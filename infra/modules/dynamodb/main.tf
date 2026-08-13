# =============================================================================
# PackTrack — DynamoDB Module
# =============================================================================
# Single-table design with 3 GSIs covering all access patterns.
#
# Table Key:    PK (String) / SK (String)
# GSI1:         gsi1pk / gsi1sk  → Resident's packages, resident profile lookup
# GSI2:         gsi2pk / gsi2sk  → Packages by status per building (guard queue)
# GSI3:         gsi3pk           → Pickup code verification (keys-only)
# =============================================================================

resource "aws_dynamodb_table" "main" {
  name         = "${var.project}-${var.environment}-packages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  # -------------------------------------------------------------------
  # Key Attributes
  # -------------------------------------------------------------------
  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # GSI1 attributes
  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  # GSI2 attributes
  attribute {
    name = "gsi2pk"
    type = "S"
  }

  attribute {
    name = "gsi2sk"
    type = "S"
  }

  # GSI3 attribute (keys-only, no sort key)
  attribute {
    name = "gsi3pk"
    type = "S"
  }

  # -------------------------------------------------------------------
  # GSI1 — Resident's packages + profile lookup
  # PK: RES#<residentId>   SK: PKG#<createdAt> | PROFILE
  # -------------------------------------------------------------------
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  # -------------------------------------------------------------------
  # GSI2 — Packages by status per building (guard queue)
  # PK: BLDG#<id>#ST#<status>   SK: <createdAt>
  # -------------------------------------------------------------------
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  # -------------------------------------------------------------------
  # GSI3 — Pickup code verification
  # PK: CODE#<pin>   (no sort key — direct lookup)
  # -------------------------------------------------------------------
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "gsi3pk"
    projection_type = "ALL"
  }

  # -------------------------------------------------------------------
  # TTL — auto-cleanup for expired/old packages
  # -------------------------------------------------------------------
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # -------------------------------------------------------------------
  # Point-in-time recovery (recommended for prod)
  # -------------------------------------------------------------------
  point_in_time_recovery {
    enabled = true
  }

  # -------------------------------------------------------------------
  # Deletion protection (safety net for prod)
  # -------------------------------------------------------------------
  deletion_protection_enabled = true # Guard the packages table against accidental deletion

  tags = {
    Name = "${var.project}-${var.environment}-packages"
  }
}
