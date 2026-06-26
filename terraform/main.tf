data "aws_caller_identity" "current" {}

locals {
  bucket_arn  = "arn:aws:s3:::${var.bucket_name}"
  exports_arn = "arn:aws:s3:::${var.bucket_name}/${var.exports_prefix}*"
}

# ──────────────────────────────────────────────────────────────
# SQS: fila principal + DLQ
# ──────────────────────────────────────────────────────────────
resource "aws_sqs_queue" "dlq" {
  name                      = var.dlq_name
  message_retention_seconds = 1209600 # 14 dias
}

resource "aws_sqs_queue" "jobs" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.lambda_timeout * 6 # AWS recomenda >= 6x o timeout da Lambda
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# ──────────────────────────────────────────────────────────────
# IAM: role de execução da Lambda
# ──────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.lambda_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Logs no CloudWatch
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Consumo da fila + escrita do ZIP no S3
data "aws_iam_policy_document" "lambda_perms" {
  statement {
    sid     = "ConsumeQueue"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "PutExportsToS3"
    actions   = ["s3:PutObject"]
    resources = [local.exports_arn]
  }
}

resource "aws_iam_role_policy" "lambda_perms" {
  name   = "${var.lambda_function_name}-perms"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_perms.json
}

# ──────────────────────────────────────────────────────────────
# Lambda worker + event source mapping (SQS -> Lambda)
# ──────────────────────────────────────────────────────────────
resource "aws_lambda_function" "export_worker" {
  function_name    = var.lambda_function_name
  role             = aws_iam_role.lambda.arn
  runtime          = var.lambda_runtime
  handler          = "index.handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      DATABASE_URL = var.database_url
      BUCKET_NAME  = var.bucket_name
      # AWS_REGION é injetada automaticamente pelo runtime da Lambda (chave reservada — não definir).
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs_to_lambda" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.export_worker.arn
  batch_size       = 1
  enabled          = true
}

# ──────────────────────────────────────────────────────────────
# S3: lifecycle apagando os ZIPs de exports/ após N dias
# (o bucket já existe e é compartilhado — só gerenciamos o lifecycle)
# ──────────────────────────────────────────────────────────────
resource "aws_s3_bucket_lifecycle_configuration" "exports_expiry" {
  bucket = var.bucket_name

  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {
      prefix = var.exports_prefix
    }

    expiration {
      days = var.exports_expiration_days
    }
  }
}

# ──────────────────────────────────────────────────────────────
# IAM: permissão de SendMessage na role do Elastic Beanstalk (produtor)
# ──────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "eb_send" {
  statement {
    sid       = "SendToJobsQueue"
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl"]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "ReadExportsForPresign"
    actions   = ["s3:GetObject"]
    resources = [local.exports_arn]
  }
}

resource "aws_iam_role_policy" "eb_send" {
  name   = "${var.queue_name}-eb-producer"
  role   = var.eb_instance_role_name
  policy = data.aws_iam_policy_document.eb_send.json
}
