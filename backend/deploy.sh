#!/bin/bash
# deploy.sh — empacota e faz deploy da Lambda
# Uso: bash deploy.sh <nome-da-lambda> <nome-do-bucket>

LAMBDA_NAME=${1:-"recibo-generator"}
BUCKET=${2:-"meu-bucket-recibos"}
REGION=${3:-"us-east-1"}
ROLE_ARN=${4:-""}  # Preencha com a ARN da role IAM

echo "==> Instalando dependências..."
pip install -r requirements.txt -t package/ --quiet

cp lambda_function.py package/

echo "==> Criando pacote ZIP..."
cd package && zip -r ../lambda.zip . -q && cd ..

if [ -z "$ROLE_ARN" ]; then
    echo "ERRO: Informe a ARN da role IAM como 4º argumento"
    echo "Exemplo: bash deploy.sh recibo-generator meu-bucket us-east-1 arn:aws:iam::123456789:role/lambda-role"
    exit 1
fi

echo "==> Criando/atualizando Lambda..."
aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime python3.11 \
    --handler lambda_function.lambda_handler \
    --zip-file fileb://lambda.zip \
    --role "$ROLE_ARN" \
    --timeout 30 \
    --memory-size 256 \
    --environment "Variables={BUCKET_NAME=$BUCKET}" \
    --region "$REGION" 2>/dev/null || \
aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file fileb://lambda.zip \
    --region "$REGION"

echo "==> Limpando arquivos temporários..."
rm -rf package lambda.zip

echo "✅ Deploy concluído!"
