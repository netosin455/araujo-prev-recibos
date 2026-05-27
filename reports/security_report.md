# Security Report — Araujo Prev Recibos

**Última atualização:** 2026-05-27 — Agente 1 (Backend) — Rodada 2
**Arquivos analisados:** `web/server.js`, `web/public/app.js`, `web/public/index.html`

---

## ✅ Vulnerabilidades Corrigidas (histórico)

### SEC-001 — XSS via `onclick` inline no modal de detalhe de recibo
- **Severidade:** MÉDIA | **Status:** ✅ Corrigido em 2026-05-25
- Substituído por `addEventListener` com closure JS, eliminando interpolação de link em atributo HTML

### SEC-002 — `iframe src` sem validação de protocolo
- **Severidade:** MÉDIA | **Status:** ✅ Corrigido em 2026-05-25
- Adicionada validação `link.startsWith("https://")` antes de renderizar

### SEC-003 — Sem validação de enum `status` em `PATCH /api/clientes/:id/parcela/:num`
- **Severidade:** MÉDIA | **Status:** ✅ Corrigido em 2026-05-25
- Whitelist `["pendente", "pago", "atrasado"]` com retorno 400

### SEC-004 — Sem validação de enum `role` em `POST/PUT /api/users`
- **Severidade:** MÉDIA | **Status:** ✅ Corrigido em 2026-05-25
- Whitelist `["admin", "financeiro", "recepcao"]` com retorno 400

### SEC-005 — Exposição de mensagens internas de erro nas rotas admin
- **Severidade:** BAIXA | **Status:** ✅ Corrigido em 2026-05-25
- Substituídas por mensagens genéricas; detalhes apenas no log do servidor

### SEC-006 — `link_comprovante` sem validação de formato
- **Severidade:** BAIXA | **Status:** ✅ Corrigido em 2026-05-25
- Regex whitelist aceita apenas `/api/comprovante...`, URLs Drive e S3

### SEC-007 — Content-Security-Policy ausente
- **Severidade:** BAIXA | **Status:** ✅ Corrigido em 2026-05-25
- CSP restritivo adicionado com `default-src 'self'`

---

## 🔴 Vulnerabilidades Abertas — Críticas

### SEC-008 — Sem rate limiting em `POST /api/login`: brute force possível
- **Arquivo:** `web/server.js` — rota `POST /api/login`
- **Severidade:** CRÍTICA
- **Descrição:** Não há limitação de tentativas de login por IP ou por username. Um atacante pode testar 10.000 senhas por segundo sem bloqueio. O sistema usa bcrypt (lento por design), mas sem rate limit, um ataque paralelo é viável.
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:**
  ```js
  // npm install express-rate-limit
  const rateLimit = require("express-rate-limit");
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { erro: "Muitas tentativas. Aguarde 15 minutos." } });
  app.post("/api/login", loginLimiter, async (req, res) => { ... });
  ```
- **Status:** ✅ Corrigido em 2026-05-27

---

### SEC-009 — Upload de comprovante sem validação de tipo real (magic bytes)
- **Arquivo:** `web/server.js` — middleware multer
- **Severidade:** CRÍTICA
- **Descrição:** O multer aceita qualquer arquivo enviado. O `fileFilter` verifica apenas o `mimetype` declarado pelo cliente (facilmente falsificado). Um atacante pode renomear um `.exe` para `.pdf` e fazer upload. O arquivo fica salvo em disco ou S3.
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:** Após receber o arquivo, ler os primeiros bytes e validar assinatura (magic bytes):
  ```js
  // PDF começa com %PDF (0x25 0x50 0x44 0x46)
  // JPEG: 0xFF 0xD8 0xFF
  // PNG: 0x89 0x50 0x4E 0x47
  const buf = fs.readFileSync(file.path).slice(0, 8);
  const isPDF = buf.toString("ascii", 0, 4) === "%PDF";
  const isJPEG = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPNG = buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (!isPDF && !isJPEG && !isPNG) { fs.unlinkSync(file.path); return res.status(400)... }
  ```
- **Status:** ✅ Corrigido em 2026-05-27

---

## 🟡 Vulnerabilidades Abertas — Médias

### SEC-010 — Hash bcrypt de usuários salvo na planilha Google Sheets
- **Arquivo:** `web/server.js` — função de sincronização de usuários para Sheets
- **Severidade:** MÉDIA
- **Descrição:** A coluna de senha na aba `Usuarios` do Sheets armazena o hash bcrypt. Hash não é reversível, mas qualquer pessoa com acesso de leitura à planilha consegue baixar os hashes e tentar ataque de dicionário offline, sem limite de tentativas.
- **Agente responsável:** Agente 1 — Backend
- **Correção aplicada:** Coluna `password` removida de `sincronizarUsuariosParaSheets()` — sync escreve apenas `username`, `role`, `escritorio`, `created_at`. `restaurarUsuariosDeSheets()` atualizada para formato de 4 colunas; contas restauradas recebem hash placeholder inutilizável — admin deve redefinir senhas via painel
- **Status:** ✅ Corrigido em 2026-05-27

---

### SEC-011 — Token JWT em `localStorage`: vulnerável a XSS
- **Arquivo:** `web/public/app.js` — linha ~50
- **Severidade:** MÉDIA
- **Descrição:** `localStorage.setItem("token", token)` expõe o token a qualquer script XSS. Se uma vulnerabilidade XSS for introduzida no futuro (via biblioteca comprometida, CDN, etc.), o token pode ser roubado e a sessão sequestrada.
- **Agente responsável:** Agente 2 — Frontend + Agente 1 — Backend
- **Correção sugerida:** Migrar para cookie `httpOnly; Secure; SameSite=Strict`. Requer alteração no backend para setar o cookie no login e lê-lo nas requisições autenticadas
- **Observação:** Migração complexa — pode ser feita gradualmente. Manter `localStorage` como fallback enquanto implementa cookies
- **Status:** 🟡 Aberto

---

### SEC-012 — `govbrStates` em Map de memória: incompatível com múltiplos workers
- **Arquivo:** `web/server.js` — linha ~1668
- **Severidade:** MÉDIA
- **Descrição:** O Map `govbrStates` é armazenado na memória do processo Node.js. Se o Elastic Beanstalk escalar para 2+ instâncias, um state gerado no worker A não estará disponível no worker B, causando falha no callback do Gov.br com "State inválido".
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:** Persistir states no Neon (tabela `govbr_states` com TTL de 10 min) ou em Redis ElastiCache
- **Observação:** Risco baixo enquanto o sistema rodar com 1 instância (config atual)
- **Status:** 🟡 Aberto

---

### SEC-013 — Limite de upload muito alto (20MB)
- **Arquivo:** `web/server.js` — configuração do multer
- **Severidade:** MÉDIA
- **Descrição:** O limite de `20MB` para upload de comprovante é excessivo. Isso permite ataques de DoS por esgotamento de disco ou bandwidth, especialmente com uploads S3.
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:** Reduzir para `5MB` — suficiente para imagens e PDFs de comprovantes bancários
- **Status:** ✅ Corrigido em 2026-05-27

---

### SEC-014 — Presigned URL S3 salva na planilha Google Sheets
- **Arquivo:** `web/server.js` — função `registrarNoSheets()`
- **Severidade:** MÉDIA
- **Descrição:** O link do comprovante (presigned URL S3 com validade de 7 dias) é salvo na planilha. Qualquer pessoa com acesso à planilha consegue baixar o comprovante sem autenticação no sistema. Links S3 são opacos mas não são secretos — quem tiver a URL acessa o arquivo.
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:** Salvar na planilha apenas o path relativo (ex: `/api/comprovante-s3/recibos/...`), não a presigned URL completa
- **Status:** 🟡 Aberto

---

## 🔵 Vulnerabilidades Abertas — Baixas / Recomendações

### SEC-015 — Sem soft delete: exclusões são permanentes e sem auditoria
- **Arquivo:** `web/server.js` — rotas `DELETE /api/recibos/:id` e `DELETE /api/clientes/:id`
- **Severidade:** BAIXA
- **Descrição:** Deletes são permanentes. Não há registro de quem deletou, quando e por quê. Impossível rastrear exclusões maliciosas ou acidentais.
- **Correção sugerida:** Adicionar campo `deletado_em` e `deletado_por` ao invés de remover o documento. Filtrar `{ deletado_em: { $exists: false } }` nas listagens

### SEC-016 — Sem validação de CPF/CNPJ: dados fraudulentos aceitos
- **Arquivo:** `web/server.js` — rotas de criação/edição de recibos e clientes
- **Severidade:** BAIXA
- **Descrição:** CPF/CNPJ sem validação matemática permitem inserção de dados fictícios (ex: `111.111.111-11`) que passam pela máscara mas são inválidos.
- **Correção sugerida:** Validar dígito verificador no backend antes de salvar

### SEC-017 — `unsafe-inline` ainda presente no CSP para estilos
- **Arquivo:** `web/server.js` — header Content-Security-Policy
- **Severidade:** BAIXA
- **Descrição:** `style-src 'unsafe-inline'` é necessário para estilos dinâmicos via JS, mas abre brecha para CSS injection. Impacto limitado, mas não ideal.
- **Correção sugerida:** Migrar estilos dinâmicos para classes CSS e remover `unsafe-inline`

### SEC-018 — Sem HTTPS forçado (redirect comentado)
- **Arquivo:** `web/server.js` — linha com `X-Forwarded-Proto` check (comentada)
- **Severidade:** BAIXA
- **Descrição:** O middleware de redirect HTTP→HTTPS está comentado. O Elastic Beanstalk já redireciona no nível do Load Balancer, mas se acessar o servidor diretamente na porta 8080, trafega em HTTP.
- **Correção sugerida:** Descomentar middleware ou garantir security group bloqueie porta 8080 externamente

---

## Resumo Executivo

| Severidade | Total | Corrigidas | Abertas |
|------------|-------|------------|---------|
| Crítica    | 3     | 1 (SEC-007)| 2       |
| Média      | 9     | 6          | 5       |
| Baixa      | 6     | 1          | 4       |
| **Total**  | **18**| **8**      | **11**  |

### Prioridade de correção

1. **SEC-008** — Rate limiting no login (Agente 1 — 30min de trabalho, alto impacto)
2. **SEC-009** — Validação de magic bytes no upload (Agente 1 — 1h)
3. **SEC-010** — Remover hash da planilha (Agente 1 — 15min)
4. **SEC-013** — Reduzir limite de upload para 5MB (Agente 1 — 5min)
5. **SEC-016** — Validação de CPF/CNPJ (Agentes 1 e 2 — 2h)
