# =============================================================================
# PackTrack — Cognito Module Outputs
# =============================================================================

output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

output "app_client_id" {
  description = "Cognito App Client ID (mobile)"
  value       = aws_cognito_user_pool_client.mobile.id
}
