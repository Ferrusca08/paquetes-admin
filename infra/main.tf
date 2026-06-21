# =============================================================================
# PackTrack — Root Module
# =============================================================================
# Orchestrates all infrastructure modules for the PackTrack application.
# Usage:
#   terraform init
#   terraform plan -var-file=environments/dev.tfvars
#   terraform apply -var-file=environments/dev.tfvars
# =============================================================================

# -----------------------------------------------------------------------------
# Terraform Configuration
# -----------------------------------------------------------------------------
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "packtrack-terraform-state-806156384483"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "packtrack-terraform-locks"
    encrypt        = true
  }
}

# -----------------------------------------------------------------------------
# Provider
# -----------------------------------------------------------------------------
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

# -----------------------------------------------------------------------------
# Local Values
# -----------------------------------------------------------------------------
locals {
  # Read the GraphQL schema from the source-of-truth location
  graphql_schema = file("${path.module}/../schema/schema.graphql")
}

# -----------------------------------------------------------------------------
# Module: Cognito (Auth)
# -----------------------------------------------------------------------------
module "cognito" {
  source = "./modules/cognito"

  project            = var.project
  environment        = var.environment
  password_min_length = var.cognito_password_min_length
}

# -----------------------------------------------------------------------------
# Module: DynamoDB (Data)
# -----------------------------------------------------------------------------
module "dynamodb" {
  source = "./modules/dynamodb"

  project     = var.project
  environment = var.environment
}

# -----------------------------------------------------------------------------
# Module: S3 (Photo Storage)
# -----------------------------------------------------------------------------
module "s3" {
  source = "./modules/s3"

  project                     = var.project
  environment                 = var.environment
  aws_account_id              = var.aws_account_id
  lifecycle_ia_transition_days = var.s3_lifecycle_ia_transition_days
}

# -----------------------------------------------------------------------------
# Module: AppSync (GraphQL API)
# -----------------------------------------------------------------------------
module "appsync" {
  source = "./modules/appsync"

  project              = var.project
  environment          = var.environment
  aws_region           = var.aws_region
  cognito_user_pool_id = module.cognito.user_pool_id
  schema               = local.graphql_schema
  lambda_function_arns = module.lambda.function_arns
  lambda_role_arn      = module.lambda.role_arn
}

# -----------------------------------------------------------------------------
# Module: Lambda (Resolvers)
# -----------------------------------------------------------------------------
module "lambda" {
  source = "./modules/lambda"

  project             = var.project
  environment         = var.environment
  aws_region          = var.aws_region
  dynamodb_table_name = module.dynamodb.table_name
  dynamodb_table_arn  = module.dynamodb.table_arn
  s3_bucket_name      = module.s3.bucket_name
  s3_bucket_arn       = module.s3.bucket_arn
  appsync_api_id      = module.appsync.api_id
  appsync_api_arn     = module.appsync.api_arn
}

# -----------------------------------------------------------------------------
# Module: GitHub OIDC (CI/CD)
# -----------------------------------------------------------------------------
module "github_oidc" {
  source = "./modules/github-oidc"

  project        = var.project
  environment    = var.environment
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id
  github_repo    = "Ferrusca08/paquetes-admin"
}
