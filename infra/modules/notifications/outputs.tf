output "send_notification_function_name" {
  description = "send-notification Lambda function name"
  value       = aws_lambda_function.send_notification.function_name
}

output "send_notification_function_arn" {
  description = "send-notification Lambda function ARN"
  value       = aws_lambda_function.send_notification.arn
}
