/**
 * PackTrack — send-notification Lambda Handler
 *
 * Triggered by SNS when a package is registered.
 * 1. Fetches the resident record to get pushToken and phone
 * 2. Sends Expo push notification (if pushToken is registered)
 * 3. Sends an SMS via Amazon SNS (if the resident has a phone)
 */
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, PK, SK } from "../shared/constants.js";
import type { ResidentItem } from "../shared/types.js";

const SMS_ENABLED = (process.env.SMS_ENABLED ?? "true") === "true";
// Optional alphanumeric sender ID. Not supported in every country (e.g. US);
// in Mexico it requires registration with AWS. Empty → SNS uses a long code.
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "";
const sns = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });

interface SNSRecord {
  Sns: { Message: string };
}

interface SNSEvent {
  Records: SNSRecord[];
}

interface PackageRegisteredEvent {
  type: "PACKAGE_REGISTERED";
  packageId: string;
  buildingId: string;
  residentId: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  pickupCode: string;
  carrier?: string;
  createdAt: string;
}

interface VisitCheckinEvent {
  type: "VISIT_CHECKIN";
  buildingId: string;
  residentId: string;
  visitorName: string;
  towerName?: string;
  unitNumber?: string;
}

interface PackageReminderEvent {
  type: "PACKAGE_REMINDER";
  buildingId: string;
  residentId: string;
  towerName?: string;
  unitNumber?: string;
  daysWaiting: number;
}

interface AnnouncementEvent {
  type: "ANNOUNCEMENT";
  buildingId: string;
  title: string;
  body: string;
}

type NotificationEvent =
  | PackageRegisteredEvent
  | VisitCheckinEvent
  | PackageReminderEvent
  | AnnouncementEvent;

export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    let payload: NotificationEvent;
    try {
      payload = JSON.parse(record.Sns.Message) as NotificationEvent;
    } catch {
      console.error("[notify] Could not parse SNS message:", record.Sns.Message);
      continue;
    }

    switch (payload.type) {
      case "PACKAGE_REGISTERED":
        await processNotification(payload);
        break;
      case "VISIT_CHECKIN":
        await processVisitCheckin(payload);
        break;
      case "PACKAGE_REMINDER":
        await processReminder(payload);
        break;
      case "ANNOUNCEMENT":
        await processAnnouncement(payload);
        break;
      default:
        console.warn("[notify] Unknown message type:", (payload as { type?: string }).type);
    }
  }
};

/** Look up a resident's push token by id. */
async function getResident(buildingId: string, residentId: string): Promise<ResidentItem | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.resident(residentId) },
    }),
  );
  return result.Item as ResidentItem | undefined;
}

function locationOf(towerName?: string, unitNumber?: string): string {
  return [towerName ? `Torre ${towerName}` : "", unitNumber ? `Depto ${unitNumber}` : ""]
    .filter(Boolean)
    .join(", ");
}

async function processVisitCheckin(v: VisitCheckinEvent): Promise<void> {
  const resident = await getResident(v.buildingId, v.residentId);
  if (!resident?.pushToken) {
    console.log(`[notify] No push token for resident ${v.residentId} — skipping visit push`);
    return;
  }
  await sendExpoPush({
    token: resident.pushToken,
    title: "👋 Tienes una visita",
    body: `${v.visitorName} está en recepción.`,
    packageId: "",
    buildingId: v.buildingId,
  });
}

async function processAnnouncement(a: AnnouncementEvent): Promise<void> {
  // Push to every resident of the building that has a registered push token.
  let lastKey: Record<string, unknown> | undefined;
  let sent = 0;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": PK.building(a.buildingId), ":sk": "RES#" },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of (res.Items as ResidentItem[]) ?? []) {
      if (!item.pushToken) continue;
      await sendExpoPush({
        token: item.pushToken,
        title: `📣 ${a.title}`,
        body: a.body,
        packageId: "",
        buildingId: a.buildingId,
      });
      sent++;
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  console.log(`[notify] announcement pushed to ${sent} resident(s)`);
}

async function processReminder(r: PackageReminderEvent): Promise<void> {
  const resident = await getResident(r.buildingId, r.residentId);
  if (!resident?.pushToken) {
    console.log(`[notify] No push token for resident ${r.residentId} — skipping reminder`);
    return;
  }
  const loc = locationOf(r.towerName, r.unitNumber);
  const days = r.daysWaiting === 1 ? "1 día" : `${r.daysWaiting} días`;
  await sendExpoPush({
    token: resident.pushToken,
    title: "📦 Paquete sin retirar",
    body: `Tienes un paquete esperando desde hace ${days}${loc ? ` (${loc})` : ""}. Pásalo a recoger.`,
    packageId: "",
    buildingId: r.buildingId,
  });
}

async function processNotification(pkg: PackageRegisteredEvent): Promise<void> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(pkg.buildingId),
        SK: SK.resident(pkg.residentId),
      },
    }),
  );

  const resident = result.Item as ResidentItem | undefined;
  if (!resident) {
    console.warn(`[notify] Resident not found: ${pkg.residentId}`);
    return;
  }

  const carrierLine = pkg.carrier ? `${pkg.carrier} · ` : "";
  const locationLine = [
    pkg.towerName ? `Torre ${pkg.towerName}` : "",
    pkg.unitNumber ? `Depto ${pkg.unitNumber}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const pushTitle = "📦 Llegó tu paquete";
  const pushBody = `${carrierLine}${locationLine}\nCódigo de retiro: ${pkg.pickupCode}`;

  // ── Expo Push Notification ───────────────────────────────────────────────
  if (resident.pushToken) {
    await sendExpoPush({
      token: resident.pushToken,
      title: pushTitle,
      body: pushBody,
      packageId: pkg.packageId,
      buildingId: pkg.buildingId,
    });
  } else {
    console.log(`[notify] No push token for resident ${pkg.residentId} — skipping push`);
  }

  // ── SMS (Amazon SNS) ─────────────────────────────────────────────────────
  if (SMS_ENABLED && resident.phone) {
    const firstName = resident.fullName.split(" ")[0];
    const smsLoc = locationLine ? ` (${locationLine})` : "";
    // Kept ASCII / accent-free so it fits in a single GSM-7 segment (cheaper).
    const smsMessage = `PackTrack: Hola ${firstName}, llego tu paquete${smsLoc}. Codigo de retiro: ${pkg.pickupCode}`;
    await sendSms(resident.phone, smsMessage);
  } else if (!resident.phone) {
    console.log(`[notify] No phone for resident ${pkg.residentId} — skipping SMS`);
  }
}

async function sendSms(phone: string, message: string): Promise<void> {
  if (!/^\+\d{8,15}$/.test(phone)) {
    console.warn(`[notify] Phone not in E.164 format, skipping SMS: ${phone}`);
    return;
  }
  try {
    const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
      // Transactional → highest delivery reliability (vs Promotional).
      "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
    };
    if (SMS_SENDER_ID) {
      messageAttributes["AWS.SNS.SMS.SenderID"] = {
        DataType: "String",
        StringValue: SMS_SENDER_ID,
      };
    }
    const res = await sns.send(
      new PublishCommand({
        PhoneNumber: phone,
        Message: message,
        MessageAttributes: messageAttributes,
      }),
    );
    console.log(`[notify] SMS sent to ${phone}:`, res.MessageId);
  } catch (err) {
    console.error("[notify] SMS send failed:", err);
  }
}

async function sendExpoPush({
  token,
  title,
  body,
  packageId,
  buildingId,
}: {
  token: string;
  title: string;
  body: string;
  packageId: string;
  buildingId: string;
}): Promise<void> {
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data: { packageId, buildingId },
        sound: "default",
        priority: "high",
        channelId: "paquetes",
      }),
    });

    const json = (await response.json()) as {
      data?: { status: string; id?: string };
      errors?: unknown[];
    };

    if (!response.ok || json.errors?.length) {
      console.error("[notify] Expo push error:", JSON.stringify(json));
    } else {
      console.log("[notify] Expo push sent:", json.data?.status, json.data?.id);
    }
  } catch (err) {
    console.error("[notify] Expo push request failed:", err);
  }
}
