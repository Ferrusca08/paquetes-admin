# =============================================================================
# PackTrack — S3 Module Variables
# =============================================================================

variable "project" {
  description = "Project name prefix"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID for globally unique bucket name"
  type        = string
}

variable "lifecycle_ia_transition_days" {
  description = "Days before transitioning objects to Infrequent Access"
  type        = number
  default     = 90
}

variable "allowed_origins" {
  description = "Allowed CORS origins (for presigned URL uploads)"
  type        = list(string)
  default     = ["*"]
}
