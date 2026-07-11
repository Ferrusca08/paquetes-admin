/**
 * PackTrack — packages-resolver Lambda Handler
 *
 * Multi-resolver: handles all package-related queries & mutations
 * that don't need their own dedicated Lambda.
 *
 * Fields handled:
 *   Query.getPackage
 *   Query.listPackagesByStatus
 *   Query.listMyPackages
 *   Query.verifyPickupCode
 *   Mutation.markPackageReturned
 */
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../shared/dynamo-client.js";
import {
  TABLE_NAME,
  PK,
  SK,
  GSI_NAMES,
  GSI2,
} from "../shared/constants.js";
import type { AppSyncResolverEvent, PackageItem } from "../shared/types.js";
import { PackageStatus } from "../shared/types.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { now } from "../shared/utils.js";

/** Strip DynamoDB internal keys from the response */
function toGraphQL(item: PackageItem) {
  return {
    id: item.id,
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
    evidencePhotoKey: item.evidencePhotoKey,
    pickupCode: item.pickupCode,
    ocrRawData: item.ocrRawData,
    registeredBy: item.registeredBy,
    receivedByName: item.receivedByName,
    deliveredBy: item.deliveredBy,
    deliveredAt: item.deliveredAt,
    notifiedAt: item.notifiedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: item.expiresAt,
  };
}

export const handler = async (event: AppSyncResolverEvent) => {
  const field = event.info.fieldName;

  switch (field) {
    case "getPackage":
      return getPackage(event);
    case "listPackagesByStatus":
      return listPackagesByStatus(event);
    case "listMyPackages":
      return listMyPackages(event);
    case "verifyPickupCode":
      return verifyPickupCode(event);
    case "markPackageReturned":
      return markPackageReturned(event);
    default:
      throw new Error(`Unknown field: ${field}`);
  }
};

// ─── Query.getPackage ────────────────────────────────────────────────────

async function getPackage(
  event: AppSyncResolverEvent<{ buildingId: string; packageId: string }>,
) {
  const { buildingId, packageId } = event.arguments;
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(buildingId),
        SK: SK.package(packageId),
      },
    }),
  );
  if (!result.Item) return null;
  return toGraphQL(result.Item as PackageItem);
}

// ─── Query.listPackagesByStatus (GSI2) ───────────────────────────────────

async function listPackagesByStatus(
  event: AppSyncResolverEvent<{
    buildingId: string;
    status: PackageStatus;
    limit?: number;
    nextToken?: string;
  }>,
) {
  const { buildingId, status, limit = 20, nextToken } = event.arguments;
  const gsi2pk = `BLDG#${buildingId}#ST#${status}`;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI2,
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": gsi2pk },
      ScanIndexForward: false, // newest first
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (result.Items as PackageItem[]).map(toGraphQL),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

// ─── Query.listMyPackages (GSI1) ─────────────────────────────────────────

async function listMyPackages(
  event: AppSyncResolverEvent<{
    residentId: string;
    limit?: number;
    nextToken?: string;
  }>,
) {
  const { residentId, limit = 20, nextToken } = event.arguments;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI1,
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": `RES#${residentId}`,
        ":skPrefix": "PKG#",
      },
      ScanIndexForward: false,
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (result.Items as PackageItem[]).map(toGraphQL),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

// ─── Query.verifyPickupCode (GSI3) ───────────────────────────────────────

async function verifyPickupCode(
  event: AppSyncResolverEvent<{ code: string }>,
) {
  const { code } = event.arguments;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI3,
      KeyConditionExpression: "gsi3pk = :pk",
      ExpressionAttributeValues: { ":pk": `CODE#${code}` },
      Limit: 1,
    }),
  );

  if (!result.Items || result.Items.length === 0) return null;
  return toGraphQL(result.Items[0] as PackageItem);
}

// ─── Mutation.markPackageReturned ─────────────────────────────────────────

async function markPackageReturned(
  event: AppSyncResolverEvent<{ buildingId: string; packageId: string }>,
) {
  const { buildingId, packageId } = event.arguments;
  const updatedAt = now();

  // First get the package to know its createdAt for GSI2
  const existing = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(buildingId),
        SK: SK.package(packageId),
      },
    }),
  );

  if (!existing.Item) {
    throw new NotFoundError("Package", packageId);
  }

  const pkg = existing.Item as PackageItem;
  if (pkg.status === PackageStatus.ENTREGADO) {
    throw new ValidationError("Cannot return a delivered package");
  }

  const newGsi2Keys = GSI2.packageByStatus(
    buildingId,
    PackageStatus.DEVUELTO,
    pkg.createdAt,
  );

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: PK.building(buildingId),
        SK: SK.package(packageId),
      },
      UpdateExpression: `
        SET #status = :status,
            updatedAt = :updatedAt,
            gsi2pk = :gsi2pk,
            gsi2sk = :gsi2sk
        REMOVE gsi3pk
      `,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": PackageStatus.DEVUELTO,
        ":updatedAt": updatedAt,
        ":gsi2pk": newGsi2Keys.gsi2pk,
        ":gsi2sk": newGsi2Keys.gsi2sk,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return toGraphQL(result.Attributes as PackageItem);
}
