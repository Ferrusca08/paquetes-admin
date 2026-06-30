/**
 * PackTrack — TypeScript interfaces matching the GraphQL schema
 */

export enum PackageStatus {
  RECIBIDO = "RECIBIDO",
  NOTIFICADO = "NOTIFICADO",
  ENTREGADO = "ENTREGADO",
  DEVUELTO = "DEVUELTO",
  EXPIRADO = "EXPIRADO",
}

export enum UserRole {
  GUARD = "GUARD",
  RESIDENT = "RESIDENT",
  ADMIN = "ADMIN",
}

// ─── DynamoDB Item Shapes ────────────────────────────────────────────────

export interface PackageItem {
  PK: string;
  SK: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk: string;
  entityType: "PACKAGE";
  id: string;
  buildingId: string;
  towerId: string;
  unitId: string;
  residentId: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  status: PackageStatus;
  carrier?: string;
  trackingNumber?: string;
  labelPhotoKey?: string;
  evidencePhotoKey?: string;
  pickupCode: string;
  ocrRawData?: string;
  registeredBy: string;
  deliveredBy?: string;
  deliveredAt?: string;
  notifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  ttl?: number;
}

export interface BuildingItem {
  PK: string;
  SK: string;
  entityType: "BUILDING";
  id: string;
  name: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface TowerItem {
  PK: string;
  SK: string;
  entityType: "TOWER";
  id: string;
  buildingId: string;
  name: string;
  createdAt: string;
}

export interface UnitItem {
  PK: string;
  SK: string;
  gsi1pk?: string;
  gsi1sk?: string;
  entityType: "UNIT";
  id: string;
  buildingId: string;
  towerId: string;
  number: string;
  towerName?: string;
  createdAt: string;
}

export interface ResidentItem {
  PK: string;
  SK: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "RESIDENT";
  id: string;
  buildingId: string;
  towerId: string;
  unitId: string;
  cognitoUserId?: string;
  fullName: string;
  nameNormalized: string;
  phone?: string;
  email?: string;
  towerName?: string;
  unitNumber?: string;
  pushToken?: string;
  createdAt: string;
}

export enum AmenityStatus {
  ACTIVE = "ACTIVE",
  OUT_OF_SERVICE = "OUT_OF_SERVICE",
}

export interface AmenityItem {
  PK: string;
  SK: string;
  entityType: "AMENITY";
  id: string;
  buildingId: string;
  name: string;
  category?: string;
  description?: string;
  capacity: number; // cupo por bloque (1 = exclusivo)
  slotMinutes: number; // duración del bloque
  openTime: string; // HH:MM
  closeTime: string; // HH:MM
  days: number[]; // 0=domingo … 6=sábado
  status: AmenityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationItem {
  PK: string;
  SK: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  entityType: "RESERVATION";
  id: string;
  buildingId: string;
  amenityId: string;
  amenityName: string;
  residentId: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  guests?: number;
  createdAt: string;
}

export interface SlotCounterItem {
  PK: string;
  SK: string;
  entityType: "SLOT";
  count: number;
}

// ─── AppSync Event Types ─────────────────────────────────────────────────

export interface AppSyncResolverEvent<TArgs = Record<string, unknown>> {
  info: {
    fieldName: string;
    parentTypeName: string;
    selectionSetList: string[];
    selectionSetGraphQL: string;
  };
  arguments: TArgs;
  identity: {
    sub: string;
    username: string;
    claims: Record<string, string>;
    groups?: string[];
  };
  source: Record<string, unknown> | null;
  request: {
    headers: Record<string, string>;
  };
  stash: Record<string, unknown>;
}

// ─── GraphQL Input Types ─────────────────────────────────────────────────

export interface RegisterPackageInput {
  buildingId: string;
  towerId: string;
  unitId: string;
  residentId: string;
  carrier?: string;
  trackingNumber?: string;
  labelPhotoKey?: string;
}

export interface ConfirmPickupInput {
  buildingId: string;
  packageId: string;
  pickupCode: string;
  evidencePhotoKey?: string;
}

export interface GetUploadUrlInput {
  buildingId: string;
  fileExtension: string;
  purpose: string;
}

export interface CreateBuildingInput {
  name: string;
  address: string;
}

export interface UpdateBuildingInput {
  id: string;
  name?: string;
  address?: string;
}

export interface CreateTowerInput {
  buildingId: string;
  name: string;
}

export interface CreateUnitInput {
  buildingId: string;
  towerId: string;
  number: string;
}

export interface CreateResidentInput {
  buildingId: string;
  towerId: string;
  unitId: string;
  fullName: string;
  phone?: string;
  email?: string;
}

export interface UpdateResidentInput {
  id: string;
  buildingId: string;
  fullName?: string;
  phone?: string;
  email?: string;
}

export interface CreateAmenityInput {
  buildingId: string;
  name: string;
  category?: string;
  description?: string;
  capacity: number;
  slotMinutes: number;
  openTime: string;
  closeTime: string;
  days: number[];
}

export interface UpdateAmenityInput {
  id: string;
  buildingId: string;
  name?: string;
  category?: string;
  description?: string;
  capacity?: number;
  slotMinutes?: number;
  openTime?: string;
  closeTime?: string;
  days?: number[];
}

export interface CreateReservationInput {
  buildingId: string;
  amenityId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  guests?: number;
}
