/**
 * PackTrack — amenities-resolver Lambda Handler
 *
 * Multi-resolver for amenity management and reservations.
 *
 * Admin-only:   createAmenity, updateAmenity, setAmenityStatus, deleteAmenity, listReservations
 * Resident:     listAmenities, getAmenityAvailability, createReservation, listMyReservations
 * Resident/Admin: cancelReservation
 *
 * Concurrency: createReservation/cancelReservation use a TransactWriteItems with
 * an atomic per-slot counter (SLOT#...) so a block can never be over-booked
 * beyond the amenity's capacity (capacity=1 ⇒ exclusive).
 */
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../shared/dynamo-client.js";
import { TABLE_NAME, PK, SK, GSI1, GSI2, GSI_NAMES } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  AmenityItem,
  ReservationItem,
  ResidentItem,
  CreateAmenityInput,
  UpdateAmenityInput,
  CreateReservationInput,
} from "../shared/types.js";
import { AmenityStatus } from "../shared/types.js";
import { NotFoundError, ValidationError, ConflictError } from "../shared/errors.js";
import { generateId, now } from "../shared/utils.js";

const TZ = "America/Mexico_City";

const ADMIN_ONLY = new Set([
  "createAmenity",
  "updateAmenity",
  "setAmenityStatus",
  "deleteAmenity",
  "listReservations",
]);

function callerGroups(event: AppSyncResolverEvent): string[] {
  const id = (event.identity || {}) as { groups?: string[]; claims?: Record<string, unknown> };
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
function claim(event: AppSyncResolverEvent, key: string): string | undefined {
  return (event.identity?.claims || {})[key];
}

// ─── time helpers ──────────────────────────────────────────────────────────
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Current wall-clock date/time in the building timezone. */
function nowLocal(): { date: string; time: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
/** Day of week (0=Sunday) for a YYYY-MM-DD in the building timezone. */
function weekday(date: string): number {
  // Anchor at noon UTC to avoid tz date rollover, then read weekday in TZ.
  const d = new Date(`${date}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// ─── mappers ─────────────────────────────────────────────────────────────
function amenityOut(a: AmenityItem) {
  return {
    id: a.id,
    buildingId: a.buildingId,
    name: a.name,
    category: a.category ?? null,
    description: a.description ?? null,
    capacity: a.capacity,
    slotMinutes: a.slotMinutes,
    openTime: a.openTime,
    closeTime: a.closeTime,
    days: a.days,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
function reservationOut(r: ReservationItem) {
  return {
    id: r.id,
    buildingId: r.buildingId,
    amenityId: r.amenityId,
    amenityName: r.amenityName,
    residentId: r.residentId,
    residentName: r.residentName,
    towerName: r.towerName ?? null,
    unitNumber: r.unitNumber ?? null,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    guests: r.guests ?? null,
    createdAt: r.createdAt,
  };
}

export const handler = async (event: AppSyncResolverEvent) => {
  const field = event.info.fieldName;
  if (ADMIN_ONLY.has(field)) requireAdmin(event);

  switch (field) {
    case "listAmenities":
      return listAmenities(event as AppSyncResolverEvent<{ buildingId: string }>);
    case "getAmenityAvailability":
      return getAmenityAvailability(
        event as AppSyncResolverEvent<{ buildingId: string; amenityId: string; date: string }>,
      );
    case "listMyReservations":
      return listMyReservations(event as AppSyncResolverEvent<{ residentId: string }>);
    case "listReservations":
      return listReservations(
        event as AppSyncResolverEvent<{ buildingId: string; fromDate: string; toDate: string }>,
      );
    case "createAmenity":
      return createAmenity(event as AppSyncResolverEvent<{ input: CreateAmenityInput }>);
    case "updateAmenity":
      return updateAmenity(event as AppSyncResolverEvent<{ input: UpdateAmenityInput }>);
    case "setAmenityStatus":
      return setAmenityStatus(
        event as AppSyncResolverEvent<{ buildingId: string; amenityId: string; status: AmenityStatus }>,
      );
    case "deleteAmenity":
      return deleteAmenity(event as AppSyncResolverEvent<{ buildingId: string; amenityId: string }>);
    case "createReservation":
      return createReservation(event as AppSyncResolverEvent<{ input: CreateReservationInput }>);
    case "cancelReservation":
      return cancelReservation(
        event as AppSyncResolverEvent<{ buildingId: string; reservationId: string }>,
      );
    default:
      throw new Error(`Unknown field: ${field}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// AMENITIES
// ═══════════════════════════════════════════════════════════════════════════

async function getAmenity(buildingId: string, amenityId: string): Promise<AmenityItem> {
  const r = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: PK.building(buildingId), SK: SK.amenity(amenityId) } }),
  );
  if (!r.Item) throw new NotFoundError("Amenity", amenityId);
  return r.Item as AmenityItem;
}

async function listAmenities(event: AppSyncResolverEvent<{ buildingId: string }>) {
  const { buildingId } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK.building(buildingId), ":sk": "AMEN#" },
    }),
  );
  return { items: (r.Items as AmenityItem[]).map(amenityOut), nextToken: null };
}

async function createAmenity(event: AppSyncResolverEvent<{ input: CreateAmenityInput }>) {
  const { input } = event.arguments;
  if (!input.name?.trim()) throw new ValidationError("name is required");
  if (!(input.capacity >= 1)) throw new ValidationError("capacity must be >= 1");
  if (!(input.slotMinutes >= 5)) throw new ValidationError("slotMinutes must be >= 5");
  if (toMin(input.closeTime) <= toMin(input.openTime))
    throw new ValidationError("closeTime must be after openTime");

  const id = generateId();
  const ts = now();
  const item: AmenityItem = {
    PK: PK.building(input.buildingId),
    SK: SK.amenity(id),
    entityType: "AMENITY",
    id,
    buildingId: input.buildingId,
    name: input.name.trim(),
    category: input.category,
    description: input.description,
    capacity: input.capacity,
    slotMinutes: input.slotMinutes,
    openTime: input.openTime,
    closeTime: input.closeTime,
    days: input.days,
    status: AmenityStatus.ACTIVE,
    createdAt: ts,
    updatedAt: ts,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return amenityOut(item);
}

async function updateAmenity(event: AppSyncResolverEvent<{ input: UpdateAmenityInput }>) {
  const { input } = event.arguments;
  const existing = await getAmenity(input.buildingId, input.id);
  const merged: AmenityItem = {
    ...existing,
    name: input.name?.trim() ?? existing.name,
    category: input.category ?? existing.category,
    description: input.description ?? existing.description,
    capacity: input.capacity ?? existing.capacity,
    slotMinutes: input.slotMinutes ?? existing.slotMinutes,
    openTime: input.openTime ?? existing.openTime,
    closeTime: input.closeTime ?? existing.closeTime,
    days: input.days ?? existing.days,
    updatedAt: now(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: merged }));
  return amenityOut(merged);
}

async function setAmenityStatus(
  event: AppSyncResolverEvent<{ buildingId: string; amenityId: string; status: AmenityStatus }>,
) {
  const { buildingId, amenityId, status } = event.arguments;
  const r = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: PK.building(buildingId), SK: SK.amenity(amenityId) },
      UpdateExpression: "SET #s = :s, updatedAt = :u",
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status, ":u": now() },
      ReturnValues: "ALL_NEW",
    }),
  );
  return amenityOut(r.Attributes as AmenityItem);
}

async function deleteAmenity(event: AppSyncResolverEvent<{ buildingId: string; amenityId: string }>) {
  const { buildingId, amenityId } = event.arguments;
  await docClient.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: PK.building(buildingId), SK: SK.amenity(amenityId) } }),
  );
  return amenityId;
}

// ═══════════════════════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════════════════════

async function getAmenityAvailability(
  event: AppSyncResolverEvent<{ buildingId: string; amenityId: string; date: string }>,
) {
  const { buildingId, amenityId, date } = event.arguments;
  const amenity = await getAmenity(buildingId, amenityId);
  if (amenity.status !== AmenityStatus.ACTIVE) return [];
  if (!amenity.days.includes(weekday(date))) return []; // day not offered

  // Booked counts for this amenity+date
  const counts = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK.building(buildingId), ":sk": SK.slotPrefix(amenityId, date) },
    }),
  );
  const byStart: Record<string, number> = {};
  for (const it of counts.Items || []) {
    const start = (it.SK as string).split("#").pop()!; // SLOT#amen#date#HH:MM
    byStart[start] = (it.count as number) ?? 0;
  }

  const open = toMin(amenity.openTime);
  const close = toMin(amenity.closeTime);
  const local = nowLocal();
  const slots = [];
  for (let s = open; s + amenity.slotMinutes <= close; s += amenity.slotMinutes) {
    const startTime = toHHMM(s);
    // Skip slots already in the past for today
    if (date < local.date || (date === local.date && startTime <= local.time)) continue;
    const reserved = byStart[startTime] ?? 0;
    slots.push({
      startTime,
      endTime: toHHMM(s + amenity.slotMinutes),
      capacity: amenity.capacity,
      reserved,
      available: Math.max(0, amenity.capacity - reserved),
    });
  }
  return slots;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function createReservation(event: AppSyncResolverEvent<{ input: CreateReservationInput }>) {
  const { input } = event.arguments;
  // Prefer the token claim (most secure); fall back to the input, since Amplify
  // sends the access token to AppSync which omits custom: attributes.
  const residentId = claim(event, "custom:residentId") || input.residentId;
  if (!residentId) throw new ValidationError("Only residents can create reservations");
  const buildingId = claim(event, "custom:buildingId") || input.buildingId;

  const amenity = await getAmenity(buildingId, input.amenityId);
  if (amenity.status !== AmenityStatus.ACTIVE)
    throw new ValidationError("La amenidad está fuera de servicio");
  if (!amenity.days.includes(weekday(input.date)))
    throw new ValidationError("La amenidad no está disponible ese día");

  const start = toMin(input.startTime);
  const open = toMin(amenity.openTime);
  const close = toMin(amenity.closeTime);
  if (start < open || start + amenity.slotMinutes > close || (start - open) % amenity.slotMinutes !== 0)
    throw new ValidationError("Horario inválido para esta amenidad");

  const local = nowLocal();
  if (input.date < local.date || (input.date === local.date && input.startTime <= local.time))
    throw new ValidationError("No se puede reservar en el pasado");

  // Resident profile (name / location)
  const res = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: PK.building(buildingId), SK: SK.resident(residentId) } }),
  );
  const resident = res.Item as ResidentItem | undefined;

  const id = generateId();
  const endTime = toHHMM(start + amenity.slotMinutes);
  const gsi1 = GSI1.reservationByResident(residentId, input.date, input.startTime);
  const gsi2 = GSI2.reservationByBuilding(buildingId, input.date, input.startTime);
  const item: ReservationItem = {
    PK: PK.building(buildingId),
    SK: SK.reservation(id),
    ...gsi1,
    ...gsi2,
    entityType: "RESERVATION",
    id,
    buildingId,
    amenityId: amenity.id,
    amenityName: amenity.name,
    residentId,
    residentName: resident?.fullName ?? "Residente",
    towerName: resident?.towerName,
    unitNumber: resident?.unitNumber,
    date: input.date,
    startTime: input.startTime,
    endTime,
    guests: input.guests,
    createdAt: now(),
  };

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: PK.building(buildingId), SK: SK.slot(amenity.id, input.date, input.startTime) },
              UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :one, entityType = :et",
              ConditionExpression: "attribute_not_exists(#c) OR #c < :cap",
              ExpressionAttributeNames: { "#c": "count" },
              ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":cap": amenity.capacity, ":et": "SLOT" },
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: item,
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
        ],
      }),
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "TransactionCanceledException") {
      throw new ConflictError("Ese horario ya está reservado o alcanzó su cupo");
    }
    throw err;
  }

  return reservationOut(item);
}

async function cancelReservation(
  event: AppSyncResolverEvent<{ buildingId: string; reservationId: string }>,
) {
  const { buildingId, reservationId } = event.arguments;
  const r = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: PK.building(buildingId), SK: SK.reservation(reservationId) } }),
  );
  const resv = r.Item as ReservationItem | undefined;
  if (!resv) throw new NotFoundError("Reservation", reservationId);

  // Ownership: admins can cancel anything. When the resident's id is present in
  // the token claims we verify it; if absent (Amplify sends the access token,
  // which omits custom: attributes) we trust the client, consistent with the
  // rest of the app's residentId-arg model.
  const callerRes = claim(event, "custom:residentId");
  const isAdmin = callerGroups(event).includes("admins");
  if (!isAdmin && callerRes && callerRes !== resv.residentId) {
    throw new Error("Unauthorized: cannot cancel another resident's reservation");
  }

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: PK.building(buildingId), SK: SK.slot(resv.amenityId, resv.date, resv.startTime) },
            UpdateExpression: "SET #c = #c - :one",
            ConditionExpression: "attribute_exists(#c) AND #c > :zero",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { PK: PK.building(buildingId), SK: SK.reservation(reservationId) },
          },
        },
      ],
    }),
  );
  return reservationId;
}

async function listMyReservations(
  event: AppSyncResolverEvent<{ residentId: string; includePast?: boolean }>,
) {
  const { residentId, includePast } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI1,
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
      ExpressionAttributeValues: { ":pk": `RES#${residentId}`, ":sk": "RESV#" },
    }),
  );
  const today = nowLocal().date;
  let items = r.Items as ReservationItem[];
  if (!includePast) items = items.filter((x) => x.date >= today); // upcoming only
  const key = (x: ReservationItem) => `${x.date}${x.startTime}`;
  items.sort((a, b) =>
    includePast ? key(b).localeCompare(key(a)) /* newest first */ : key(a).localeCompare(key(b)),
  );
  return { items: items.map(reservationOut), nextToken: null };
}

async function listReservations(
  event: AppSyncResolverEvent<{ buildingId: string; fromDate: string; toDate: string }>,
) {
  const { buildingId, fromDate, toDate } = event.arguments;
  const r = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI_NAMES.GSI2,
      KeyConditionExpression: "gsi2pk = :pk AND gsi2sk BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `BLDG#${buildingId}#RESV`,
        ":from": `${fromDate}#00:00`,
        ":to": `${toDate}#23:59`,
      },
    }),
  );
  return { items: (r.Items as ReservationItem[]).map(reservationOut), nextToken: null };
}
