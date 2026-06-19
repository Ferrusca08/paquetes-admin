# =============================================================================
# PackTrack — Root Outputs
# =============================================================================
# These outputs are the values needed by the mobile app, Lambda functions,
# and downstream Terraform modules (Phases 2-5).
# =============================================================================

# -----------------------------------------------------------------------------
# Cognito
# -----------------------------------------------------------------------------
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = module.cognito.user_pool_arn
}

output "cognito_user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = module.cognito.user_pool_endpoint
}

output "cognito_app_client_id" {
  description = "Cognito App Client ID (mobile)"
  value       = module.cognito.app_client_id
}

# -----------------------------------------------------------------------------
# DynamoDB
# -----------------------------------------------------------------------------
output "dynamodb_table_name" {
  description = "DynamoDB table name"
  value       = module.dynamodb.table_name
}

output "dynamodb_table_arn" {
  description = "DynamoDB table ARN"
  value       = module.dynamodb.table_arn
}

# -----------------------------------------------------------------------------
# S3
# -----------------------------------------------------------------------------
output "s3_bucket_name" {
  description = "S3 uploads bucket name"
  value       = module.s3.bucket_name
}

output "s3_bucket_arn" {
  description = "S3 uploads bucket ARN"
  value       = module.s3.bucket_arn
}

# -----------------------------------------------------------------------------
# AppSync
# -----------------------------------------------------------------------------
output "appsync_api_id" {
  description = "AppSync GraphQL API ID"
  value       = module.appsync.api_id
}

output "appsync_api_url" {
  description = "AppSync GraphQL API URL"
  value       = module.appsync.api_url
}

output "appsync_realtime_url" {
  description = "AppSync Realtime WebSocket URL (subscriptions)"
  value       = module.appsync.api_realtime_url
}

output "appsync_api_arn" {
  description = "AppSync GraphQL API ARN"
  value       = module.appsync.api_arn
}

# -----------------------------------------------------------------------------
# Convenience: Mobile app configuration
# -----------------------------------------------------------------------------
output "mobile_config" {
  description = "Configuration values for the Expo mobile app (Amplify)"
  value = {
    aws_region           = var.aws_region
    cognito_user_pool_id = module.cognito.user_pool_id
    cognito_app_client_id = module.cognito.app_client_id
    appsync_api_url      = module.appsync.api_url
    appsync_realtime_url = module.appsync.api_realtime_url
    s3_bucket_name       = module.s3.bucket_name
  }
  sensitive = false
}
