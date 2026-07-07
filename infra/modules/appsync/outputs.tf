# =============================================================================
# PackTrack — AppSync Module Outputs
# =============================================================================

output "api_id" {
  description = "AppSync GraphQL API ID"
  value       = aws_appsync_graphql_api.main.id
}

output "api_url" {
  description = "AppSync GraphQL API URL (HTTPS endpoint)"
  value       = aws_appsync_graphql_api.main.uris["GRAPHQL"]
}

output "api_realtime_url" {
  description = "AppSync Realtime WebSocket URL (for subscriptions)"
  value       = aws_appsync_graphql_api.main.uris["REALTIME"]
}

output "api_arn" {
  description = "AppSync GraphQL API ARN"
  value       = aws_appsync_graphql_api.main.arn
}

output "none_datasource_name" {
  description = "NONE data source name (for local resolvers)"
  value       = aws_appsync_datasource.none.name
}

output "api_key" {
  description = "Public API key for the visitor badge page (getVisitBadge)"
  value       = aws_appsync_api_key.public.key
  sensitive   = true
}
