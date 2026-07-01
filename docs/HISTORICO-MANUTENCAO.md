# Histórico de Manutenção — Araujo Prev Recibos

> Documento completo de tudo que foi feito, bugs corrigidos, decisões tomadas e pendências.
> Leia antes de mexer em qualquer coisa que envolva SSL, PWA, Docker, Lambda, SQS, testes ou infra.

---

## Índice

1. [Bugs Corrigidos](#1-bugs-corrigidos)
2. [Melhorias de Código](#2-melhorias-de-código)
3. [Melhorias de Infraestrutura](#3-melhorias-de-infraestrutura)
4. [Novas Funcionalidades](#4-novas-funcionalidades)
5. [Arquivos Criados/Modificados](#5-arquivos-criadomodificados)
6. [Decisões Técnicas](#6-decisões-técnicas)
7. [Pendências](#7-pendências)
8. [Comandos Úteis](#8-comandos-úteis)
9. [Fluxo de Deploy](#9-fluxo-de-deploy)

---

## 1. Bugs Corrigidos

### 1.1 SSL — `rejectUnauthorized: false` → `true`

**Onde:** `web/server.js:58` e `lambda/export-worker/index.js:22`

**Problema:** Ambos usavam `rejectUnauthorized: false` na conexão SSL do PostgreSQL (Neon). Isso desabilita a verificação do certificado TLS, abrindo brecha para ataque MITM.

**O que foi feito:**
- `web/server.js:58`: `ssl: { rejectUnauthorized: false }` → `ssl: { rejectUnauthorized: true }`
- `lambda/export-worker/index.js:22`: `ssl: { rejectUnauthorized: false }` → `ssl: { rejectUnauthorized: true }`

**Por que funciona:** Neon usa certificado público assinado por CA conhecida. O Node.js consegue validar sem precisar de CA customizada.

**Se quebrar de novo:**
- Erro típico: `Error: self-signed certificate in certificate chain`
- Causa: ambiente bloqueando a CA pública do Neon (ex: proxy corporativo)
- Solução: setar `NODE_TLS_REJECT_UNAUTHORIZED=0` no ambiente TEMPORARIAMENTE para debug, mas NUNCA commit

### 1.2 PWA — Service Worker sendo "desligado" em vez de registrado

**Onde:** `web/public/sw-register.js`

**Problema:** O arquivo ORIGINAL chamava `navigator.serviceWorker.getRegistrations()` e fazia `registration.unregister()` para cada SW existente, efetivamente **desabilitando** o PWA. O SW (`sw.js`) existia mas nunca era ativado.

**Código original (bug):**
```js
navigator.serviceWorker.getRegistrations().then(regs => {
  for (let r of regs) r.unregister();
});
```

**Código corrigido:**
```js
navigator.serviceWorker.register("/sw.js");
```

**Comportamento do SW (`web/public/sw.js`):**
- Estratégia **network-first**: tenta a rede primeiro, cai no cache se offline
- Assets estáticos cacheados na instalação: `/`, `/index.html`, `/manifest.json`, `/logo.png`
- **Nunca** cacheia `/api/*` (requisições sempre vão pra rede)
- Cache atual: `araujo-prev-v3`

**Se quebrar de novo:**
- Verificar se o navegador aceita SW (Chrome > 95+, Edge, Firefox)
- Verificar se o `sw.js` está sendo servido na raiz (ex: `GET /sw.js` retorna 200)
- No DevTools → Application → Service Workers: deve mostrar "activated" e "running"

---

## 2. Melhorias de Código

### 2.1 ESLint + Prettier configurados

**Onde:** `web/.eslintrc.json`, `web/.prettierrc`

**Regras ativas:**
- ESLint: `eslint:recommended` + `eqeqeq: error`, `no-throw-literal: error`, `prefer-const: warn`, `no-var: warn`
- Prettier: 140 colunas, aspas duplas, trailing comma, sem ponto-e-vírgula opcional

**Comandos:**
```bash
npm run lint           # Checa lint
npm run lint -- --fix  # Corrige automático
npm run format         # Formata tudo
npm run format:check   # Só checa (usar em CI)
```

### 2.2 Scripts npm adicionados ao `web/package.json`

```json
"scripts": {
  "start": "node server.js",
  "dev": "node --watch server.js",
  "lint": "eslint . --ext .js,.mjs --ignore-pattern node_modules --ignore-pattern public/libs",
  "format": "prettier --write \"**/*.js\" --ignore-path .gitignore",
  "format:check": "prettier --check \"**/*.js\" --ignore-path .gitignore",
  "test": "node --test tests/*.test.js"
}
```

**Dependências adicionadas (devDependencies):**
- `eslint` ^10.6.0
- `prettier` ^3.9.3
- `express-rate-limit` ^7.5.0

### 2.3 Rate Limiting

**Onde:** `web/server.js:711-744`

Dois limiters:
- **`loginLimiter`** (linha 702): 10 requisições por 15 min no `/api/login`. Retorna 429 com `Muitas tentativas de login. Aguarde 15 minutos.`
- **`mutationLimiter`** (linha 711): 100 requisições por 15 min global em POST/PUT/PATCH/DELETE (exceto login). Middleware aplicado antes de montar as rotas (linha 739-745).

### 2.4 Logger Estruturado em JSON

**Arquivo:** `web/services/logger.js`

```js
logger.info("mensagem", { usuario, acao })
logger.error("falhou", { err })
logger.warn("atencao", { detalhe })
logger.debug("verbose", { dados }) // só imprime se NODE_ENV !== "production"
```

**Saída:**
```json
{"ts":"2026-06-29T10:00:00.000Z","level":"ERROR","msg":"falhou","error":{"message":"...","stack":["..."]}}
```

- ERROR/WARN → `stderr` (separado no CloudWatch)
- INFO/DEBUG → `stdout`

**Não está substituindo `console.log` no server.js ainda** — migração gradual pendente.

### 2.5 Endpoint `/api/health`

**Onde:** `web/server.js:2814-2829`

```http
GET /api/health
```

**Resposta (200):**
```json
{"status":"ok","checks":{"pg":true,"s3":true,"sqs":true},"uptime":1234.56}
```

**Resposta (503):**
```json
{"status":"degraded","checks":{"pg":false,"s3":false,"sqs":false},"uptime":12.34}
```

- Retorna 503 se PostgreSQL estiver fora — S3 e SQS são lenientes (não derrubam o health)
- S3 checa se o client está configurado (não faz requisição)
- SQS só checa se `EXPORT_QUEUE_URL` está setada

**Uso:** monitoramento externo (uptime robot, cloudwatch alarm, etc.)

### 2.6 Testes Adicionados

**Arquivo:** `tests/export.test.js`

Usa `node:test` (nativo do Node 18+) com `node:assert`.

**Testes:**
- `filaConfigurada()` retorna false sem `EXPORT_QUEUE_URL`
- Validações de export (array vazio, >100 IDs, null)
- `validarCPF()` — aceita CPF real (529.982.247-25), rejeita repetidos e inválidos
- `validarCNPJ()` — aceita CNPJ real (04.470.081/0001-26), rejeita repetidos e inválidos

**Estado do `tests/clientes.test.js`:** este arquivo usa `describe/test/expect` (API Jest) mas o Jest **não está instalado**. Esses testes NÃO rodam com `npm test`. Pendente: reescrever para `node:test`.

---

## 3. Melhorias de Infraestrutura

### 3.1 Docker + docker-compose para dev local

**Arquivos:**
- `Dockerfile` — imagem slim node:24, copia só `web/`, `npm ci --omit=dev`
- `docker-compose.yml` — app + postgres:16-alpine
- `.dockerignore` — exclui node_modules, .git, terraform, lambda, docs, tests

**Uso:**
```bash
docker compose up -d        # Sobe app + postgres
docker compose down         # Para tudo
docker compose down -v      # Para e apaga volume do PG
```

**Detalhes:**
- Dev: monta `./web` como volume, roda com `node --watch` (restart automático)
- Prod: imagem estática, roda `node server.js`
- PG local: usuário `araujo`, senha `araujo_dev`, porta 5432
- App: porta 3000, conecta no PG via `DATABASE_URL` com `sslmode=disable`

### 3.2 Terraform — Runtime da Lambda corrigido

**Arquivo:** `terraform/variables.tf:39`

```hcl
variable "lambda_runtime" {
  default = "nodejs20.x"  # era "nodejs18.x"
}
```

O runtime real da Lambda já estava em `nodejs20.x` (deploy manual). O Terraform estava desatualizado — agora está alinhado.

---

## 4. Novas Funcionalidades (Implementadas pelo Claude)

### 4.1 PDF Generator Compartilhado

**Arquivo fonte único:** `web/services/pdf-generator.js`

Importado por:
- `web/routes/recibos.js` — geração inline de PDF
- `lambda/export-worker/index.js` — geração em lote via SQS

**Build da Lambda:** `npm run build` copia `pdf-generator.js` de `web/services/` para `lambda/export-worker/`.

⚠️ **Regra:** sempre editar `web/services/pdf-generator.js`. Rodar `npm run build` na Lambda antes de deploy.

### 4.2 SQS + Lambda Export Worker

**Fila:** `araujo-prev-jobs` (SQS) com DLQ `araujo-prev-jobs-dlq` (maxReceiveCount=3)

**Produtor:** `web/services/fila.js` — envia mensagem JSON `{ jobId, ids }`

**Consumidor:** `lambda/export-worker/index.js`:
1. Lê job da tabela `export_jobs`
2. Para cada ID, busca recibo no PG, gera PDF
3. Atualiza `export_jobs.prontos` a cada 5 PDFs
4. Monta ZIP com `archiver`
5. Sobe ZIP no S3 em `exports/{jobId}.zip`
6. Marca job como `pronto` e salva `s3_key`
7. Se erro, marca `erro` e re-lança exceção (SQS retry → DLQ)

**Tabela `export_jobs`:** `id, status, total, prontos, formato, criado_por, s3_key, erro, criado_em`

**Cron de cleanup:** `web/server.js` — todo dia às 4h, deleta jobs com mais de 7 dias.

### 4.3 Terraform — Infra como Código

**Arquivos em `terraform/`:**
- `main.tf` — SQS, DLQ, Lambda, IAM, event source mapping, S3 lifecycle
- `variables.tf` — região, runtime, timeouts, flags
- `outputs.tf` — queue URL, queue ARN, function name
- `versions.tf` — provider AWS ~> 5.0, backend S3 comentado
- `README.md` — instruções de import e deploy
- `terraform.tfvars.example` — template de variáveis

**Recursos gerenciados:**
- `aws_sqs_queue.jobs` — fila principal
- `aws_sqs_queue.jobs_dlq` — dead letter queue
- `aws_lambda_function.export_worker` — função Lambda
- `aws_iam_role.lambda_exec` — role de execução
- `aws_iam_role_policy.lambda_exec` — policy anexada
- `aws_iam_role_policy.eb_send` — policy do EB producer
- `aws_lambda_event_source_mapping.sqs_trigger` — SQS → Lambda
- `aws_s3_bucket_lifecycle_configuration.exports_expiry` — expiração de exports em 7 dias

---

## 5. Arquivos Criados/Modificados

### Criados por esta sessão (opencode)

| Arquivo | O que é |
|---|---|
| `web/.eslintrc.json` | Config ESLint |
| `web/.prettierrc` | Config Prettier |
| `web/services/logger.js` | Logger estruturado JSON |
| `tests/export.test.js` | Testes de export, CPF, CNPJ |
| `Dockerfile` | Imagem Docker do app |
| `docker-compose.yml` | Docker compose dev (app + PG) |
| `.dockerignore` | Exclusões do Docker |
| `opencode.md` | Canal de comunicação entre agentes |

### Modificados por esta sessão (opencode)

| Arquivo | O que mudou |
|---|---|
| `web/server.js:58` | `rejectUnauthorized: false` → `true` |
| `web/server.js:702-708` | `loginLimiter` adicionado |
| `web/server.js:711-745` | `mutationLimiter` adicionado + middleware |
| `web/server.js:2814-2829` | Endpoint `GET /api/health` |
| `web/package.json` | Scripts `dev`, `lint`, `format`, `format:check`, `test` + deps `eslint`, `prettier`, `express-rate-limit` |
| `web/public/sw-register.js` | Reescrito de unregister → register |
| `terraform/variables.tf:39` | `lambda_runtime` `nodejs18.x` → `nodejs20.x` |

### Criados pelo Claude (sessão anterior)

| Arquivo | O que é |
|---|---|
| `web/services/pdf-generator.js` | Gerador de PDF compartilhado |
| `web/services/fila.js` | Produtor SQS |
| `lambda/export-worker/index.js` | Handler Lambda |
| `lambda/export-worker/package.json` | Deps da Lambda |
| `lambda/export-worker/.gitignore` | Exclusões da Lambda |
| `lambda/export-worker/logo.png` | Logo para PDF |
| `terraform/` (pasta completa) | Infra como código |

---

## 6. Decisões Técnicas

### SSL
- Neon usa CA pública → `rejectUnauthorized: true` funciona sem config adicional
- NUNCA commitar `rejectUnauthorized: false`

### PWA
- Network-first (não cache-first) porque recibos mudam com frequência
- `/api/*` nunca é cacheado (dados sensíveis)
- Cache estático renovado a cada deploy (bump `CACHE` string em `sw.js`)

### Logger
- ERROR/WARN → stderr, INFO/DEBUG → stdout (compatível com CloudWatch)
- Erros são serializados com stack limitado a 4 linhas (evita poluição)
- DEBUG só imprime em desenvolvimento

### Health Check
- Só PG derruba o health (503). S3 e SQS são consultivos.
- Razão: S3/SQS podem estar temporariamente indisponíveis sem ser falha crítica do app
- Timeout implícito de 5s (pool do PG)

### Lambda
- Pool `max: 1` — cada execução concorrente da Lambda tem seu próprio pool. Evita estourar limite de conexões do Neon.
- Timeout 300s, memória 1024MB
- Se `arquivos.length === 0` após processar todos IDs, lança exceção → SQS retry → DLQ (nunca marca como `pronto`)
- Event source mapping: batch size 1 (processa um job por vez)

### Docker Compose Dev
- Usa PostgreSQL local (evita depender do Neon durante desenvolvimento)
- Monta `./web` como volume — alterações refletem instantâneas (com `--watch`)
- PG local não tem SSL (`sslmode=disable`)

---

## 7. Pendências

### 🟡 Média Prioridade

| # | Item | Por que |
|---|---|---|
| 1 | **Migrar `console.log` para `logger`** | Hoje o server.js ainda usa `console.log`/`console.error`. Migrar gradualmente para `logger.info`/`logger.error` para ter logs estruturados no CloudWatch. |
| 2 | **Retenção de logs do Lambda** | O log group `/aws/lambda/araujo-prev-export-worker` retém logs para sempre. Adicionar `aws_cloudwatch_log_group` com `retention_in_days = 7` no Terraform. |
| 3 | **Reescrever `tests/clientes.test.js`** | Usa API Jest (`describe/test/expect`) mas Jest não está instalado. Reescrever para `node:test` (`const { describe, it } = require("node:test"); const assert = require("node:assert");`). |

### 🟢 Baixa Prioridade

| # | Item | Por que |
|---|---|---|
| 4 | **Swagger/OpenAPI** | Documentar as rotas da API com `swagger-jsdoc`. |
| 5 | **Script de deploy da Lambda** | Automatizar `npm run build` + `zip` + `aws lambda update-function-code` (ou `terraform apply`). |
| 6 | **Policy IAM duplicada** | A role da Lambda tem `sqs-s3-access` (legada, fora do Terraform) e `araujo-prev-export-worker-perms` (Terraform). Remover a legada manualmente. |
| 7 | **Terraform state remoto** | State está em `terraform/terraform.tfstate` local. Se outro dev rodar `apply`, o state dessincroniza. Subir pro S3. |
| 8 | **CI/CD da Lambda no buildspec** | O `buildspec.yml` atual só deploya o `web/` no EB. Adicionar step que builda + zipa + deploya a Lambda. |

---

## 8. Comandos Úteis

```bash
# ── Servidor ──────────────────────────────────────────
npm run dev              # Desenvolvimento com --watch
npm start                # Produção

# ── Qualidade de código ───────────────────────────────
npm run lint             # ESLint
npm run format           # Prettier --write
npm run format:check     # Prettier --check (CI)

# ── Testes ────────────────────────────────────────────
npm test                 # node --test tests/*.test.js
node --test tests/export.test.js            # Só export
node --test tests/integration.test.js       # Só integração
node --test tests/export.test.js --watch    # Watch mode

# ── Docker ────────────────────────────────────────────
docker compose up -d            # Sair app + PG local
docker compose logs -f app      # Ver logs do app
docker compose exec db psql -U araujo -d araujo_prev  # Shell no PG
docker compose down -v          # Parar + apagar volume

# ── Lambda ────────────────────────────────────────────
cd lambda/export-worker
npm ci --production        # Instalar só prod
npm run build              # Copiar pdf-generator.js do web/
zip -r function.zip . -x '*.zip'   # Empacotar
# Deploy:
aws lambda update-function-code --function-name araujo-prev-export-worker --zip-file fileb://function.zip
# Ou via Terraform:
terraform apply

# ── Health Check ──────────────────────────────────────
curl http://localhost:3000/api/health
# → {"status":"ok","checks":{"pg":true,"s3":true,"sqs":true},"uptime":123.45}

# ── Testar rate limiting ──────────────────────────────
for ($i=0; $i -lt 110; $i++) { curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"username":"x","senha":"x"}' }
# → Depois de 10, começa a retornar 429

# ── Terraform ─────────────────────────────────────────
cd terraform
terraform init
terraform plan
terraform apply
terraform destroy   # CUIDADO: destrói tudo
```

---

## 9. Fluxo de Deploy

### Deploy do Web App (Elastic Beanstalk)
```bash
git add .
git commit -m "..."
git push                    # buildspec.xml deploya automaticamente no EB
```

### Deploy da Lambda (manual — sem automatização ainda)
```bash
cd lambda/export-worker
npm ci --production
npm run build
zip -r function.zip . -x '*.zip'
aws lambda update-function-code --function-name araujo-prev-export-worker --zip-file fileb://function.zip
```

### Deploy do Terraform (infra)
```bash
cd terraform
terraform init
terraform plan
terraform apply            # Atualiza só o que mudou
```

---

## Anexo: Estado Atual do Projeto

### Stack
- **Web:** Node.js 24 + Express 4 no Elastic Beanstalk
- **DB:** PostgreSQL 16 no Neon (sa-east-1)
- **Fila:** SQS (`araujo-prev-jobs`) com DLQ
- **Worker:** Lambda (`araujo-prev-export-worker`) Node 20.x, 1024MB, 300s
- **Storage:** S3 (`araujo-prev-comprovantes`)
- **Infra:** Terraform (state local)

### Variáveis de Ambiente Essenciais

| Variável | Onde | Obrigatória |
|---|---|---|
| `DATABASE_URL` | EB + Lambda | Sim |
| `JWT_SECRET` | EB | Sim |
| `BUCKET_NAME` | EB + Lambda | Sim |
| `EXPORT_QUEUE_URL` | EB (produtor) | Só se usar SQS |
| `AWS_REGION` | Lambda (implícita) | Não (default us-east-1) |
| `GOOGLE_CREDENTIALS` | EB | Só se usar sheets |
| `DRIVE_FOLDER_ID` | EB | Só se usar sheets |
| `SMTP_HOST/USER/PASS` | EB | Só se usar email |

---

> Última atualização: 2026-06-29
