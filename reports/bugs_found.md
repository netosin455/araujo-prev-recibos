# Bugs Found — Araujo Prev Recibos

**Última atualização:** 2026-07-21 — Agente 1/4 (Backend + QA) — Correção de autorização
**Arquivos analisados:** `web/server.js`, `web/public/app.js`, `web/public/index.html`

---

## Auditoria QA - 2026-07-23

### BUG-020 - Fundo preto piscava ao focar campos no celular
- **Arquivos:** `web/public/css/main.css`
- **Impacto:** MEDIO - ao abrir o teclado, o login ou a tela inicial podiam piscar e aparentar uma troca de tela.
- **Causa:** viewport dinamico e efeitos de composicao (gradiente animado, `backdrop-filter` e animacao de tela) eram recalculados durante a abertura do teclado em navegadores mobile.
- **Correcao aplicada:** `body` e area principal usam `svh` em celular; efeitos de composicao instaveis foram removidos somente no mobile, preservando o visual e animacoes no desktop.
- **Status:** corrigido em 2026-07-23 - confirmar em aparelho fisico antes do proximo deploy.

### BUG-019 - Tela de login se movia ao focar campo no celular
- **Arquivos:** `web/public/css/main.css`; `web/public/app/core.js`; `web/public/index.html`
- **Impacto:** MEDIO - ao abrir o teclado, o login podia reposicionar repetidamente e dificultar a digitacao.
- **Causa:** inputs de 13 px ativavam zoom automatico em iOS; `100dvh`, centralizacao flexivel e `body` fixado recalculavam a posicao do login durante a animacao do teclado.
- **Correcao aplicada:** fonte minima de 16 px nos campos mobile, viewport estavel (`svh`), overlay rolavel com area segura, layout compacto para qualquer viewport baixo em paisagem e remocao do estado fixado apos restaurar sessao.
- **Status:** corrigido em 2026-07-23 - sintaxe JavaScript e whitespace do diff validados; teste em aparelho fisico recomendado.

## Auditoria QA - 2026-07-22

### BUG-018 - Rotacionar o telefone apagava ou desorganizava a assinatura
- **Arquivos:** `web/public/app/assinatura.js`; `web/public/assinar.js`; estilos de assinatura em `web/public/css/main.css` e `web/public/assinar.html`
- **Impacto:** MEDIO - o cliente podia perder o traco ja desenhado ao virar o aparelho e, em telas baixas, os controles ficavam apertados.
- **Causa:** redimensionar um `<canvas>` limpa seu bitmap; o listener de `resize` recriava o canvas sem preservar a assinatura. O layout nao tinha regra para a altura curta do modo paisagem.
- **Correcao aplicada:** copia temporaria do bitmap antes de cada redimensionamento, restauracao proporcional do desenho, debounce de `resize`/`orientationchange` e layout compacto com rolagem para paisagem.
- **Status:** corrigido em 2026-07-22 - `node --check` aprovado; confirmar em dispositivo fisico antes do deploy.

## Auditoria QA — 2026-07-21

### BUG-017 — Cursor de recibos não aplica o escopo do escritório
- **Arquivo:** `web/routes/recibos.js:124-142`; `web/services/database.js:42-61`
- **Impacto:** ALTO — além de expor dados de outros escritórios, a paginação por cursor produz resultado diferente da paginação normal para o mesmo usuário.
- **Descrição:** a rota usa `{ $regex: ... }` para filtrar `escritorio`, mas o helper PostgreSQL não implementa esse operador e descarta a condição.
- **Correção sugerida:** substituir a condição por filtro SQL parametrizado e testar que recepção só recebe recibos do próprio escritório com `?cursor=`.
- **Status:** ✅ Corrigido em 2026-07-21 — `RegExp` de escritório é convertido para `~* $n` com parâmetro PostgreSQL; teste de regressão incluído.

---

## ✅ Bugs Corrigidos (histórico)

### BUG-001 — `confirmarPagamentoParcela`: crash quando `api()` retorna null
- **Arquivo:** `web/public/app.js` — função `confirmarPagamentoParcela`
- **Impacto:** CRÍTICO
- **Correção:** `const data = res ? await res.json().catch(...) : {};`
- **Status:** ✅ Corrigido em 2026-05-25

---

### BUG-002 — `PUT /api/clientes/:id`: sem retorno 404 quando cliente não existe
- **Arquivo:** `web/server.js` — rota `PUT /api/clientes/:id`
- **Impacto:** MÉDIO
- **Correção:** `if (!atual) return res.status(404).json({ erro: "Cliente não encontrado." });`
- **Status:** ✅ Corrigido em 2026-05-25

---

### BUG-003 — `PATCH /api/clientes/:id/parcela/:num`: sem whitelist de campos
- **Arquivo:** `web/server.js`
- **Impacto:** MÉDIO
- **Correção:** Whitelist explícita dos campos aceitos no body
- **Status:** ✅ Corrigido em 2026-05-25

---

### BUG-004 — Typo `jaPagess` em `inicializarParcelasLegado`
- **Arquivo:** `web/server.js`
- **Impacto:** BAIXO
- **Correção:** Renomeada para `jaPagas`
- **Status:** ✅ Corrigido em 2026-05-25

---

### BUG-005 — `PUT /api/me/referencia`: sem limite de tamanho no servidor
- **Arquivo:** `web/server.js`
- **Impacto:** BAIXO
- **Correção:** Validação de `length > 20` no backend
- **Status:** ✅ Corrigido em 2026-05-25

---

## 🔴 Bugs Abertos — Críticos

### BUG-006 — `POST /api/recibos` sem `financeiroOnly`: recepção consegue criar recibos via API
- **Arquivo:** `web/server.js` — linha ~987
- **Impacto:** CRÍTICO
- **Descrição:** A rota `POST /api/recibos` usa apenas `auth`, sem o middleware `financeiroOnly`. Um usuário com role `recepcao` consegue criar recibos diretamente via chamada à API (ex: console do navegador ou Postman), burlando a restrição da UI.
- **Agente responsável pela correção:** Agente 1 — Backend
- **Correção sugerida:** Adicionar `financeiroOnly` como middleware: `app.post("/api/recibos", auth, financeiroOnly, async ...)`
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-007 — Aba Financeiro fica em branco até o usuário clicar "Filtrar"
- **Arquivo:** `web/public/app.js` — função de inicialização da aba admin
- **Impacto:** ALTO — confunde usuário, parece que o sistema quebrou
- **Descrição:** `aplicarFiltros()` é vinculada ao click do botão "Filtrar", mas não é chamada na inicialização da aba. A tabela aparece vazia até o primeiro clique.
- **Agente responsável pela correção:** Agente 2 — Frontend
- **Correção aplicada:** `navegarPara("admin")` agora chama `preencherFiltrosAnos(); aplicarFiltros()` quando o painel financeiro está ativo, garantindo dados frescos ao navegar para admin com essa aba já selecionada
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-008 — Edição de recibo não atualiza `forma_pagamento` e `motivo_pagamento` no Google Sheets
- **Arquivo:** `web/server.js` — função `atualizarNoSheets()`
- **Impacto:** ALTO — planilha fica desatualizada em relação ao banco
- **Descrição:** Ao editar um recibo, `atualizarNoSheets()` recebe apenas os campos do `upd`, que não inclui `forma_pagamento` e `motivo_pagamento`. As colunas G e H da planilha ficam com os valores antigos.
- **Agente responsável pela correção:** Agente 1 — Backend
- **Correção sugerida:** Passar o objeto completo do recibo para `atualizarNoSheets()`, mesclando `upd` com os campos existentes antes de escrever na planilha
- **Status:** ✅ Corrigido em 2026-05-27

---

## 🟡 Bugs Abertos — Moderados

### BUG-009 — Presigned URL S3 expira em 7 dias sem renovação automática
- **Arquivo:** `web/server.js` — função `linkParaSheets()`
- **Impacto:** MÉDIO — comprovantes ficam inacessíveis após 7 dias
- **Descrição:** URLs geradas via `getSignedUrl` com `expiresIn: 7 * 24 * 3600` expiram e o comprovante some do modal. Não há renovação automática nem aviso ao usuário.
- **Agente responsável:** Agente 1 — Backend
- **Correção sugerida:** Ao abrir detalhe de recibo com link S3, chamar endpoint que regera a presigned URL antes de exibir; ou aumentar expiração para 30 dias
- **Status:** ✅ Corrigido em 2026-05-27 — `expiresIn` aumentado para 30 dias em `linkParaSheets()`

---

### BUG-010 — Botão "Gerar Recibo" pode ser clicado 2x — cria recibos duplicados
- **Arquivo:** `web/public/app.js` — função `gerarRecibo()`
- **Impacto:** MÉDIO — cria dois registros com dados iguais e números sequenciais
- **Descrição:** Não há debounce nem desabilitação do botão durante a requisição. Em conexão lenta, usuário tende a clicar novamente.
- **Agente responsável:** Agente 2 — Frontend
- **Correção aplicada:** `btn.disabled=true` já estava presente; adicionado `try/finally` ao corpo da função para garantir que o botão seja sempre re-habilitado ao final, inclusive em exceções não tratadas
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-011 — Sem aviso quando Google Sheets falha mas recibo foi salvo localmente
- **Arquivo:** `web/public/app.js` — após `POST /api/recibos`
- **Impacto:** MÉDIO — usuário não sabe que a planilha está desatualizada
- **Descrição:** Se `sheets_ok === false` na resposta do servidor, o frontend mostra alert genérico, mas não deixa claro que o recibo foi salvo no banco e que a planilha está fora de sincronia.
- **Agente responsável:** Agente 2 — Frontend
- **Correção aplicada:** `alert()` substituído por `mostrarToast("Recibo salvo! Aviso: Google Sheets fora de sincronia. Execute 'Reescrever planilha' no painel admin.", null, "error")` — mensagem clara e não-bloqueante
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-012 — `num_parcelas = 0` ou vazio causa divisão por zero em `recalcularResumo()`
- **Arquivo:** `web/server.js` — função `recalcularResumo()`
- **Impacto:** MÉDIO — crash silencioso ao regenerar parcelas com valor inválido
- **Descrição:** Se `num_parcelas` chegar como `0` ou `""` ao regenerar parcelas, `gerarParcelas()` retorna array vazio e `recalcularResumo()` pode produzir `NaN` ou `Infinity` nos totais.
- **Agente responsável:** Agente 1 — Backend
- **Correção aplicada:** Guard adicionado no início de `recalcularResumo()` — retorna zeros se `parcelas` não for array válido; rotas POST/PUT de clientes já validavam `>= 1`
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-013 — CPF/CNPJ aceito sem validação de dígito verificador
- **Arquivo:** `web/server.js` e `web/public/app.js`
- **Impacto:** MÉDIO — dados incorretos entram no banco e na planilha
- **Descrição:** O sistema aceita qualquer string no formato de máscara (ex: `111.111.111-11`) sem validar matematicamente se os dígitos verificadores são válidos.
- **Agente responsável:** Agentes 1 e 2 (backend valida, frontend exibe erro)
- **Correção aplicada (backend):** `validarCPF()` e `validarCNPJ()` implementadas com dígito verificador; validação em `POST /api/recibos`, `POST /api/clientes` e `PUT /api/clientes/:id`
- **Status:** ✅ Corrigido em 2026-05-27 (backend) — aguarda frontend (Agente 2)

---

## 🔵 Bugs Abertos — Baixo impacto / UX

### BUG-014 — Status "atrasado" nunca é setado automaticamente
- **Arquivo:** `web/server.js` — função `recalcularResumo()`
- **Impacto:** BAIXO — parcelas atrasadas aparecem como "pendente"
- **Descrição:** O status "atrasado" existe no enum mas só pode ser setado manualmente. Parcelas com `data_vencimento` vencida continuam como "pendente".
- **Agente responsável:** Agente 1 — Backend
- **Correção aplicada:** `enriquecerCliente()` agora marca parcelas `pendente` com `data_vencimento < hoje` como `atrasado` on-the-fly (sem persistir)
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-015 — Badge de clientes inativos não atualiza após registrar pagamento
- **Arquivo:** `web/public/app.js` — função `atualizarBadgeClientes()`
- **Impacto:** BAIXO — badge mostra número desatualizado até reload
- **Descrição:** `atualizarBadgeClientes()` é chamada apenas ao carregar a lista de clientes. Após registrar pagamento de parcela, o badge não é recalculado.
- **Agente responsável:** Agente 2 — Frontend
- **Correção aplicada:** `atualizarBadgeClientes()` adicionada ao final de `confirmarPagamentoParcela()`, após `renderClientes()`
- **Status:** ✅ Corrigido em 2026-05-27

---

### BUG-016 — Data do recibo não valida dias inexistentes (ex: 31/02/2026)
- **Arquivo:** `web/public/app.js` — validação do formulário de recibo
- **Impacto:** BAIXO — data inválida entra no banco
- **Descrição:** Validação verifica apenas que dia/mês/ano estão preenchidos, mas não verifica se a combinação é uma data válida.
- **Agente responsável:** Agente 2 — Frontend
- **Correção aplicada:** `new Date(ano, mes-1, dia)` com checagem `getMonth() !== mes-1` adicionada em `gerarRecibo()`, antes de formatar a data
- **Status:** ✅ Corrigido em 2026-05-27

---

## Resumo

| Severidade | Total | Corrigidos | Abertos |
|------------|-------|------------|---------|
| Crítico    | 3     | 3          | 0       |
| Alto       | 2     | 2          | 0       |
| Médio      | 5     | 5          | 0       |
| Baixo      | 6     | 6          | 0       |
| **Total**  | **16**| **11**     | **5**   |

**Próxima ação recomendada:** Agente 1 (Backend) resolver BUG-009, BUG-012, BUG-013 (parte backend). BUG-013 (parte frontend) corrigido nesta rodada via `validarCPF`/`validarCNPJ`.
