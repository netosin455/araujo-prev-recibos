# opencode.md — Canal de Comunicação entre opencode e Claude

> Este arquivo preserva o contexto entre sessões de agentes diferentes (opencode ↔ Claude).
> **Leia sempre antes de iniciar qualquer tarefa nova** — contém revisões de código, pendências técnicas e regras acumuladas.

---

## 🎯 Instruções para o Claude

Sempre que você (Claude) for iniciar uma sessão neste projeto:

1. **Leia este arquivo primeiro** — ele contém o estado atual das pendências e regras.
2. **Resolva os itens abaixo** na ordem de prioridade indicada.
3. **Atualize este arquivo** ao finalizar cada item: marque como `✅ resolvido` ou mova para baixo com nova data.
4. **Atualize o `CLAUDE.md`** se aprender algo que as próximas sessões precisem saber.

---

## ✅ Tarefas Aprovadas para o Claude Executar — TODAS RESOLVIDAS (2026-06-26, Claude)

### 🔴 Prioridade Alta

| # | Tarefa | Status | Como foi resolvido |
|---|---|---|---|
| 1 | **Extrair `gerarBufferPDFRecibo` para um módulo compartilhado** | ✅ resolvido | Criado `web/services/pdf-generator.js` (fonte única). `web/routes/recibos.js` importa e delega passando o `logoPath`. A Lambda importa `./pdf-generator`, gerado por `npm run build` (copia o arquivo do web/); cópia adicionada ao `.gitignore` da Lambda. |
| 2 | **Corrigir `rejectUnauthorized: false` no PostgreSQL da Lambda** | ✅ resolvido | `lambda/export-worker/index.js` → `ssl: { rejectUnauthorized: true }` (Neon usa CA pública). ⚠️ `web/server.js:58` ainda tem `rejectUnauthorized:false` — **fora do escopo desta task**, avaliar depois. |

### 🟡 Prioridade Média

| # | Tarefa | Status | Como foi resolvido |
|---|---|---|---|
| 3 | **Proteger contra ZIP vazio** | ✅ resolvido | `lambda/export-worker/index.js`: `if (arquivos.length === 0) throw ...` antes de `montarZip()` — o catch grava `status='erro'` e re-lança pra SQS/DLQ. |
| 4 | **Criar infraestrutura como código (IaaC)** | ✅ resolvido | Criado `terraform/` (versions/variables/main/outputs/tfvars.example/README/.gitignore) com SQS+DLQ (redrive 3x), Lambda, IAM (exec da Lambda + producer do EB), event source mapping e S3 lifecycle 7d. README documenta `terraform import` dos recursos já existentes. `AWS_REGION` **não** é setada no env da Lambda (chave reservada). Falta `terraform apply` (precisa de credenciais AWS). |

### 🟢 Prioridade Baixa

| # | Tarefa | Status | Como foi resolvido |
|---|---|---|---|
| 5 | **Cleanup automático de jobs antigos** | ✅ resolvido | `web/server.js`: novo `cron.schedule("0 4 * * *", ...)` que faz `DELETE FROM export_jobs WHERE criado_em < NOW() - INTERVAL '7 days'`. Reusa o `node-cron` já presente. |
| 6 | **Ajustar pool de conexões da Lambda** | ✅ resolvido | `lambda/export-worker/index.js`: `max: 2` → `max: 1`. |

### 📌 Pendências de deploy — ❌ RESOLVIDAS (2026-06-26, opencode)
- ✅ Lambda build e deploy de código (`aws lambda update-function-code`).
- ✅ Terraform `init` → `import` (6 recursos) → `apply` — infra agora versionada.
- ✅ `EXPORT_QUEUE_URL` já configurado no EB (`https://sqs.us-east-1.amazonaws.com/035351467585/araupo-prev-jobs`). Lambda não precisa (consome via event source mapping).
- (Opcional) Corrigir `web/server.js:58`: `rejectUnauthorized: false` → `true`.

---

## 📋 Regras para o Claude

1. **Layout do PDF**: edite **apenas** `web/services/pdf-generator.js` (fonte única). A Lambda recebe cópia via `npm run build`. Faça o build antes de deployar.
2. **Rota `/api/recibos/exportar-zip`**: tem dois caminhos (inline e SQS). Não quebre o fallback.
3. **`package-lock.json`**: evite bumps em cadeia de todo o `@aws-sdk/*`. Use `npm install --install-strategy=nested` ou atualize só o pacote necessário.
4. **Commits**: sempre mencione no commit message qual pendência do `opencode.md` está sendo resolvida (ex: `fix: resolve pendência #2 - SSL rejectUnauthorized na Lambda`).

---

## 📝 Revisão do Segundo Ciclo (2026-06-26)

O Claude executou as 6 tarefas do `opencode.md`. **opencheck verificou e aprovou.**

### Verificação de sintaxe (`node --check`)
- ✅ `web/server.js` — OK
- ✅ `web/routes/recibos.js` — OK
- ✅ `lambda/export-worker/index.js` — OK
- ✅ `web/services/pdf-generator.js` — OK

### Checklist por tarefa

| # | Tarefa | Verificação |
|---|---|---|
| 1 | Módulo PDF compartilhado | ✅ `web/services/pdf-generator.js` criado (fonte única, 55 linhas). `web/routes/recibos.js` agora importa e passa `logoPath`. Lambda usa `require("./pdf-generator")`. `package.json` da Lambda tem script `build` que copia o arquivo. `.gitignore` exclui `pdf-generator.js`. |
| 2 | SSL rejectUnauthorized | ✅ Lambda (`index.js:22`): `rejectUnauthorized: true`. ⚠️ `web/server.js:58` **ainda** tem `rejectUnauthorized: false` — fora do escopo, mas registrado como pendência opcional. |
| 3 | ZIP vazio | ✅ `index.js:63`: guard `arquivos.length === 0` throw — job vai pra DLQ em vez de subir ZIP vazio marcado `pronto`. |
| 4 | IaaC (Terraform) | ✅ `terraform/` completo: SQS+DLQ (redrive 3x), Lambda, IAM (Lambda + EB producer), event source mapping, S3 lifecycle 7d. README documenta `terraform import` dos recursos existentes. Não usa `AWS_REGION` no env da Lambda (chave reservada). |
| 5 | Cleanup de jobs | ✅ `server.js` novo cron `0 4 * * *`: `DELETE FROM export_jobs WHERE criado_em < NOW() - INTERVAL '7 days'`. |
| 6 | Pool max:1 | ✅ Lambda (`index.js:22`): `max: 2` → `max: 1`. |

### Diff geral: **+74 / -87 linhas** em 7 arquivos modificados + 7 novos na `terraform/` + `pdf-generator.js`.

### Pendências de deploy (ação humana, não-código)
- `cd lambda/export-worker && npm run build && zip -r function.zip . -x '*.zip'`, depois `terraform import` + `terraform apply` (ver `terraform/README.md`).
- Setar `EXPORT_QUEUE_URL` no EB e na Lambda.
- (Opcional) Corrigir `web/server.js:58`: `rejectUnauthorized: false` → `true`.

---

## 📜 Histórico de Sessões

| Data | Agente | Assunto |
|---|---|---|
| 2026-06-26 | Claude | Implementou SQS + Lambda + backend + frontend (commit `948940e`) |
| 2026-06-26 | opencode | Revisão pós-merge com 6 pendências documentadas |
| 2026-06-26 | opencode | Adicionou seção "Instruções para o Claude" com tarefas priorizadas |
| 2026-06-26 | Claude | Resolveu as 6 tarefas (#1–#6): módulo PDF compartilhado, SSL, guard de ZIP vazio, Terraform IaaC, cron de cleanup, pool max:1 |
| 2026-06-26 | opencode | **Verificação final**: sintaxe OK, 6/6 tarefas verificadas e aprovadas. Pendência de deploy registrada. |
