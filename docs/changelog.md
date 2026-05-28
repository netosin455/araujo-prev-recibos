# Changelog — Araujo Prev Recibos

---

## [2026-05-27] — Backend: Rodada 4 — segurança (SEC-012, SEC-014, SEC-017) + 3 endpoints novos

### Segurança
- **SEC-014**: Helper `sanitizarLinkParaSheets()` — presigned URLs S3 são convertidas para path relativo `/api/comprovante-s3/...` antes de escrever na coluna K do Sheets (em `registrarNoSheets()` e `atualizarNoSheets()`). URLs Drive e paths internos passam sem alteração
- **SEC-017**: `'unsafe-inline'` removido de `style-src` no header Content-Security-Policy — estilos dinâmicos via JS devem migrar para classes CSS (ação pendente no Frontend)
- **SEC-012**: `govbrStates` Map em memória substituído por tabela `govbr_states` no Neon PostgreSQL — migração automática em `initDb()` com limpeza de states expirados no startup; `GET /api/govbr/iniciar` usa `INSERT` Neon; `GET /api/govbr/callback` usa `DELETE … RETURNING` atômico para evitar race condition em múltiplos workers

### Adicionado
- **`GET /api/relatorios/projecao`** (`financeiroOnly`): agrupa parcelas `pendente`/`atrasado` por mês de vencimento e retorna array `[{ mes, valor }]` dos próximos 6 meses — alimenta gráfico de projeção de receita no Frontend
- **`GET /api/relatorios/por-escritorio`** (`financeiroOnly`): agrega recibos e clientes por `escritorio` — retorna receita total, contagem de recibos, clientes distintos e ticket médio; ordenado por receita desc
- **`GET /api/admin/backup-db`** (`adminOnly`): gera ZIP com `recibos.db` + `clientes.db` via `archiver` (nível 9) e faz stream como download — filename `backup_db_YYYY-MM-DD-HH-MM-SS.zip`

---

## [2026-05-27] — Agente 5 (Analytics): Complemento Rodada 1 — gráfico mensal e filtro de ano no tab Analytics

### Adicionado
- **Gráfico de receita mensal no tab Analytics**: `<canvas id="grafico-analytics-mensal">` com Chart.js — mesmo estilo do Dashboard mas independente, usando a variável `graficoAnalyticsMensal`
- **Filtro de ano no tab Analytics**: `<select id="analytics-ano">` auto-populado com todos os anos presentes em `historicoRecibos` (padrão: ano corrente). Ao trocar, re-renderiza gráfico, top 5 e ranking em tempo real sem recarregar
- **Label de contagem** (`analytics-ano-label`): exibe quantos recibos existem no período filtrado
- **Refatoração de `carregarAnalytics()`**: extraída função interna `_renderAnalytics()` que recebe o filtro de ano — `carregarAnalytics()` preenche o seletor e chama `_renderAnalytics()`, que também é chamada diretamente no evento `change` do seletor

---

## [2026-05-27] — Frontend: Rodada 4 — 5 features (skeleton, impressão, projeção, backup, por escritório)

### Adicionado
- **Skeleton loading**: `mostrarSkeleton()` exibe divs animadas em `#historico-grid` e `#clientes-grid` durante carregamento — elimina tela em branco
- **Impressão direta de recibo**: botão "Imprimir" no modal de detalhe — gera PDF via jsPDF com `doc.autoPrint()`, abre diálogo de impressão automaticamente
- **Aba "Projeção" no painel admin**: gráfico de barras + tabela com parcelas a receber nos próximos 6 meses (`GET /api/relatorios/projecao`); mostra "Em breve" se 404
- **Botão "Baixar backup do banco"**: aba Relatórios do painel admin — chama `GET /api/admin/backup-db` e faz download do ZIP; mostra "Em breve" se 404
- **Aba "Por Escritório" no painel admin**: tabela com receita, recibos, clientes e ticket médio por escritório (`GET /api/relatorios/por-escritorio`); mostra "Em breve" se 404

---

## [2026-05-27] — Agente 6 (Integrações): Rodada 1 — SMTP, Gov.br, WhatsApp docs

### Adicionado
- **Dependência `nodemailer ^8.0.9`** em `web/package.json` para envio de e-mails via SMTP
- **Bloco SMTP em `server.js`**: funções `smtpConfigurado()`, `criarTransporter()` e `enviarEmail()` — transporter configurado via variáveis de ambiente (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- **`POST /api/notificacoes/email-inadimplencia`** (role: financeiro/admin): consulta NeDB, monta tabela de clientes inadimplentes com valor em aberto e dias de atraso, envia e-mail HTML formatado ao admin (`SMTP_ADMIN`). Retorna `{ ok, inadimplentes, destinatario }`
- **`POST /api/notificacoes/enviar-recibo-email`** (role: financeiro/admin): aceita dados do recibo + `email_cliente`, gera PDF em memória (mesma lógica de `/api/gerar-recibo`) e envia como anexo ao cliente. Valida e-mail antes de processar
- **Log de tentativas Gov.br**: callback `/api/govbr/callback` agora registra timestamp, state, usuário do sistema e recibo em cada etapa (início, sucesso, erro)
- **Mensagens de erro Gov.br detalhadas**: `error_description` do provedor é repassado ao frontend; erros de sessão expirada têm mensagem clara em pt-BR; erros de comunicação com o provedor não expõem stack trace ao usuário

### Documentado em `docs/architecture.md`
- **Seção SMTP**: variáveis de ambiente, estratégia de App Password Gmail, fluxo de envio
- **Seção WhatsApp Business API**: análise comparativa de provedores (Twilio, Z-API, WPPConnect, Evolution API) com recomendação e critérios de escolha

---

## [2026-05-27] — Agente 5 (Analytics): Rodada 1 — aba Analytics, bug fix inadimplência

### Adicionado
- **Aba "Analytics"** no painel admin: nova seção com top 5 clientes por valor pago (com barra de progresso proporcional), resumo rápido (clientes distintos, receita total, ticket médio global, maior cliente) e ranking completo dos 30 maiores clientes com ticket médio por cliente
- **`carregarAnalytics()`** em `app.js`: computa ranking e ticket médio a partir de `historicoRecibos` (sem nova chamada de API)
- **Hook em `abrirAdminTab()`**: aba "analytics" dispara `carregarAnalytics()` ao ser ativada

### Corrigido
- **Bug `valor_aberto` → `valor_em_aberto`** em `carregarInadimplencia()`: o campo retornado pelo endpoint `GET /api/relatorios/inadimplencia` é `valor_em_aberto`, mas o frontend lia `valor_aberto` — causava R$ 0,00 em toda coluna "Valor em Aberto" e total zerado
- **Parsing da resposta de inadimplência**: a API retorna `{ total_inadimplentes, relatorio[] }` mas o frontend esperava array direto — adicionado fallback `Array.isArray(body) ? body : body.relatorio`
- **Dias de atraso na tabela de inadimplência**: corrigido para ler `c.parcelas?.reduce(max(dias_atraso))` em vez de campo inexistente `c.dias_atraso`

---

## [2026-05-27] — DevOps: Rodada 3 — SMTP, NeDB monitoring, nodemailer

### Verificado
- `nodemailer ^8.0.9` já presente em `web/package.json` (adicionado pelo Agente 1 — versão mais recente que a solicitada `^6.9.0`)

### Documentado em `docs/architecture.md`
- Seção **Variáveis de ambiente — Elastic Beanstalk**: tabela completa com todas as env vars obrigatórias e as de email (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- Seção **Monitoramento — NeDB**: instruções de verificação de tamanho via SSH, thresholds (< 50MB / 50–200MB / > 200MB) e estratégia de compactação

### Pendente (ação manual — sem acesso via código)
- **SEC-018**: EC2 → Security Groups → [SG do EB] → porta 8080 → source deve ser SG do Load Balancer, não `0.0.0.0/0`
- **NeDB size**: verificar `/var/data/araujo-prev/*.db` via SSH ou Session Manager no AWS Console

---

## [2026-05-27] — Frontend: Rodada 3 — 7 features (inadimplência, parcelas vencendo, busca global, atalhos, histórico edições, exportar ZIP, nome_completo)

### Adicionado
- **Tela de inadimplência**: nova aba "Inadimplência" no painel admin — chama `GET /api/relatorios/inadimplencia`; exibe tabela com cliente, CPF, parcelas atrasadas, valor em aberto e dias de atraso; mostra "Em breve" se endpoint retornar 404
- **Notificação de parcelas vencendo**: ao iniciar o app, `verificarParcelasVencendo()` verifica parcelas com `data_vencimento` nos próximos 7 dias e exibe toast com link para a tela de clientes
- **Auto-fill "Emitido por" com nome completo**: `carregarReferenciaPadrao()` usa `me.nome_completo || me.username` — pronto para quando Backend entregar o campo
- **Histórico de edições no modal de detalhe**: se `r.historico_edicoes` existir, exibe seção com data, responsável e campos alterados no modal de detalhe do recibo
- **Seleção múltipla + exportar ZIP**: checkboxes em cada recibo do histórico; botão "Exportar ZIP" aparece quando há selecionados; chama `POST /api/recibos/exportar-zip`; mostra "Em breve" se 404
- **Busca global**: campo de busca na sidebar (Ctrl+K) — filtra recibos e clientes simultaneamente com dropdown agrupado; clique navega para o item
- **Atalhos de teclado**: `Ctrl+N` → novo recibo, `Ctrl+H` → histórico, `Ctrl+K` → foco na busca global

---

## [2026-05-27] — Backend: Rodada 3 — nome_completo, inadimplência, histórico, paginação, ZIP

### Adicionado
- **`nome_completo`**: coluna na tabela `users` (migração automática). Retornado em `GET /api/me`. Atualizado via `PUT /api/me/nome-completo` (máx. 80 chars)
- **`GET /api/relatorios/inadimplencia`** (`financeiroOnly`): retorna `{ total_inadimplentes, relatorio[] }` com clientes com parcelas atrasadas, valor em aberto e dias de atraso por parcela, ordenado por valor desc
- **Histórico de edições de recibo**: `PUT /api/recibos/:id` salva array `historico_edicoes[]` no documento NeDB — cada entrada contém `data`, `editado_por` e `campos_alterados[]` com diff anterior/novo por campo
- **Paginação em `GET /api/recibos`**: aceita `?page=1&limit=50` (máx. 200). Resposta alterada para `{ recibos, total, pagina, totalPaginas }`
- **`POST /api/recibos/exportar-zip`** (`financeiroOnly`): recebe `{ ids: [...] }` (máx. 100), gera PDFs em memória via helper `gerarBufferPDFRecibo()` e retorna ZIP com `archiver`

---

## [2026-05-27] — DevOps: Rodada 3 — dependência archiver

### Adicionado
- `archiver ^7.0.1` em `web/package.json` — suporte a exportação ZIP de recibos em lote (Agente 1, rodada 3)

### Pendente (ação manual no AWS Console)
- **SEC-018**: porta 8080 no security group do EB — source deve ser SG do Load Balancer, não `0.0.0.0/0`
- **NeDB size**: verificar tamanho de `web/data/recibos.db` e `web/data/clientes.db` via SSH no EB. Se > 50MB, rodar compactação (`db.persistence.compactDatafile()` via endpoint admin ou console)

---

## [2026-05-27] — Backend: Rodada 2 — bugs, segurança e features (BUG-009, BUG-012, BUG-013, BUG-014, SEC-010, soft delete, CPF/CNPJ)

### Corrigido
- **BUG-009**: `expiresIn` das presigned URLs S3 aumentado de 7 para 30 dias em `linkParaSheets()`
- **BUG-012**: Guard adicionado no início de `recalcularResumo()` — retorna zeros se `parcelas` não for array válido
- **BUG-014**: `enriquecerCliente()` agora marca parcelas `pendente` com `data_vencimento` vencida como `atrasado` on-the-fly

### Segurança
- **SEC-010**: Coluna `password` removida de `sincronizarUsuariosParaSheets()` — planilha Usuarios passa a ter 4 colunas (username, role, escritorio, created_at). `restaurarUsuariosDeSheets()` adaptada: contas restauradas recebem hash inutilizável com aviso de redefinição

### Adicionado
- **BUG-013 (backend)**: `validarCPF()` e `validarCNPJ()` com dígito verificador — aplicadas em `POST /api/recibos`, `POST /api/clientes` e `PUT /api/clientes/:id`
- **Soft delete**: `DELETE /api/recibos/:id` e `DELETE /api/clientes/:id` passam a fazer soft delete com campos `deletado_em` e `deletado_por`; constante `NAO_DELETADO` aplicada em todas as queries de listagem
- **Status atrasado automático**: implementado em `enriquecerCliente()` junto com BUG-014

---

## [2026-05-27] — Frontend: Rodada 2 — bugs + 4 features novas

### Corrigido
- **BUG-015**: `atualizarBadgeClientes()` chamada ao final de `confirmarPagamentoParcela()` — badge de inativos atualiza imediatamente após pagamento de parcela
- **BUG-016**: Validação de data com `new Date(ano, mes-1, dia)` em `gerarRecibo()` — datas inexistentes (ex: 31/02) são rejeitadas antes de submeter

### Adicionado
- **Preenchimento automático de "Emitido por"**: campo preenchido com o username do usuário logado ao iniciar a sessão, via `GET /api/me` em `carregarReferenciaPadrao()`
- **Aviso de sessão expirando**: `iniciarAvisoSessao()` decodifica o JWT e exibe toast de aviso 15 minutos antes do `exp` — "Sua sessão expira em 15 min. Salve o trabalho."
- **Excluir cliente**: botão 🗑 adicionado ao card do cliente (apenas para não-recepcao com cadastro ativo); `excluirCliente()` exibe contagem de parcelas pendentes antes de confirmar exclusão via `DELETE /api/clientes/:id`
- **Validação de CPF/CNPJ**: `validarCPF()` e `validarCNPJ()` com dígito verificador implementadas; validação aplicada em `gerarRecibo()` e `salvarCliente()` antes de submeter (BUG-013 — parte frontend)

---

## [2026-05-27] — DevOps: .gitignore atualizado + auditoria de scripts

### Adicionado
- `.gitignore`: adicionadas entradas para `capacitor-app/`, `deploy.zip`, `pipeline-update.json`, `planejamento2.md` — evita poluição do repositório com artefatos locais

### Verificado (sem alteração necessária)
- Scripts `add_recibos_maio.py`, `importar_excel.py`, `gerar_token_drive.py` — todos possuem docstring com instruções de uso no cabeçalho

### Pendente (ação manual no AWS Console)
- **SEC-018**: verificar que inbound rule da porta 8080 no security group do EB aponta para o SG do Load Balancer, não para `0.0.0.0/0`

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
