# remove-legacy-policy.ps1
# Remove a política inline "sqs-s3-access" legada da role da Lambda
# (duplicada — o Terraform gerencia "araujo-prev-export-worker-perms")
$RoleName = "araujo-prev-export-worker-role"
$PolicyName = "sqs-s3-access"

Write-Host "Removendo política inline $PolicyName da role $RoleName ..."
aws iam delete-role-policy --role-name $RoleName --policy-name $PolicyName
if ($LASTEXITCODE -eq 0) {
  Write-Host "Política $PolicyName removida com sucesso." -ForegroundColor Green
} else {
  Write-Host "Erro ao remover. Verifique se a política existe." -ForegroundColor Red
}
