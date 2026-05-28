# Briefing dos Agentes — Araujo Prev Recibos

**Última atualização:** 2026-05-27 — Agente 4 (QA)

> Leia este arquivo ao iniciar sua sessão. Ele define o que cada agente deve fazer agora.
> Após concluir cada item, atualize o status aqui e em `bugs_found.md` / `security_report.md`.

---

## AGENTE 1 — BACKEND (`web/server.js`)

### Correções obrigatórias (dos reports)

| Item | Descrição | Arquivo de referência |
|------|-----------|----------------------|
| BUG-012 | `num_parcelas = 0` causa divisão por zero em `recalcularResumo()` — validar `>= 1` antes de chamar `gerarParcelas()` | `bugs_found.md` |
| BUG-014 | Status "atrasado" nunca é setado automaticamente — verificar `data_vencimento < hoje` on-the-fly no `GET /api/clientes` | `bugs_found.md` |
| BUG-009 | Presigned URL S3 expira em 7 dias — aumentar `expiresIn` para 30 dias ou regenerar ao abrir detalhe | `bugs_found.md` |
| SEC-010 | Hash bcrypt salvo na aba Usuarios do Google Sheets — remover coluna `password` da sincronização | `security_report.md` |

### Features novas a implementar

| Feature | Descrição |
|---------|-----------|
| Validação de CPF/CNPJ | Implementar `validarCPF(cpf)` e `validarCNPJ(cnpj)` com dígito verificador. Retornar HTTP 400 se inválido nas rotas `POST /api/recibos` e `POST/PUT /api/clientes` |
| Soft delete com auditoria | Em `DELETE /api/recibos/:id` e `DELETE /api/clientes/:id`: ao invés de remover, adicionar campos `deletado_em` (timestamp) e `deletado_por` (username). Filtrar `{ deletado_em: { $exists: false } }` nas listagens |
| Status atrasado automático | Em `GET /api/clientes`, marcar parcelas com `data_vencimento < hoje` como "atrasado" on-the-fly (sem persistir — mesma estratégia do `inicializarParcelasLegado`) |

### Regras obrigatórias
- Só mexa em `web/server.js`
- Todo novo endpoint deve ter `auth` + middleware de role adequado
- Tratamento de erro em todo I/O com try/catch
- Após terminar: atualizar `reports/bugs_found.md`, `reports/security_report.md` e `docs/changelog.md`

---

## AGENTE 2 — FRONTEND (`web/public/app.js`, `index.html`, `style.css`)

### Correções obrigatórias (dos reports)

| Item | Descrição | Arquivo de referência |
|------|-----------|----------------------|
| BUG-015 | Badge de clientes inativos não atualiza após registrar pagamento — chamar `atualizarBadgeClientes()` ao final de `confirmarPagamentoParcela()` | `bugs_found.md` |
| BUG-016 | Data inválida aceita no formulário (ex: 31/02) — validar com `new Date(ano, mes-1, dia)` e checar se mês bate | `bugs_found.md` |

### Features novas a implementar

| Feature | Descrição |
|---------|-----------|
| Preenchimento automático de "Emitido por" | Após login, buscar nome do usuário via `GET /api/me` e preencher o campo "Emitido por" no formulário de recibo automaticamente |
| Aviso de sessão expirando | Decodificar o JWT do `localStorage` para ler o `exp`. Exibir toast de aviso 15 minutos antes de expirar: "Sua sessão expira em 15 min. Salve o trabalho." |
| Confirmação antes de deletar cliente com parcelas ativas | Antes de chamar `DELETE /api/clientes/:id`, verificar se cliente tem parcelas com `status !== "pago"`. Se sim, exibir modal de confirmação com o número de parcelas pendentes |
| Validação de CPF/CNPJ no frontend | Implementar `validarCPF(cpf)` e `validarCNPJ(cnpj)` com dígito verificador. Exibir erro inline no campo antes de submeter o formulário |

### Regras obrigatórias
- Só mexa em `web/public/app.js`, `index.html` e `style.css`
- Não chame endpoints que não existam — confirme com o Backend se precisar de rota nova
- Toda operação assíncrona deve desabilitar o botão de ação durante a requisição (`btn.disabled = true` + `try/finally`)
- Após terminar: atualizar `reports/bugs_found.md` e `docs/changelog.md`

---

## AGENTE 3 — DEVOPS (infra, scripts, `package.json`)

### Tarefas

| Tarefa | Descrição |
|--------|-----------|
| Verificar deploy atual | Confirmar que `express-rate-limit` está instalado e funcionando em produção após o último deploy |
| `.gitignore` | Adicionar `capacitor-app/`, `deploy.zip`, `pipeline-update.json` e `planejamento2.md` ao `.gitignore` para não poluir o repositório |
| SEC-018 | Verificar se o security group do Elastic Beanstalk bloqueia acesso externo direto à porta 8080 (tráfego deve passar pelo Load Balancer) |
| Limpar scripts raiz | Verificar se `add_recibos_maio.py`, `importar_excel.py` e `gerar_token_drive.py` têm instrução de uso no cabeçalho — se não tiver, adicionar docstring |

### Regras obrigatórias
- Não toque em `server.js`, `app.js` ou `index.html`
- Após terminar: atualizar `docs/changelog.md`

---

---

## RODADA 4 — Novas features e segurança

---

## AGENTE 1 — BACKEND — Rodada 4

### Segurança (prioridade máxima)

| Item | Descrição |
|------|-----------|
| SEC-014 | `registrarNoSheets()` — salvar apenas path relativo (`/api/comprovante-s3/...`) na planilha, não a presigned URL completa |
| SEC-012 | `govbrStates` em Map de memória — criar tabela `govbr_states` no Neon (colunas: `state TEXT PK`, `data JSONB`, `expira_em TIMESTAMPTZ`). Migrar do Map para queries Neon com TTL de 10 min |
| SEC-017 | Remover `style-src 'unsafe-inline'` do CSP — identificar estilos inline dinâmicos e migrar para classes CSS |

### Features novas

| Feature | Descrição |
|---------|-----------|
| `GET /api/relatorios/projecao` | Retorna parcelas pendentes agrupadas por mês futuro (próximos 6 meses). Fonte: `clientes.db`. Formato: `[{ mes: "Jun/2026", valor: 12500.00 }, ...]` |
| `GET /api/admin/backup-db` | Comprime `recibos.db` e `clientes.db` em ZIP e retorna para download. Rota `adminOnly` |
| `GET /api/relatorios/por-escritorio` | Receita total, quantidade de recibos e clientes agrupados por `escritorio`. Retorna array ordenado por receita decrescente |

### Regras
- Só mexa em `web/server.js`
- Após terminar: atualizar `docs/changelog.md` e `reports/security_report.md`

---

## AGENTE 2 — FRONTEND — Rodada 4

### Features novas

| Feature | Descrição |
|---------|-----------|
| Skeleton loading | Substituir tela em branco por divs animadas durante carregamento em: histórico de recibos, lista de clientes e painel admin |
| Impressão direta de recibo | Botão "Imprimir" no modal de detalhe — abre PDF em `window.print()` sem precisar baixar |
| Aba "Projeção" no painel admin | Gráfico de barras com parcelas a receber nos próximos 6 meses (usa `GET /api/relatorios/projecao`) |
| Botão "Baixar backup do banco" | No painel admin, botão que chama `GET /api/admin/backup-db` e faz download do ZIP |
| Aba "Por Escritório" no painel admin | Tabela com receita total, recibos e clientes por escritório (usa `GET /api/relatorios/por-escritorio`) |

### Regras
- Só mexa em `web/public/app.js`, `index.html` e `style.css`
- Features que dependem de endpoint do Backend: implementar o frontend mas mostrar loading/empty state se endpoint não responder ainda
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 3 — DEVOPS — Rodada 3

### Tarefas

| Tarefa | Descrição |
|--------|-----------|
| Dependência nodemailer | Adicionar `"nodemailer": "^6.9.0"` em `web/package.json` — necessário para o Agente 6 |
| Variáveis SMTP | Documentar em `docs/architecture.md` as variáveis que o admin precisa adicionar no painel do EB: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| SEC-018 | Verificar manualmente no AWS Console: EC2 → Security Groups → [SG do EB] → Inbound rules → porta 8080 deve apontar para SG do Load Balancer, não `0.0.0.0/0` |
| Tamanho do NeDB | Verificar tamanho de `web/data/recibos.db` e `web/data/clientes.db` e documentar em `docs/architecture.md` |

### Regras
- Não toque em `server.js`, `app.js` ou `index.html`
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 5 — DADOS / ANALYTICS — Rodada 1 (ESTREIA)

### Domínio
Pode tocar em `web/server.js` (endpoints) E `web/public/app.js` (visualizações). Suas features sempre têm lado backend + frontend.

### Tarefas — Rodada 1

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Relatório de inadimplência completo | Endpoint `GET /api/relatorios/inadimplencia` + tela no painel admin com tabela: cliente, parcelas atrasadas, valor em aberto, dias de atraso. Ordenar por maior valor em aberto | 🔴 Alta |
| Dashboard de clientes | Nova aba "Analytics" no painel admin com: top 5 clientes por valor pago, receita total por mês (gráfico de barras), ticket médio por cliente | 🔴 Alta |
| Exportar recibos em lote (ZIP) | `POST /api/recibos/exportar-zip` recebe array de IDs, gera PDFs e retorna ZIP. Frontend: checkbox em cada linha do histórico + botão "Exportar selecionados" | 🟡 Média |
| Notificação de parcelas vencendo | Ao iniciar app, verificar parcelas com `data_vencimento` nos próximos 7 dias. Toast: "X parcela(s) vencem em breve." com link para clientes | 🟡 Média |

### Regras obrigatórias
- Só mexa em `server.js` e `app.js/index.html` — nunca em autenticação, S3, Google Sheets ou deploy
- Endpoints novos: sempre com `auth` + role adequado
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 6 — INTEGRAÇÕES / APIs EXTERNAS

### Domínio
`web/server.js` (rotas de integração) + scripts Python na raiz.

### Tarefas — Rodada 1

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Email SMTP — aviso de parcela vencendo | Configurar nodemailer com variáveis de ambiente (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Endpoint `POST /api/notificacoes/email-inadimplencia` que envia email para o admin com lista de clientes inadimplentes | 🔴 Alta |
| Email SMTP — recibo por email | Ao gerar recibo, opção de enviar o PDF diretamente por email para o cliente. Campo "Email do cliente" no formulário (opcional). Backend: anexar PDF gerado e enviar | 🟡 Média |
| Gov.br — melhorias no fluxo | Revisar e documentar o fluxo OAuth2 atual. Garantir que erros de callback são tratados com mensagem clara ao usuário. Adicionar log de tentativas de autenticação | 🟡 Média |
| WhatsApp Business API | Pesquisar e propor integração: ao gerar recibo ou vencer parcela, enviar mensagem via WhatsApp. Documentar em `docs/architecture.md` qual API usar (Twilio, Z-API, etc.) antes de implementar | 🔵 Baixa |

### Variáveis de ambiente necessárias (adicionar no EB)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=email@dominio.com
SMTP_PASS=senha_de_app
SMTP_FROM=Araujo Prev <email@dominio.com>
```

### Regras obrigatórias
- Só mexa em integrações — nunca em lógica de recibos, parcelas, NeDB diretamente ou autenticação JWT
- Credenciais sempre em variáveis de ambiente — nunca hardcoded
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 4 — QA (revisor — não implementa)

### Status atual do projeto

| Categoria | Total | Corrigidos | Abertos |
|-----------|-------|------------|---------|
| Bugs | 16 | 9 | 7 |
| Vulnerabilidades | 18 | 8 | 10 |

### O que revisar quando os agentes terminarem
- Ler `docs/changelog.md` e confirmar que cada item foi documentado
- Ler `reports/bugs_found.md` e `reports/security_report.md` e confirmar status atualizados
- Verificar que nenhum agente tocou em arquivo fora do seu domínio
- Aprovar deploy apenas após revisão completa

---

## Status geral

| Agente | Status | Última ação |
|--------|--------|-------------|
| Agente 1 — Backend | ⏳ Rodada 4 em andamento | Ver seção Rodada 4 abaixo |
| Agente 2 — Frontend | ✅ Rodada 4 concluída | skeleton, impressão direta, projeção, backup DB, por escritório |
| Agente 3 — DevOps | ⏳ Rodada 3 em andamento | Ver seção Rodada 4 abaixo |
| Agente 4 — QA | ✅ Aguardando rodada 4 | Aprovar deploy após todos terminarem |
| Agente 5 — Analytics | ✅ Rodada 1 concluída | aba Analytics (top 5, ticket médio), bug fix inadimplência |
| Agente 6 — Integrações | ✅ Rodada 1 concluída | SMTP (email-inadimplência + recibo por email), Gov.br melhorias, WhatsApp docs |
| **Deploy** | ✅ Em produção | commit `324e5fd` |

---

## RODADA 3 — Novas funcionalidades

---

## AGENTE 1 — BACKEND — Rodada 3

### Features a implementar

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Relatório de inadimplência | Endpoint `GET /api/relatorios/inadimplencia` — retorna clientes com parcelas atrasadas, valor total em aberto e dias de atraso por parcela | 🔴 Alta |
| Campo `nome_completo` nos usuários | Adicionar coluna `nome_completo` na tabela `users` do Neon (migração automática no startup). Retornar em `GET /api/me`. Usar em `emitido_por` no lugar de `username` | 🔴 Alta |
| Histórico de edições de recibo | Em `PUT /api/recibos/:id`, salvar array `historico_edicoes[]` no documento NeDB com campos: `data`, `editado_por`, `campos_alterados` (diff dos campos que mudaram) | 🟡 Média |
| Paginação no histórico | `GET /api/recibos` aceitar query params `?page=1&limit=50`. Retornar `{ recibos, total, pagina, totalPaginas }` | 🟡 Média |
| Exportar recibos em lote (ZIP) | `POST /api/recibos/exportar-zip` recebe array de IDs, gera PDFs em memória e retorna um ZIP. Usar `archiver` ou `jszip` | 🔵 Baixa |

### Regras obrigatórias
- Só mexa em `web/server.js`
- Todo endpoint novo: `auth` + middleware de role adequado
- Após terminar: atualizar `reports/bugs_found.md`, `reports/security_report.md` e `docs/changelog.md`

---

## AGENTE 2 — FRONTEND — Rodada 3

### Features a implementar

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Tela de inadimplência | Nova aba no painel admin: tabela com clientes inadimplentes (nome, parcelas atrasadas, valor em aberto, dias de atraso). Chamar `GET /api/relatorios/inadimplencia` | 🔴 Alta |
| Notificação de parcelas vencendo | Ao iniciar o app (`iniciarApp()`), verificar se há parcelas com `data_vencimento` nos próximos 7 dias. Exibir toast: "X parcela(s) vencem nos próximos 7 dias." com link para a tela de clientes | 🔴 Alta |
| Auto-fill "Emitido por" com nome completo | Usar `me.nome_completo` em vez de `me.username` no preenchimento automático de "Emitido por" (quando Backend entregar o campo) | 🔴 Alta |
| Histórico de edições no modal de detalhe | No modal de detalhe do recibo, exibir seção "Histórico de edições" com data, quem editou e o que mudou (quando Backend entregar `historico_edicoes`) | 🟡 Média |
| Seleção múltipla + exportar ZIP | No histórico, checkbox em cada linha para selecionar recibos. Botão "Exportar selecionados (ZIP)" que chama `POST /api/recibos/exportar-zip` | 🟡 Média |
| Busca global | Campo de busca no topo da sidebar que filtra recibos e clientes simultaneamente. Ao digitar, exibe dropdown com resultados agrupados | 🔵 Baixa |
| Atalhos de teclado | `Ctrl+N` abre formulário de novo recibo, `Ctrl+H` vai para histórico, `Ctrl+K` foca na busca global | 🔵 Baixa |

### Regras obrigatórias
- Só mexa em `web/public/app.js`, `index.html` e `style.css`
- Features que dependem de endpoint novo do Backend: implementar o lado frontend mas exibir "Em breve" se o endpoint não existir ainda
- Toda operação assíncrona: `btn.disabled = true` + `try/finally`
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 3 — DEVOPS — Rodada 3

### Tarefas

| Tarefa | Descrição |
|--------|-----------|
| Dependência `archiver` ou `jszip` | Adicionar `archiver` em `web/package.json` para suportar exportação ZIP (Backend vai precisar) |
| Verificar SEC-018 manualmente | AWS Console → EC2 → Security Groups → [SG do EB] → Inbound rules → porta 8080 → Source deve ser o SG do Load Balancer, não `0.0.0.0/0` |
| Monitorar tamanho do NeDB | Verificar tamanho atual de `web/data/recibos.db` e `web/data/clientes.db` no servidor. Se > 50MB, considerar compactação manual |

### Regras obrigatórias
- Não toque em `server.js`, `app.js` ou `index.html`
- Após terminar: atualizar `docs/changelog.md`
