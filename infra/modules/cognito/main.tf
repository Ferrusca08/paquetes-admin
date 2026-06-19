# =============================================================================
# PackTrack — Cognito Module
# =============================================================================
# Creates: User Pool, App Client (mobile SRP), 3 user groups.
# =============================================================================

# -----------------------------------------------------------------------------
# User Pool
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.environment}-users"

  # Auto-verify email on sign-up
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  # Username is case-insensitive
  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = var.password_min_length
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # Standard attributes
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Custom attributes for the app
  schema {
    name                     = "buildingId"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  schema {
    name                     = "residentId"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  # Account recovery via email
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email configuration (Cognito default for dev, SES for prod)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Admin can create users (for guards and initial residents)
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "PackTrack — Código de verificación"
    email_message        = "Tu código de verificación es: {####}"
  }
}

# -----------------------------------------------------------------------------
# App Client (Mobile — SRP auth, no client secret)
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "mobile" {
  name         = "${var.project}-${var.environment}-mobile"
  user_pool_id = aws_cognito_user_pool.main.id

  # Mobile apps use SRP auth — no client secret
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  supported_identity_providers = ["COGNITO"]

  # Token validity
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  # Prevent user existence errors (security best practice)
  prevent_user_existence_errors = "ENABLED"

  # Read/write custom attributes
  read_attributes = [
    "email",
    "email_verified",
    "custom:buildingId",
    "custom:residentId",
  ]

  write_attributes = [
    "email",
    "custom:buildingId",
    "custom:residentId",
  ]
}

# -----------------------------------------------------------------------------
# User Groups
# -----------------------------------------------------------------------------
resource "aws_cognito_user_group" "guardias" {
  name         = "guardias"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Security guards — register and deliver packages"
  precedence   = 2
}

resource "aws_cognito_user_group" "residentes" {
  name         = "residentes"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Building residents — receive packages"
  precedence   = 3
}

resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Building administrators — manage buildings, units, residents"
  precedence   = 1
}
