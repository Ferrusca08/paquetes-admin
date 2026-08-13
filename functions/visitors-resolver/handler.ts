/**
 * PackTrack — visitors-resolver Lambda Handler
 *
 * Multi-resolver for visitor check-in / check-out and the virtual badge.
 *
 * Staff (guardias/admins): checkInVisit, checkOutVisit, listActiveVisits
 * Public (API key):        getVisitBadge   ← the visitor's own phone, no login
 *
 * A visit is identified publicly by an unguessable `badgeToken` (UUID). The
 * guard's app shows a QR encoding the badge URL; the visitor scans it to open
 * the virtual badge web page (getVisitBadge), which renders name + department
 * and a second QR the guard scans on the way out (checkOutVisit).
 */
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { docClient } from "../shared/dynamo-client.js";

const sns = new SNSClient({});
import { TABLE_NAME, PK, SK, GSI2, GSI3, GSI_NAMES } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  VisitItem,
  UnitItem,
  CheckInVisitInput,
} from "../shared/types.js";
import { VisitStatus } from "../shared/types.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { generateId, now } from "../shared/utils.js";

// ─── auth helpers (mirror amenities-resolver) ────────────────────────────────
function callerGroups(event: AppSyncResolverEvent): string[] {
  const id = (event.identity || {}) as { groups?: string[]; claims?: Record<string, unknown> };
  if (Array.isArray(id.groups)) return id.groups;
  const c = id.claims?.["cognito:groups"];
  if (Array.isArray(c)) return c as string[];
  if (typeof c === "string") return c.split(",");
  return [];
}
function requireStaff(event: AppSyncResolverEvent): void {
  const groups = callerGroups(event);
  if (!groups.includes("guardias") && !groups.includes("admins")) {
    throw new Error("Unauthorized: this operation requires the 'guardias' or 'admins' group");
  }
}

// ─── mappers ─────────────────────────────────────────────────────────────
function visitOut(v: VisitItem) {
  return {
    id: v.id,
    buildingId: v.buildingId,
    visitorName: v.visitorName,
    towerId: v.towerId,
    towerName: v.towerName ?? null,
    unitId: v.unitId,
    unitNumber: v.unitNumber ?? null,
    residentId: v.residentId ?? null,
    status: v.status,
    badgeToken: v.badgeToken,
    checkInAt: v.checkInAt,
    checkOutAt: v.checkOutAt ?? null,
    registeredBy: v.registeredBy,
  };
}
function badgeOut(v: VisitItem) {
  return {
    visitorName: v.visitorName,
    towerName: v.towerName ?? null,
    unitNumber: v.unitNumber ?? null,
    status: v.status,
    badgeToken: v.badgeToken,
  };
}

export const handler = async (event: AppSyncResolverEvent) => {
  const field = event.info.fieldName;

  // getVisitBadge is public (API key) — everything else requires staff.
  if (field !== "getVisitBadge") requireStaff(event);

  switch (field) {
    case "checkInVisit":
      return checkInVisit(event as AppSyncResolverEvent<{ input: CheckInVisitInput }>);
    case "checkOutVisit":
      return checkOutVisit(event as AppSyncResolverEvent<{ token: string }>);
    case "listActiveVisits":
      return listActiveVisits(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "getVisitBadge":
      return getVisitBadge(event as AppSyncResolverEvent<{ token: string }>);
    default:
      throw new Error(`Unknown field: ${field}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// VISITS
// ═══════════════════════════════════════════════════════════════════════════

/** Resolve a visit by its public badge token via GSI3. */
async function findByToken(token: string): Promise<VisitItem | undefined> {
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI3,
      KeyConditionExpression: "gsi3pk = :pk",
      ExpressionAttributeValues: { ":pk": GSI3.visitBadge(token).gsi3pk },
      Limit: 1,
    }),
  );
  return (r.Items?.[0] as VisitItem | undefined) ?? undefined;
}

async function checkInVisit(event: AppSyncResolverEvent<{ input: CheckInVisitInput }>) {
  const { input } = event.arguments;
  if (!input.visitorName?.trim()) throw new ValidationError("visitorName is required");
  if (!input.towerId || !input.unitId) throw new ValidationError("towerId and unitId are required");

  const registeredBy = event.identity?.sub ?? "unknown";

  // Denormalize tower/unit names for display on the badge and admin list.
  const unitRes = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(input.buildingId), SK: SK.unit(input.unitId) },
    }),
  );
  const unit = unitRes.Item as UnitItem | undefined;

  const id = generateId();
  const badgeToken = generateId();
  const ts = now();
  const gsi2 = GSI2.visitByBuilding(input.buildingId, ts);
  const gsi3 = GSI3.visitBadge(badgeToken);

  const item: VisitItem = {
    PK: PK.building(input.buildingId),
    SK: SK.visit(id),
    ...gsi2,
    ...gsi3,
    entityType: "VISIT",
    id,
    buildingId: input.buildingId,
    visitorName: input.visitorName.trim(),
    towerId: input.towerId,
    towerName: unit?.towerName,
    unitId: input.unitId,
    unitNumber: unit?.number,
    residentId: input.residentId,
    status: VisitStatus.ACTIVE,
    badgeToken,
    checkInAt: ts,
    registeredBy,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  // Notify the unit's resident that a visitor arrived (fire-and-forget).
  if (item.residentId && process.env.NOTIFICATION_TOPIC_ARN) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
          Subject: "PackTrack:VISIT_CHECKIN",
          Message: JSON.stringify({
            type: "VISIT_CHECKIN",
            buildingId: item.buildingId,
            residentId: item.residentId,
            visitorName: item.visitorName,
            towerName: item.towerName,
            unitNumber: item.unitNumber,
          }),
        }),
      );
    } catch (err) {
      console.error("[visitors] VISIT_CHECKIN publish failed:", err);
    }
  }

  return visitOut(item);
}

async function checkOutVisit(event: AppSyncResolverEvent<{ token: string }>) {
  const { token } = event.arguments;
  if (!token) throw new ValidationError("token is required");

  const visit = await findByToken(token);
  if (!visit) throw new NotFoundError("Visit", token);
  if (visit.status === VisitStatus.ENDED) return visitOut(visit); // idempotent

  const ts = now();
  // Remove the GSI2 keys so the visit drops out of the "active" list, and flip
  // status. The GSI3 badge lookup is preserved so the badge still resolves.
  const r = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: visit.PK, SK: visit.SK },
      UpdateExpression: "SET #s = :ended, checkOutAt = :ts REMOVE gsi2pk, gsi2sk",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":ended": VisitStatus.ENDED, ":ts": ts },
      ReturnValues: "ALL_NEW",
    }),
  );
  return visitOut(r.Attributes as VisitItem);
}

async function listActiveVisits(event: AppSyncResolverEvent<{ buildingId: string }>) {
  const { buildingId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI2,
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": GSI2.visitByBuilding(buildingId, "").gsi2pk },
      ScanIndexForward: false, // newest check-ins first
    }),
  );
  return { items: (r.Items as VisitItem[]).map(visitOut), nextToken: null };
}

async function getVisitBadge(event: AppSyncResolverEvent<{ token: string }>) {
  const { token } = event.arguments;
  if (!token) throw new ValidationError("token is required");
  const visit = await findByToken(token);
  if (!visit) throw new NotFoundError("Visit", token);
  return badgeOut(visit);
}
