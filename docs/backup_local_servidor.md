# Backup Local no Servidor da Empresa — Guia de Instalação

> Objetivo: manter uma **cópia local** (no servidor físico da empresa) de tudo que
> importa, para nunca depender só da nuvem. Cobre:
> - **Documentos do fichário** (fotos/PDFs por cliente) — hoje no S3
> - **Comprovantes** de pagamento — hoje no S3
> - **Banco de dados** (recibos, clientes, usuários) — hoje no Neon/PostgreSQL

## Como funciona (visão geral)

O sistema roda na **nuvem** (AWS Elastic Beanstalk). A nuvem **não** consegue
escrever direto no disco do servidor da empresa. Por isso a estratégia é:

> **O servidor da empresa "puxa" as cópias**, em vez de a nuvem "empurrar".

Um script (`scripts/backup_local.ps1`) roda de tempos em tempos neste servidor e:
1. Baixa os arquivos novos do bucket S3 (`aws s3 sync`).
2. Gera um snapshot completo do banco (`pg_dump`).
3. Guarda tudo numa pasta local e registra num log.

Nada disso mexe no sistema em produção — é 100% leitura. Risco zero para o site no ar.

---

## Passo 1 — Instalar o AWS CLI

1. Baixe: <https://awscli.amazonaws.com/AWSCLIV2.msi>
2. Instale (next → next → finish).
3. Confirme abrindo o PowerShell e rodando:
   ```powershell
   aws --version
   ```
   Deve aparecer algo como `aws-cli/2.x.x`.

## Passo 2 — Criar credenciais de LEITURA para o S3

⚠️ **Não reutilize** as chaves do sistema em produção. Crie um usuário IAM
**somente-leitura**, restrito a este bucket. Assim, se o servidor da empresa for
comprometido, o atacante só consegue *ler* os backups — não apagar nada na nuvem.

No Console AWS → IAM → Users → **Create user** (ex.: `backup-local-readonly`):
- Sem acesso ao console (só chave programática).
- Anexe esta policy (Create inline policy → JSON):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:ListBucket"],
        "Resource": [
          "arn:aws:s3:::araujo-prev-comprovantes",
          "arn:aws:s3:::araujo-prev-comprovantes/*"
        ]
      }
    ]
  }
  ```
- Gere um **Access Key** para esse usuário e guarde as duas partes.

No servidor da empresa, configure as credenciais (uma vez só):
```powershell
aws configure
# AWS Access Key ID:     <cole a key do usuário backup-local-readonly>
# AWS Secret Access Key: <cole o secret>
# Default region name:   us-east-1
# Default output format: json
```

## Passo 3 — Instalar o `pg_dump` (para o backup do banco)

1. Baixe o instalador do PostgreSQL: <https://www.postgresql.org/download/windows/>
   (pode instalar **só** os "Command Line Tools" — não precisa do servidor completo).
2. Após instalar, adicione a pasta `bin` ao PATH (ex.:
   `C:\Program Files\PostgreSQL\17\bin`) ou confirme que funciona:
   ```powershell
   pg_dump --version
   ```

## Passo 4 — Definir a conexão do banco (variável de ambiente)

A senha do banco **não** fica no script. Ela é lida da variável `DATABASE_URL`.
Defina-a como variável de ambiente **da máquina** (persiste entre reinícios):

```powershell
# Rode UMA vez, como Administrador. Pegue o valor real no painel do Elastic Beanstalk
# (variável DATABASE_URL) — começa com postgresql://...
[Environment]::SetEnvironmentVariable(
  "DATABASE_URL",
  "postgresql://USUARIO:SENHA@HOST/neondb?sslmode=require",
  "Machine"
)
```
> Feche e reabra o PowerShell depois de definir, para a variável valer.

## Passo 5 — Testar o script manualmente

```powershell
cd "C:\caminho\do\projeto\scripts"
powershell -ExecutionPolicy Bypass -File .\backup_local.ps1 -BackupRoot "D:\BackupAraujoPrev"
```
Ajuste `-BackupRoot` para o disco/pasta onde você quer guardar (idealmente um disco
diferente do sistema, ou um HD externo). Ao final, confira:
- `D:\BackupAraujoPrev\arquivos-s3\` → deve ter as pastas `clientes/` e `comprovantes/`
- `D:\BackupAraujoPrev\banco\` → deve ter um arquivo `araujoprev_....dump`
- `D:\BackupAraujoPrev\logs\` → o log da execução

## Passo 6 — Agendar para rodar sozinho (Agendador de Tarefas)

Para rodar automático (ex.: a cada 6 horas):

1. Abra o **Agendador de Tarefas** do Windows → **Criar Tarefa**.
2. **Geral:** marque "Executar estando o usuário conectado ou não" e
   "Executar com privilégios mais altos".
3. **Disparadores:** novo → Diariamente, repetir a cada 6 horas por 1 dia.
4. **Ações:** novo → Iniciar um programa:
   - Programa: `powershell.exe`
   - Argumentos:
     ```
     -ExecutionPolicy Bypass -File "C:\caminho\do\projeto\scripts\backup_local.ps1" -BackupRoot "D:\BackupAraujoPrev"
     ```
5. Salve. Teste clicando com o botão direito → **Executar**.

---

## Restaurar (quando precisar)

- **Arquivos:** já estão prontos em `arquivos-s3/` — é só copiar.
- **Banco:** restaure um dump com:
  ```powershell
  pg_restore --no-owner --dbname="postgresql://USUARIO:SENHA@HOST/neondb?sslmode=require" "D:\BackupAraujoPrev\banco\araujoprev_2026-07-14_08-00-00.dump"
  ```

## Observações

- O `s3 sync` **não** apaga arquivos locais quando algo some do S3 (proposital:
  protege contra exclusão acidental na nuvem).
- O Neon já tem backups próprios; este dump local é uma **camada extra** de segurança.
- Recomendo guardar o `-BackupRoot` num disco separado do SO (ou externo) e, se
  possível, uma cópia mensal fora do prédio (nuvem/HD que sai da empresa).
