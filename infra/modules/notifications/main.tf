# =============================================================================
# PackTrack — Notifications Module
# =============================================================================
# send-notification Lambda: triggered by SNS, sends Expo push + WhatsApp DEMO.
# Also grants the shared Lambda role permission to publish to the SNS topic.
# =============================================================================

# -----------------------------------------------------------------------------
# IAM: Allow the shared Lambda role to publish to the SNS topic
# (Added here to avoid circular deps — the topic is created in the root module)
# -----------------------------------------------------------------------------
resource "aws_iam_role_policy" "sns_publish" {
  name = "${var.project}-${var.environment}-lambda-sns-publish"
  role = var.lambda_role_arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = var.topic_arn
      },
      {
        # SMS publishes go directly to a phone number (no topic ARN), so the
        # resource cannot be scoped beyond "*".
        Sid      = "PublishSmsToPhoneNumbers"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# send-notification Lambda
# -----------------------------------------------------------------------------
data "archive_file" "send_notification" {
  type        = "zip"
  source_dir  = "${var.functions_dist_dir}/send-notification"
  output_path = "${var.functions_dist_dir}/send-notification.zip"
}

resource "aws_lambda_function" "send_notification" {
  function_name = "${var.project}-${var.environment}-send-notification"
  description   = "Sends push notification + SMS when a package is registered"
  role          = var.lambda_role_arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.send_notification.output_path
  source_code_hash = data.archive_file.send_notification.output_base64sha256

  environment {
    variables = {
      TABLE_NAME     = var.dynamodb_table_name
      SMS_ENABLED    = "true"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  tags = {
    Name     = "${var.project}-${var.environment}-send-notification"
    Function = "send-notification"
  }
}

# -----------------------------------------------------------------------------
# SNS → Lambda subscription
# -----------------------------------------------------------------------------
resource "aws_sns_topic_subscription" "send_notification" {
  topic_arn = var.topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.send_notification.arn
}

# Allow SNS to invoke the Lambda
resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_notification.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = var.topic_arn
}
