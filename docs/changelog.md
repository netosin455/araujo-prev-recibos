# Changelog — Araujo Prev Recibos

---

## [2026-05-27] — Frontend: correções de bugs (BUG-007, BUG-010, BUG-011)

### Corrigido
- **BUG-007**: Aba Financeiro agora atualiza ao retornar para o painel admin com ela ativa — `aplicarFiltros()` chamada em `navegarPara("admin")` quando financeiro é o tab atual
- **BUG-010**: `gerarRecibo()` envolto em `try/finally` — botão "Gerar Recibo" sempre re-habilitado ao final da operação, inclusive em exceções não tratadas
- **BUG-011**: Falha de sincronização com Google Sheets exibe toast específico ao invés de `alert()` genérico — mensagem informa que o recibo foi salvo e orienta a executar "Reescrever planilha"

---

## [2026-05-27] — Backend: correções de segurança e bugs (BUG-006, BUG-008, SEC-008, SEC-009, SEC-013)

### Corrigido
- **BUG-006**: `POST /api/recibos` agora exige `financeiroOnly` — usuários `recepcao` não conseguem mais criar recibos via API direta
- **BUG-008**: `atualizarNoSheets()` na edição de recibo agora recebe o objeto completo do recibo (pós-update), garantindo que `forma_pagamento` e `motivo_pagamento` sejam atualizados na planilha
- **SEC-013**: Limite de upload de comprovante reduzido de 20MB para 5MB

### Adicionado
- **SEC-008**: Rate limiting em `POST /api/login` — máx. 10 tentativas por IP em 15 minutos (`express-rate-limit`)
- **SEC-009**: Validação de magic bytes no `POST /api/upload-comprovante` — arquivos com assinatura diferente de PDF, JPEG ou PNG são rejeitados com HTTP 400

---

## [2026-05-27] — DevOps: dependência express-rate-limit adicionada

### Adicionado
- `express-rate-limit ^7.5.0` em `web/package.json` — preparação para SEC-008 (rate limiting no login, Agente 1)

---

## [2026-05-27] — Correção: Google Sheets — gap de linhas e data incorreta

### Corrigido
- `reescrever-planilha`: dados apareciam a partir da linha 278 em vez da linha 4 — causa raiz: `INSERT_ROWS` no `values.append` acumulou linhas físicas vazias ao longo do tempo; corrigido com `deleteDimension` (batchUpdate) antes de reescrever
- `reescrever-planilha`: erro "not possible to delete all non-frozen rows" — Sheets exige ao menos 1 linha não-congelada; corrigido usando `endIndex: totalRows - 1` seguido de `values.clear`
- `reescrever-planilha`: timeout ao processar URLs S3 em loop — removido `linkParaSheets()` do fluxo de reescrita; escreve `link_comprovante` diretamente
- `registrarNoSheets`: colunas E (data pagamento), F (data depósito) e L (mês) sempre recebiam a data de hoje — campo `data` não era passado de `POST /api/recibos` para `registrarNoSheets`; corrigido

### Adicionado
- Timeout de 5 segundos em `linkParaSheets()` via `Promise.race` para evitar travamento ao gerar URL presigned S3

---

## [2026-05-26] — Correção: planilha e numeração de recibos

### Corrigido
- Recibos novos iam para o topo da planilha Google Sheets — adicionado `insertDataOption: "INSERT_ROWS"` no `append` (dois pontos: geração e sync forçado)
- Números de recibo ficavam desorganizados quando havia exclusões — `/api/proximo-num` agora pega o maior número existente do ano ao invés de contar registros
- `reescrever-planilha` processava todos os links S3 ao mesmo tempo — agora em lotes de 10 para evitar falha em cascata

### Adicionado
- Novo endpoint `POST /api/admin/importar-de-sheets` — importa recibos da planilha para o banco sem precisar esvaziar o banco (upsert por número de recibo)
- Botão "Importar planilha → banco" no painel admin para recuperar recibos perdidos por reset do servidor
- Colunas N (Responsável) e O (Referência) adicionadas à planilha — dados agora são preservados em todos os fluxos de escrita e restauração

---

## [2026-05-25] — CSP: remoção de unsafe-inline do script-src

### Segurança
- Removido `'unsafe-inline'` de `script-src` no cabeçalho Content-Security-Policy
- Todos os handlers inline (`onclick`, `onchange`, `oninput`, `onerror`) removidos de `index.html`
- Adicionado `bindStaticHandlers()` em `app.js` que reconfigura via `addEventListener` todos os elementos estáticos
- HTML dinâmico (cards de cliente, tabela de recibos, lista de usuários) migrado para `data-action` + event delegation
- Bloco `<script>` inline do service worker já estava em `sw-register.js` externo

---

## [2026-05-25] — Módulo de Clientes: Controle Granular de Parcelas + Segurança

### Adicionado
- Schema de parcelas individuais por cliente: array `parcelas[]` com campos `num`, `valor`, `status` (pendente/pago/atrasado), `data_recebimento`, `data_deposito`, `recibo_id`, `recibo_num`, `observacao`, `data_vencimento`
- Rota `PATCH /api/clientes/:id/parcela/:num` para atualizar uma parcela individualmente
- Rota `GET /api/me` para retornar dados completos do usuário logado
- Rota `PUT /api/me/referencia` para salvar referência padrão por usuário
- Coluna `referencia_padrao` na tabela `users` do Neon PostgreSQL (migração automática no startup)
- Modal "Registrar Pagamento de Parcela" com data de recebimento, data de depósito, nº recibo e observação
- 4 abas no card do cliente: Parcelamento / A Receber / Recebidos / Histórico
- Campos `valor_beneficio` e `num_beneficios` no cadastro do cliente (calcula `valor_contrato` automaticamente)
- Botão pin no campo referência do formulário de recibo para salvar como padrão
- Preenchimento automático da referência padrão após login
- Fluxo "Novo Recibo para Cliente" vincula parcela após geração
- Testes unitários com Jest: 22 testes cobrindo `gerarParcelas`, `recalcularResumo`, `inicializarParcelasLegado`, validações de entrada

### Corrigido
- BUG-001: `confirmarPagamentoParcela` — crash quando `api()` retorna null (sessão expirada)
- BUG-002: `PUT /api/clientes/:id` — retornava 200 sem alterar nada quando cliente não existia
- BUG-003: `PATCH /api/clientes/:id/parcela/:num` — sem whitelist de campos permitia sobrescrever `num` e `valor`
- BUG-004: Typo `jaPagess` → `jaPagas` em `inicializarParcelasLegado`
- BUG-005: `PUT /api/me/referencia` — sem validação de tamanho no servidor
- SEC-001: XSS via `onclick` inline no modal de detalhe de recibo
- SEC-002: `iframe src` sem validação de protocolo em `abrirComprovante`
- SEC-003: Sem validação de enum `status` em `PATCH /api/clientes/:id/parcela/:num`
- SEC-004: Sem validação de enum `role` em `POST/PUT /api/users`
- SEC-005: Exposição de mensagens internas de erro em rotas admin
- SEC-006: `link_comprovante` sem validação de formato na API
- SEC-007: Header `Content-Security-Policy` ausente

### Refatorado
- `renderClientes()` em `app.js` decomposta em 5 funções auxiliares: `_badgeParcela`, `_btnPagarParcela`, `_buildBlocoContrato`, `_buildTabelaRecibos`, `_buildTabelasParcelamento`
- `enriquecerCliente()` em `server.js` simplificada para usar `inicializarParcelasLegado()`

---

## [2026-05-18] — Recepção vê apenas recibos do próprio escritório
- Adicionado: filtro de escritório para usuários com role `recepcao`
- Adicionado: campo `escritorio` obrigatório ao criar usuário com role `recepcao`

## [2026-05-15] — Módulo de cadastro de clientes
- Adicionado: CRUD de clientes com controle básico de parcelas
- Adicionado: busca por CPF e por nome na tela de clientes

## [2026-05-10] — Revert: volta para append no registrarNoSheets
- Revertido: comportamento de overwrite na sincronização de planilha

## [2026-05-08] — Remoção do bloqueio de 15 minutos por tentativas de login
- Removido: middleware de rate limiting por IP que bloqueava usuários legítimos em rede compartilhada
