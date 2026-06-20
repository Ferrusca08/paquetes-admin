# =============================================================================
# PackTrack — Lambda Module Variables
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

variable "dynamodb_table_name" {
  description = "DynamoDB table name"
  type        = string
}

variable "dynamodb_table_arn" {
  description = "DynamoDB table ARN"
  type        = string
}

variable "s3_bucket_name" {
  description = "S3 uploads bucket name"
  type        = string
}

variable "s3_bucket_arn" {
  description = "S3 uploads bucket ARN"
  type        = string
}

variable "appsync_api_id" {
  description = "AppSync GraphQL API ID"
  type        = string
}

variable "appsync_api_arn" {
  description = "AppSync GraphQL API ARN"
  type        = string
}
