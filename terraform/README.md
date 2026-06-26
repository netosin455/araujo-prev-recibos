# Infraestrutura — Export Worker (SQS + Lambda + S3)

IaaC dos recursos da exportação ZIP assíncrona, que antes eram criados à mão no console.

## Recursos gerenciados

- **SQS** `araujo-prev-jobs` + **DLQ** `araujo-prev-jobs-dlq` (redrive `maxReceiveCount = 3`)
- **Lambda** `araujo-prev-export-worker` + **event source mapping** SQS→Lambda
- **IAM**: role de execução da Lambda (logs, consumo da fila, `s3:PutObject` em `exports/*`)
- **IAM**: policy de `sqs:SendMessage` + `s3:GetObject` na role do EB (produtor)
- **S3 lifecycle**: expira `exports/*` após 7 dias (bucket `araujo-prev-comprovantes`, **já existente**)

## Pré-requisitos

1. AWS CLI autenticado (`aws sts get-caller-identity`).
2. Pacote da Lambda buildado:
   ```bash
   cd ../lambda/export-worker
   npm ci --production          # ou: npm install --production
   npm run build                # copia web/services/pdf-generator.js
   zip -r function.zip . -x '*.zip'
   cd -
   ```
3. `terraform.tfvars` criado a partir do `.example` com a `database_url`.

## Importante: os recursos já existem

Como tudo foi criado manualmente, rode `terraform import` antes do primeiro `apply`
para o Terraform **adotar** os recursos em vez de tentar recriá-los (o que daria erro de "já existe"):

```bash
terraform init

terraform import aws_sqs_queue.dlq            https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/araujo-prev-jobs-dlq
terraform import aws_sqs_queue.jobs           https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/araujo-prev-jobs
terraform import aws_iam_role.lambda          araujo-prev-export-worker-role
terraform import aws_lambda_function.export_worker araujo-prev-export-worker
terraform import aws_s3_bucket_lifecycle_configuration.exports_expiry araujo-prev-comprovantes
# event source mapping: pegue o UUID com `aws lambda list-event-source-mappings`
terraform import aws_lambda_event_source_mapping.sqs_to_lambda <UUID>
```

Depois:

```bash
terraform plan    # confira que o diff bate com a config (ajuste se houver divergência)
terraform apply
```

> Se preferir começar do zero numa conta nova, pule os `import` e rode direto `apply`.

## Deploy de código da Lambda

Para atualizar **só o código** depois (sem mexer em infra), basta rebuildar o `function.zip`
e `terraform apply` (o `source_code_hash` detecta a mudança), ou usar a AWS CLI:

```bash
aws lambda update-function-code --function-name araujo-prev-export-worker --zip-file fileb://../lambda/export-worker/function.zip
```
