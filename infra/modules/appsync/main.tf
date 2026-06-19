# =============================================================================
# PackTrack — AppSync Module
# =============================================================================
# Creates the GraphQL API with Cognito User Pool authentication.
# Phase 1: Schema skeleton + NONE data source (placeholder).
# Phase 2 will add Lambda data sources and resolvers.
# =============================================================================

# -----------------------------------------------------------------------------
# GraphQL API
# -----------------------------------------------------------------------------
resource "aws_appsync_graphql_api" "main" {
  name                = "${var.project}-${var.environment}-api"
  authentication_type = "AMAZON_COGNITO_USER_POOLS"

  user_pool_config {
    user_pool_id   = var.cognito_user_pool_id
    default_action = "ALLOW"
    aws_region     = var.aws_region
  }

  schema = var.schema

  # Enable CloudWatch logging for debugging
  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_logs.arn
    field_log_level          = "ERROR"
    exclude_verbose_content  = false
  }

  tags = {
    Name = "${var.project}-${var.environment}-api"
  }
}

# -----------------------------------------------------------------------------
# NONE Data Source (placeholder for Phase 1)
# Used for local resolvers / subscriptions
# -----------------------------------------------------------------------------
resource "aws_appsync_datasource" "none" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "NoneDataSource"
  type             = "NONE"
  description      = "Placeholder data source for local resolvers and subscriptions"
}

# -----------------------------------------------------------------------------
# IAM Role for AppSync CloudWatch Logging
# -----------------------------------------------------------------------------
resource "aws_iam_role" "appsync_logs" {
  name = "${var.project}-${var.environment}-appsync-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "appsync.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "appsync_logs" {
  role       = aws_iam_role.appsync_logs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppSyncPushToCloudWatchLogs"
}

# -----------------------------------------------------------------------------
# API Key (optional — for development/testing without Cognito)
# Disabled by default; uncomment if you need unauthenticated access.
# -----------------------------------------------------------------------------
# resource "aws_appsync_api_key" "dev" {
#   api_id  = aws_appsync_graphql_api.main.id
#   expires = timeadd(timestamp(), "8760h")  # 1 year
# }
