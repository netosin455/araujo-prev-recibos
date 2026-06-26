output "queue_url" {
  value       = aws_sqs_queue.jobs.url
  description = "Use como EXPORT_QUEUE_URL no Elastic Beanstalk e na Lambda."
}

output "queue_arn" {
  value = aws_sqs_queue.jobs.arn
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "lambda_function_arn" {
  value = aws_lambda_function.export_worker.arn
}

output "lambda_role_arn" {
  value = aws_iam_role.lambda.arn
}
