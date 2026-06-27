/**
 * PackTrack — confirmPickup Lambda Handler
 *
 * Called by AppSync when a guard confirms package pickup.
 * 1. Loads the package from DynamoDB
 * 2. Validates the pickup code matches
 * 3. Updates the package status to ENTREGADO
 * 4. Removes old GSI2/GSI3 keys, sets new GSI2 key
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, PK, SK, GSI2 } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  ConfirmPickupInput,
  PackageItem,
} from "../shared/types.js";
import { PackageStatus } from "../shared/types.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { now } from "../shared/utils.js";

export const handler = async (
  event: AppSyncResolverEvent<{ input: ConfirmPickupInput }>,
) => {
  const { input } = event.arguments;
  const cognitoUserId = event.identity.sub;

  // ─── Load Package ────────────────────────────────────────────────────
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(input.buildingId),
        SK: SK.package(input.packageId),
      },
    }),
  );

  const pkg = result.Item as PackageItem | undefined;
  if (!pkg) {
    throw new NotFoundError("Package", input.packageId);
  }

  // ─── Validate Status ─────────────────────────────────────────────────
  if (pkg.status === PackageStatus.ENTREGADO) {
    throw new ValidationError("Package already delivered");
  }
  if (pkg.status === PackageStatus.DEVUELTO) {
    throw new ValidationError("Package was returned");
  }

  // ─── Validate Pickup Code ────────────────────────────────────────────
  if (pkg.pickupCode !== input.pickupCode) {
    throw new ValidationError("Invalid pickup code");
  }

  // ─── Update Package ──────────────────────────────────────────────────
  const deliveredAt = now();
  const newGsi2Keys = GSI2.packageByStatus(
    input.buildingId,
    PackageStatus.ENTREGADO,
    pkg.createdAt,
  );

  const updateResult = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(input.buildingId),
        SK: SK.package(input.packageId),
      },
      UpdateExpression: `
        SET #status = :status,
            deliveredBy = :deliveredBy,
            deliveredAt = :deliveredAt,
            updatedAt = :updatedAt,
            gsi2pk = :gsi2pk,
            gsi2sk = :gsi2sk
        REMOVE gsi3pk
      `,
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": PackageStatus.ENTREGADO,
        ":deliveredBy": cognitoUserId,
        ":deliveredAt": deliveredAt,
        ":updatedAt": deliveredAt,
        ":gsi2pk": newGsi2Keys.gsi2pk,
        ":gsi2sk": newGsi2Keys.gsi2sk,
        // Guards against a race that double-delivers a package. The evidence
        // photo, if any, is written in the separate update below.
        ":alreadyDelivered": PackageStatus.ENTREGADO,
      },
      ConditionExpression: "#status <> :alreadyDelivered",
      ReturnValues: "ALL_NEW",
    }),
  );

  // Handle optional evidence photo in a separate update if provided
  if (input.evidencePhotoKey) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: PK.building(input.buildingId),
          SK: SK.package(input.packageId),
        },
        UpdateExpression: "SET evidencePhotoKey = :evidencePhotoKey",
        ExpressionAttributeValues: {
          ":evidencePhotoKey": input.evidencePhotoKey,
        },
      }),
    );
  }

  const updated = updateResult.Attributes!;

  return {
    id: updated.id,
    buildingId: updated.buildingId,
    towerId: updated.towerId,
    unitId: updated.unitId,
    residentId: updated.residentId,
    residentName: updated.residentName,
    towerName: updated.towerName,
    unitNumber: updated.unitNumber,
    status: updated.status,
    carrier: updated.carrier,
    trackingNumber: updated.trackingNumber,
    labelPhotoKey: updated.labelPhotoKey,
    evidencePhotoKey: input.evidencePhotoKey ?? updated.evidencePhotoKey,
    pickupCode: updated.pickupCode,
    registeredBy: updated.registeredBy,
    deliveredBy: updated.deliveredBy,
    deliveredAt: updated.deliveredAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    expiresAt: updated.expiresAt,
  };
};
