# =============================================================================
# PackTrack — Remote State Bootstrap
# =============================================================================
# Run this ONCE to create the S3 bucket and DynamoDB table for Terraform state.
# After apply, migrate with: terraform init -migrate-state (from infra/)
#
# Usage:
#   cd infra/backend
#   terraform init
#   terraform apply
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# -----------------------------------------------------------------------------
# S3 Bucket — Terraform State
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = "packtrack-terraform-state-806156384483"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "packtrack-terraform-state"
    ManagedBy = "terraform"
    Purpose   = "terraform-remote-state"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------------------------------------------------------
# DynamoDB Table — State Locking
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "locks" {
  name         = "packtrack-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "packtrack-terraform-locks"
    ManagedBy = "terraform"
    Purpose   = "terraform-state-locking"
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "state_bucket_name" {
  value = aws_s3_bucket.state.id
}

output "locks_table_name" {
  value = aws_dynamodb_table.locks.name
}
