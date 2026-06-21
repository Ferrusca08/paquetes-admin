variable "project" {
  description = "Project name prefix"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "topic_arn" {
  description = "SNS topic ARN for package events"
  type        = string
}

variable "lambda_role_arn" {
  description = "IAM role ARN shared by all Lambda functions"
  type        = string
}

variable "dynamodb_table_name" {
  description = "DynamoDB table name (passed to send-notification env)"
  type        = string
}

variable "functions_dist_dir" {
  description = "Path to the compiled Lambda dist directory"
  type        = string
}
