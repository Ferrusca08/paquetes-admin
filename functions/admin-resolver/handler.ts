/**
 * PackTrack — admin-resolver Lambda Handler
 *
 * Multi-resolver: handles all admin CRUD operations and resident management.
 *
 * Fields handled:
 *   Query.getBuilding, Query.listBuildings
 *   Query.listTowers, Query.listUnits
 *   Query.listResidents, Query.searchResidents
 *   Mutation.createBuilding, Mutation.updateBuilding, Mutation.deleteBuilding
 *   Mutation.createTower, Mutation.deleteTower
 *   Mutation.createUnit, Mutation.deleteUnit
 *   Mutation.createResident, Mutation.updateResident, Mutation.deleteResident
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  ListUsersInGroupCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, BUCKET_NAME, PK, SK, GSI1, GSI_NAMES } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  BuildingItem,
  TowerItem,
  UnitItem,
  ResidentItem,
  AnnouncementItem,
  ReportItem,
  DocumentItem,
  CreateBuildingInput,
  UpdateBuildingInput,
  CreateTowerInput,
  CreateUnitInput,
  CreateResidentInput,
  UpdateResidentInput,
} from "../shared/types.js";
import { ReportStatus } from "../shared/types.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { generateId, now, normalizeName } from "../shared/utils.js";

const s3 = new S3Client({});
const sns = new SNSClient({});

// ─── Cognito (user provisioning) ────────────────────────────────────────────
const REGION = process.env.AWS_REGION || "us-east-1";
const USER_POOL_ID = process.env.USER_POOL_ID || "";
const GROUP_RESIDENTS = "residentes";
const GROUP_GUARDS = "guardias";
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// Fields that mutate/manage data and must only be callable by admins.
// Read queries used by the mobile app (searchResidents, listBuildings, etc.)
// and registerPushToken (called by residents) are intentionally excluded.
const ADMIN_ONLY = new Set([
  "createBuilding",
  "updateBuilding",
  "deleteBuilding",
  "createTower",
  "deleteTower",
  "createUnit",
  "deleteUnit",
  "createResident",
  "updateResident",
  "deleteResident",
  "createGuard",
  "listGuards",
  "deleteGuard",
  "createAnnouncement",
  "deleteAnnouncement",
  "listReports",
  "setReportStatus",
  "createDocument",
  "deleteDocument",
]);

function callerGroups(event: AppSyncResolverEvent): string[] {
  const id = (event.identity || {}) as {
    groups?: string[];
    claims?: Record<string, unknown>;
  };
  if (Array.isArray(id.groups)) return id.groups;
  const c = id.claims?.["cognito:groups"];
  if (Array.isArray(c)) return c as string[];
  if (typeof c === "string") return c.split(",");
  return [];
}

function requireAdmin(event: AppSyncResolverEvent): void {
  if (!callerGroups(event).includes("admins")) {
    throw new Error("Unauthorized: this operation requires the 'admins' group");
  }
}

/**
 * Creates a Cognito login and assigns it to a group. Returns the user's sub.
 * Sends an invitation email with a temporary password (COGNITO_DEFAULT email).
 */
async function provisionUser(opts: {
  email: string;
  phone?: string | null;
  fullName: string;
  group: string;
  attributes?: Record<string, string | undefined>;
}): Promise<string> {
  if (!USER_POOL_ID) {
    throw new Error("USER_POOL_ID is not configured");
  }
  const userAttributes: { Name: string; Value: string }[] = [
    { Name: "email", Value: opts.email },
    { Name: "email_verified", Value: "true" },
    { Name: "name", Value: opts.fullName },
  ];
  // phone_number must be E.164 (e.g. +5215512345678) or Cognito rejects it.
  if (opts.phone && /^\+\d{8,15}$/.test(opts.phone)) {
    userAttributes.push({ Name: "phone_number", Value: opts.phone });
  }
  for (const [k, v] of Object.entries(opts.attributes || {})) {
    if (v) userAttributes.push({ Name: k, Value: v });
  }
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: opts.email,
      UserAttributes: userAttributes,
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: opts.email,
      GroupName: opts.group,
    }),
  );
  const sub = created.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
  return sub || opts.email;
}

export const handler = async (event: AppSyncResolverEvent) => {
  const field = event.info.fieldName;

  if (ADMIN_ONLY.has(field)) requireAdmin(event);

  switch (field) {
    // ─── Queries ──────────────────────────────────────────────────────
    case "getBuilding":
      return getBuilding(event);
    case "listBuildings":
      return listBuildings(event);
    case "listTowers":
      return listTowers(event);
    case "listUnits":
      return listUnits(event);
    case "listResidents":
      return listResidents(event);
    case "searchResidents":
      return searchResidents(event);

    // ─── Building Mutations ──────────────────────────────────────────
    case "createBuilding":
      return createBuilding(event);
    case "updateBuilding":
      return updateBuilding(event);
    case "deleteBuilding":
      return deleteBuilding(event);

    // ─── Tower Mutations ─────────────────────────────────────────────
    case "createTower":
      return createTower(event);
    case "deleteTower":
      return deleteTower(event);

    // ─── Unit Mutations ──────────────────────────────────────────────
    case "createUnit":
      return createUnit(event);
    case "deleteUnit":
      return deleteUnit(event);

    // ─── Resident Mutations ──────────────────────────────────────────
    case "createResident":
      return createResident(event);
    case "updateResident":
      return updateResident(event);
    case "deleteResident":
      return deleteResident(event);
    case "registerPushToken":
      return registerPushToken(
        event as AppSyncResolverEvent<{
          residentId: string;
          buildingId: string;
          pushToken: string;
        }>,
      );

    // ─── Guard (Cognito-only staff users) ────────────────────────────
    case "createGuard":
      return createGuard(event as AppSyncResolverEvent<{ input: CreateGuardInput }>);
    case "listGuards":
      return listGuards(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "deleteGuard":
      return deleteGuard(event as AppSyncResolverEvent<{ username: string }>);

    // ─── Community: announcements ────────────────────────────────────
    case "listAnnouncements":
      return listAnnouncements(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "createAnnouncement":
      return createAnnouncement(
        event as AppSyncResolverEvent<{ input: { buildingId: string; title: string; body: string } }>,
      );
    case "deleteAnnouncement":
      return deleteAnnouncement(
        event as AppSyncResolverEvent<{ buildingId: string; announcementId: string }>,
      );

    // ─── Community: reports / incidencias ────────────────────────────
    case "createReport":
      return createReport(
        event as AppSyncResolverEvent<{
          input: { buildingId: string; residentId: string; category: string; description: string };
        }>,
      );
    case "listReports":
      return listReports(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "listMyReports":
      return listMyReports(event as AppSyncResolverEvent<{ residentId: string }>);
    case "setReportStatus":
      return setReportStatus(
        event as AppSyncResolverEvent<{ buildingId: string; reportId: string; status: ReportStatus }>,
      );

    // ─── Community: documents ────────────────────────────────────────
    case "listDocuments":
      return listDocuments(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "getDocumentUrl":
      return getDocumentUrl(
        event as AppSyncResolverEvent<{ buildingId: string; documentId: string }>,
      );
    case "createDocument":
      return createDocument(
        event as AppSyncResolverEvent<{
          input: { buildingId: string; title: string; fileExtension: string };
        }>,
      );
    case "deleteDocument":
      return deleteDocument(
        event as AppSyncResolverEvent<{ buildingId: string; documentId: string }>,
      );

    default:
      throw new Error(`Unknown field: ${field}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// BUILDING
// ═══════════════════════════════════════════════════════════════════════════

async function getBuilding(event: AppSyncResolverEvent<{ id: string }>) {
  const { id } = event.arguments;
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(id), SK: SK.meta },
    }),
  );
  if (!result.Item) return null;
  const b = result.Item as BuildingItem;
  return { id: b.id, name: b.name, address: b.address, createdAt: b.createdAt, updatedAt: b.updatedAt };
}

async function listBuildings(
  event: AppSyncResolverEvent<{ limit?: number; nextToken?: string }>,
) {
  const { limit = 50, nextToken } = event.arguments;
  // Scan for all building META records. OK for MVP with <100 buildings.
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const scanResult = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "entityType = :et AND SK = :meta",
      ExpressionAttributeValues: { ":et": "BUILDING", ":meta": SK.meta },
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (scanResult.Items as BuildingItem[]).map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
    nextToken: scanResult.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(scanResult.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

async function createBuilding(
  event: AppSyncResolverEvent<{ input: CreateBuildingInput }>,
) {
  const { input } = event.arguments;
  const id = generateId();
  const createdAt = now();

  const item: BuildingItem = {
    PK: PK.building(id),
    SK: SK.meta,
    entityType: "BUILDING",
    id,
    name: input.name,
    address: input.address,
    createdAt,
    updatedAt: createdAt,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { id, name: item.name, address: item.address, createdAt, updatedAt: createdAt };
}

async function updateBuilding(
  event: AppSyncResolverEvent<{ input: UpdateBuildingInput }>,
) {
  const { input } = event.arguments;
  const updates: string[] = ["updatedAt = :updatedAt"];
  const values: Record<string, unknown> = { ":updatedAt": now() };

  if (input.name !== undefined) {
    updates.push("#name = :name");
    values[":name"] = input.name;
  }
  if (input.address !== undefined) {
    updates.push("address = :address");
    values[":address"] = input.address;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(input.id), SK: SK.meta },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeNames: input.name !== undefined ? { "#name": "name" } : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  const b = result.Attributes as BuildingItem;
  return { id: b.id, name: b.name, address: b.address, createdAt: b.createdAt, updatedAt: b.updatedAt };
}

async function deleteBuilding(event: AppSyncResolverEvent<{ id: string }>) {
  const { id } = event.arguments;
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(id), SK: SK.meta },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOWER
// ═══════════════════════════════════════════════════════════════════════════

async function listTowers(
  event: AppSyncResolverEvent<{ buildingId: string; limit?: number; nextToken?: string }>,
) {
  const { buildingId, limit = 50, nextToken } = event.arguments;
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": PK.building(buildingId),
        ":sk": "TWR#",
      },
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (result.Items as TowerItem[]).map((t) => ({
      id: t.id, buildingId: t.buildingId, name: t.name, createdAt: t.createdAt,
    })),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

async function createTower(
  event: AppSyncResolverEvent<{ input: CreateTowerInput }>,
) {
  const { input } = event.arguments;
  const id = generateId();
  const createdAt = now();

  const item: TowerItem = {
    PK: PK.building(input.buildingId),
    SK: SK.tower(id),
    entityType: "TOWER",
    id,
    buildingId: input.buildingId,
    name: input.name,
    createdAt,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { id, buildingId: input.buildingId, name: input.name, createdAt };
}

async function deleteTower(
  event: AppSyncResolverEvent<{ buildingId: string; towerId: string }>,
) {
  const { buildingId, towerId } = event.arguments;
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.tower(towerId) },
    }),
  );
  return towerId;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIT
// ═══════════════════════════════════════════════════════════════════════════

async function listUnits(
  event: AppSyncResolverEvent<{
    buildingId: string;
    towerId?: string;
    limit?: number;
    nextToken?: string;
  }>,
) {
  const { buildingId, towerId, limit = 100, nextToken } = event.arguments;

  // If towerId is provided, query GSI1 for units in that tower
  if (towerId) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `TWR#${towerId}`,
          ":sk": "UNIT#",
        },
        Limit: limit,
        ...(nextToken
          ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
          : {}),
      }),
    );
    return {
      items: (result.Items as UnitItem[]).map((u) => ({
        id: u.id, buildingId: u.buildingId, towerId: u.towerId, number: u.number,
        towerName: u.towerName, createdAt: u.createdAt,
      })),
      nextToken: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
        : null,
    };
  }

  // Otherwise, query the main table for all units in the building
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": PK.building(buildingId),
        ":sk": "UNIT#",
      },
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (result.Items as UnitItem[]).map((u) => ({
      id: u.id, buildingId: u.buildingId, towerId: u.towerId, number: u.number,
      towerName: u.towerName, createdAt: u.createdAt,
    })),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

async function createUnit(
  event: AppSyncResolverEvent<{ input: CreateUnitInput }>,
) {
  const { input } = event.arguments;
  const id = generateId();
  const createdAt = now();

  // Look up tower name for denormalization
  const towerResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(input.buildingId), SK: SK.tower(input.towerId) },
    }),
  );
  const towerName = (towerResult.Item as TowerItem | undefined)?.name;

  const gsi1Keys = GSI1.unitByTower(input.towerId, id);

  const item: UnitItem = {
    PK: PK.building(input.buildingId),
    SK: SK.unit(id),
    ...gsi1Keys,
    entityType: "UNIT",
    id,
    buildingId: input.buildingId,
    towerId: input.towerId,
    number: input.number,
    towerName,
    createdAt,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { id, buildingId: input.buildingId, towerId: input.towerId, number: input.number, towerName, createdAt };
}

async function deleteUnit(
  event: AppSyncResolverEvent<{ buildingId: string; unitId: string }>,
) {
  const { buildingId, unitId } = event.arguments;
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.unit(unitId) },
    }),
  );
  return unitId;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESIDENT
// ═══════════════════════════════════════════════════════════════════════════

async function listResidents(
  event: AppSyncResolverEvent<{ buildingId: string; limit?: number; nextToken?: string }>,
) {
  const { buildingId, limit = 50, nextToken } = event.arguments;
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": PK.building(buildingId),
        ":sk": "RES#",
      },
      Limit: limit,
      ...(nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(nextToken, "base64url").toString()) }
        : {}),
    }),
  );

  return {
    items: (result.Items as ResidentItem[]).map(residentToGraphQL),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

async function searchResidents(
  event: AppSyncResolverEvent<{ buildingId: string; query: string; limit?: number }>,
) {
  const { buildingId, query, limit = 10 } = event.arguments;
  const normalizedQuery = normalizeName(query);

  // Query all residents in the building and filter by normalized name
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "contains(nameNormalized, :query)",
      ExpressionAttributeValues: {
        ":pk": PK.building(buildingId),
        ":sk": "RES#",
        ":query": normalizedQuery,
      },
      Limit: limit * 5, // Over-fetch to account for filter
    }),
  );

  return {
    items: (result.Items as ResidentItem[]).slice(0, limit).map(residentToGraphQL),
    nextToken: null,
  };
}

async function createResident(
  event: AppSyncResolverEvent<{ input: CreateResidentInput }>,
) {
  const { input } = event.arguments;
  const id = generateId();
  const createdAt = now();

  // Look up tower/unit names for denormalization
  const [towerResult, unitResult] = await Promise.all([
    docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: PK.building(input.buildingId), SK: SK.tower(input.towerId) },
      }),
    ),
    docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: PK.building(input.buildingId), SK: SK.unit(input.unitId) },
      }),
    ),
  ]);

  const towerName = (towerResult.Item as TowerItem | undefined)?.name;
  const unitNumber = (unitResult.Item as UnitItem | undefined)?.number;

  const gsi1Keys = GSI1.residentProfile(id);

  // Provision a Cognito login (residentes group) so the resident can use the
  // mobile app. Requires an email; the resident's id is stored as
  // custom:residentId so the app can resolve their profile.
  let cognitoUserId: string | undefined;
  if (input.email && USER_POOL_ID) {
    cognitoUserId = await provisionUser({
      email: input.email,
      phone: input.phone,
      fullName: input.fullName,
      group: GROUP_RESIDENTS,
      attributes: {
        "custom:buildingId": input.buildingId,
        "custom:residentId": id,
      },
    });
  }

  const item: ResidentItem = {
    PK: PK.building(input.buildingId),
    SK: SK.resident(id),
    ...gsi1Keys,
    entityType: "RESIDENT",
    id,
    buildingId: input.buildingId,
    towerId: input.towerId,
    unitId: input.unitId,
    fullName: input.fullName,
    nameNormalized: normalizeName(input.fullName),
    phone: input.phone,
    email: input.email,
    cognitoUserId,
    towerName,
    unitNumber,
    createdAt,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return residentToGraphQL(item);
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARD  (Cognito-only staff users — no DynamoDB entity)
// ═══════════════════════════════════════════════════════════════════════════

interface CreateGuardInput {
  buildingId: string;
  fullName: string;
  email: string;
  phone?: string | null;
}

async function createGuard(
  event: AppSyncResolverEvent<{ input: CreateGuardInput }>,
) {
  const { input } = event.arguments;
  const sub = await provisionUser({
    email: input.email,
    phone: input.phone,
    fullName: input.fullName,
    group: GROUP_GUARDS,
    attributes: { "custom:buildingId": input.buildingId },
  });
  return {
    id: sub,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone ?? null,
    buildingId: input.buildingId,
    status: "FORCE_CHANGE_PASSWORD",
    createdAt: now(),
  };
}

async function listGuards(
  event: AppSyncResolverEvent<{ buildingId: string }>,
) {
  const { buildingId } = event.arguments;
  const res = await cognito.send(
    new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: GROUP_GUARDS,
      Limit: 60,
    }),
  );
  const attr = (u: { Attributes?: { Name?: string; Value?: string }[] }, n: string) =>
    u.Attributes?.find((a) => a.Name === n)?.Value;
  const items = (res.Users || [])
    .map((u) => ({
      id: u.Username as string,
      fullName: attr(u, "name") || attr(u, "email") || (u.Username as string),
      email: attr(u, "email") || "",
      phone: attr(u, "phone_number") || null,
      buildingId: attr(u, "custom:buildingId") || null,
      status: u.UserStatus || null,
      createdAt: u.UserCreateDate
        ? new Date(u.UserCreateDate).toISOString()
        : null,
    }))
    .filter((g) => !buildingId || g.buildingId === buildingId);
  return { items, nextToken: null };
}

async function deleteGuard(
  event: AppSyncResolverEvent<{ username: string }>,
) {
  const { username } = event.arguments;
  await cognito.send(
    new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }),
  );
  return username;
}

async function updateResident(
  event: AppSyncResolverEvent<{ input: UpdateResidentInput }>,
) {
  const { input } = event.arguments;
  const updates: string[] = [];
  const values: Record<string, unknown> = {};
  const names: Record<string, string> = {};

  if (input.fullName !== undefined) {
    updates.push("fullName = :fullName", "nameNormalized = :nameNormalized");
    values[":fullName"] = input.fullName;
    values[":nameNormalized"] = normalizeName(input.fullName);
  }
  if (input.phone !== undefined) {
    updates.push("phone = :phone");
    values[":phone"] = input.phone;
  }
  if (input.email !== undefined) {
    updates.push("email = :email");
    values[":email"] = input.email;
  }

  if (updates.length === 0) {
    // Nothing to update, return existing
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: PK.building(input.buildingId), SK: SK.resident(input.id) },
      }),
    );
    if (!existing.Item) throw new NotFoundError("Resident", input.id);
    return residentToGraphQL(existing.Item as ResidentItem);
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(input.buildingId), SK: SK.resident(input.id) },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  return residentToGraphQL(result.Attributes as ResidentItem);
}

async function deleteResident(
  event: AppSyncResolverEvent<{ buildingId: string; residentId: string }>,
) {
  const { buildingId, residentId } = event.arguments;
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.resident(residentId) },
    }),
  );
  return residentId;
}

async function registerPushToken(
  event: AppSyncResolverEvent<{ residentId: string; buildingId: string; pushToken: string }>,
) {
  const { residentId, buildingId, pushToken } = event.arguments;
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.resident(residentId) },
      UpdateExpression: "SET pushToken = :token",
      ExpressionAttributeValues: { ":token": pushToken },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function residentToGraphQL(r: ResidentItem) {
  return {
    id: r.id,
    buildingId: r.buildingId,
    towerId: r.towerId,
    unitId: r.unitId,
    cognitoUserId: r.cognitoUserId,
    fullName: r.fullName,
    nameNormalized: r.nameNormalized,
    phone: r.phone,
    email: r.email,
    towerName: r.towerName,
    unitNumber: r.unitNumber,
    createdAt: r.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNITY: ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════

function announcementOut(a: AnnouncementItem) {
  return {
    id: a.id,
    buildingId: a.buildingId,
    title: a.title,
    body: a.body,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
  };
}

async function listAnnouncements(event: AppSyncResolverEvent<{ buildingId: string }>) {
  const { buildingId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK.building(buildingId), ":sk": "ANNC#" },
    }),
  );
  const items = (r.Items as AnnouncementItem[]).map(announcementOut);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  return { items, nextToken: null };
}

async function createAnnouncement(
  event: AppSyncResolverEvent<{ input: { buildingId: string; title: string; body: string } }>,
) {
  const { input } = event.arguments;
  if (!input.title?.trim()) throw new ValidationError("title is required");
  if (!input.body?.trim()) throw new ValidationError("body is required");

  const id = generateId();
  const ts = now();
  const item: AnnouncementItem = {
    PK: PK.building(input.buildingId),
    SK: SK.announcement(id),
    entityType: "ANNOUNCEMENT",
    id,
    buildingId: input.buildingId,
    title: input.title.trim(),
    body: input.body.trim(),
    createdBy: event.identity?.sub ?? "admin",
    createdAt: ts,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  // Fan-out push to all residents of the building (fire-and-forget).
  if (process.env.NOTIFICATION_TOPIC_ARN) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
          Subject: "PackTrack:ANNOUNCEMENT",
          Message: JSON.stringify({
            type: "ANNOUNCEMENT",
            buildingId: input.buildingId,
            title: item.title,
            body: item.body,
          }),
        }),
      );
    } catch (err) {
      console.error("[admin] ANNOUNCEMENT publish failed:", err);
    }
  }
  return announcementOut(item);
}

async function deleteAnnouncement(
  event: AppSyncResolverEvent<{ buildingId: string; announcementId: string }>,
) {
  const { buildingId, announcementId } = event.arguments;
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.announcement(announcementId) },
    }),
  );
  return announcementId;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNITY: REPORTS / INCIDENCIAS
// ═══════════════════════════════════════════════════════════════════════════

function reportOut(r: ReportItem) {
  return {
    id: r.id,
    buildingId: r.buildingId,
    residentId: r.residentId,
    residentName: r.residentName ?? null,
    towerName: r.towerName ?? null,
    unitNumber: r.unitNumber ?? null,
    category: r.category,
    description: r.description,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? null,
  };
}

async function createReport(
  event: AppSyncResolverEvent<{
    input: { buildingId: string; residentId: string; category: string; description: string };
  }>,
) {
  const { input } = event.arguments;
  if (!input.description?.trim()) throw new ValidationError("description is required");

  // Denormalize the resident's name/location for the admin list.
  const res = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(input.buildingId), SK: SK.resident(input.residentId) },
    }),
  );
  const resident = res.Item as ResidentItem | undefined;

  const id = generateId();
  const ts = now();
  const item: ReportItem = {
    PK: PK.building(input.buildingId),
    SK: SK.report(id),
    ...GSI1.reportByResident(input.residentId, ts),
    entityType: "REPORT",
    id,
    buildingId: input.buildingId,
    residentId: input.residentId,
    residentName: resident?.fullName,
    towerName: resident?.towerName,
    unitNumber: resident?.unitNumber,
    category: input.category?.trim() || "General",
    description: input.description.trim(),
    status: ReportStatus.OPEN,
    createdAt: ts,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return reportOut(item);
}

async function listReports(event: AppSyncResolverEvent<{ buildingId: string }>) {
  const { buildingId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK.building(buildingId), ":sk": "RPT#" },
    }),
  );
  const items = (r.Items as ReportItem[]).map(reportOut);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items, nextToken: null };
}

async function listMyReports(event: AppSyncResolverEvent<{ residentId: string }>) {
  const { residentId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI1,
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
      ExpressionAttributeValues: { ":pk": `RES#${residentId}`, ":sk": "RPT#" },
      ScanIndexForward: false, // newest first
    }),
  );
  return { items: (r.Items as ReportItem[]).map(reportOut), nextToken: null };
}

async function setReportStatus(
  event: AppSyncResolverEvent<{ buildingId: string; reportId: string; status: ReportStatus }>,
) {
  const { buildingId, reportId, status } = event.arguments;
  const r = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.report(reportId) },
      UpdateExpression:
        status === ReportStatus.RESOLVED
          ? "SET #s = :s, resolvedAt = :ts"
          : "SET #s = :s REMOVE resolvedAt",
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues:
        status === ReportStatus.RESOLVED ? { ":s": status, ":ts": now() } : { ":s": status },
      ReturnValues: "ALL_NEW",
    }),
  );
  return reportOut(r.Attributes as ReportItem);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNITY: DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_DOC_EXT = new Set(["pdf", "jpg", "jpeg", "png", "doc", "docx"]);

function documentOut(d: DocumentItem) {
  return {
    id: d.id,
    buildingId: d.buildingId,
    title: d.title,
    s3Key: d.s3Key,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
  };
}

async function listDocuments(event: AppSyncResolverEvent<{ buildingId: string }>) {
  const { buildingId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK.building(buildingId), ":sk": "DOC#" },
    }),
  );
  const items = (r.Items as DocumentItem[]).map(documentOut);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items, nextToken: null };
}

async function createDocument(
  event: AppSyncResolverEvent<{ input: { buildingId: string; title: string; fileExtension: string } }>,
) {
  const { input } = event.arguments;
  if (!input.title?.trim()) throw new ValidationError("title is required");
  const ext = input.fileExtension.toLowerCase().replace(".", "");
  if (!ALLOWED_DOC_EXT.has(ext)) {
    throw new ValidationError(`Invalid file type: ${ext}. Allowed: ${[...ALLOWED_DOC_EXT].join(", ")}`);
  }

  const id = generateId();
  const s3Key = `document/${input.buildingId}/${id}.${ext}`;
  const item: DocumentItem = {
    PK: PK.building(input.buildingId),
    SK: SK.document(id),
    entityType: "DOCUMENT",
    id,
    buildingId: input.buildingId,
    title: input.title.trim(),
    s3Key,
    createdBy: event.identity?.sub ?? "admin",
    createdAt: now(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }),
    { expiresIn: 300 },
  );
  return { document: documentOut(item), uploadUrl };
}

async function getDocumentUrl(
  event: AppSyncResolverEvent<{ buildingId: string; documentId: string }>,
) {
  const { buildingId, documentId } = event.arguments;
  const r = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.document(documentId) },
    }),
  );
  const doc = r.Item as DocumentItem | undefined;
  if (!doc) throw new NotFoundError("Document", documentId);
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3Key }), {
    expiresIn: 300,
  });
}

async function deleteDocument(
  event: AppSyncResolverEvent<{ buildingId: string; documentId: string }>,
) {
  const { buildingId, documentId } = event.arguments;
  const r = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.document(documentId) },
    }),
  );
  const doc = r.Item as DocumentItem | undefined;
  if (doc) {
    // Best-effort remove the S3 object, then the metadata row.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3Key }));
    } catch (err) {
      console.error("[admin] deleteDocument S3 delete failed:", err);
    }
  }
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.document(documentId) },
    }),
  );
  return documentId;
}
