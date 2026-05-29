# LOG de Alterações — Araujo Prev

## 2026-05-29

### feat(gerar-recibo): preencher valor da parcela automaticamente pelo nome
- Ao selecionar o nome do cliente no formulário, o campo "Valor Recebido" é preenchido automaticamente com `valor_parcela` do cadastro (se existir e o campo estiver vazio).
- Campo continua editável — recepção pode alterar livremente.
- Comportamento já existia via CPF (`preencherDadosCliente`) e pelo botão `+ Recibo` dos cards; agora também funciona via digitação do nome.

### fix(clientes): clientes cadastrados sem recibo não apareciam na lista
- **Causa raiz:** `renderClientes()` construía o mapa apenas de `historicoRecibos`. Clientes cadastrados via modal (com CPF, contrato, parcelas) mas ainda sem nenhum recibo emitido ficavam invisíveis na tela.
- **Fix:** `listaClientes` é processado primeiro para garantir que todo cliente cadastrado entra no mapa com `recibos:[]`. Em seguida `historicoRecibos` popula os recibos de quem já os tem. Clientes sem recibo aparecem com "0 recibos" e R$ 0,00.

### fix(mobile): correções visuais nas seções admin e calendário
- **Grids admin em coluna única:** Seções Relatórios, Analytics, Projeção, Por Escritório e Por Responsável tinham grids `1fr 1fr` sem breakpoint mobile. Agora viram coluna única (`1fr`) em ≤768px. Elementos com `grid-column:span 2` também resetados.
- **Filtros avançados:** Inputs "Valor mínimo/máximo" com `width:100px` fixo agora ocupam `width:100%` em mobile.
- **Calendário:** Células com `min-height:60px` espremiam em mobile. Reduzido para `44px` (adequado para toque), padding menor, gap menor (`3px`). Fonte do cabeçalho reduzida para `10px`.

### fix: correção sistêmica — 5 bugs de integração

- **Clientes duplicados no mapa:** Recibos antigos sem CPF (campo vazio) criavam entrada separada mesmo quando o cliente já estava em listaClientes com CPF. O loop de historicoRecibos agora casa por CPF primeiro, depois por nome.
- **Race condition busca global → clientes:** navegarPara("clientes") limpava a busca e chamava renderClientes() ao mesmo tempo que o código seguinte definia o filtro. Corrigido com setTimeout(50ms) igual ao padrão já usado no modal.
- **carregarClientes() duplo em salvarCliente():** Chamava carregarClientes() explicitamente e depois renderClientes() que também chama. Removida a chamada explícita; atualizarSugestoesNomes() agora vem após renderClientes() (dados já atualizados).
- **+ Recibo não limpava formulário anterior:** novoReciboParaCliente() navegava para "gerar" sem limparCampos(). Dados do recibo anterior (forma_pagamento, data, etc.) vazavam. Adicionado limparCampos() + restauração de emitido_por do usuário logado.
- **Modais não fechavam ao clicar no fundo:** Com display:flex sempre ativo (animação), o backdrop estava presente mas sem listener. Adicionado listener em todos os 7 modais para fechar ao clicar fora do modal-content.

### fix(clientes): campo de busca persistia entre navegações
- **Causa:** `busca-clientes` não era limpo ao navegar para a tela de clientes. Se o usuário tivesse digitado "alyne" e navegado para outra tela, ao voltar o filtro permanecia ativo e mostrava "Nenhum cliente encontrado."
- **Fix 1:** `navegarPara("clientes")` agora limpa o campo antes de chamar `renderClientes()`.
- **Fix 2:** `salvarCliente()` também limpa o campo antes de `renderClientes()` — garante que o cliente recém-cadastrado aparece na lista sem ser filtrado por busca anterior.

### fix(frontend): clientes não apareciam na primeira abertura da tela
- **Causa:** `renderClientes()` constrói a grade a partir de `historicoRecibos`, mas só aguardava `carregarClientes()`. Se os recibos não estivessem carregados (rede lenta, timeout no init), `historicoRecibos` ficava vazio e a grade mostrava estado vazio.
- **Fix:** Adicionado `if (!historicoRecibos.length) await carregarRecibos()` no início de `renderClientes()`. Isso garante que os dados existem antes de renderizar, sem impacto de performance nas chamadas normais (o `if` só dispara quando o array está vazio).

### fix(frontend): abas admin e gráfico DRE no mobile
- **Abas admin:** `flex-wrap:wrap` substituído por `overflow-x:auto; flex-wrap:nowrap`. As 10 abas agora ficam em uma linha com scroll horizontal invisível (scrollbar oculta). `flex:0 0 auto; white-space:nowrap` evita que qualquer aba quebre.
- **Grid DRE mobile:** Adicionada classe `dre-grid` ao container. No breakpoint 768px, força `grid-template-columns:1fr` — gráfico e resumo ficam empilhados em coluna única.
- **Canvas DRE:** `min-height:220px` no mobile + `maintainAspectRatio:false` no Chart.js — gráfico ocupa a altura definida pelo CSS em vez da proporção padrão.

### fix(frontend): Parte 6 — Acessibilidade (a11y)
- **7 modais com `role="dialog" aria-modal="true" aria-labelledby`:** Leitores de tela agora anunciam o título do modal ao abrir e sabem que o foco está preso dentro do diálogo.
- **Todos os `.modal-close` com `aria-label="Fechar"`:** Botões com só ícone agora têm nome acessível.
- **Labels conectados com `for=""` nos formulários principais:** Login (usuário/senha), formulário de recibo (nome, cpf, municipio_uf, valor, motivo_pagamento, forma_pagamento, escritorio, emitido_por). Clicar no label agora foca o campo correto.
- **`#status` com `role="alert" aria-live="polite"`:** Erros de validação são anunciados automaticamente por leitores de tela sem precisar focar o elemento.
- **`#toast` com `role="status" aria-live="polite" aria-atomic="true"`:** Notificações toast anunciadas automaticamente quando aparecem.
- **`#btn-tema` com `aria-label`:** Botão de tema (moon icon) agora tem nome acessível.

### fix(frontend): Parte 5 — Validação visual de formulários
- **`marcarInvalido(...ids)`:** Nova função helper que adiciona `input-error` (borda vermelha + fundo rosado) a qualquer campo. Remove automaticamente quando o usuário começa a digitar (`input` event com `{once:true}`).
- **`gerarRecibo()` valida todos os campos de uma vez:** Antes parava no primeiro campo vazio. Agora coleta todos os vazios, destaca todos ao mesmo tempo e mostra mensagem genérica única.
- **CPF/data inválidos também ficam vermelhos:** Campos específicos são destacados ao falhar validação.
- **Modal de cliente:** Mesma lógica — campos Nome, CPF, Município, Valor do contrato e Nº parcelas ficam vermelhos individualmente quando inválidos.
- **Placeholders adicionados:** `nome` ("Nome do(a) cliente..."), `cpf` ("000.000.000-00"), `municipio_uf` ("Ex: Terra Rica - PR"), `valor` ("0,00").
- **CSS dark mode para `.input-error`:** Fundo `#2a1515` no dark mode em vez do rosado padrão.

### fix(frontend): Parte 4 — Navegação teclado busca global + erros silenciosos
- **Busca global ↑↓ + Enter:** Adicionada navegação por teclado no dropdown da busca global. ArrowDown/ArrowUp percorrem os itens (com highlight `.focused`), Enter seleciona o item ativo, Escape fecha e limpa. `scrollIntoView` mantém o item visível se o dropdown estiver com scroll.
- **carregarClientes() silencioso:** Se a API falhar no primeiro carregamento (lista ainda vazia), exibe toast de erro orientando o usuário a recarregar.
- **carregarReferenciaPadrao() silencioso:** Se `/api/me` falhar, exibe toast de erro — evita que campos `emitido_por` e `referencia` fiquem silenciosamente vazios.

### fix(frontend): Parte 3 — Eliminar todos os alert()
- **20 chamadas `alert()` substituídas por `mostrarToast(..., "error")`** em todo o app.js.
- Cobertos: upload de comprovante (fluxo novo e edição), validações de cliente (Nome/CPF/CNPJ/contrato/parcelas), pagamento de parcela, exclusão de cliente, gestão de usuários (criar/editar), restaurar backup, e 7 guards de "nenhum dado" nas exportações.
- Resultado: nenhuma caixa de diálogo bloqueante restante — todos os erros aparecem como toast não-invasivo, incluindo no mobile onde `alert()` bloqueia o fluxo de forma especialmente ruim.

### fix(frontend): Parte 2 — CSS mobile e visual
- **Modal com animação:** Modal não pisca mais ao abrir. Usa `opacity` + `pointer-events` + `transition:0.2s` no lugar de `display:none/flex`. No desktop: painel sobe levemente com `translateY(12px) scale(0.98)`. No mobile: desliza de baixo com `translateY(24px)`.
- **Dark mode btn-secondary:** Texto era `var(--mid)` (#aaaaaa) em fundo #252525 — contraste marginal. Agora é `#d0d0d0` para leitura confortável.
- **Labels mobile:** `font-size:11px` → `13px` no breakpoint 768px. Mais legível no celular.
- **Botões .btn-sm mobile:** Adicionado `min-height:38px` e `font-size:12px` no breakpoint 768px — área de toque adequada.

### fix(frontend): Parte 1 — bugs JS críticos
- **alert() → mostrarToast():** Erros no upload de comprovante usavam `alert()` bloqueante (péssimo em mobile). Substituído por `mostrarToast(..., "error")` nos dois casos (erro de API e erro de rede).
- **c.recibos undefined:** Acessos a `c.recibos[0]`, `c.recibos.length` e `c.recibos.map()` em cards de clientes e modal de cadastro agora usam `(c.recibos || [])` para evitar `TypeError` quando o campo não existe no objeto.

## 2026-05-26

### fix: Recibos da recepção não apareciam no histórico
- **Causa raiz:** `escritorioLogado` não era salvo no login — campo `escritorio` do token do servidor não era armazenado no `localStorage`. Após salvar um recibo, `limparCampos()` zerava o campo `escritorio`, então o próximo recibo era salvo com `escritorio: ""`. O filtro do servidor exige que `r.escritorio === user.escritorio`, então esses recibos nunca apareciam para a recepção.
- **Fix:** `escritorioLogado` agora é salvo no login (`localStorage.setItem`), atualizado ao carregar `/api/me`, e restaurado automaticamente para usuários de recepção em `limparCampos()` (em vez de apagar).

## 2026-05-25

### feat: Refatoração completa do módulo de clientes — parcelas individuais + referência padrão
- **Schema novo do cliente:** array `parcelas` com controle por parcela (status pago/pendente/atrasado, data recebimento, data depósito, recibo vinculado, observação)
- **Campos novos:** `valor_beneficio`, `num_beneficios`, `valor_parcela`, `updated_at`; cálculo automático `valor_contrato = beneficio × nº benefícios`
- **Migração on-the-fly:** clientes antigos sem campo `parcelas` recebem array inicializado automaticamente na leitura (parcelas já pagas marcadas como `pago`, restantes como `pendente`) — sem perda de dados
- **Neon:** `ALTER TABLE users ADD COLUMN IF NOT EXISTS referencia_padrao` — rodado no startup via `initDb()`
- **Rotas novas (server.js):**
  - `GET /api/me` — retorna dados do usuário logado com `referencia_padrao`
  - `PUT /api/me/referencia` — salva referência padrão do usuário logado
  - `PATCH /api/clientes/:id/parcela/:num` — marca parcela como paga com datas e vínculo de recibo
- **Rotas atualizadas (server.js):** POST e PUT `/api/clientes` agora aceitam e persistem todos os novos campos; `enriquecerCliente` usa o array `parcelas` diretamente em vez de contar recibos
- **Modal de cliente reformulado (index.html):** 3 seções (Dados Pessoais / Benefício-Contrato / Botões), campos novos, botão pin para salvar referência padrão
- **Modal "Registrar Pagamento de Parcela" (index.html):** novo modal com valor readonly, date pickers para recebimento/depósito, nº do recibo e observação
- **Abas no card do cliente (app.js):** 4 abas — Parcelamento (tabela completa + botão Registrar Pgto), A Receber, Recebidos, Histórico
- **Referência padrão (app.js):** carregada via `GET /api/me` após login; auto-preenchida no campo `referencia` do formulário de recibo e no modal de cadastro; botão pin exibe opção de salvar quando valor diferente do padrão
- **Fluxo "+ Recibo" (app.js):** ao clicar em "+ Recibo" no card do cliente, preenche campos do formulário (incluindo `escritorio` da firma); após gerar recibo com sucesso, pergunta se deseja marcar a próxima parcela pendente como paga

### fix+sec: Etapas 4-9 CLAUDE.md — bugs, segurança, testes, refactoring, documentação
- **5 bugs corrigidos** (ver `reports/bugs_found.md`): null check no `confirmarPagamentoParcela`, 404 no PUT cliente, whitelist no PATCH parcela, typo `jaPagess→jaPagas`, validação de tamanho na referência
- **7 vulnerabilidades corrigidas** (ver `reports/security_report.md`): XSS no onclick inline, iframe src sem protocolo, sem validação de enum status/role, e.message exposto ao cliente, CSP ausente, link_comprovante sem whitelist
- **22 testes unitários Jest** em `tests/clientes.test.js` — cobrindo `gerarParcelas`, `recalcularResumo`, `inicializarParcelasLegado`, validações de entrada
- **Refactoring** de `renderClientes()` em app.js: extraídas 5 funções auxiliares `_badgeParcela`, `_btnPagarParcela`, `_buildBlocoContrato`, `_buildTabelaRecibos`, `_buildTabelasParcelamento`
- **Documentação criada:** `docs/changelog.md`, `docs/architecture.md`, `reports/final_review.md`

## 2026-05-22 (2)

### fix: Clientes mostram todos do histórico + campo firma
- `renderClientes` volta a agrupar todos os clientes do histórico de recibos (comportamento original)
- Se o cliente já tiver cadastro, exibe barra de progresso de parcelas e firma no card
- Botão "Cadastrar" aparece para clientes sem cadastro, "Editar cadastro" para os que já têm
- Ao clicar em "Cadastrar", modal abre pré-preenchido com nome, CPF e município do histórico
- Adicionado campo `firma` (escritório/filial) no cadastro do cliente — visível no card em dourado
- Backend: rotas POST/PUT de clientes aceitam e persistem `firma`

## 2026-05-22

### feat: Módulo de cadastro de clientes com controle de parcelas
- Novo banco `clientes.db` (NeDB) com campos: nome, CPF, telefone, endereço, município/UF, referência, valor do contrato, nº de parcelas
- Novas rotas: `GET/POST/PUT/DELETE /api/clientes` e `GET /api/clientes/cpf/:cpf`
- API enriquece cada cliente com: valor_parcela, parcelas_pagas (contagem de recibos por CPF), parcelas_restantes, valor_pago, valor_restante
- Tela Clientes: botão "Cadastrar Cliente", cards com barra de progresso visual (X/Y parcelas · R$ pago · R$ restante)
- Modal de cadastro/edição com cálculo automático do valor de cada parcela
- Ao digitar CPF completo no formulário de recibo, preenche automaticamente nome, município, referência e valor da parcela
- Botão "+ Recibo" no card do cliente pré-preenche o formulário de geração

## 2026-05-21

### feat: Recepção visualiza apenas recibos do próprio escritório
- Adicionado campo `escritorio` na tabela `users` (Neon) com migração automática via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- JWT de login agora carrega `escritorio` no payload
- `GET /api/recibos`: usuários com `role = recepcao` recebem apenas os recibos cujo campo `escritorio` bate com o escritório do seu usuário (comparação case-insensitive)
- `POST /api/users` e `PUT /api/users/:id`: aceitam e persistem `escritorio`; retornam erro 400 se `role = recepcao` e `escritorio` estiver vazio
- `GET /api/users`: retorna campo `escritorio`
- Sync e restauração do Google Sheets atualizados para coluna A:E (adicionada coluna escritório)
- Frontend: campo "Escritório" aparece nos formulários de adicionar/editar usuário apenas quando perfil = Recepção
- Lista de usuários exibe o escritório vinculado para perfil Recepção

### remove: Bloqueio de 15 minutos por tentativas de login
- Removida lógica de rate limit (`loginAttempts`, `checkRateLimit`, `getClientIp`) do `web/server.js`
- O sistema não bloqueia mais o IP após 10 tentativas erradas de senha
- Motivação: bloqueio estava impedindo usuários legítimos que erravam a senha

## 2026-05-13 (3)

### fix: Causa raiz definitiva — comprovantes expirando no app
- **Causa raiz real**: `sincronizarComprovantes()` rodava no startup, lia todos os links da coluna K da planilha (que continha presigned URLs temporárias geradas durante syncs anteriores) e os **sobrescrevia no banco NeDB**, trocando proxy URLs permanentes por URLs que expiravam em horas
- **Efeito**: a cada reinício do servidor (deploy), o banco recebia presigned URLs expiradas → app mostrava XML de erro do S3 ("ExpiredToken") no modal de comprovante
- **Correções**:
  - `sincronizarComprovantes`: adicionada guarda dupla — só preenche registros sem `link_comprovante` (nunca sobrescreve) e ignora qualquer URL contendo `amazonaws.com` (presigned ou pública)
  - `corrigirLinksComprovante`: regex atualizada de `/amazonaws\.com\/(.+)$/` para `/amazonaws\.com\/(.+?)(?:\?|$)/` — extrai só o path, descartando query string com tokens expirados; converte de volta para proxy URL
  - `abrirComprovante` (frontend): detecta presigned URL expirada (`amazonaws.com` + `X-Amz-`) e exibe mensagem amigável em vez do XML de erro do S3

### fix: Upload de comprovante retornava erro de cota do Drive
- **Causa**: rota `/api/upload-comprovante` tentava fazer upload para o Google Drive via service account antes de tentar o S3 — service accounts não têm cota de armazenamento no Drive pessoal
- **Tentativas**: compartilhamento de pasta com service account (não resolve — cota é da SA, não do dono da pasta); OAuth2 com refresh token (bloqueado por 2FA na conta)
- **Correção**: removido bloco Drive do upload — arquivos vão direto para S3; proxy URL `/api/comprovante-s3/...` nunca expira no app

### fix: Novo recibo não aparecia na planilha automaticamente
- **Causa**: `registrarNoSheets` chamava `await linkParaSheets(...)` internamente para gerar presigned URL — se a chamada falhava ou travava silenciosamente (função é fire-and-forget), o append ao Sheets nunca acontecia
- **Correção**: `registrarNoSheets` salva `link_comprovante` diretamente como está (proxy URL); presigned URL só é gerada no sync explícito, onde erros são visíveis

### feat: IAM user estático para presigned URLs de 7 dias reais
- **Problema**: credenciais IAM temporárias do instance profile do EB expiram em horas — presigned URLs assinadas com elas também expiram antes do prazo configurado
- **Solução**: criado usuário IAM `araujo-prev-s3-reader` com política `s3:GetObject` somente no bucket `araujo-prev-comprovantes`; Access Key permanente gerada e configurada no EB como `S3_SIGNER_KEY_ID` e `S3_SIGNER_SECRET`
- `s3SignerClient` criado no servidor usando essas credenciais fixas — presigned URLs de 7 dias agora são reais
- Fallback para `s3Client` (instance profile) se env vars não estiverem definidas

---

## 2026-05-13 (2)

### fix: Sincronização inserindo dados no meio da planilha
- **Causa raiz**: `values.append` com `insertDataOption: "INSERT_ROWS"` detecta o "fim da tabela" como o fim do último bloco contíguo — se houver linhas vazias no meio dos dados, insere ali em vez de no final
- **Correção**: removido `insertDataOption: "INSERT_ROWS"` de `registrarNoSheets` e do endpoint `/api/admin/sync-sheets`; o comportamento padrão `OVERWRITE` sempre acrescenta após a última linha não-vazia

### fix: Datas em formato americano (MM/DD/YYYY) na planilha
- **Causa raiz**: `new Date("08/05/2026")` no JavaScript interpreta a string como MM/DD/YYYY (padrão americano), convertendo 08/05/2026 para agosto de 2026 em vez de maio
- **Correção**: criada função `parseDateBR(str)` que faz split manual em "/" e constrói a data com `new Date(Number(y), Number(m)-1, Number(d))` — evita a interpretação automática errada
- Aplicada em todos os pontos que formatam datas para a planilha (`sync-sheets`, `reescrever-planilha`, `corrigir-datas`)

### fix: Duplicatas na planilha (até 11 cópias do mesmo recibo)
- **Causa raiz**: múltiplas execuções de sync + `INSERT_ROWS` inserindo no meio + dados originais do Google Forms já presentes
- **Correção**: adicionado endpoint `POST /api/admin/limpar-duplicatas` que lê todas as linhas, identifica duplicatas pela coluna M (num_recibo) mantendo apenas a primeira ocorrência, e deleta as extras de baixo para cima usando `batchUpdate/deleteDimension`
- **Solução nuclear**: endpoint `POST /api/admin/reescrever-planilha` que limpa o intervalo A4:Z e reescreve todos os registros do NeDB do zero, usando `Promise.all` com `async map` para processar comprovantes em paralelo

### feat: Endpoint para corrigir datas retroativamente na planilha
- `POST /api/admin/corrigir-datas`: cruza os registros do NeDB com as linhas da planilha pelo num_recibo (coluna M) e atualiza colunas A (data_emissao), E (competencia_inicio), F (competencia_fim) e L (data_pagamento) com datas no formato brasileiro correto

### fix: Comprovante não carregava no app (dois bugs distintos)
- **Bug 1 — Link Drive com formato `?id=`**: regex antiga `/\/d\/([^/]+)\//` só detectava links no formato `/d/ID/preview`. Links antigos salvos como `open?id=ID` não eram reconhecidos
  - **Correção**: regex atualizada para também detectar `[?&]id=([a-zA-Z0-9_-]{10,})`
- **Bug 2 — Comprovante local retornava 401**: `<iframe src="/api/comprovante/arquivo">` não envia o header `Authorization: Bearer <token>` automaticamente
  - **Correção**: `abrirComprovante()` reescrita em `app.js` — detecta links `/api/comprovante*`, faz `fetch()` com header Authorization, converte resposta para Blob URL e injeta no modal via `<img>` (imagens) ou `<iframe>` (PDFs)

### fix: Links S3 na planilha não abriam externamente
- **Causa**: comprovantes ficavam salvos como `/api/comprovante-s3/comprovantes/HASH.pdf` — URL relativa que requer JWT, inacessível direto do Google Sheets
- **Tentativa 1** (descartada): presigned URLs do S3 — credenciais IAM temporárias do Elastic Beanstalk não conseguem gerar URLs de longa duração
- **Correção final**: função `linkParaSheets(link, reciboId)` em `server.js`:
  - Se `GOOGLE_CREDENTIALS` estiver disponível: baixa o arquivo do S3, faz upload para o Google Drive, salva o link do Drive de volta no NeDB (`link_comprovante` atualizado) e retorna o link público do Drive — migração permanente
  - Fallback: tenta presigned URL do S3 (7 dias)
  - Chamada em `sync-sheets` e `reescrever-planilha` para todos os registros com link S3
- **Dependência adicionada**: `@aws-sdk/s3-request-presigner` no `package.json`

### fix: Acesso ao painel administrativo removido para role "recepcao"
- Em `app.js`, dentro de `iniciarApp()`, quando `roleLogado === "recepcao"`: oculta todos os elementos `.somente-financeiro`, o item de navegação `#nav-admin` e o botão `#bn-admin`
- Em `index.html`: adicionado `id="nav-admin"` ao item de navegação do Administrativo

### feat: Refinamentos visuais no frontend
- **Variáveis CSS**: `--radius:12px`, `--radius-sm:8px`, `--shadow-hover` adicionadas
- **Sidebar**: gradiente `linear-gradient(180deg,#252525,#1e1e1e)`, nav items com border-radius e indicador ativo `inset 3px 0 0 var(--gold)`
- **Login**: fundo com gradiente escuro, sombra dourada no card, border-radius 16px
- **Cards e modais**: border-radius 12px, `backdrop-filter:blur(2px)` no overlay do modal
- **Dash cards**: gradiente `linear-gradient(145deg,#ffffff,#faf7f2)`, efeito hover de elevação (`translateY(-2px)`)
- **Botões** `btn-primary` e `btn-gold`: gradiente + hover lift
- **Lista de recibos**: transição `cubic-bezier(.4,0,.2,1)` + `translateY(-1px)` no hover
- **Badges**: borda adicionada para melhor contraste
- **Tema escuro**: cor de card atualizada para `#1c1c1c`

---

## 2026-05-13

### feat: Backup automático de usuários no Google Sheets
- Toda vez que uma conta é criada, editada ou deletada pelo painel, a lista completa de usuários (exceto admin) é salva na aba `Usuarios` da planilha Google Sheets (armazena hash bcrypt — não texto puro).
- No startup, se o banco Neon estiver vazio (reset detectado), o servidor restaura automaticamente todos os usuários da planilha com as mesmas senhas.
- A aba `Usuarios` é criada automaticamente na primeira sincronização se não existir.
- Sem nenhuma ação manual necessária — contas criadas pelo painel agora sobrevivem a resets do banco.

### fix: Contas de usuário não sobrescritas pelo USERS_JSON no deploy
- **Causa raiz identificada**: `ON CONFLICT (username) DO UPDATE SET password` no processamento do `USERS_JSON` fazia com que, a cada reinício do servidor (a cada deploy), as senhas dos usuários listados na variável de ambiente fossem resetadas ao valor original do env var — apagando qualquer senha alterada pelo painel.
- **Causa estrutural do "sumiço" de contas**: O banco Neon no free tier pode ser deletado após ~14 dias de inatividade, deixando apenas as contas recriadas pelas env vars (`ADMIN_USER` e `USERS_JSON`) após o reset.
- **Correção**:
  - `USERS_JSON` alterado para `ON CONFLICT (username) DO NOTHING` — só cria usuário se não existir, nunca sobrescreve senha ou role de usuário já cadastrado.
  - Admin (`ADMIN_USER`) continua com `DO UPDATE` pois é conta de sistema controlada por env var.
  - Adicionado log de auditoria no startup: exibe total de usuários no banco Neon para facilitar diagnóstico de resets.
- **Ação necessária**: Adicionar todas as contas importantes no `USERS_JSON` no Elastic Beanstalk — assim elas são recriadas automaticamente se o banco for resetado.

## 2026-05-12

### ci: Pipeline CodePipeline corrigido (backslash no ZIP)
- **Causa raiz**: CodePipeline gerava o artefato ZIP no Windows com backslashes nos caminhos, causando falha no deploy do Elastic Beanstalk ("invalid path separators")
- **Correção**: adicionado `buildspec.yml` na raiz do repositório — CodeBuild (Linux) passa a criar o artefato antes do deploy
  - Instala dependências via `npm install --production` dentro de `web/`
  - Exclui `data/` e `data/uploads/` do artefato para não sobrescrever dados em produção
- **Infraestrutura criada via AWS CLI**:
  - IAM Role `CodeBuildAraujoRole` com políticas de S3, CloudWatch e CodeBuild
  - Projeto CodeBuild `araujo-prev-build` usando `aws/codebuild/standard:7.0`
  - Estágio `Build` adicionado ao pipeline entre `Source` e `Deploy`
  - Deploy agora consome `BuildArtifact` (Linux) em vez de `SourceArtifact` (Windows)
  - Permissão `codebuild:StartBuild` adicionada ao role do CodePipeline

### fix: Upload de comprovante retornava HTML em vez de JSON
- **Causa**: `await s3Client.send()` sem try/catch — erro não tratado fazia Express retornar página HTML de erro 500
- **Correção**: rota `/api/upload-comprovante` envolvida em try/catch, retorna JSON com mensagem de erro legível

### fix: Bucket S3 não existia
- **Causa**: bucket `araujo-prev-comprovantes` nunca havia sido criado
- **Correção**: bucket criado via `aws s3 mb s3://araujo-prev-comprovantes --region us-east-1`
- **IAM**: política `AllowS3Comprovantes` adicionada ao role `aws-elasticbeanstalk-ec2-role` com permissões `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

### fix: Comprovante S3 não exibia (bucket privado)
- **Causa**: link salvo era URL pública do S3 (`https://bucket.s3.amazonaws.com/...`), mas o bucket é privado — acesso bloqueado pelo Block Public Access do S3
- **Correção**: arquitetura de proxy no servidor
  - Nova rota `GET /api/comprovante-s3/*` busca o arquivo do S3 com `GetObjectCommand` e faz pipe para o cliente (bucket permanece privado)
  - Upload agora salva `/api/comprovante-s3/comprovantes/KEY` em vez da URL pública
  - `corrigirLinksComprovante()` atualizada para converter URLs públicas S3 antigas para o formato proxy automaticamente na inicialização
- **Frontend** (`app.js`): `abrirComprovante()` detecta links `/api/comprovante-s3/` e faz `fetch()` com header `Authorization: Bearer <token>`, converte para Blob URL e injeta no modal — necessário porque `<img src>` não envia o JWT automaticamente

## 2026-05-11

### Fix: Usuários somiam após reinício do servidor
- **Causa raiz**: usuários criados pelo painel admin ficavam apenas no nedb local (`users.db`). Ao reiniciar/redeployar no Elastic Beanstalk, esse arquivo era perdido.
- **Correção**: migração de usuários do nedb para **Neon (PostgreSQL)**
  - Adicionada dependência `pg` no `package.json`
  - Pool de conexão configurado via variável de ambiente `DATABASE_URL`
  - Tabela `users` criada automaticamente via `initDb()` na inicialização
  - Admin e USERS_JSON continuam funcionando (upsert via `ON CONFLICT`)
  - Usuários criados pelo painel admin agora persistem no Neon independente de restarts/redeploys
  - Recibos continuam no nedb + Google Sheets (sem alteração)
- **Variável de ambiente necessária no Elastic Beanstalk**: `DATABASE_URL` (connection string do Neon)


## 2026-05-11 (3)

### UX: mensagem quando recibo não tem comprovante
- Tela de detalhes agora exibe "Nenhum comprovante adicionado" em vez de sumir a linha quando não há comprovante

## 2026-05-11 (4)

### feat: upload de comprovantes via S3
- Arquivos agora vão pro S3 quando `BUCKET_NAME` estiver configurado no EB
- Usa `multer.memoryStorage()` + `@aws-sdk/client-s3` para upload direto
- Fallback para disco local se `BUCKET_NAME` não estiver definido
- Variáveis necessárias no EB: `BUCKET_NAME` e opcionalmente `AWS_REGION` (padrão: us-east-1)

## 2026-05-11 (2)

### Fix: "Conexão recusada" ao ver comprovante
- **Causa**: link do comprovante era gerado com `req.protocol + req.get("host")` que no EB/nginx virava `http://localhost:8080/...` — inacessível pelo browser
- **Correção**: link agora usa URL relativa (`/api/comprovante/filename`) quando `APP_URL` não está definido
- `corrigirLinksComprovante()` roda na inicialização e converte todos os links absolutos antigos para URL relativa automaticamente

## 2026-05-07

### App Android (Capacitor WebView)
- Criado app Android usando Capacitor 6 que abre o site da AWS direto ao iniciar
- Projeto em `capacitor-app/` com config apontando para `http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com/`
- Adicionado `android.overridePathCheck=true` no `gradle.properties` para contornar limitação do Gradle com caminhos não-ASCII no Windows
- APK gerado em `capacitor-app/android/app/build/outputs/apk/debug/app-debug.apk`
- Testado e funcionando no dispositivo Android
