# =============================================================================
# PackTrack — S3 Module
# =============================================================================
# Bucket for package label photos and delivery evidence.
# Globally unique name: packtrack-<env>-uploads-<accountId>
# =============================================================================

# -----------------------------------------------------------------------------
# Bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project}-${var.environment}-uploads-${var.aws_account_id}-us"

  tags = {
    Name = "${var.project}-${var.environment}-uploads"
  }
}

# -----------------------------------------------------------------------------
# Versioning
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

# -----------------------------------------------------------------------------
# Server-side encryption (SSE-S3)
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# -----------------------------------------------------------------------------
# Block all public access
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------------------------------------------------------
# Bucket policy — deny any non-TLS (HTTP) request
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceTLSRequestsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      }
    ]
  })

  # The public access block must exist first (block_public_policy).
  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

# -----------------------------------------------------------------------------
# CORS — allow presigned URL uploads from the mobile app
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 3600
  }
}

# -----------------------------------------------------------------------------
# Lifecycle — transition to IA after N days, expire after 1 year
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "transition-and-expiration"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = var.lifecycle_ia_transition_days
      storage_class = "STANDARD_IA"
    }

    # Auto-delete label/evidence photos after 180 days (cost + privacy).
    # ID photos are already deleted immediately after OCR in process-label.
    expiration {
      days = 180
    }

    # Non-current versions cleaned up after 30 days
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# -----------------------------------------------------------------------------
# Bucket ownership controls
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}
