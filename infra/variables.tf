# =============================================================================
# PackTrack — Root Variables
# =============================================================================

variable "project" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "packtrack"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.project))
    error_message = "Project name must be lowercase alphanumeric with hyphens."
  }
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "mx-central-1"
}

variable "aws_account_id" {
  description = "AWS account ID — used for globally unique S3 bucket names"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "AWS account ID must be a 12-digit number."
  }
}

variable "cognito_password_min_length" {
  description = "Minimum password length for Cognito User Pool"
  type        = number
  default     = 8
}

variable "s3_lifecycle_ia_transition_days" {
  description = "Days before transitioning S3 objects to Infrequent Access"
  type        = number
  default     = 90
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}
