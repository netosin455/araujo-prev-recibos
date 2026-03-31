#!/bin/bash
# setup.sh — cria S3, API Gateway e configura permissões
# Uso: bash setup.sh <bucket-name> <lambda-arn> <region>

BUCKET=${1:-"meu-bucket-recibos"}
LAMBDA_ARN=$2
REGION=${3:-"us-east-1"}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "==> Criando bucket S3: $BUCKET"
if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION"
fi

echo "==> Criando API Gateway..."
API_ID=$(aws apigatewayv2 create-api \
    --name "recibo-api" \
    --protocol-type HTTP \
    --cors-configuration AllowOrigins="*",AllowMethods="POST,OPTIONS",AllowHeaders="Content-Type" \
    --query "ApiId" --output text --region "$REGION")

echo "API ID: $API_ID"

# Integração com Lambda
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$LAMBDA_ARN" \
    --payload-format-version "2.0" \
    --query "IntegrationId" --output text --region "$REGION")

# Rota POST /gerar-recibo
aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "POST /gerar-recibo" \
    --target "integrations/$INTEGRATION_ID" \
    --region "$REGION"

# Deploy
aws apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name "prod" \
    --auto-deploy \
    --region "$REGION"

# Permissão para API Gateway invocar Lambda
aws lambda add-permission \
    --function-name "$LAMBDA_ARN" \
    --statement-id "apigateway-invoke" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/gerar-recibo" \
    --region "$REGION"

ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/prod/gerar-recibo"
echo ""
echo "✅ Setup concluído!"
echo "📌 Endpoint: $ENDPOINT"
echo "📌 Bucket:   $BUCKET"
echo ""
echo "Guarde o endpoint e configure no app Electron em frontend/renderer.js"
