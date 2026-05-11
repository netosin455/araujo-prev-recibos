# LOG de Alterações — Araujo Prev

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
