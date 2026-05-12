# LOG de Alterações — Araujo Prev

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
