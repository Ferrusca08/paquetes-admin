# =============================================================================
# PackTrack — Lambda Module Outputs
# =============================================================================

output "function_arns" {
  description = "Map of function name → Lambda ARN"
  value       = { for k, v in aws_lambda_function.resolvers : k => v.arn }
}

output "function_names" {
  description = "Map of function name → Lambda function name"
  value       = { for k, v in aws_lambda_function.resolvers : k => v.function_name }
}

output "role_arn" {
  description = "IAM role ARN shared by all Lambda functions"
  value       = aws_iam_role.lambda.arn
}
