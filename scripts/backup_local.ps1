<#
    backup_local.ps1 — Backup local do sistema Araujo Prev (roda no SERVIDOR DA EMPRESA)

    O QUE FAZ:
      1. Sincroniza TODOS os arquivos do bucket S3 (fichário + comprovantes) para uma pasta local.
      2. Gera um dump completo do banco de dados (Neon/PostgreSQL) num arquivo .dump.
      3. Mantém apenas os N dumps mais recentes (rotação) para não encher o disco.
      4. Registra tudo num log com data/hora.

    POR QUE ASSIM:
      O sistema roda na nuvem (AWS Elastic Beanstalk). A nuvem não consegue escrever
      direto no disco deste servidor. Então é ESTE servidor que "puxa" as cópias:
      - arquivos: via `aws s3 sync` (só baixa o que mudou; rápido e barato)
      - banco:    via `pg_dump` (snapshot completo, restaurável com pg_restore)

    PRÉ-REQUISITOS (ver docs/backup_local_servidor.md):
      - AWS CLI instalado e credenciais (read-only no bucket) configuradas
      - PostgreSQL client tools instalado (fornece pg_dump.exe)

    CONFIGURAÇÃO SENSÍVEL:
      A string de conexão do banco NÃO fica hardcoded aqui. Ela é lida da variável
      de ambiente DATABASE_URL (defina no servidor — ver o guia). Assim a senha do
      banco não vai parar no controle de versão nem em texto plano no script.
#>

[CmdletBinding()]
param(
    # Pasta raiz onde os backups ficam. Ajuste para o disco/pasta do seu servidor.
    [string]$BackupRoot = "D:\BackupAraujoPrev",

    # Nome do bucket S3 (o mesmo do sistema em produção).
    [string]$Bucket = "araujo-prev-comprovantes",

    # Quantos dumps do banco manter. Os mais antigos são apagados.
    [int]$RetencaoDumps = 30
)

$ErrorActionPreference = "Stop"

# ── Caminhos derivados ──────────────────────────────────────────────
$PastaArquivos = Join-Path $BackupRoot "arquivos-s3"   # espelho do bucket
$PastaDumps    = Join-Path $BackupRoot "banco"          # dumps do PostgreSQL
$PastaLogs     = Join-Path $BackupRoot "logs"
$Carimbo       = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$ArquivoLog    = Join-Path $PastaLogs "backup_$Carimbo.log"

# Cria a estrutura de pastas se ainda não existir.
foreach ($p in @($BackupRoot, $PastaArquivos, $PastaDumps, $PastaLogs)) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

# ── Função de log: escreve no console E no arquivo, com timestamp ────
function Write-Log {
    param([string]$Mensagem, [string]$Nivel = "INFO")
    $linha = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Nivel, $Mensagem
    Write-Host $linha
    Add-Content -Path $ArquivoLog -Value $linha -Encoding utf8
}

$houveErro = $false

Write-Log "===== INÍCIO DO BACKUP LOCAL ====="
Write-Log "Destino: $BackupRoot"

# ── ETAPA 1: Sincronizar arquivos do S3 (fichário + comprovantes) ───
# `aws s3 sync` baixa apenas o que é novo/alterado. NÃO usamos --delete de
# propósito: se alguém apagar um arquivo no S3 por engano, a cópia local
# permanece (essa é justamente a proteção que você quer).
try {
    Write-Log "Sincronizando arquivos do bucket s3://$Bucket ..."
    $saidaSync = & aws s3 sync "s3://$Bucket" $PastaArquivos --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "aws s3 sync retornou código $LASTEXITCODE. Saída: $saidaSync"
    }
    $qtd = (Get-ChildItem -Path $PastaArquivos -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Log "Arquivos sincronizados com sucesso. Total local agora: $qtd arquivos."
} catch {
    $houveErro = $true
    Write-Log "FALHA na sincronização do S3: $($_.Exception.Message)" "ERROR"
}

# ── ETAPA 2: Dump do banco de dados (Neon/PostgreSQL) ───────────────
# Formato custom (-Fc): compacto e restaurável com pg_restore. A conexão vem
# da variável de ambiente DATABASE_URL (nunca hardcoded).
try {
    $dbUrl = $env:DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($dbUrl)) {
        throw "Variável de ambiente DATABASE_URL não definida. Configure no servidor (ver o guia)."
    }
    $arquivoDump = Join-Path $PastaDumps "araujoprev_$Carimbo.dump"
    Write-Log "Gerando dump do banco de dados ..."
    # pg_dump lê a URL diretamente; --no-owner facilita restaurar em outro banco.
    & pg_dump $dbUrl --format=custom --no-owner --file=$arquivoDump 2>&1 | ForEach-Object { Write-Log $_ "PG" }
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump retornou código $LASTEXITCODE."
    }
    $tam = [math]::Round((Get-Item $arquivoDump).Length / 1MB, 2)
    Write-Log "Dump gerado: $arquivoDump ($tam MB)."
} catch {
    $houveErro = $true
    Write-Log "FALHA no dump do banco: $($_.Exception.Message)" "ERROR"
}

# ── ETAPA 3: Rotação — manter só os N dumps mais recentes ───────────
try {
    $dumps = Get-ChildItem -Path $PastaDumps -Filter "*.dump" -File | Sort-Object LastWriteTime -Descending
    if ($dumps.Count -gt $RetencaoDumps) {
        $paraApagar = $dumps | Select-Object -Skip $RetencaoDumps
        foreach ($d in $paraApagar) {
            Remove-Item $d.FullName -Force
            Write-Log "Dump antigo removido (rotação): $($d.Name)"
        }
    }
} catch {
    Write-Log "Aviso: falha na rotação de dumps antigos: $($_.Exception.Message)" "WARN"
}

# ── Fim ─────────────────────────────────────────────────────────────
if ($houveErro) {
    Write-Log "===== BACKUP CONCLUÍDO COM ERROS (ver acima) =====" "ERROR"
    exit 1
} else {
    Write-Log "===== BACKUP CONCLUÍDO COM SUCESSO ====="
    exit 0
}
