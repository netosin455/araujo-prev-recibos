# Bugs Found — Araujo Prev Recibos
**Data da análise:** 2026-05-25
**Módulos analisados:** server.js, app.js (módulo de clientes)

---

## BUG-001 — `confirmarPagamentoParcela`: crash quando `api()` retorna null
- **Arquivo:** `web/public/app.js` — função `confirmarPagamentoParcela`
- **Impacto:** CRÍTICO — o usuário vê tela em branco / erro não tratado
- **Descrição:** `api()` retorna `null` quando o servidor responde 401 (sessão expirada). O código chamava `res.json()` sem checar se `res` era null primeiro, causando `TypeError: Cannot read properties of null`.
- **Correção aplicada:** `const data = res ? await res.json().catch(...)  : {};`

---

## BUG-002 — `PUT /api/clientes/:id`: sem retorno 404 quando cliente não existe
- **Arquivo:** `web/server.js` — rota `PUT /api/clientes/:id`
- **Impacto:** MÉDIO — operação silenciosamente bem-sucedida sem alterar nada
- **Descrição:** Se `_id` não corresponder a nenhum cliente no banco, `findOne` retorna `null`. O código continuava tentando acessar `atual.parcelas` (protegido por `&&`) mas o `update` rodava sem encontrar documento, retornando `{ ok: true }` falsamente.
- **Correção aplicada:** `if (!atual) return res.status(404).json({ erro: "Cliente não encontrado." });`

---

## BUG-003 — `PATCH /api/clientes/:id/parcela/:num`: sem whitelist de campos
- **Arquivo:** `web/server.js` — rota `PATCH /api/clientes/:id/parcela/:num`
- **Impacto:** MÉDIO — atacante poderia sobrescrever campos internos da parcela (ex: `num`, `valor`) via body malicioso
- **Descrição:** O spread `{ ...p, ...req.body }` aplicava qualquer campo enviado no body sem filtro, incluindo `num` e `valor` que são campos calculados/internos.
- **Correção aplicada:** Whitelist explícita extraindo apenas `status`, `data_recebimento`, `data_deposito`, `recibo_id`, `recibo_num`, `observacao`, `data_vencimento`.

---

## BUG-004 — Typo `jaPagess` em `inicializarParcelasLegado`
- **Arquivo:** `web/server.js` — função `inicializarParcelasLegado`
- **Impacto:** BAIXO — funciona, mas prejudica leitura e manutenção do código
- **Descrição:** Variável nomeada `jaPagess` (com 's' duplo no final). Não causa erro funcional mas viola o princípio de nomes descritivos.
- **Correção aplicada:** Renomeada para `jaPagas`.

---

## BUG-005 — `PUT /api/me/referencia`: sem limite de tamanho no servidor
- **Arquivo:** `web/server.js` — rota `PUT /api/me/referencia`
- **Impacto:** BAIXO — em teoria permite gravar strings arbitrariamente longas no banco
- **Descrição:** O frontend limita a 20 chars via `maxlength`, mas o servidor não validava o tamanho, permitindo bypass via requisição direta à API.
- **Correção aplicada:** `if (referencia_padrao.length > 20) return res.status(400)...`

---

## Status
Todos os 5 bugs corrigidos. Nenhum bug restante crítico identificado.
