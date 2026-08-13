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

  # Secondary auth for the public visitor badge page (getVisitBadge @aws_api_key).
  additional_authentication_provider {
    authentication_type = "API_KEY"
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
# API Key — public access for the visitor badge web page (getVisitBadge)
# -----------------------------------------------------------------------------
resource "aws_appsync_api_key" "public" {
  api_id      = aws_appsync_graphql_api.main.id
  description = "Public key for the visitor virtual badge page"
  # AppSync caps API key lifetime at 365 days; Terraform rotates on apply after expiry.
  expires = timeadd(timestamp(), "8760h")

  lifecycle {
    # Avoid a new key on every apply just because `timestamp()` moved.
    ignore_changes = [expires]
  }
}

# -----------------------------------------------------------------------------
# NONE Data Source (for local resolvers / subscriptions)
# -----------------------------------------------------------------------------
resource "aws_appsync_datasource" "none" {
  api_id      = aws_appsync_graphql_api.main.id
  name        = "NoneDataSource"
  type        = "NONE"
  description = "Placeholder data source for local resolvers and subscriptions"
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
    "Query-getPackage"           = { type = "Query", field = "getPackage" }
    "Query-listPackagesByStatus" = { type = "Query", field = "listPackagesByStatus" }
    "Query-listMyPackages"       = { type = "Query", field = "listMyPackages" }
    "Query-verifyPickupCode"     = { type = "Query", field = "verifyPickupCode" }
    # Mutations
    "Mutation-markPackageReturned" = { type = "Mutation", field = "markPackageReturned" }
  }

  admin_resolver_fields = {
    # Queries
    "Query-getBuilding"     = { type = "Query", field = "getBuilding" }
    "Query-listBuildings"   = { type = "Query", field = "listBuildings" }
    "Query-listTowers"      = { type = "Query", field = "listTowers" }
    "Query-listUnits"       = { type = "Query", field = "listUnits" }
    "Query-listResidents"   = { type = "Query", field = "listResidents" }
    "Query-searchResidents" = { type = "Query", field = "searchResidents" }
    # Mutations
    "Mutation-createBuilding"    = { type = "Mutation", field = "createBuilding" }
    "Mutation-updateBuilding"    = { type = "Mutation", field = "updateBuilding" }
    "Mutation-deleteBuilding"    = { type = "Mutation", field = "deleteBuilding" }
    "Mutation-createTower"       = { type = "Mutation", field = "createTower" }
    "Mutation-deleteTower"       = { type = "Mutation", field = "deleteTower" }
    "Mutation-createUnit"        = { type = "Mutation", field = "createUnit" }
    "Mutation-deleteUnit"        = { type = "Mutation", field = "deleteUnit" }
    "Mutation-createResident"    = { type = "Mutation", field = "createResident" }
    "Mutation-updateResident"    = { type = "Mutation", field = "updateResident" }
    "Mutation-deleteResident"    = { type = "Mutation", field = "deleteResident" }
    "Mutation-registerPushToken" = { type = "Mutation", field = "registerPushToken" }
    # Guards (Cognito-only staff users)
    "Query-listGuards"     = { type = "Query", field = "listGuards" }
    "Mutation-createGuard" = { type = "Mutation", field = "createGuard" }
    "Mutation-deleteGuard" = { type = "Mutation", field = "deleteGuard" }
    # Community: announcements / reports / documents
    "Query-listAnnouncements"    = { type = "Query", field = "listAnnouncements" }
    "Query-listReports"          = { type = "Query", field = "listReports" }
    "Query-listMyReports"        = { type = "Query", field = "listMyReports" }
    "Query-listDocuments"        = { type = "Query", field = "listDocuments" }
    "Query-getDocumentUrl"       = { type = "Query", field = "getDocumentUrl" }
    "Mutation-createAnnouncement" = { type = "Mutation", field = "createAnnouncement" }
    "Mutation-deleteAnnouncement" = { type = "Mutation", field = "deleteAnnouncement" }
    "Mutation-createReport"       = { type = "Mutation", field = "createReport" }
    "Mutation-setReportStatus"    = { type = "Mutation", field = "setReportStatus" }
    "Mutation-createDocument"     = { type = "Mutation", field = "createDocument" }
    "Mutation-deleteDocument"     = { type = "Mutation", field = "deleteDocument" }
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
# Resolvers — Amenities multi-resolver
# -----------------------------------------------------------------------------
locals {
  amenities_resolver_fields = {
    # Queries
    "Query-listAmenities"          = { type = "Query", field = "listAmenities" }
    "Query-getAmenityAvailability" = { type = "Query", field = "getAmenityAvailability" }
    "Query-listMyReservations"     = { type = "Query", field = "listMyReservations" }
    "Query-listReservations"       = { type = "Query", field = "listReservations" }
    # Mutations
    "Mutation-createAmenity"     = { type = "Mutation", field = "createAmenity" }
    "Mutation-updateAmenity"     = { type = "Mutation", field = "updateAmenity" }
    "Mutation-setAmenityStatus"  = { type = "Mutation", field = "setAmenityStatus" }
    "Mutation-deleteAmenity"     = { type = "Mutation", field = "deleteAmenity" }
    "Mutation-createReservation" = { type = "Mutation", field = "createReservation" }
    "Mutation-cancelReservation" = { type = "Mutation", field = "cancelReservation" }
  }
}

resource "aws_appsync_resolver" "amenities" {
  for_each = contains(keys(var.lambda_function_arns), "amenities-resolver") ? local.amenities_resolver_fields : {}

  api_id      = aws_appsync_graphql_api.main.id
  type        = each.value.type
  field       = each.value.field
  data_source = aws_appsync_datasource.lambda["amenities-resolver"].name
}

# -----------------------------------------------------------------------------
# Resolvers — Visitors multi-resolver
# -----------------------------------------------------------------------------
locals {
  visitors_resolver_fields = {
    # Queries
    "Query-listActiveVisits" = { type = "Query", field = "listActiveVisits" }
    "Query-getVisitBadge"    = { type = "Query", field = "getVisitBadge" } # public (API key)
    # Mutations
    "Mutation-checkInVisit"  = { type = "Mutation", field = "checkInVisit" }
    "Mutation-checkOutVisit" = { type = "Mutation", field = "checkOutVisit" }
  }
}

resource "aws_appsync_resolver" "visitors" {
  for_each = contains(keys(var.lambda_function_arns), "visitors-resolver") ? local.visitors_resolver_fields : {}

  api_id      = aws_appsync_graphql_api.main.id
  type        = each.value.type
  field       = each.value.field
  data_source = aws_appsync_datasource.lambda["visitors-resolver"].name
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

