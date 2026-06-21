/**
 * PackTrack — send-notification Lambda Handler
 *
 * Triggered by SNS when a package is registered.
 * 1. Fetches the resident record to get pushToken and phone
 * 2. Sends Expo push notification (if pushToken is registered)
 * 3. Logs WhatsApp message in DEMO_MODE (no real Meta API call)
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, PK, SK } from "../shared/constants.js";
import type { ResidentItem } from "../shared/types.js";

const WHATSAPP_MODE = process.env.WHATSAPP_MODE ?? "DEMO";

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

  // ── WhatsApp (DEMO_MODE) ─────────────────────────────────────────────────
  if (WHATSAPP_MODE === "DEMO") {
    const phone = resident.phone ?? "(sin teléfono)";
    const waMessage =
      `Hola ${resident.fullName}! 📦 Tu paquete llegó al edificio.\n\n` +
      `${locationLine ? locationLine + "\n" : ""}` +
      `Código de retiro: *${pkg.pickupCode}*\n\n` +
      `Preséntate en recepción para recogerlo.`;
    console.log("[WHATSAPP DEMO]", JSON.stringify({ to: phone, message: waMessage }, null, 2));
    // Production: POST to https://graph.facebook.com/v19.0/{phone-number-id}/messages
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
