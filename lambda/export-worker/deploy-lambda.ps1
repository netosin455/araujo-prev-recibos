# deploy-lambda.ps1
# Empacota e atualiza o código da Lambda export-worker
# Uso: .\deploy-lambda.ps1 [-Terraform]

param([switch]$Terraform)

$ErrorActionPreference = "Stop"
$LambdaDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FunctionName = "araujo-prev-export-worker"

Write-Host "==> Instalando dependências de produção..." -ForegroundColor Cyan
& npm ci --production
if ($LASTEXITCODE -ne 0) { throw "npm ci falhou" }

Write-Host "==> Copiando pdf-generator.js do web/services..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }

Write-Host "==> Empacotando lambda/function.zip..." -ForegroundColor Cyan
if (Test-Path "function.zip") { Remove-Item "function.zip" -Force }
$exclude = @("*.zip", "*.git*", "node_modules\.cache\*", ".gitignore")
Get-ChildItem -Path "." -Exclude $exclude |
  Compress-Archive -DestinationPath "function.zip"
if (-not (Test-Path "function.zip")) { throw "Compress-Archive falhou" }

if ($Terraform) {
  Write-Host "==> Atualizando via Terraform..." -ForegroundColor Cyan
  $TerraformDir = Resolve-Path "$LambdaDir/../../terraform"
  Push-Location $TerraformDir
  try {
    & terraform apply -auto-approve
  } finally { Pop-Location }
} else {
  Write-Host "==> Atualizando código da Lambda via AWS CLI..." -ForegroundColor Cyan
  & aws lambda update-function-code `
    --function-name $FunctionName `
    --zip-file fileb://function.zip
  if ($LASTEXITCODE -ne 0) { throw "aws lambda update falhou" }
}

Write-Host "==> Lambda $FunctionName atualizada com sucesso!" -ForegroundColor Green
