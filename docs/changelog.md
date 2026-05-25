# Changelog — Araujo Prev Recibos

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
