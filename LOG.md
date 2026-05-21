# LOG de Alterações — Araujo Prev

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
