# =============================================================================
# PackTrack — DynamoDB Module Outputs
# =============================================================================

output "table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.main.name
}

output "table_arn" {
  description = "DynamoDB table ARN"
  value       = aws_dynamodb_table.main.arn
}

output "table_id" {
  description = "DynamoDB table ID"
  value       = aws_dynamodb_table.main.id
}

output "gsi1_name" {
  description = "GSI1 index name (resident packages)"
  value       = "GSI1"
}

output "gsi2_name" {
  description = "GSI2 index name (status queue)"
  value       = "GSI2"
}

output "gsi3_name" {
  description = "GSI3 index name (pickup code)"
  value       = "GSI3"
}
