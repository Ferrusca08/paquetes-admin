/**
 * PackTrack — reminder-handler Lambda
 *
 * Triggered daily by EventBridge. Finds packages still waiting to be picked up
 * (RECIBIDO / NOTIFICADO) beyond a threshold and publishes a PACKAGE_REMINDER
 * event to SNS so send-notification pushes a nudge to the resident.
 *
 * NOTE (scale): uses a table Scan with a filter — fine for a once-a-day batch at
 * MVP volume. For large buildings, switch to per-building GSI2 queries
 * (BLDG#<id>#ST#RECIBIDO) driven by a buildings list.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME } from "../shared/constants.js";
import type { PackageItem } from "../shared/types.js";
import { PackageStatus } from "../shared/types.js";

const sns = new SNSClient({});

/** Remind about packages older than this many days. */
const REMINDER_AFTER_DAYS = 2;

export const handler = async (): Promise<void> => {
  const topicArn = process.env.NOTIFICATION_TOPIC_ARN;
  if (!topicArn) {
    console.warn("[reminder] NOTIFICATION_TOPIC_ARN not set — nothing to do");
    return;
  }

  const threshold = new Date(Date.now() - REMINDER_AFTER_DAYS * 86400_000).toISOString();
  const pending: PackageItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression:
          "entityType = :pkg AND #st IN (:recibido, :notificado) AND createdAt < :threshold",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":pkg": "PACKAGE",
          ":recibido": PackageStatus.RECIBIDO,
          ":notificado": PackageStatus.NOTIFICADO,
          ":threshold": threshold,
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    pending.push(...((res.Items as PackageItem[]) ?? []));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`[reminder] ${pending.length} package(s) pending pickup > ${REMINDER_AFTER_DAYS}d`);

  for (const pkg of pending) {
    const daysWaiting = Math.max(
      1,
      Math.floor((Date.now() - new Date(pkg.createdAt).getTime()) / 86400_000),
    );
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Subject: "PackTrack:PACKAGE_REMINDER",
          Message: JSON.stringify({
            type: "PACKAGE_REMINDER",
            buildingId: pkg.buildingId,
            residentId: pkg.residentId,
            towerName: pkg.towerName,
            unitNumber: pkg.unitNumber,
            daysWaiting,
          }),
        }),
      );
    } catch (err) {
      console.error(`[reminder] publish failed for package ${pkg.id}:`, err);
    }
  }
};
