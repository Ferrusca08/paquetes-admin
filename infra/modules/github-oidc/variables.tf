# =============================================================================
# PackTrack — GitHub OIDC Module Variables
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

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo in format owner/repo (e.g. Ferrusca08/paquetes-admin)"
  type        = string
  default     = "Ferrusca08/paquetes-admin"
}
