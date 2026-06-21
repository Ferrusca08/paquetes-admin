# =============================================================================
# PackTrack — GitHub OIDC Module Outputs
# =============================================================================

output "role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes"
  value       = aws_iam_role.github_actions.arn
}

output "role_name" {
  description = "Name of the IAM role"
  value       = aws_iam_role.github_actions.name
}

output "oidc_provider_arn" {
  description = "ARN of the OIDC provider"
  value       = aws_iam_openid_connect_provider.github.arn
}
