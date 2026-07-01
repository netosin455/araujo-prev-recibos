variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "Região AWS onde os recursos vivem."
}

variable "queue_name" {
  type        = string
  default     = "araujo-prev-jobs"
  description = "Nome da fila SQS principal (produtor = EB, consumidor = Lambda)."
}

variable "dlq_name" {
  type        = string
  default     = "araujo-prev-jobs-dlq"
  description = "Nome da Dead Letter Queue."
}

variable "max_receive_count" {
  type        = number
  default     = 3
  description = "Tentativas antes de mandar a mensagem para a DLQ."
}

variable "lambda_function_name" {
  type        = string
  default     = "araujo-prev-export-worker"
  description = "Nome da função Lambda worker."
}

variable "lambda_zip_path" {
  type        = string
  default     = "../lambda/export-worker/function.zip"
  description = "Caminho para o pacote .zip da Lambda (gerar com: cd lambda/export-worker && npm run build && npm prune --production && zip -r function.zip . -x '*.zip')."
}

variable "lambda_runtime" {
  type        = string
  default     = "nodejs20.x"
  description = "Runtime da Lambda (alinhado ao buildspec do EB)."
}

variable "lambda_timeout" {
  type        = number
  default     = 300
  description = "Timeout da Lambda em segundos (lotes de até 100 recibos)."
}

variable "lambda_memory" {
  type        = number
  default     = 1024
  description = "Memória da Lambda em MB."
}

variable "bucket_name" {
  type        = string
  default     = "araujo-prev-comprovantes"
  description = "Bucket S3 já existente (compartilhado com comprovantes). Os ZIPs ficam sob o prefixo exports/."
}

variable "exports_prefix" {
  type        = string
  default     = "exports/"
  description = "Prefixo no bucket onde os ZIPs são gravados e expirados."
}

variable "exports_expiration_days" {
  type        = number
  default     = 7
  description = "Dias até o S3 apagar os ZIPs em exports/."
}

variable "database_url" {
  type        = string
  sensitive   = true
  description = "Connection string do Neon PostgreSQL (DATABASE_URL) usada pela Lambda."
}

variable "eb_instance_role_name" {
  type        = string
  default     = "aws-elasticbeanstalk-ec2-role"
  description = "Role de instância do Elastic Beanstalk que precisa de permissão de SendMessage na fila."
}
