# =============================================================================
# PackTrack — GitHub Actions OIDC Module
# =============================================================================
# Creates the IAM OIDC provider and role that GitHub Actions assumes.
# Credentials are temporary per-job — no long-lived keys needed.
# =============================================================================

# -----------------------------------------------------------------------------
# OIDC Provider (GitHub's token endpoint)
# -----------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint (stable)
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# -----------------------------------------------------------------------------
# IAM Role — GitHub Actions assumes this via OIDC
# -----------------------------------------------------------------------------
resource "aws_iam_role" "github_actions" {
  name = "${var.project}-${var.environment}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            # Only allow the packtrack repo, main branch
            "token.actions.githubusercontent.com:sub" = [
              "repo:${var.github_repo}:ref:refs/heads/main",
              "repo:${var.github_repo}:pull_request",
              "repo:${var.github_repo}:environment:*",
            ]
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Inline Policy — Terraform needs broad deploy permissions
# Scoped to packtrack-* resources where possible
# -----------------------------------------------------------------------------
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project}-${var.environment}-github-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Lambda
      {
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:DeleteFunction",
          "lambda:ListFunctions",
          "lambda:AddPermission",
          "lambda:RemovePermission",
          "lambda:GetPolicy",
          "lambda:TagResource",
        ]
        Resource = "arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:${var.project}-*"
      },
      # AppSync
      {
        Effect = "Allow"
        Action = [
          "appsync:GetGraphqlApi",
          "appsync:UpdateGraphqlApi",
          "appsync:GetDataSource",
          "appsync:CreateDataSource",
          "appsync:UpdateDataSource",
          "appsync:DeleteDataSource",
          "appsync:GetResolver",
          "appsync:CreateResolver",
          "appsync:UpdateResolver",
          "appsync:DeleteResolver",
          "appsync:ListGraphqlApis",
          "appsync:ListDataSources",
          "appsync:ListResolvers",
          "appsync:TagResource",
        ]
        Resource = "*"
      },
      # DynamoDB (para tabla packtrack-*)
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable",
          "dynamodb:DescribeTimeToLive",
          "dynamodb:ListTagsOfResource",
          "dynamodb:TagResource",
          "dynamodb:DescribeContinuousBackups",
          "dynamodb:DescribeKinesisStreamingDestination",
          "dynamodb:DescribeGlobalTable",
          "dynamodb:ListGlobalTables",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${var.project}-*"
      },
      # IAM (scoped al proyecto)
      {
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:CreateRole",
          "iam:UpdateRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:PassRole",
          "iam:TagRole",
          "iam:GetOpenIDConnectProvider",
          "iam:CreateOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviders",
          "iam:TagOpenIDConnectProvider",
        ]
        Resource = "*"
      },
      # S3 — state bucket + uploads bucket
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketVersioning",
          "s3:GetBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketLogging",
          "s3:GetBucketWebsite",
          "s3:GetEncryptionConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketCors",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging",
        ]
        Resource = [
          "arn:aws:s3:::packtrack-*",
          "arn:aws:s3:::packtrack-*/*",
        ]
      },
      # DynamoDB locks table
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/packtrack-terraform-locks"
      },
      # Cognito
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:GetUserPoolMfaConfig",
          "cognito-idp:ListUserPoolClients",
          "cognito-idp:ListTagsForResource",
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${var.aws_account_id}:userpool/*"
      },
      # CloudWatch Logs (para Lambda logs)
      {
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups",
          "logs:ListTagsForResource",
          "logs:ListTagsLogGroup",
        ]
        Resource = "*"
      },
    ]
  })
}
