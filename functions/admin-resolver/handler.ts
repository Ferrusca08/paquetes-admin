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
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, PK, SK, GSI1 } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  BuildingItem,
  TowerItem,
  UnitItem,
  ResidentItem,
  CreateBuildingInput,
  UpdateBuildingInput,
  CreateTowerInput,
  CreateUnitInput,
  CreateResidentInput,
  UpdateResidentInput,
} from "../shared/types.js";
import { NotFoundError } from "../shared/errors.js";
import { generateId, now, normalizeName } from "../shared/utils.js";

export const handler = async (event: AppSyncResolverEvent) => {
  const field = event.info.fieldName;

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
    towerName,
    unitNumber,
    createdAt,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return residentToGraphQL(item);
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
