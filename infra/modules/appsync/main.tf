# =============================================================================
# PackTrack — AppSync Module
# =============================================================================
# Creates the GraphQL API with Cognito User Pool authentication.
# Phase 1: Schema + NONE data source.
# Phase 2: Lambda data sources + resolvers for all operations.
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
# NONE Data Source (for local resolvers / subscriptions)
# -----------------------------------------------------------------------------
resource "aws_appsync_datasource" "none" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "NoneDataSource"
  type             = "NONE"
  description      = "Placeholder data source for local resolvers and subscriptions"
}

# -----------------------------------------------------------------------------
# IAM Role — AppSync assumes this to invoke Lambda functions
# -----------------------------------------------------------------------------
resource "aws_iam_role" "appsync_lambda" {
  count = length(var.lambda_function_arns) > 0 ? 1 : 0
  name  = "${var.project}-${var.environment}-appsync-lambda"

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

resource "aws_iam_role_policy" "appsync_lambda_invoke" {
  count = length(var.lambda_function_arns) > 0 ? 1 : 0
  name  = "${var.project}-${var.environment}-appsync-lambda-invoke"
  role  = aws_iam_role.appsync_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = values(var.lambda_function_arns)
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Lambda Data Sources
# -----------------------------------------------------------------------------
resource "aws_appsync_datasource" "lambda" {
  for_each = var.lambda_function_arns

  api_id           = aws_appsync_graphql_api.main.id
  name             = replace(each.key, "-", "_")
  type             = "AWS_LAMBDA"
  description      = "Lambda data source: ${each.key}"
  service_role_arn = aws_iam_role.appsync_lambda[0].arn

  lambda_config {
    function_arn = each.value
  }
}

# -----------------------------------------------------------------------------
# Resolvers — Mutations (dedicated Lambdas)
# -----------------------------------------------------------------------------
resource "aws_appsync_resolver" "register_package" {
  count = contains(keys(var.lambda_function_arns), "register-package") ? 1 : 0

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "registerPackage"
  data_source = aws_appsync_datasource.lambda["register-package"].name
}

resource "aws_appsync_resolver" "confirm_pickup" {
  count = contains(keys(var.lambda_function_arns), "confirm-pickup") ? 1 : 0

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "confirmPickup"
  data_source = aws_appsync_datasource.lambda["confirm-pickup"].name
}

resource "aws_appsync_resolver" "get_upload_url" {
  count = contains(keys(var.lambda_function_arns), "get-upload-url") ? 1 : 0

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "getUploadUrl"
  data_source = aws_appsync_datasource.lambda["get-upload-url"].name
}

# -----------------------------------------------------------------------------
# Resolvers — Packages multi-resolver
# -----------------------------------------------------------------------------
locals {
  packages_resolver_fields = {
    # Queries
    "Query-getPackage"           = { type = "Query",    field = "getPackage" }
    "Query-listPackagesByStatus" = { type = "Query",    field = "listPackagesByStatus" }
    "Query-listMyPackages"       = { type = "Query",    field = "listMyPackages" }
    "Query-verifyPickupCode"     = { type = "Query",    field = "verifyPickupCode" }
    # Mutations
    "Mutation-markPackageReturned" = { type = "Mutation", field = "markPackageReturned" }
  }

  admin_resolver_fields = {
    # Queries
    "Query-getBuilding"      = { type = "Query",    field = "getBuilding" }
    "Query-listBuildings"    = { type = "Query",    field = "listBuildings" }
    "Query-listTowers"       = { type = "Query",    field = "listTowers" }
    "Query-listUnits"        = { type = "Query",    field = "listUnits" }
    "Query-listResidents"    = { type = "Query",    field = "listResidents" }
    "Query-searchResidents"  = { type = "Query",    field = "searchResidents" }
    # Mutations
    "Mutation-createBuilding"  = { type = "Mutation", field = "createBuilding" }
    "Mutation-updateBuilding"  = { type = "Mutation", field = "updateBuilding" }
    "Mutation-deleteBuilding"  = { type = "Mutation", field = "deleteBuilding" }
    "Mutation-createTower"     = { type = "Mutation", field = "createTower" }
    "Mutation-deleteTower"     = { type = "Mutation", field = "deleteTower" }
    "Mutation-createUnit"      = { type = "Mutation", field = "createUnit" }
    "Mutation-deleteUnit"      = { type = "Mutation", field = "deleteUnit" }
    "Mutation-createResident"      = { type = "Mutation", field = "createResident" }
    "Mutation-updateResident"      = { type = "Mutation", field = "updateResident" }
    "Mutation-deleteResident"      = { type = "Mutation", field = "deleteResident" }
    "Mutation-registerPushToken"   = { type = "Mutation", field = "registerPushToken" }
    # Guards (Cognito-only staff users)
    "Query-listGuards"     = { type = "Query",    field = "listGuards" }
    "Mutation-createGuard" = { type = "Mutation", field = "createGuard" }
    "Mutation-deleteGuard" = { type = "Mutation", field = "deleteGuard" }
  }
}

resource "aws_appsync_resolver" "packages" {
  for_each = contains(keys(var.lambda_function_arns), "packages-resolver") ? local.packages_resolver_fields : {}

  api_id      = aws_appsync_graphql_api.main.id
  type        = each.value.type
  field       = each.value.field
  data_source = aws_appsync_datasource.lambda["packages-resolver"].name
}

resource "aws_appsync_resolver" "admin" {
  for_each = contains(keys(var.lambda_function_arns), "admin-resolver") ? local.admin_resolver_fields : {}

  api_id      = aws_appsync_graphql_api.main.id
  type        = each.value.type
  field       = each.value.field
  data_source = aws_appsync_datasource.lambda["admin-resolver"].name
}

# -----------------------------------------------------------------------------
# Resolvers — Subscriptions (NONE data source, local resolvers)
# -----------------------------------------------------------------------------
locals {
  subscription_fields = {
    "onPackageRegistered" = { field = "onPackageRegistered" }
    "onPackagePickedUp"   = { field = "onPackagePickedUp" }
    "onMyPackageUpdated"  = { field = "onMyPackageUpdated" }
  }
}

resource "aws_appsync_resolver" "subscriptions" {
  for_each = local.subscription_fields

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Subscription"
  field       = each.value.field
  data_source = aws_appsync_datasource.none.name

  request_template  = "{\"version\": \"2017-02-28\", \"payload\": $util.toJson($context.arguments)}"
  response_template = "$util.toJson($context.result)"
}

# -----------------------------------------------------------------------------
# Resolver — processLabel (AWS Textract OCR)
# -----------------------------------------------------------------------------
resource "aws_appsync_resolver" "process_label" {
  count = contains(keys(var.lambda_function_arns), "process-label") ? 1 : 0

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "processLabel"
  data_source = aws_appsync_datasource.lambda["process-label"].name
}

# Fallback resolver for processLabel if Lambda not yet wired
resource "aws_appsync_resolver" "process_label_placeholder" {
  count = contains(keys(var.lambda_function_arns), "process-label") ? 0 : 1

  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "processLabel"
  data_source = aws_appsync_datasource.none.name

  request_template = <<-EOF
    {
      "version": "2017-02-28",
      "payload": {
        "suggestedName": null,
        "suggestedTrackingNumber": null,
        "suggestedCarrier": null,
        "rawText": "OCR not yet implemented",
        "confidence": 0
      }
    }
  EOF

  response_template = "$util.toJson($context.result)"
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

