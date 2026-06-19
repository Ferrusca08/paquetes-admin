# =============================================================================
# PackTrack — AppSync Module Variables
# =============================================================================

variable "project" {
  description = "Project name prefix"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID for API authentication"
  type        = string
}

variable "schema" {
  description = "GraphQL schema definition (file content)"
  type        = string
}
