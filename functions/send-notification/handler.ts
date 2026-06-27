/**
 * PackTrack — send-notification Lambda Handler
 *
 * Triggered by SNS when a package is registered.
 * 1. Fetches the resident record to get pushToken and phone
 * 2. Sends Expo push notification (if pushToken is registered)
 * 3. Sends an SMS via Amazon SNS (if the resident has a phone)
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
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

export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    let payload: PackageRegisteredEvent;
    try {
      payload = JSON.parse(record.Sns.Message) as PackageRegisteredEvent;
    } catch {
      console.error("[notify] Could not parse SNS message:", record.Sns.Message);
      continue;
    }

    if (payload.type !== "PACKAGE_REGISTERED") continue;

    await processNotification(payload);
  }
};

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
