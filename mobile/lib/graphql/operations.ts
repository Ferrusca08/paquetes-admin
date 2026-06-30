// ============================================================
// PackTrack — GraphQL Operations (Queries & Mutations)
// ============================================================

// ─── Fragment ────────────────────────────────────────────────

const PACKAGE_FIELDS = /* GraphQL */ `
  id buildingId towerId unitId residentId
  residentName towerName unitNumber
  status carrier trackingNumber
  labelPhotoKey evidencePhotoKey
  pickupCode registeredBy deliveredBy deliveredAt
  notifiedAt createdAt updatedAt expiresAt
`;

// Same as PACKAGE_FIELDS but WITHOUT pickupCode — the pickup code must only
// ever reach the resident, never the guard's browseable lists.
const GUARD_PACKAGE_FIELDS = /* GraphQL */ `
  id buildingId towerId unitId residentId
  residentName towerName unitNumber
  status carrier trackingNumber
  labelPhotoKey evidencePhotoKey
  registeredBy deliveredBy deliveredAt
  notifiedAt createdAt updatedAt expiresAt
`;

// ─── Queries ─────────────────────────────────────────────────

export const listPackagesByStatus = /* GraphQL */ `
  query ListPackagesByStatus(
    $buildingId: ID!
    $status: PackageStatus!
    $limit: Int
    $nextToken: String
  ) {
    listPackagesByStatus(
      buildingId: $buildingId
      status: $status
      limit: $limit
      nextToken: $nextToken
    ) {
      items { ${GUARD_PACKAGE_FIELDS} }
      nextToken
    }
  }
`;

export const listMyPackages = /* GraphQL */ `
  query ListMyPackages($residentId: ID!, $limit: Int, $nextToken: String) {
    listMyPackages(residentId: $residentId, limit: $limit, nextToken: $nextToken) {
      items { ${PACKAGE_FIELDS} }
      nextToken
    }
  }
`;

export const getPackage = /* GraphQL */ `
  query GetPackage($buildingId: ID!, $packageId: ID!) {
    getPackage(buildingId: $buildingId, packageId: $packageId) {
      ${PACKAGE_FIELDS}
    }
  }
`;

export const verifyPickupCode = /* GraphQL */ `
  query VerifyPickupCode($code: String!) {
    verifyPickupCode(code: $code) {
      ${PACKAGE_FIELDS}
    }
  }
`;

export const searchResidents = /* GraphQL */ `
  query SearchResidents($buildingId: ID!, $query: String!, $limit: Int) {
    searchResidents(buildingId: $buildingId, query: $query, limit: $limit) {
      items {
        id buildingId towerId unitId
        fullName phone email towerName unitNumber createdAt
      }
    }
  }
`;

export const listResidents = /* GraphQL */ `
  query ListResidents($buildingId: ID!, $limit: Int) {
    listResidents(buildingId: $buildingId, limit: $limit) {
      items {
        id buildingId towerId unitId
        fullName phone email towerName unitNumber createdAt
      }
    }
  }
`;

export const listBuildings = /* GraphQL */ `
  query ListBuildings($limit: Int) {
    listBuildings(limit: $limit) {
      items { id name address createdAt }
    }
  }
`;

// ─── Mutations ───────────────────────────────────────────────

export const registerPackage = /* GraphQL */ `
  mutation RegisterPackage($input: RegisterPackageInput!) {
    registerPackage(input: $input) {
      ${GUARD_PACKAGE_FIELDS}
    }
  }
`;

export const confirmPickup = /* GraphQL */ `
  mutation ConfirmPickup($input: ConfirmPickupInput!) {
    confirmPickup(input: $input) {
      ${GUARD_PACKAGE_FIELDS}
    }
  }
`;

export const markPackageReturned = /* GraphQL */ `
  mutation MarkPackageReturned($buildingId: ID!, $packageId: ID!) {
    markPackageReturned(buildingId: $buildingId, packageId: $packageId) {
      ${GUARD_PACKAGE_FIELDS}
    }
  }
`;

export const getUploadUrl = /* GraphQL */ `
  mutation GetUploadUrl($input: GetUploadUrlInput!) {
    getUploadUrl(input: $input) {
      uploadUrl key expiresIn
    }
  }
`;

export const processLabel = /* GraphQL */ `
  mutation ProcessLabel($input: ProcessLabelInput!) {
    processLabel(input: $input) {
      suggestedName suggestedTowerName suggestedUnitNumber
      suggestedTrackingNumber suggestedCarrier rawText confidence
    }
  }
`;

// ─── Amenities (resident) ─────────────────────────────────────

export const listAmenities = /* GraphQL */ `
  query ListAmenities($buildingId: ID!) {
    listAmenities(buildingId: $buildingId) {
      items {
        id name category description capacity slotMinutes
        openTime closeTime days status
      }
    }
  }
`;

export const getAmenityAvailability = /* GraphQL */ `
  query GetAmenityAvailability($buildingId: ID!, $amenityId: ID!, $date: String!) {
    getAmenityAvailability(buildingId: $buildingId, amenityId: $amenityId, date: $date) {
      startTime endTime capacity reserved available
    }
  }
`;

export const listMyReservations = /* GraphQL */ `
  query ListMyReservations($residentId: ID!) {
    listMyReservations(residentId: $residentId) {
      items {
        id amenityName date startTime endTime guests createdAt
      }
    }
  }
`;

export const createReservation = /* GraphQL */ `
  mutation CreateReservation($input: CreateReservationInput!) {
    createReservation(input: $input) {
      id amenityName date startTime endTime
    }
  }
`;

export const cancelReservation = /* GraphQL */ `
  mutation CancelReservation($buildingId: ID!, $reservationId: ID!) {
    cancelReservation(buildingId: $buildingId, reservationId: $reservationId)
  }
`;

// ─── Subscriptions ────────────────────────────────────────────

export const onPackageRegistered = /* GraphQL */ `
  subscription OnPackageRegistered($buildingId: ID!) {
    onPackageRegistered(buildingId: $buildingId) {
      ${PACKAGE_FIELDS}
    }
  }
`;

export const onMyPackageUpdated = /* GraphQL */ `
  subscription OnMyPackageUpdated($residentId: ID!) {
    onMyPackageUpdated(residentId: $residentId) {
      ${PACKAGE_FIELDS}
    }
  }
`;

export const registerPushToken = /* GraphQL */ `
  mutation RegisterPushToken($residentId: ID!, $buildingId: ID!, $pushToken: String!) {
    registerPushToken(residentId: $residentId, buildingId: $buildingId, pushToken: $pushToken)
  }
`;
