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
      items { ${PACKAGE_FIELDS} }
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
      ${PACKAGE_FIELDS}
    }
  }
`;

export const confirmPickup = /* GraphQL */ `
  mutation ConfirmPickup($input: ConfirmPickupInput!) {
    confirmPickup(input: $input) {
      ${PACKAGE_FIELDS}
    }
  }
`;

export const markPackageReturned = /* GraphQL */ `
  mutation MarkPackageReturned($buildingId: ID!, $packageId: ID!) {
    markPackageReturned(buildingId: $buildingId, packageId: $packageId) {
      ${PACKAGE_FIELDS}
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
      suggestedName suggestedTrackingNumber suggestedCarrier rawText confidence
    }
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
