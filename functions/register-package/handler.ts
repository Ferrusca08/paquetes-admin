/**
 * PackTrack — registerPackage Lambda Handler
 *
 * Called by AppSync when a guard registers a new package.
 * 1. Looks up the resident to get denormalized fields
 * 2. Generates a 6-digit pickup code
 * 3. Writes the Package item to DynamoDB (with GSI keys)
 * 4. Returns the full Package object for AppSync
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient } from "../shared/dynamo-client.js";

const sns = new SNSClient({});
import {
  TABLE_NAME,
  PK,
  SK,
  GSI1,
  GSI2,
  GSI3,
  PACKAGE_TTL_DAYS,
} from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  RegisterPackageInput,
  PackageItem,
  ResidentItem,
} from "../shared/types.js";
import { PackageStatus } from "../shared/types.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { generatePickupCode, generateId, now, ttlEpoch } from "../shared/utils.js";

export const handler = async (
  event: AppSyncResolverEvent<{ input: RegisterPackageInput }>,
) => {
  const { input } = event.arguments;
  const cognitoUserId = event.identity.sub;

  // ─── Validate Input ──────────────────────────────────────────────────
  if (!input.buildingId || !input.residentId || !input.unitId || !input.towerId) {
    throw new ValidationError("buildingId, towerId, unitId and residentId are required");
  }

  // ─── Look up Resident for denormalized fields ────────────────────────
  const residentResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(input.buildingId),
        SK: SK.resident(input.residentId),
      },
    }),
  );

  const resident = residentResult.Item as ResidentItem | undefined;
  if (!resident) {
    throw new NotFoundError("Resident", input.residentId);
  }

  // ─── Build the Package item ──────────────────────────────────────────
  const packageId = generateId();
  const createdAt = now();
  const pickupCode = generatePickupCode();

  const gsi1Keys = GSI1.residentPackage(input.residentId, createdAt);
  const gsi2Keys = GSI2.packageByStatus(input.buildingId, PackageStatus.RECIBIDO, createdAt);
  const gsi3Keys = GSI3.pickupCode(pickupCode);

  const item: PackageItem = {
    PK: PK.building(input.buildingId),
    SK: SK.package(packageId),
    ...gsi1Keys,
    ...gsi2Keys,
    ...gsi3Keys,
    entityType: "PACKAGE",
    id: packageId,
    buildingId: input.buildingId,
    towerId: input.towerId,
    unitId: input.unitId,
    residentId: input.residentId,
    residentName: resident.fullName,
    towerName: resident.towerName,
    unitNumber: resident.unitNumber,
    status: PackageStatus.RECIBIDO,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    labelPhotoKey: input.labelPhotoKey,
    pickupCode,
    registeredBy: cognitoUserId,
    receivedByName: input.receivedByName?.trim() || undefined,
    createdAt,
    updatedAt: createdAt,
    ttl: ttlEpoch(PACKAGE_TTL_DAYS),
  };

  // ─── Write to DynamoDB ───────────────────────────────────────────────
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );

  // ─── Publish notification event to SNS (fire-and-forget) ─────────────
  if (process.env.NOTIFICATION_TOPIC_ARN) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
          Message: JSON.stringify({
            type: "PACKAGE_REGISTERED",
            packageId,
            buildingId: input.buildingId,
            residentId: input.residentId,
            residentName: resident.fullName,
            towerName: resident.towerName,
            unitNumber: resident.unitNumber,
            pickupCode,
            carrier: input.carrier,
            createdAt,
          }),
          Subject: "PackTrack:PACKAGE_REGISTERED",
        }),
      );
    } catch (err) {
      // Don't fail package registration if notification fails
      console.error("[register-package] SNS publish failed:", err);
    }
  }

  // ─── Return for AppSync ──────────────────────────────────────────────
  return {
    id: packageId,
    buildingId: item.buildingId,
    towerId: item.towerId,
    unitId: item.unitId,
    residentId: item.residentId,
    residentName: item.residentName,
    towerName: item.towerName,
    unitNumber: item.unitNumber,
    status: item.status,
    carrier: item.carrier,
    trackingNumber: item.trackingNumber,
    labelPhotoKey: item.labelPhotoKey,
    pickupCode: item.pickupCode,
    registeredBy: item.registeredBy,
    receivedByName: item.receivedByName,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: new Date(item.ttl! * 1000).toISOString(),
  };
};
