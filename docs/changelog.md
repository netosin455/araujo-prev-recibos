# Changelog — Araujo Prev Recibos

---

## [2026-07-22] - Assinatura no celular em modo paisagem

### Corrigido
- Girar o celular durante a assinatura nao apaga mais o traco do cliente, tanto na tela interna quanto no link publico.
- A tela de assinatura ficou compacta em telefones deitados, mantendo quadro, botoes e aceite acessiveis por rolagem.
- O campo de nome usa 16 px em celular, evitando o zoom automatico do iOS ao preencher a assinatura.

### Testado
- Sintaxe validada com `node --check` nos dois scripts de assinatura.
- A validacao visual em navegador local ficou pendente porque o servidor de desenvolvimento nao ficou acessivel nesta sessao; confirmar em um celular real antes do proximo deploy.

## [2026-07-21] — Refinamentos visuais de clientes, recibos e fichário

### Adicionado
- Resumo de contrato mais legível nos cartões de clientes: percentual visual, valores pago/em aberto e situação da próxima parcela.
- Botão **Conferir** no formulário de recibo: abre uma prévia local antes da geração, sem reservar número nem gravar dados.
- Filtro por tipo no fichário, com contagem contextual e miniaturas maiores para documentos.

### Melhorado
- Estados de carregamento, vazio e erro do fichário agora têm estrutura e feedback visual consistentes.

## [2026-07-21] — Correções de sessão, escopo e proteção de login

### Corrigido
- Edição de usuário agora incrementa `token_version`, encerrando sessões emitidas antes da troca de senha, papel, nome ou escritório.
- Paginação de recibos por cursor voltou a aplicar corretamente o filtro de escritório de recepção com regex parametrizada no PostgreSQL.
- Limite de login restaurado para 10 tentativas por IP a cada 15 minutos.

### Testado
- Adicionados testes de regressão para invalidação de sessão e filtro de escritório; suíte com 87 testes aprovada.

---

## [2026-07-21] — Auditoria de segurança e autorização

### Documentado
- Revisão de SQL injection, autenticação por cookie, exposição de token e fronteira backend–frontend.
- Registradas correções prioritárias para revogação de sessão após mudança de perfil, rotas de assinatura, escopo por escritório na paginação e proxy S3 genérico.
- Comunicação de handoff adicionada ao `opencode.md` para o Claude Code. Nenhum código de produção foi alterado nesta rodada.

---

## [2026-07-17] — Resiliência do banco + validação de tipos no payload

### Corrigido
- **Conexão ociosa do Postgres caindo derrubava o processo** — `pg.Pool` sem listener de `error` (evento fora de rota; o async-wrap não alcança). Agora loga e o pool se recupera sozinho. + rede de segurança `unhandledRejection` (loga em vez de matar o servidor).
- **Validação de tipos no payload** (`campoTextoInvalido` em helpers): POST/PUT de recibos e clientes rejeitam com 400 campo que não seja string/número ou passe de 300 chars (barra objeto/array — dado sujo ou injeção — antes do banco).
- **PUT /api/recibos/:id retornava 200 pra recibo inexistente** — agora 404.
- +2 testes (payload com objeto → 400; PUT inexistente → 404) — suite: **85 testes**.

### Nota sobre a re-verificação externa
- "Async routes sem try/catch: pendente" — **falso**: resolvido globalmente pelo `middleware/async-wrap.js` (a ferramenta procurou try/catch rota a rota e não viu o wrapper). Testes cobrem.
- "SHEET_ID hardcoded: pendente" — **decisão documentada**: fallback mantido com aviso de boot (ID não é credencial; remover às cegas arriscaria derrubar a integração se a env sumir do EB). Para remover de vez: confirmar no painel do EB que `SHEET_ID`/`DRIVE_FOLDER_ID` existem.

---

## [2026-07-17] — Varredura própria: backup quebrado, logger 100%, rate limit em rota pública

### Corrigido
- **Botão "Backup do Banco de Dados" estava QUEBRADO desde a migração pro Neon** — procurava arquivos NeDB (`recibos.db`/`clientes.db`) num caminho inexistente e sempre retornava 404. Reescrito: exporta as 4 tabelas do Neon (recibos, clientes, auditoria, documentos) em JSON num ZIP com manifesto; auditado (`backup_db`).
- **Rota pública `GET /api/assinatura/:token` sem rate limit** — token aleatório sofria força bruta sem freio; agora passa pelo limiter (100/15min por IP).
- **Fallback de uploads apontava pra `routes/data`** (faltava o `..` no caminho) — só afetaria instalação sem S3, mas estava errado.
- **Migração console→logger 100% completa**: `services/google-sheets.js` (18) e `services/database.js` (1) eram os últimos usando `console.*`.

---

## [2026-07-17] — Estabilidade e dependências: async-wrap + npm audit zerado

### Corrigido
- **Erro em rota async não derruba mais o servidor** — Express 4 não captura rejeição de handler async (Node 15+ mata o processo com unhandledRejection). Novo `middleware/async-wrap.js` embrulha automaticamente todo handler async registrado (get/post/put/patch/delete): o erro cai no error handler global (500 JSON) e o servidor segue de pé. Cobre as 11 rotas apontadas em auditoria e qualquer rota futura. +2 testes.
- **`SHEET_ID`/`DRIVE_FOLDER_ID`**: aviso no boot quando o fallback hardcoded é usado (os IDs não são credenciais — o acesso exige a service account — mas o certo é vir do ambiente; nota: já constam no histórico do git de qualquer forma).

### Dependências (npm audit: 8 vulnerabilidades → **0**)
- Removido `xlsx` do backend — **não era usado em lugar nenhum** (o frontend usa o arquivo estático próprio); carregava 2 vulnerabilidades altas sem correção disponível.
- `node-cron` 3 → 4 (corrige uuid vulnerável); crons validados no boot.
- `nodemailer` 8 → 9.0.3 (corrige SSRF/leitura de arquivo via opção raw); API usada (`createTransport`/`sendMail`) inalterada.
- `npm audit fix` aplicado no restante (multer/qs/js-yaml).

---

## [2026-07-17] — Planilha: linhas ANTIGAS clicáveis + levantamento de comprovantes perdidos

### Feito na planilha (execução única, já aplicada)
- **1.649 links do Google Drive** convertidos pra "Ver comprovante" clicável (Drive não expira — conversão definitiva).
- **74 caminhos legados** (`/api/comprovante/...`) verificados um a um contra o S3: **nenhum existe** — são os comprovantes perdidos da era do disco local. Levantamento completo em `reports/comprovantes_perdidos.md` (linhas 1653–1752 da planilha). Irrecuperáveis pelo sistema; alternativas no relatório.

### Corrigido no código
- **"Limpar e reescrever do zero"** agora dispara a renovação de links em segundo plano ao terminar — a coluna K volta a ficar clicável em instantes, sem esperar domingo.
- **"Sincronizar agora"** trocou `values.append INSERT_ROWS` (proibido pela lição de 2026-05-28 do CLAUDE.md — insere no topo com linha em branco no meio) pela escrita determinística (conta coluna A → escreve na próxima linha), e a coluna K já sai como "Ver comprovante".
- **Cron de renovação** também envelopa links do Drive em texto cru pra "Ver comprovante" (cobre o cenário pós-reescrita).

---

## [2026-07-17] — Planilha: link do comprovante já nasce clicável

### Corrigido
- **Coluna K (comprovante) da planilha** recebia o caminho relativo `/api/comprovante-s3/...` (texto morto) e só virava link quando o cron de renovação rodava. Agora `registrarNoSheets`/`atualizarNoSheets` geram a **URL assinada (7 dias) na hora** — com `USER_ENTERED` o Sheets auto-linka, então a célula já nasce clicável. O cron semanal continua renovando antes de expirar; sem o signer configurado, cai no comportamento antigo.
- **Anexar comprovante depois (PATCH) agora reflete na planilha** — antes o link só chegava no Sheets em sincronizações completas.

---

## [2026-07-17] — Desfazer exclusão de cliente (toast) — fecha revisão do planejamento

### Adicionado
- **`POST /api/clientes/:id/desfazer-exclusao`** — espelho do desfazer de recibos: quem excluiu desfaz em até 15 min (admin sempre), com auditoria `desfazer_exclusao_cliente` (CPF mascarado). O toast de exclusão de cliente agora tem botão **Desfazer**.
- A restauração pelo admin já existia via Lixeira (`/api/admin/lixeira/clientes/:id/restaurar`) — a revisão externa não a tinha localizado.
- +3 testes (404/403/410/200) — suite: **81 testes**.

---

## [2026-07-17] — Planejamento de Segurança: falhas 1, 2, 4, 5, 6, 7 e 8 corrigidas

Execução do `docs/planejamento-seguranca.md`:

### Corrigido
- **#1 (crítica) Rate limiter no login** — `loginLimiter` (10 tentativas/15min por IP) agora aplicado na rota `POST /api/login`; estava definido mas nunca usado. Verificado: 11ª tentativa retorna 429.
- **#2 (crítica) Logout invalida tokens** — `token_version` na tabela users, incluída no JWT e validada no middleware; logout incrementa a versão e mata TODOS os tokens do usuário na hora (token roubado morre no logout). Tokens atuais seguem válidos (claim ausente = versão 0) — ninguém é deslogado no deploy.
- **#4 Authorization Bearer removido** — middleware aceita só cookie httpOnly. Únicos usuários de Bearer eram scripts Python de importação já quebrados desde a migração pra cookie (podem usar `requests.Session()` se voltarem).
- **#5 console.* → logger** — 78 ocorrências em `routes/*.js` migradas pro logger estruturado (timestamp ISO + nível); URL do webhook removida dos logs (podia conter chave na query string).
- **#6 Error handler** — mensagem fixa no lugar de `err.message` (não ecoa detalhes internos).
- **#7 Webhook LGPD** — CPF mascarado no payload; suporte a `WEBHOOK_SECRET` (header Authorization) opcional.
- **#8 Auditoria de login** — todo login registra usuário, role, IP e timestamp na tabela auditoria (falha na auditoria nunca bloqueia o login).

### Corrigido (continuação — Falha #3, fase 1)
- **CSP endurecido nos blocos `<style>`**: `style-src-elem` agora é só `'self'` + fontes/CDN, **sem `unsafe-inline`** — bloco `<style>` injetado (o vetor forte de CSS injection) é bloqueado pelo navegador. O CSS que fichario.js e inicio.js injetavam via JS foi movido pro `css/main.css` e as funções de injeção removidas.
- `style-src-attr 'unsafe-inline'` mantém os atributos `style=""` funcionando (são ~283 no HTML + centenas gerados por JS — o documento subestimou o escopo ao contar só o index.html). A migração desses atributos pra classes fica como fase 2, gradual; o `style-src` genérico permanece como fallback pra navegadores antigos.

### Observações
- **#9 (soft delete de clientes)**: já estava implementada desde a Fase 3 — item do documento estava desatualizado.
- +3 testes (token_version defasada → 401, Bearer rejeitado, logout incrementa versão) — suite: **78 testes**.

---

## [2026-07-17] — Fichário: paginação corrigida, ZIP do cliente, lixeira de documentos, índice

### Corrigido
- **Só os primeiros 60 clientes apareciam no Fichário** — o backend já paginava, mas o frontend nunca usava (`_ficPagina`/`_ficTemMais` declarados e ignorados). Agora tem botão "Carregar mais clientes" e o contador avisa quando há mais páginas.
- **Exclusão de documento prometia recuperação que não existia** — o confirm dizia "fica recuperável no sistema", mas não havia tela. Documentos do fichário agora aparecem na **Lixeira do admin** (10 últimos) com restauração (`restaurar_documento` auditado).

### Adicionado
- **"Baixar tudo (ZIP)"** na galeria do cliente: `GET /api/clientes/:cpf/documentos/zip` — RG, CPF, comprovantes e laudos numa tacada, direto do S3, nomes organizados por tipo (`01_RG_...jpg`). Auditado (`exportar_docs_cliente`, CPF mascarado).
- **Índice `idx_documentos_cliente_cpf`** (parcial, só não-deletados) — a busca do fichário faz 2 subconsultas por cliente contra essa coluna; evita degradar conforme os documentos acumulam.
- +1 teste (restauração de documento) — suite: **75 testes**.

---

## [2026-07-17] — Fase 6: UX (desfazer exclusão, máscara de telefone, badge, skeleton)

### Adicionado
- **Toast "Desfazer" na exclusão de recibos** (individual e em lote): quem excluiu pode desfazer em até **15 minutos** via `POST /api/recibos/:id/desfazer-exclusao` (admin desfaz sempre; 409 se o número já foi reutilizado; auditoria `desfazer_exclusao_recibo`). Complementa a Lixeira sem abrir a restauração pra todo mundo.
- **Máscara de telefone** no cadastro de cliente — `(44) 99999-9999` (celular) e `(44) 9999-9999` (fixo), formatando enquanto digita.
- **Badge de selecionados** no item Histórico do sidebar — a contagem da seleção em lote fica visível mesmo navegando em outra tela.
- **Skeleton loading na Lixeira** (no lugar do texto "Carregando...").
- Toast agora aceita rótulo customizado no botão de ação (`mostrarToast(msg, fn, tipo, "Desfazer")`).
- +5 testes da rota de desfazer (404/403/410/200/admin) — suite total: **74 testes**.

### Observações
- Dark mode persistente já existia; campo CEP não existe no formulário — itens do plano original descartados.

---

## [2026-07-17] — Fase 2: arquitetura frontend

### Refatorado
- **CSS fora do HTML**: os dois blocos `<style>` do `index.html` (40 KB + tela de assinatura) viraram `public/css/main.css`. O index caiu de 116 KB pra ~74 KB e o CSS agora é cacheável separadamente (7 dias + `?v=`).
- **`recibos-extra.js` unificado no `recibos.js`** (Gov.br, recorrente, calendário, busca global, auditoria, timeline) — um script a menos pra baixar; sem colisão de declarações (verificado).
- **`_selecionadosZip` → `_selecionadosExport`** — o Set serve pra ZIP, Excel, e-mail e exclusão em lote; o nome antigo mentia.

### Adicionado
- **`api()` com erro padronizado**: toast automático (com anti-spam de 5s) pra falha de rede e erro 5xx — falhas deixam de ser silenciosas. Novo helper **`apiJSON()`** devolve `{ ok, status, data }` já parseado, pra código novo não repetir `if(!res||!res.ok)`.
- **ESLint funcional**: config migrada pro formato flat (`eslint.config.mjs`, ESLint 10) — o script `npm run lint` estava quebrado desde a v9. Backend com `no-undef` ligado; frontend (escopo global compartilhado) com `no-redeclare` pra pegar colisões reais. Estado atual: 0 erros, 106 warnings de limpeza gradual.

---

## [2026-07-17] — Fase 5: testes de integração das rotas reais

### Adicionado
- **`tests/rotas.test.js`** (19 testes, supertest): monta os módulos reais de `routes/*` num Express de teste com Postgres mockado — roda sem servidor externo e sem Neon. Cobre:
  - Middleware de auth real (cookie httpOnly + JWT): sem token/token inválido → 401
  - Soft delete de recibos e clientes: marca `deletado_em`/`deletado_por`, audita, CPF mascarado; recepção → 403
  - Exportação ZIP: validações (0 ids, >100 ids), caminho síncrono devolve `application/zip`, recepção → 403
  - Lixeira: 403 não-admin, limite 10, 400/404/409 (conflito de num) e restauração com auditoria
  - Login: 401 usuário/senha errados, 400 payload não-string, 200 com cookie httpOnly e **sem token no body** (SEC-011)
- Suite total: **69 testes** (`npm test`, node --test). devDependency nova: `supertest`.

---

## [2026-07-17] — Performance: gzip, cache de estáticos e boot paralelo

### Diagnóstico
- Medido: 1.887 recibos = 1,24 MB de JSON sem compressão; libs estáticas 1,4 MB; boot do app fazia 4+ round-trips em série. Banco responde rápido (tabela inteira em ~250ms) — o gargalo era transporte, não o servidor. **Load balancer não resolveria** (EB já tem ELB; não é problema de capacidade).

### Adicionado
- **Compressão gzip** em todas as respostas (middleware `compression`) — JSON e estáticos encolhem até ~10x (xlsx.min.js: 861 KB → 309 KB na rede).
- **Cache de 7 dias nos estáticos** (`express.static` com maxAge) — o `?v=` nos scripts invalida quando o código muda; `index.html` permanece `no-store`.
- **Boot paralelo no frontend**: checagem de admin (`/api/users`) não bloqueia mais o carregamento; `atualizarNumRecibo` e `carregarReferenciaPadrao` rodam em paralelo.

---

## [2026-07-17] — Fase 3: Lixeira com restauração (admin)

### Adicionado
- **Card "Lixeira"** no painel Configurações (visível só para admin): lista os 10 últimos recibos e 10 últimos clientes soft-deletados (mais recentes primeiro) com quem excluiu e quando, e botão Restaurar.
- **`GET /api/admin/lixeira`** e **`POST /api/admin/lixeira/:tipo/:id/restaurar`** (adminOnly). Restaurar limpa `deletado_em`/`deletado_por` e registra auditoria (`restaurar_recibo`/`restaurar_cliente`).
- **Proteção de conflito de numeração**: restaurar um recibo cujo número já pertence a um recibo ativo é bloqueado com 409 (o índice único de `num` só vale para ativos).

### Removido
- **Backup/Restaurar via JSON no sidebar** (seção Sistema) — redundantes com o card "Backup do Banco de Dados" das Configurações. No lugar entrou o item **Lixeira** (só admin), que navega direto pro card e já carrega a lista.

### Contexto
- Os demais itens da Fase 3 do plano já estavam implementados em sessões anteriores: JWT em cookie httpOnly (SEC-011, login/logout/middleware), soft delete de recibos, clientes, usuários e documentos, todos com auditoria.

---

## [2026-07-17] — Fase 4: exportação em lote completada

### Adicionado
- **Excel dos selecionados** — botão "Excel (N)" na barra de ações do Histórico: gera .xlsx no navegador (lib XLSX local) com os recibos marcados + linha de TOTAL (soma dos valores e contagem).
- **Seleção rápida** — dropdown "Selecionar…" com: Visíveis, Todos os filtrados (respeita busca/datas/filtros avançados — combinado com o filtro de escritório cobre "selecionar deste escritório"), Deste mês, Limpar seleção.
- **Barra de ações sempre visível** no Histórico (antes só aparecia após marcar o 1º checkbox — o botão "Todos" ficava inacessível). Botões ZIP/Excel/Email/Excluir desabilitados com 0 selecionados; ZIP e Excel mostram a contagem.

### Corrigido
- **Seleção era perdida** ao clicar "Carregar mais", no auto-refresh (20s) e ao mudar filtros — agora persiste entre re-renders; só descarta ids de recibos que deixaram de existir.
- **Toast de exclusão em lote** sempre dizia "0 recibo(s) excluídos" (lia o Set depois do `clear()`).
- **Limite de 100 recibos por ZIP** agora é avisado no frontend antes de chamar a API (o backend já rejeitava com 400).

---

## [2026-07-17] — Fase 1 da refatoração: server.js vira entry point

### Refatorado
- **`web/server.js` reduzido de ~2791 para ~285 linhas** — agora só faz configuração (env, Neon, S3, multer, middlewares), montagem das rotas modularizadas e `app.listen`.
- Rotas soltas movidas para os módulos existentes: `routes/govbr.js` (OAuth Gov.br + assinatura) e `routes/notificacoes.js` (SMTP/notificações) criados; `routes/admin.js`, `routes/clientes.js` e `routes/misc.js` receberam as rotas que ainda estavam no server.js.
- Novos serviços: `services/helpers.js` (parseBRL, gerarParcelas, recalcularResumo, validarCPF/CNPJ, enriquecerCliente, maskCPF etc.), `services/email.js` (transporter SMTP), `services/startup.js` (initDb, migrações, sincronizações com Sheets) e `services/cron.js` (cron jobs + health check `/api/health`).

### Corrigido
- **`ADMIN_PASS` não era injetado em `services/startup.js`** — o `initDb()` lançava `ReferenceError` no boot, abortando a criação/atualização do usuário admin e as normalizações de dados. Agora o server.js passa `ADMIN_PASS` ao factory do startup.
- **Logger descartava mensagens de erro** — chamadas no estilo `logger.error("msg:", e.message)` (string como 2º argumento) perdiam o detalhe do erro; o logger agora concatena strings/números à mensagem e serializa `Error` passado diretamente.

---

## [2026-07-10] — Tela inicial "Início" (painel-resumo)

### Adicionado
- **Tela "Início"** como home do app (`web/public/app/inicio.js`): saudação, 4 tiles (receita do mês c/ variação vs mês anterior, recibos no mês, a receber, clientes ativos), mini-gráfico de receita (6 meses) e listas de recibos recentes + parcelas atrasadas.
- Vira a **tela padrão** ao entrar; itens de menu "Início" no sidebar e no nav mobile.

### Decisão
- **Não duplica o "Administrativo"** (que tem os relatórios detalhados): o Início só **resume** os dados que o app já carrega em memória (`historicoRecibos`, `listaClientes`) e **linka** pras telas de detalhe. Design system (tiles/cards/tokens) reaproveitável no resto do app.

---

## [2026-07-10] — Fichário aperfeiçoado (visualizador, envio em lote, agrupamento)

### Adicionado
- **Visualizador (lightbox)**: ver os documentos dentro do app, com **zoom** (clique) e **navegação** por setas/teclado entre os documentos do cliente, no lugar de abrir a URL crua em aba nova.
- **Envio em lote**: enviar/fotografar **vários documentos de uma vez** (RG frente+verso+comprovante), com progresso "Enviando N de M".
- **Agrupamento por tipo** na galeria (RG, Comprovante, Procuração…), com contagem.

### Alterado
- Visual da seção Fichário alinhado à identidade do sistema (título serifado, cards com capa + badge de contagem, cabeçalho da galeria, hover, estados vazios).

### Removido / corrigido
- **Colisão de `renderFichario`**: existiam duas implementações (a aba antiga no card do cliente e a seção do menu). Removida a **aba redundante do card**; o Fichário passa a ser só a seção do menu (fonte única). Código de upload unificado (fim da duplicação).

---

## [2026-07-10] — Fichário de documentos do cliente

### Adicionado
- **Fichário por cliente**: aba "Fichário" no card de cada cliente pra guardar **fotos e PDFs** (RG, CPF, comprovante, procuração, laudo, CTPS…). Pensado pro pessoal de campo — botão **Tirar foto** (câmera direto no celular) + Enviar arquivo.
- **Tabela `documentos`** (metadados + chaves S3, soft-delete) e rotas `web/routes/documentos.js`: `POST/GET /api/clientes/:cpf/documentos` e `DELETE /api/documentos/:id` (excluir só financeiro/admin).
- Arquivos no **S3** (privado, via URL assinada temporária).

### Decisões de arquitetura
- **Carregamento sob demanda**: nada de documento carrega ao abrir o app/lista — só quando a aba Fichário de um cliente é aberta; miniaturas com `loading="lazy"`; arquivo cheio só no "Ver". Mantém o app leve mesmo com muitos documentos por cliente.
- **Redimensionamento no navegador (canvas)** em vez de `sharp` (que não está instalado e complicaria o deploy): o cliente envia a foto já reduzida + a miniatura — economiza banda no campo e evita dependência nativa. `createImageBitmap` corrige a orientação EXIF.
- Gravação passa por um ponto único (`salvarArquivo`) pra facilitar o **espelho no servidor local da firma** (fase 2).

### Nota
- Precisa de `BUCKET_NAME`/S3 configurado (existe na produção; não no `.env` local) pra o upload funcionar. Leitura e UI testadas no local.

---

## [2026-07-10] — Lista de clientes redesenhada + "Quitado" por valor

### Adicionado
- **Cards de cliente redesenhados**: etiqueta de status (Quitado / Em dia / Atrasado), "Total pago" em destaque, barra de progresso e "falta receber" mais claros, com aviso de parcela vencida.

### Alterado
- **Status "Quitado" agora é por VALOR** (pago ≥ contrato) em vez de contar parcelas — respeita pagamento parcial. A barra de progresso também é por dinheiro (pago ÷ contrato).

### Manutenção de dados (script pontual, executado uma vez)
- Mesclados 37 clientes duplicados do import (CPF estragado por formatação de Excel: `.0`, zeros à esquerda perdidos) — mantido o CPF válido, recibos re-apontados (nenhum recibo apagado), duplicado com soft-delete. 7 clientes marcados "pagos" sem nenhum recibo foram resetados. 8 casos ambíguos (CPFs válidos distintos) deixados para revisão manual.

---

## [2026-07-10] — Cadastro de clientes: valores corretos, parcela flexível e resumo novo

### Corrigido
- **Inflação de 100x nos valores de cliente**: `valorParaNumero` só entendia o formato BR (`"1.518,00"`) e, ao receber valores de cliente em formato SQL (`"6000.00"`), removia o ponto decimal — virava 600000. Agora entende os dois formatos, e o backend (`enriquecerCliente`) normaliza contrato/entrada/pago/restante/parcelas para **número** ao retornar da API (fim das somas que concatenavam texto).
- **Parcela "atrasada" errada**: comparava datas em formatos diferentes (`DD/MM/YYYY` vs `YYYY-MM-DD`). Agora normaliza para ISO antes de comparar.

### Adicionado
- **Valor de parcela flexível (versatilidade)**: ao gerar um recibo, a parcela é quitada com o **valor real do recibo** (pode diferir da parcela sugerida). `recalcularResumo(parcelas, baseContrato)` passou a calcular "falta receber" como `contrato − pago`, então pagamentos a menor/maior sempre batem com o dinheiro real.
- **Resumo de parcelas em destaque** no modal de cadastro (contrato · entrada · a financiar), no lugar do texto simples.

### Removido
- Resquício visual do **recibo automático** (selo "Auto") — emitir recibo é ação manual.

---

## [2026-07-09] — Numeração de recibo à prova de corrida (atômica no servidor)

### Corrigido
- **Race condition na numeração**: o número do recibo era calculado no navegador (`GET /api/proximo-num` = "maior + 1") e impresso no documento **antes** de salvar. Dois recibos criados ao mesmo tempo pegavam o mesmo número → o segundo tomava um "Erro interno" (500) por causa do índice UNIQUE, com o PDF errado já baixado. Agora o **servidor reserva o número atomicamente** ao gerar o documento (`X-Recibo-Num` no header da resposta), então o número impresso sempre bate com o salvo.
- **Mensagem de erro clara**: conflito de número (`23505`) agora retorna **409** com mensagem explicativa em vez do "Erro interno ao salvar recibo." genérico.

### Adicionado
- Tabela `recibo_counters (ano, ultimo)` + seed idempotente (semeia com o maior número existente por ano; `GREATEST` no boot nunca reduz o contador).
- Helper `reservarProximoNumero(ano)` em `web/routes/recibos.js` (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — reserva atômica).

### Alterado
- `POST /api/gerar-recibo`: reserva o número quando o cliente envia `reservar_numero: true` (fluxo de criação novo). Re-impressão (`reimprimirRecibo`) e importação (`rest.js`) seguem usando o número existente — sem quebra.
- Rota de recibo recorrente passou a usar a reserva atômica (tinha o mesmo bug de `maior + 1`).
- Frontend (`public/app/recibos.js`): deixou de calcular o número; lê `X-Recibo-Num` da resposta e usa no nome do arquivo e ao salvar.

### Trade-off conhecido
- A numeração pode ter **buracos** (ex.: 0025 → 0027) se alguém gerar e não concluir — porque o número foi reservado. É intencional: numeração sem buracos é incompatível com "à prova de corrida".

---

## [2026-06-26] — Hardening do export assíncrono (6 pendências do opencode.md)

### Adicionado
- **`web/services/pdf-generator.js`** — fonte única de `gerarBufferPDFRecibo`, compartilhada entre o app e a Lambda. A Lambda recebe a cópia via `npm run build` (script novo no `package.json` da Lambda; arquivo no `.gitignore`).
- **`terraform/`** — IaaC dos recursos do export (SQS + DLQ com redrive 3x, Lambda, IAM da Lambda e do produtor EB, event source mapping, S3 lifecycle de 7 dias). README com fluxo de `terraform import` dos recursos já existentes.
- **Cron de limpeza** em `web/server.js`: remove `export_jobs` com mais de 7 dias (diário, 04:00 UTC).

### Corrigido
- **SSL do PostgreSQL na Lambda**: `rejectUnauthorized: false` → `true` (Neon usa CA pública).
- **ZIP vazio**: a Lambda agora falha o job (e manda pra DLQ) se nenhum PDF for gerado, em vez de subir um ZIP vazio marcado como `pronto`.

### Refatorado
- Eliminada a duplicação de `gerarBufferPDFRecibo` entre `web/routes/recibos.js` e `lambda/export-worker/index.js`.
- Pool de conexões da Lambda reduzido de `max: 2` para `max: 1` (evita estourar conexões do Neon em pico).

### Pendências de deploy (ação humana)
- Buildar/zipar a Lambda (`npm run build`) e rodar `terraform import` + `terraform apply` (ver `terraform/README.md`).
- (Opcional) Replicar o fix de SSL em `web/server.js:58`.

---

## [2026-06-26] — Exportação de ZIP em lote assíncrona (SQS + Lambda)

### Adicionado
- **Exportação em lote agora é assíncrona:** `POST /api/recibos/exportar-zip` deixou de gerar o ZIP dentro da requisição (que travava o servidor e arriscava timeout em lotes grandes). Agora cria um job em `export_jobs`, envia pra fila **SQS** (`araujo-prev-jobs`) e responde `202 { jobId }` na hora.
- **Worker Lambda** (`lambda/export-worker/`, `araujo-prev-export-worker`): consome a fila, busca os recibos no Neon, gera os PDFs (reusa a lógica de `gerarBufferPDFRecibo`), monta o ZIP e sobe no S3 (`exports/<jobId>.zip`); marca o job como `pronto`. Retry automático (3x) + **DLQ** (`araujo-prev-jobs-dlq`) em caso de falha.
- **Novo `GET /api/recibos/exportar-zip/status/:jobId`**: o app gera a URL assinada de download (via `s3SignerClient`) quando o job fica pronto.
- **Frontend:** o botão de exportar vira "Gerando x/total…" com polling e dispara o download quando pronto (`exportarZipSelecionados` em `recibos.js`). Mantém fallback inline se a fila não estiver configurada (`EXPORT_QUEUE_URL`).
- Infra (provisionada): fila SQS + DLQ, IAM (envio na role do EB, consumo/S3 na role do Lambda), event source mapping, e lifecycle do S3 apagando `exports/` após 7 dias. Tabela `export_jobs` no schema (`web/server.js`).

---

## [2026-06-26] — Assinatura ancorada na linha + selo de validação

### Melhorado
- **Assinatura não "flutua" mais:** no PDF, a imagem agora é ancorada **sobre a linha** (base do traço encosta na linha), com o espaço vazio reduzido — bloco coeso (assinatura → linha → nome → CPF), no padrão dos apps de assinatura (ZapSign/Clicksign/Autentique).
- **Selo de validação eletrônica:** abaixo do nome/CPF aparece, em itálico discreto, "Assinado eletronicamente por NOME em DD/MM/AAAA HH:MM · IP X.X.X.X" — no PDF (`abrirPDFRecibo`) e no DOCX (`/api/gerar-recibo`). Nome e IP vêm de `assinatura_govbr` (passados também no `reimprimirRecibo`).

---

## [2026-06-26] — Correção de recibos duplicados (raiz + limpeza)

### Corrigido
- **Causa raiz da duplicação:** `sincronizarDeSheets()` (restauração da planilha quando o banco está vazio) inseria **todas** as linhas da planilha sem checar o número — se a planilha tinha linhas repetidas, duplicava no banco. Agora pula número já visto na planilha ou já existente, e não aborta o restore se uma linha falhar.
- **Índice único de número criado** (`idx_recibos_num_unique` em `recibos(num) WHERE deletado_em IS NULL`). Ele nunca tinha sido criado (falhava porque já havia duplicatas). Agora **qualquer** caminho que tente inserir número repetido é bloqueado pelo banco — proteção universal.
- **Limpeza:** 1.797 cópias duplicadas (de re-importação da planilha em 30/05 e 03/06) removidas via soft-delete, mantendo 1 de cada número. Backup completo em `backup_duplicatas_removidas.json` + relatório `duplicatas_recibos.csv`. Recibos ativos: 3.621 → 1.826.

### Removido
- **Cron de "auto-recibos mensais"** (`0 8 1 * *`) e o checkbox "Gerar recibos automáticos mensais" no cadastro de cliente — removidos a pedido do usuário. O cron referenciava colunas inexistentes (`clientes.auto_recibo`, `recibos.auto`), então estava quebrado/inerte, mas era um risco latente de duplicação. Não recriar sem aprovação explícita.

---

## [2026-06-26] — Assinatura remota por link + "Não assinar agora" + bugfixes

### Adicionado
- **Assinatura remota por link:** o financeiro gera um link (`POST /api/recibos/:id/link-assinatura`) com token aleatório (`crypto.randomBytes(24)`, nunca o id do recibo) e envia ao cliente via WhatsApp (`wa.me`) ou "copiar link". O cliente assina de casa, sem login, em página pública `/assinar/:token` (`web/public/assinar.html` + `assinar.js`), conferindo nome/CPF antes de desenhar a assinatura.
  - **Backend:** rotas públicas `GET/POST /api/assinatura/:token` (sem auth) — retornam apenas dados mínimos (CPF mascarado), validam expiração (7 dias) e uso único (bloqueio se já assinado), gravam `assinatura_govbr` com `metodo:"remoto"`, `ip` e timestamp.
  - **Banco:** novas colunas em `recibos`: `assinatura_token`, `assinatura_status`, `assinatura_expira_em` (com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para tabelas já existentes) + índice único parcial em `assinatura_token`.
  - **Frontend painel:** botão "Enviar p/ assinar" no card e no modal de detalhe + badge "Assinado/Assinatura pendente" em cada card.
- **"Não assinar agora":** botão na tela de assinatura do celular (`#btn-assinatura-pular`) que adia a assinatura — o recibo fica pendente e pode ser assinado depois pelo link remoto.
- **Atualização automática do histórico:** enquanto a tela de histórico está aberta, o painel revê os recibos a cada 20s e ao voltar o foco à aba (ex.: depois de enviar o link no WhatsApp), re-renderizando só quando o status muda. Quando um recibo é assinado remotamente, o badge vira "Assinado" sozinho e aparece um aviso. (`atualizarHistoricoAuto` em `recibos.js`)
- **`APP_URL`:** variável de ambiente que fixa o endereço público usado nos links de assinatura (`baseUrlDaRequisicao` em `server.js`). Sem ela, links gerados em `localhost` apontavam para `localhost` e não abriam no celular. Definida no `.env` e em `.ebextensions/03_env.config`.
- **HTTPS via CloudFront:** o domínio `.elasticbeanstalk.com` é só HTTP, e celulares forçam HTTPS — por isso o link dava "não é possível acessar esse site" no celular (`ERR_CONNECTION_REFUSED` na porta 443). Criada distribuição CloudFront (`https://dmd9wnmdoejv4.cloudfront.net`) na frente do EB com HTTPS válido; `APP_URL` aponta para ela.

### Melhorado
- **Assinatura no documento não fica mais esticada:** a captura agora recorta a assinatura no traço real (remove o espaço vazio), mantém a proporção natural e usa fundo transparente (`recortarAssinatura` em `assinatura.js`; `capturarPNG` em `assinar.js`). Na renderização, o PDF (`abrirPDFRecibo`, via `getImageProperties`) e o DOCX (lê o tamanho real do PNG no IHDR) desenham mantendo a proporção, centralizado — inclusive assinaturas antigas deixam de aparecer esticadas.
- **Linha-guia de assinatura:** os quadros de assinatura (celular e link remoto) agora mostram uma linha "✗ ____" indicando onde assinar. A guia é um elemento HTML/CSS sobreposto (não é desenhada no canvas), então **não entra na imagem** capturada da assinatura.
- **Legenda "Assinado eletronicamente em \<data\>":** aparece em itálico discreto logo abaixo do nome/CPF, no PDF (`abrirPDFRecibo`) e no DOCX (`/api/gerar-recibo`), quando o recibo tem assinatura. A data vem de `assinatura_govbr.assinado_em` (passada também no payload de `reimprimirRecibo`).
- **Qualidade do traço da assinatura:** o desenho agora usa curvas quadráticas (linha suave, sem cantos quebrados), traço de 3px, captura recortada em até 1000px e redução com `imageSmoothingQuality: "high"` — assinatura mais nítida e definida no documento. Em `assinatura.js` e `assinar.js`.
- **Tela de assinatura no celular = tela do link remoto:** a assinatura on-device (`#tela-assinatura`, após gerar o recibo) foi reformulada para ficar idêntica à página pública `assinar.html` — card com dados do recibo (Nº, valor, data, CPF mascarado), confirmação de nome, quadro com linha-guia e a mesma declaração. `mostrarTelaAssinatura` agora recebe o recibo inteiro e devolve `{ imagem, nome_confirmado }`; o `PUT /api/recibos/:id/assinatura` grava o nome confirmado pelo cliente (não mais o usuário logado) com `metodo:"local"`.

### Corrigido
- **Botão Excluir não funcionava:** `recibos.js` enviava `DELETE /api/recibos/undefined` ao usar `recibo.id` (vinha `undefined`); passou a usar `rid` (`recibo.id||recibo._id`).
- **Logout no celular:** o botão "Sair" do bottom nav (`bn-sair`) não tinha listener — adicionado em `rest.js`.
- **Botão Ver:** `abrirPDFRecibo` falhava em silêncio (sem try/catch) e dependia de `window.open`, bloqueado no celular/WebView. Agora trata erro com toast e cai para download via `<a>` quando o popup é bloqueado.

---

## [2026-06-14] — Agente 1/2 (Backend + Frontend): fix recepcao não conseguia salvar recibo

### Corrigido
- **Recibo não aparecia no histórico após geração (role recepcao):** middleware `semRecepcao` no `POST /api/recibos` bloqueava o save com 403; frontend não detectava o erro e navegava para o histórico sem o recibo salvo
- **Backend:** removido `semRecepcao` do `POST /api/recibos`; adicionado check explícito para `precatorios`; `registrarNoSheets` e `dispararWebhook` agora non-blocking
- **Frontend:** adicionada verificação `!salvarRes.ok` com `return` early — erros HTTP agora exibem toast e interrompem o fluxo corretamente

---

## [2026-05-28] — Agente 2 (Frontend): Rodada 6 — Calendário, busca global modal, paginação histórico, recibo recorrente, timeline cliente, auditoria

### Adicionado
- **Calendário de vencimentos** (`carregarCalendario(ano, mes)`): aba "Calendário" no admin com CSS grid 7 colunas; badge numérico por dia; cores por urgência (atrasado=vermelho, hoje/amanhã=laranja, futuro=verde); clicar no dia lista clientes/parcelas; navegação mês anterior/próximo via `btn-cal-prev`/`btn-cal-next`. Dados locais de `listaClientes`
- **Pesquisa global modal (Ctrl+K)** (`abrirModalBuscaGlobal`, `renderBuscaModal`): modal flutuante abre com Ctrl+K ou clique no overlay fecha; debounce 200ms; busca local em `historicoRecibos` + `listaClientes` simultaneamente; clicar no resultado navega para a tela e abre detalhe; fechar com Esc
- **Paginação no histórico**: `_historicoVisiveis = 50` renderizado por vez; botão "Carregar mais (N restantes)" no rodapé; filtros sempre operam sobre todo `historicoRecibos`, paginação só limita o que é renderizado; reset automático ao mudar qualquer filtro
- **Botão "Recorrente"** (`preencherReciboRecorrente`): em cada card do histórico e no modal de detalhe; calcula mês seguinte, incrementa referência (troca mês/ano por extenso), navega para formulário pré-preenchido para revisão antes de gerar
- **Linha do tempo do cliente** (`_buildTimeline`): nova aba "Timeline" nos cards de cliente com parcelamento; eventos cronológicos (recibo gerado, parcela paga, observação, lembrete enviado); ícones diferenciados por tipo; ordenado mais recente → mais antigo; dados 100% locais
- **Tela de Auditoria** (`carregarAuditoria`, `_renderAuditoria`): aba "Auditoria" no admin, visível apenas para `admin` (admin === usuário com acesso a `/api/users`); consome `GET /api/admin/audit-log`; filtros por usuário e ação sem nova chamada de API; "Em breve" se endpoint 404

### Alterado
- Ctrl+K agora abre modal de busca global em vez de focar o campo lateral
- `renderHistorico()` aceita parâmetro `maisItens=false` para controle de paginação
- `abrirAdminTab()` e `navegarPara()` adicionam suporte a tabs `calendario` e `auditoria`
- `iniciarApp()` exibe aba Auditoria para usuários com acesso admin

---

## [2026-05-28] — Agente 3 (DevOps): Backup diário S3 + renovação semanal de presigned URLs

### Adicionado
- **`fazerBackupDiario()`**: cron diário às 05:00 UTC (02:00 BRT) que zipa `recibos.db` + `clientes.db` e faz upload para `s3://BUCKET/backups/YYYY-MM-DD_backup_db.zip`. Usa o `archiver` já presente e o `s3Client` existente. Logado em caso de sucesso ou falha.
- **`renovarPresignedUrlsSheets()`**: cron dominical às 06:00 UTC (03:00 BRT) que percorre toda a coluna K do Google Sheets, detecta links S3 (paths `/api/comprovante-s3/KEY` ou presigned URLs expiradas) e regera URLs de 30 dias com `batchUpdate`. Garante que comprovantes não expirem para quem consulta a planilha.
- Ambos os crons registrados fora do `app.listen`, seguindo o padrão do cron de lembretes já existente.

---

## [2026-05-28] — Agente 1 (Backend): Rodada 6 — cron, cursor, recorrente, auditoria, analytics

### Corrigido
- **Lembrete não recorrente**: `setTimeout` de 30s substituído por `node-cron` com expressão `0 8 * * *` (todo dia às 8h, timezone `America/Sao_Paulo`). Startup mantém 30s de delay para verificação imediata no primeiro boot.
- **Paginação ineficiente em `GET /api/recibos`**: implementado modo cursor (`?cursor=<timestamp>&limit=N`) que usa `findLimited()` com filtro no NeDB. Retorna `{ recibos, nextCursor, hasMore }`. Modo legado `page/limit` mantido para compatibilidade total com frontend e scripts de importação.

### Adicionado
- **`node-cron ^3.0.0`** adicionado ao `web/package.json`
- **`POST /api/recibos/:id/recorrente`**: clona recibo existente avançando um mês na data, gera novo `num` sequencial, registra no Sheets e dispara webhook. Body aceita `{ data, referencia }` opcionais para override. Role: `financeiroOnly`.
- **Middleware de auditoria**: função `registrarAuditoria()` salva em `auditoria.db` (NeDB) a cada ação crítica: criar/editar/excluir recibo, atualizar parcela, excluir cliente, criar/excluir usuário. CPF sempre mascarado via `maskCPF()`.
- **`GET /api/admin/audit-log`**: retorna até 500 entradas do `auditoria.db`, mais recentes primeiro. Filtros opcionais: `?usuario=&acao=&de=&ate=`. Role: `adminOnly`.
- **`GET /api/relatorios/comparativo-anos`**: agrupa receita por ano e mês. Retorna array `[{ ano, meses: [{ mes, receita, qtd }] }]`. Role: `semRecepcao`.
- **`GET /api/relatorios/dre`**: DRE simplificado para o ano (`?ano=`). Retorna `{ ano, meses: [{ mes, receita_bruta, qtd_recibos, ticket_medio, variacao_mom, acumulado }], total_ano }`. Role: `semRecepcao`.
- **`findLimited()`**: helper NeDB que suporta `.sort().limit()` via cursor nativo, evitando carregar todos os documentos em memória.

---

## [2026-05-28] — Agente 6 (Integrações): Rodada 6 — fix email recibo, templates, retry webhook

### Corrigido
- **Bug `POST /api/notificacoes/enviar-recibo-email` retornando 404**: endpoint reescrito para aceitar aliases que o frontend envia (`email` em vez de `email_cliente`, `num` em vez de `num_recibo`). Campos `cpf`, `municipio_uf` e `data_extenso` agora opcionais — PDF é gerado sem eles. Campo obrigatório mínimo: `nome` + `valor` + e-mail válido

### Adicionado
- **Templates HTML de e-mail** em `web/templates/`: `email-recibo.html`, `email-inadimplencia.html`, `email-lembrete.html` — variáveis substituídas via `{{chave}}`; `carregarTemplate(nome, variaveis)` carrega com `fs.readFileSync` e faz replace; fallback para HTML inline se arquivo não for encontrado
- **Webhook com retry exponencial**: `dispararWebhook()` tenta até 3 vezes com delays de 1s → 4s → 16s (backoff `4^(n-1) * 1000ms`); cada tentativa é logada; falha permanente após 3 tentativas loga erro com número do recibo e URL de destino

---

## [2026-05-28] — Agente 5 (Analytics): Gráfico multi-ano, DRE simplificado, Export Analytics PDF

### Adicionado
- **Gráfico multi-ano** (`_renderGraficoMultiAno()`): gráfico de linhas sobrepostas com um dataset por ano detectado em `historicoRecibos`. Eixo X: Jan–Dez fixo. Eixo Y: receita. Cada linha tem cor própria (paleta `COR_LINHA`). Legenda abaixo com ano + total do ano. Renderizado ao final de `_renderAnalytics()` — responde ao filtro de período (dados globais, não filtrados, para permitir comparação entre anos)
- **Aba DRE** (nova aba "DRE" no painel admin): seletor de ano, tabela mensal com Qtd Recibos / Receita Bruta / Acumulado / Ticket Médio, rodapé com total do ano, gráfico de barras mensal e painel "Resumo DRE" com 6 KPIs (receita bruta, recibos, ticket médio, melhor mês, meses ativos, média mensal)
- **Export DRE PDF** (`exportarDREPDF()`): PDF A4 portrait com cabeçalho institucional, tabela completa via `autoTable` com rodapé em fundo escuro, coluna "Receita Bruta" em verde. Arquivo: `dre_araujo_{ano}.pdf`
- **Export Analytics PDF** (`exportarAnalyticsPDF()`): PDF A4 landscape com período no cabeçalho, bloco de 4 KPIs (recibos, receita, ticket, clientes), tabela Top 25 Clientes e tabela Por Responsável em duas cores de cabeçalho distintas. Arquivo: `analytics_araujo_{de}_{ate}.pdf`
- **Botão "PDF"** ao lado do "Excel" na barra do tab Analytics

---

## [2026-05-28] — Agente 4 (QA): Correções críticas — dashboard, recepção, Google Sheets

### Corrigido
- **Google Sheets — recibos indo ao topo (regressão):** `registrarNoSheets` trocou `values.append` com `INSERT_ROWS` por `values.get(A:A)` + `values.update` na linha exata; elimina table-detection instável do Sheets que inseria no meio dos dados quando havia linhas em branco
- **Dashboard — KPIs e gráfico em branco:** `iniciarApp` aguarda agora `Promise.all([carregarRecibos(), carregarClientes()])` antes de exibir o dashboard, garantindo que inadimplentes e vencimentos sejam calculados com dados reais
- **Projeção — gráfico vazio sem mensagem útil:** quando todas as parcelas têm valor zero (datas não cadastradas), mostra mensagem explicativa em vez de tela em branco
- **Recepção bloqueada de criar recibos:** removido `financeiroOnly` do `POST /api/recibos` (agente havia adicionado por engano)
- **Gráficos Chart.js sem dimensão:** adicionado `requestAnimationFrame` antes de `new Chart()` para garantir que o canvas tenha layout antes de calcular dimensões

### Atualizado
- `CLAUDE.md` — dois novos protocolos de erro: breaking change de API e `values.append` no Sheets

---

## [2026-05-28] — Agente 2 (Frontend): Rodada 5 — KPIs dashboard, e-mail recibo, WhatsApp, filtros avançados, aba Por Responsável, observações cliente

### Adicionado
- **Dashboard KPIs comparativos** (4 novos cards): Variação do Mês (verde/vermelho ±%), Clientes Inadimplentes, Parcelas Vencendo nos próximos 7 dias, Clientes Novos no mês — calculados localmente de `historicoRecibos` e `listaClientes`
- **Campo "E-mail do cliente"** opcional no formulário de recibo; após gerar com sucesso e e-mail preenchido, exibe painel "Enviar por e-mail" com botão `enviarReciboEmail()` que chama `POST /api/notificacoes/enviar-recibo-email`; mostra "Em breve" se endpoint não existir
- **Link WhatsApp no telefone do cliente** (`wa-link`): no card do cliente exibe telefone como `<a href="https://wa.me/55{fone}">` com ícone Bootstrap Icons; `stopPropagation` impede toggle do card ao clicar
- **Filtros avançados no histórico** (painel colapsável): filtros por escritório, forma de pagamento, responsável e range de valor (mínimo/máximo); `preencherFiltrosAvancados()` popula selects com valores únicos de `historicoRecibos`; `toggleFiltrosAvancados()` / `limparFiltrosAvancados()` controlam estado; todos os filtros se combinam com busca e intervalo de datas existentes
- **Aba "Por Responsável"** no painel admin: `carregarPorResponsavel()` consome `GET /api/relatorios/por-responsavel`; tabela ranqueada com rank, nome, qtd recibos, receita total, ticket médio e barra de progresso proporcional ao maior valor; "Em breve" se endpoint 404
- **Observações no modal do cliente**: seção "Observações" com lista renderizada por `renderObservacoes()`, botão toggle e campo textarea para adicionar; `adicionarObservacaoCliente()` chama `POST /api/clientes/:id/observacoes`; visível apenas no modo edição (não no cadastro)

### Alterado
- `limparCampos()`: limpa campo `email-cliente` e oculta `area-enviar-email`
- `limparModalCliente()`: limpa lista de observações, esconde painel de adição e botão toggle
- `editarCliente()`: renderiza observações do cliente e exibe botão "Adicionar observação"
- `carregarRecibos()`: chama `preencherFiltrosAvancados()` após carregar dados para manter selects atualizados
- `navegarPara()` e `abrirAdminTab()`: adicionam suporte ao tab `responsaveis`

---

## [2026-05-28] — Agente 6 (Integrações): Rodada 2 — lembrete parcelas, WhatsApp, Gov.br erro page, webhook

### Adicionado
- **Lembrete automático de parcelas** (`verificarEEnviarLembretesParcelasProximas`): executa 30s após startup via `setTimeout`; consulta NeDB para parcelas não-pagas com `data_vencimento` nos próximos 3 dias e sem `lembrete_enviado_em`; envia e-mail HTML resumido ao `SMTP_ADMIN`; registra `lembrete_enviado_em` e `lembrete_enviado_por: "sistema"` diretamente no NeDB. Não executa se SMTP não estiver configurado
- **Botão "💬 WhatsApp"** em cada parcela pendente/atrasada: função `_btnWhatsApp(telefone, nomeCliente, p)` em `app.js` gera link `https://wa.me/55{fone}?text=...` com mensagem pré-formatada (nome, parcela, valor, vencimento). Exibido na tabela "A Receber" do modal de detalhe do cliente. Não requer API — link direto
- **Página de erro amigável Gov.br** (`web/public/govbr-erro.html`): HTML estático com mensagem de erro dinâmica (lida do query param `?msg=`), botão "Voltar e Tentar Novamente" e botão "Ir para o Início". Todos os redirects de erro do callback Gov.br atualizados para usar esta página
- **Webhook `dispararWebhook()`** em `server.js`: função fire-and-forget que faz POST para `WEBHOOK_URL` (se configurada) com payload `{ evento: "recibo_gerado", recibo: {...}, timestamp }`. Erros são logados sem bloquear a resposta. Disparado ao final de `POST /api/recibos`

---

## [2026-05-28] — Agente 5 (Analytics): Export Excel, Por Responsável, Pizza Formas Pagamento, Filtro Período

### Adicionado
- **Export Excel — 3 abas** (`exportarAnalyticsExcel()`): gera `.xlsx` com SheetJS (`libs/xlsx.min.js`) com abas "Resumo Mensal" (período, qtd, receita, ticket médio), "Top Clientes" (rank, nome, qtd, total, ticket) e "Por Responsável" (responsável, qtd, receita, ticket). Nome do arquivo inclui período selecionado. Botão "Exportar Excel" no header do tab Analytics
- **Seção "Receita por Responsável"** (`_renderPorResponsavel()`): gráfico de barras horizontal (Chart.js `indexAxis: "y"`) com receita por `emitido_por`, computado a partir de `historicoRecibos` filtrado pelo período — não faz chamada de API adicional
- **Seção "Formas de Pagamento"** (`_renderFormasPagamento()`): gráfico doughnut com receita por `forma_pagamento` + legenda customizada com valor absoluto e percentual — computado do mesmo conjunto de dados do período
- **Paleta de cores compartilhada** (`CORES_GRAFICO`): array de 9 cores usadas por ambos os gráficos para consistência visual
- **`libs/xlsx.min.js`** adicionado ao `index.html` via `<script defer>`

### Alterado
- **Filtro de período** substitui filtro de ano: seletores "De" e "Até" (YYYY-MM) auto-populados com todos os meses presentes nos dados. Padrão: Jan do ano atual → mês corrente. Ao trocar qualquer seletor, re-renderiza gráfico mensal, top 5, ranking, por responsável e formas de pagamento simultaneamente
- **Gráfico mensal** agora exibe todos os meses do período selecionado (eixo X dinâmico) em vez de fixar os 12 meses do ano — períodos curtos ficam mais legíveis; máx. 60 meses para evitar overflow
- **Helper `_periodoMeses()`**: extrai e ordena todos os "YYYY-MM" únicos de `historicoRecibos`

---

## [2026-05-28] — Backend: Rodada 5 — 5 endpoints novos (resumo-mes, por-responsavel, formas-pagamento, observações, lembrete)

### Adicionado
- **`GET /api/relatorios/resumo-mes`** (`financeiroOnly`): KPIs comparativos mês atual vs anterior — receita, recibos, ticket médio, clientes novos, com delta percentual para cada métrica. Aceita `?mes=YYYY-MM` (padrão: mês corrente)
- **`GET /api/relatorios/por-responsavel`** (`financeiroOnly`): receita, contagem de recibos e ticket médio por `emitido_por`, ordenado por receita desc. Aceita `?mes=YYYY-MM` para filtrar por mês
- **`GET /api/relatorios/formas-pagamento`** (`financeiroOnly`): receita, contagem e percentual do total por `forma_pagamento`, ordenado por receita desc. Aceita `?mes=YYYY-MM`
- **`POST /api/clientes/:id/observacoes`** (`financeiroOnly`): adiciona observação ao cliente — body `{ texto }` (máx. 500 chars); salva `{ texto, autor, criado_em }` no array `observacoes[]` do documento NeDB
- **`DELETE /api/clientes/:id/observacoes/:idx`** (`adminOnly`): remove observação por índice do array
- **`PATCH /api/clientes/:id/lembrete`** (`financeiroOnly`): ativa ou desativa lembrete no cliente — body `{ ativo: bool, texto?: string (máx. 200 chars) }`; salva `{ ativo, texto, criado_por, criado_em }` no campo `lembrete`
- **`GET /api/clientes/:id`** (`auth`): retorna cliente único enriquecido — evita recarregar toda a lista após mutações pontuais
- **Helper `mesDeData()`**: converte "DD/MM/YYYY" → "YYYY-MM" para todos os filtros de mês dos relatórios

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
