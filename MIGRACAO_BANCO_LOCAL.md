# Migração do banco de dados — Araujo Prev Recibos

> Documento de handoff para outra instância do Claude Code, rodando no
> servidor físico do escritório. Escrito em 20/07/2026.

## ⚡ Atualização — 20/07/2026, mesma noite

**O incidente foi resolvido sem migração**: fizemos upgrade temporário do
plano do Neon, o que liberou a cota na hora. Testado (`POST /api/login`
retornando 401 normal, sem erro de cota) — **site no ar de novo**.

Decisão de arquitetura tomada nesta sessão (caso a migração continue no
futuro): **Postgres na própria instância EC2** (não no servidor físico do
escritório), pra evitar o risco de rede/disponibilidade descrito abaixo.

**O que já foi feito, e pode ser reaproveitado:**
- Usuário IAM `adm_banco_local` criado com permissão ampla (`AdministratorAccess`)
  pra tarefas de migração — **existe separado do `backup-local-readonly`**,
  não misturar os dois. Profile local: `aws --profile admin`.
- PostgreSQL **17.10** instalado na instância EC2 (`i-0f33593fd0dc87bea`),
  client + server (`postgresql17`, `postgresql17-server`) — versão escolhida
  para bater exatamente com o Neon (17.10), evitando erro de
  "server version mismatch" no pg_dump/pg_restore.
- Dump completo do Neon extraído com sucesso (só funcionou **depois** do
  upgrade do plano — antes disso até o `pg_dump` era bloqueado pela cota,
  não só as queries do app) e salvo em:
  `s3://araujo-prev-comprovantes/db-migration-backups/araujo_prev_dump_2026-07-20.bak`
  (1.3 MB).

**O que falta, se decidir continuar a migração depois (sem pressa agora):**
1. `initdb` + criar usuário/banco dedicado no Postgres 17 da EC2 (ver Passo 2
   original abaixo, ajustando os nomes de pacote pra `postgresql17*`)
2. Restaurar o dump do S3 nesse banco novo (`pg_restore`)
3. Testar app apontando pro banco novo **antes** de trocar em produção
4. Configurar backup automático pro S3 (cron + pg_dump)
5. Trocar `DATABASE_URL` no Elastic Beanstalk só depois de validar tudo

**Não esquecer:** o Neon está no plano pago agora (upgrade temporário pra
destravar o dump). Se não for mais usar, avaliar rebaixar pro free tier de
novo mais pra frente — mas só depois que o backup local/S3 estiver
confirmado funcionando, senão fica sem rede de segurança nenhuma.

## ✅ Migração concluída — 21/07/2026

Produção migrada do Neon pro PostgreSQL 17.10 rodando na própria instância
EC2 (`i-0f33593fd0dc87bea`), conforme a decisão de arquitetura acima.

**O que foi feito:**
- Banco `araujoprev` criado, dump restaurado (3744 recibos, 745 clientes,
  12 usuários, 8 tabelas), dono de todas as tabelas transferido pra
  `araujoprev_app` (necessário pra `ALTER TABLE` no startup do app — só
  `GRANT` não é suficiente).
- Autenticação por senha habilitada (`pg_hba.conf`: `ident` → `scram-sha-256`
  nas conexões `host` 127.0.0.1/::1).
- Código (`web/server.js` e `lambda/export-worker/index.js`) ganhou a env
  var **`DB_SSL`** — `DB_SSL=false` desliga a exigência de SSL (necessária
  pro Neon, impossível de validar com certificado confiável num Postgres
  local em 127.0.0.1). Default preserva o comportamento anterior.
- `DATABASE_URL` e `DB_SSL=false` atualizados no Elastic Beanstalk. Login
  e queries confirmados funcionando em produção, sem erros nos logs.
- Backup diário automático: `/usr/local/bin/backup_db_to_s3.sh` (pg_dump +
  upload pro `s3://araujo-prev-comprovantes/db-backups/`, retenção local de
  14 dias) via `/etc/cron.d/araujoprev-backup`, roda todo dia às 5h UTC.
  Testado manualmente com sucesso.
- Neon mantido no ar (não desligado) como rede de segurança adicional.

**Incidente durante a migração:** a instância é uma `t3.micro` (916MB RAM).
Rodar uma segunda cópia completa do app (Express + Google Sheets + etc.)
pra teste, ao mesmo tempo que produção + Postgres, esgotou a memória e
derrubou o SSM Agent e o site. Recuperado com `aws ec2 reboot-instances`.
**Lição:** nesta instância, nunca rodar dois processos Node completos ao
mesmo tempo — testar conexão de banco com um script Node mínimo (só
`require("pg")`, sem subir o Express) em vez do app inteiro.

**Credenciais:** senha do usuário `araujoprev_app` foi gerada nesta sessão
e setada via `ALTER USER` — não registrada aqui (secreta). Está apenas na
`DATABASE_URL` da configuração do Elastic Beanstalk.

## Contexto

O sistema Araujo Prev (gerador de recibos, React/Express na AWS Elastic
Beanstalk) usa PostgreSQL hospedado no **Neon** (serverless). O plano
gratuito do Neon **estourou a cota de transferência de dados** — toda
consulta ao banco falha com:

```
Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.
```

Isso derrubou o login e qualquer operação que toque o banco. O site
inteiro depende dele (recibos, clientes, auditoria, usuários).

**Decisão tomada:** migrar o banco pra rodar localmente, com backup
automático pro S3 (o projeto já usa um bucket S3 pra comprovantes —
reaproveitar).

## ⚠️ Antes de começar — decisão de arquitetura pendente

A aplicação roda numa instância **EC2 na AWS** (Elastic Beanstalk),
**não** no servidor do escritório. Se o banco vai rodar no servidor do
escritório, a aplicação na AWS precisa **alcançar esse servidor pela
internet** — isso exige uma das duas coisas, e nenhuma delas está
configurada ainda:

1. **IP fixo (ou DNS dinâmico) + porta do Postgres exposta com cuidado**
   (firewall restringindo só ao IP da instância EC2, nunca `0.0.0.0/0`
   aberto pra qualquer um — banco de dados exposto sem restrição é alvo
   certo de ataque automatizado), OU
2. **VPN/túnel** entre a AWS e a rede do escritório (mais seguro, mais
   trabalho de configurar).

**Risco a considerar:** se o servidor do escritório desligar, cair a
internet daí, ou a energia acabar fora do expediente, o site inteiro
para de responder — inclusive pra clientes tentando acessar fora do
horário comercial. Isso é uma mudança real de confiabilidade em relação
a hoje (banco sempre-ligado gerenciado).

**Se isso não tiver sido resolvido/aceito explicitamente pelo Carlo,
pare aqui e confirme com ele antes de prosseguir** — é uma decisão de
negócio (dados financeiros/CPF de clientes reais), não só técnica.

Alternativa que também resolve o problema imediato sem esse risco de
rede: instalar o Postgres na **própria instância EC2 que já roda a
aplicação** (mesma máquina, sem depender de rede entre dois lugares).
Isso já estava em andamento antes deste handoff — só não foi concluído.

## Onde as coisas estão

- **App**: AWS Elastic Beanstalk
  - Ambiente: `Araujo-prev-env`
  - Aplicação: `araujo-prev`
  - URL: `https://Araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com`
  - Deploy automático via CodePipeline a cada `git push` na branch `main`
    do repo (GitHub `netosin455/araujo-prev-recibos`)
  - Instância única (sem load balancer), `t3.micro`, Amazon Linux 2023,
    Node.js 24
  - **Acesso remoto via AWS Systems Manager (SSM) já habilitado** nesta
    sessão — dá pra rodar comandos na instância sem chave SSH:
    ```bash
    aws ssm start-session --target i-0f33593fd0dc87bea
    ```
- **Banco atual**: Neon PostgreSQL (com a cota estourada)
- **Repositório local**: `C:\Users\carlo\OneDrive\Área de
  Trabalho\Araujo_Prev_Recibos` (Windows, mas o servidor de produção é
  Linux)

## Variáveis de ambiente já configuradas no EB (nomes, não valores)

```
ADMIN_PASS, ADMIN_USER, APP_URL, BUCKET_NAME, DATABASE_URL, DATA_DIR,
DRIVE_FOLDER_ID, EXPORT_QUEUE_URL, GOOGLE_CREDENTIALS, JWT_SECRET,
MIRROR_LOCAL_DIR, NPM_USE_PRODUCTION, PORT, S3_SIGNER_KEY_ID,
S3_SIGNER_SECRET, SHEET_ID, USERS_JSON
```

**Não escrevi os valores neste arquivo de propósito** — são segredos
reais (senha de admin, credenciais AWS, JWT secret). Pra pegar o valor
atual de `DATABASE_URL` (a connection string do Neon, necessária pra
fazer o dump dos dados antes de desligar de vez):

```bash
aws elasticbeanstalk describe-configuration-settings \
  --environment-name "Araujo-prev-env" --application-name araujo-prev \
  --query "ConfigurationSettings[0].OptionSettings[?OptionName=='DATABASE_URL'].Value" \
  --output text
```

(Precisa das credenciais AWS configuradas nessa máquina. Se não tiver,
peça pro Carlo rodar o comando acima e colar o resultado.)

## Schema do banco (tabelas conhecidas)

`recibos`, `clientes`, `auditoria`, `documentos`, `users`,
`recibo_counters`, `govbr_states`, `export_jobs`. Definições completas
em `web/services/startup.js` (função `initDb`) e nos módulos que criam
tabela sob demanda (`services/database.js` tem os índices).

## Passo a passo sugerido

### 1. Confirmar a decisão de arquitetura (rede) — ver seção de aviso acima

### 2. Instalar e configurar o PostgreSQL no destino escolhido
```bash
# Amazon Linux 2023 (se for a instância EC2):
sudo dnf install -y postgresql16 postgresql16-server
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```
Criar usuário/banco dedicados ao app (não usar o superusuário `postgres`
em produção).

### 3. Dump do Neon (enquanto ainda for possível — a cota bloqueia
consultas, mas `pg_dump` pode ainda funcionar dependendo de quanto foi
excedido; testar primeiro)
```bash
pg_dump "$DATABASE_URL_NEON" --no-owner --no-acl -F c -f araujo_prev_dump.bak
```
Se `pg_dump` também estiver bloqueado pela cota, esperar o reset mensal
do Neon (verificar no console.neon.tech) OU fazer upgrade temporário do
plano só pra conseguir extrair o dump, depois cancelar.

### 4. Restaurar no banco novo
```bash
pg_restore --no-owner --no-acl -d "$DATABASE_URL_LOCAL" araujo_prev_dump.bak
```

### 5. Testar o app apontando pro banco novo ANTES de trocar em produção
Rodar `web/server.js` localmente (ou numa instância de teste) com
`DATABASE_URL` apontando pro Postgres novo, confirmar login, listagem
de recibos/clientes, criação de recibo — fluxo completo.

### 6. Backup automático pro S3 (obrigatório antes de cortar o Neon de vez)
Script diário (`pg_dump` + `aws s3 cp`) via cron, guardando pelo menos
7-14 dias de retenção. Reaproveitar o `BUCKET_NAME` já configurado.
**Sem isso, um problema de disco na instância perde tudo — não pular
essa etapa.**

### 7. Trocar `DATABASE_URL` na configuração do EB
```bash
aws elasticbeanstalk update-environment \
  --environment-name "Araujo-prev-env" \
  --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value="<nova-connection-string>"
```
Isso reinicia a aplicação com o novo banco. Confirmar login funcionando
logo em seguida.

### 8. Só depois de confirmar tudo estável por alguns dias, desligar o
projeto no Neon (ou rebaixar pro free tier de novo, sem cancelar ainda
por precaução).

## Cuidados gerais

- **Dados reais de clientes** (CPF, valores, comprovantes) — qualquer
  erro na migração é sério. Testar exaustivamente antes de apontar a
  produção pro banco novo.
- Nunca commitar `DATABASE_URL` nem nenhum outro segredo no git.
- Manter o Neon vivo (mesmo que no plano free travado) até ter certeza
  absoluta que a migração e o backup estão funcionando — serve de rede
  de segurança/cópia dos dados originais.
