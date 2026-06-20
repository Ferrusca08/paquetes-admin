# =============================================================================
# PackTrack — Lambda Module
# =============================================================================
# Creates Lambda functions, IAM roles, and policies for all resolvers.
# Each function is bundled by esbuild and zipped by Terraform's archive_file.
# =============================================================================

locals {
  functions_dir = "${path.module}/../../../functions/dist"
  runtime       = "nodejs20.x"
  architecture  = "arm64"   # Graviton — better price/performance
  timeout       = 15
  memory        = 256

  # Common environment variables for all Lambda functions
  common_env = {
    TABLE_NAME  = var.dynamodb_table_name
    BUCKET_NAME = var.s3_bucket_name
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  }

  # Function definitions: name → handler-specific overrides
  functions = {
    register-package = {
      description = "Registers a new package in the system"
    }
    confirm-pickup = {
      description = "Confirms package pickup with PIN verification"
    }
    get-upload-url = {
      description = "Generates presigned S3 upload URLs"
    }
    packages-resolver = {
      description = "Multi-resolver for package queries and markPackageReturned"
    }
    admin-resolver = {
      description = "Multi-resolver for admin CRUD operations"
    }
  }
}

# -----------------------------------------------------------------------------
# ZIP Archives (built by esbuild → dist/<function>/index.mjs)
# -----------------------------------------------------------------------------
data "archive_file" "lambda" {
  for_each = local.functions

  type        = "zip"
  source_dir  = "${local.functions_dir}/${each.key}"
  output_path = "${local.functions_dir}/${each.key}.zip"
}

# -----------------------------------------------------------------------------
# IAM Role (shared by all functions — same permissions needed)
# -----------------------------------------------------------------------------
resource "aws_iam_role" "lambda" {
  name = "${var.project}-${var.environment}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# DynamoDB access
resource "aws_iam_role_policy" "dynamodb" {
  name = "${var.project}-${var.environment}-lambda-dynamodb"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
        ]
        Resource = [
          var.dynamodb_table_arn,
          "${var.dynamodb_table_arn}/index/*",
        ]
      }
    ]
  })
}

# S3 access (for presigned URL generation)
resource "aws_iam_role_policy" "s3" {
  name = "${var.project}-${var.environment}-lambda-s3"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
        ]
        Resource = "${var.s3_bucket_arn}/*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Lambda Functions
# -----------------------------------------------------------------------------
resource "aws_lambda_function" "resolvers" {
  for_each = local.functions

  function_name = "${var.project}-${var.environment}-${each.key}"
  description   = each.value.description
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = local.runtime
  architectures = [local.architecture]
  timeout       = local.timeout
  memory_size   = local.memory

  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256

  environment {
    variables = local.common_env
  }

  tags = {
    Name     = "${var.project}-${var.environment}-${each.key}"
    Function = each.key
  }
}

# -----------------------------------------------------------------------------
# Lambda Permission — Allow AppSync to invoke each function
# -----------------------------------------------------------------------------
resource "aws_lambda_permission" "appsync" {
  for_each = local.functions

  statement_id  = "AllowAppSyncInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resolvers[each.key].function_name
  principal     = "appsync.amazonaws.com"
  source_arn    = "${var.appsync_api_arn}/*"
}
