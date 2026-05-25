# Security Report — Araujo Prev Recibos
**Data da análise:** 2026-05-25
**Arquivos analisados:** `web/server.js`, `web/public/app.js`

---

## SEC-001 — XSS via `onclick` inline no modal de detalhe de recibo
- **Arquivo:** `web/public/app.js` — função `abrirDetalhe`
- **Severidade:** MÉDIA
- **Descrição:** O botão "Ver comprovante" era renderizado via `innerHTML` com `onclick="abrirComprovante('${esc(link)}')"`. Mesmo usando `esc()`, entidades HTML como `&#39;` são decodificadas pelo parser antes da execução JS, tornando a escapa ineficaz para contexto JavaScript dentro de atributos HTML. Um link malicioso persistido no banco poderia executar JS arbitrário no navegador do usuário.
- **Correção aplicada:** Substituído por `id="btn-ver-comprovante-modal"` + `addEventListener` via `onclick` no DOM após o render, passando `r.link_comprovante` diretamente ao closure JS.

---

## SEC-002 — `iframe src` sem validação de protocolo
- **Arquivo:** `web/public/app.js` — função `abrirComprovante` (fallback externo)
- **Severidade:** MÉDIA
- **Descrição:** O caminho de fallback da função `abrirComprovante` inseria o link diretamente em `<iframe src="...">` sem validar o protocolo. Um link `javascript:...` ou `data:...` poderia ser renderizado, potencialmente executando código.
- **Correção aplicada:** Adicionada validação `if (!link.startsWith("https://"))` antes de renderizar o iframe; link escapado com `esc()` no atributo `src`.

---

## SEC-003 — Sem validação de enum `status` em `PATCH /api/clientes/:id/parcela/:num`
- **Arquivo:** `web/server.js` — rota `PATCH /api/clientes/:id/parcela/:num`
- **Severidade:** MÉDIA
- **Descrição:** O campo `status` era aceito sem verificação de valor permitido. Um atacante autenticado poderia gravar um status arbitrário (ex: `"hacked"`) corrompendo a lógica de `recalcularResumo()` que filtra por `"pago"`.
- **Correção aplicada:** Whitelist explícita: `STATUS_VALIDOS = ["pendente", "pago", "atrasado"]` com retorno 400 para valores não permitidos.

---

## SEC-004 — Sem validação de enum `role` em `POST/PUT /api/users`
- **Arquivo:** `web/server.js` — rotas `POST /api/users` e `PUT /api/users/:id`
- **Severidade:** MÉDIA
- **Descrição:** O campo `role` era aceito sem verificação. Um admin poderia acidentalmente criar um usuário com role desconhecida (ex: `"superadmin"`) que passaria pelo middleware `financeiroOnly` sem restrição esperada.
- **Correção aplicada:** Whitelist explícita: `ROLES_VALIDOS = ["admin", "financeiro", "recepcao"]` com retorno 400 para valores não permitidos.

---

## SEC-005 — Exposição de mensagens internas de erro nas rotas admin
- **Arquivo:** `web/server.js` — rotas `/api/admin/*`
- **Severidade:** BAIXA
- **Descrição:** Blocos `catch` nas 4 rotas admin retornavam `{ erro: e.message }` diretamente ao cliente, podendo vazar detalhes de infraestrutura (nome de variável Postgres, caminho de arquivo, message de API do Google).
- **Correção aplicada:** Substituídas por mensagens genéricas ("Erro ao sincronizar planilha.", etc.) mantendo o log completo apenas no servidor.

---

## SEC-006 — `link_comprovante` sem validação de formato
- **Arquivo:** `web/server.js` — rota `PATCH /api/recibos/:id/comprovante`
- **Severidade:** BAIXA
- **Descrição:** Qualquer string era aceita como `link_comprovante`, incluindo valores como `javascript:...`. Embora o link seja renderizado via `abrirComprovante()` no frontend, a validação deve existir na API.
- **Correção aplicada:** Regex de whitelist aceita apenas `/api/comprovante...`, `https://drive.google.com/...` e `https://*.amazonaws.com/...`.

---

## SEC-007 — Content-Security-Policy ausente
- **Arquivo:** `web/server.js` — middleware de headers de segurança
- **Severidade:** BAIXA
- **Descrição:** Não havia cabeçalho `Content-Security-Policy`. Sem CSP, o navegador permite execução de scripts inline de qualquer origem, carregamento de recursos externos arbitrários e outras injeções.
- **Correção aplicada:** Adicionado CSP restritivo: `default-src 'self'`, com exceções explícitas para `unsafe-inline` (necessário para scripts/estilos inline existentes), Google Fonts, Bootstrap Icons CDN e frames do Drive.

---

## Itens sem correção imediata (recomendações futuras)

| # | Descrição | Severidade | Motivo de não corrigir agora |
|---|-----------|-----------|------------------------------|
| R1 | Sem rate limiting no `POST /api/login` — força bruta de senhas possível | MÉDIA | Requer middleware externo (ex: `express-rate-limit`); Elastic Beanstalk ALB já bloqueia IPs abusivos no nível de rede |
| R2 | `POST /api/recibos` não impede números de recibo duplicados | BAIXA | Lógica de negócio existente no frontend controla numeração; duplicatas seriam visíveis na planilha |
| R3 | `unsafe-inline` no CSP para scripts — necessário para o código inline atual | BAIXA | Eliminar exigiria refatoração completa dos `onclick` inline e `<script>` inline no HTML |

---

## Status
**7 vulnerabilidades encontradas. 7 corrigidas. 3 recomendações documentadas para ciclo futuro.**
