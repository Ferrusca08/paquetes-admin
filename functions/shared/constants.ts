/**
 * PackTrack — Constants
 *
 * Table name read from environment variable at runtime.
 * PK/SK patterns for the single-table design.
 */

// Environment variables set by Terraform
export const TABLE_NAME = process.env.TABLE_NAME!;
export const BUCKET_NAME = process.env.BUCKET_NAME!;
export const AWS_REGION_NAME = process.env.AWS_REGION || "us-east-1";

// ─── PK/SK Prefixes ─────────────────────────────────────────────────────

export const PK = {
  building: (id: string) => `BLDG#${id}`,
} as const;

export const SK = {
  meta: "META",
  tower: (id: string) => `TWR#${id}`,
  unit: (id: string) => `UNIT#${id}`,
  resident: (id: string) => `RES#${id}`,
  package: (id: string) => `PKG#${id}`,
  amenity: (id: string) => `AMEN#${id}`,
  reservation: (id: string) => `RESV#${id}`,
  /** Slot capacity counter: SLOT#<amenityId>#<date>#<startTime> */
  slot: (amenityId: string, date: string, startTime: string) =>
    `SLOT#${amenityId}#${date}#${startTime}`,
  slotPrefix: (amenityId: string, date: string) => `SLOT#${amenityId}#${date}#`,
} as const;

// ─── GSI Key Builders ────────────────────────────────────────────────────

export const GSI1 = {
  /** Resident's packages: gsi1pk = RES#<id>, gsi1sk = PKG#<createdAt> */
  residentPackage: (residentId: string, createdAt: string) => ({
    gsi1pk: `RES#${residentId}`,
    gsi1sk: `PKG#${createdAt}`,
  }),
  /** Resident profile: gsi1pk = RES#<id>, gsi1sk = PROFILE */
  residentProfile: (residentId: string) => ({
    gsi1pk: `RES#${residentId}`,
    gsi1sk: "PROFILE",
  }),
  /** Unit by tower: gsi1pk = TWR#<towerId>, gsi1sk = UNIT#<unitId> */
  unitByTower: (towerId: string, unitId: string) => ({
    gsi1pk: `TWR#${towerId}`,
    gsi1sk: `UNIT#${unitId}`,
  }),
  /** Resident's reservations: gsi1pk = RES#<id>, gsi1sk = RESV#<date>#<startTime> */
  reservationByResident: (residentId: string, date: string, startTime: string) => ({
    gsi1pk: `RES#${residentId}`,
    gsi1sk: `RESV#${date}#${startTime}`,
  }),
} as const;

export const GSI2 = {
  /** Guard queue: gsi2pk = BLDG#<id>#ST#<status>, gsi2sk = <createdAt> */
  packageByStatus: (buildingId: string, status: string, createdAt: string) => ({
    gsi2pk: `BLDG#${buildingId}#ST#${status}`,
    gsi2sk: createdAt,
  }),
  /** Building reservations (admin calendar): gsi2pk = BLDG#<id>#RESV, gsi2sk = <date>#<startTime> */
  reservationByBuilding: (buildingId: string, date: string, startTime: string) => ({
    gsi2pk: `BLDG#${buildingId}#RESV`,
    gsi2sk: `${date}#${startTime}`,
  }),
} as const;

export const GSI3 = {
  /** Pickup code lookup: gsi3pk = CODE#<pin> */
  pickupCode: (code: string) => ({
    gsi3pk: `CODE#${code}`,
  }),
} as const;

// ─── GSI Index Names ─────────────────────────────────────────────────────

export const GSI_NAMES = {
  GSI1: "GSI1",
  GSI2: "GSI2",
  GSI3: "GSI3",
} as const;

// ─── Package Expiration ──────────────────────────────────────────────────

/** Default TTL for packages: 30 days after creation */
export const PACKAGE_TTL_DAYS = 30;
