# Briefing dos Agentes — Araujo Prev Recibos

**Última atualização:** 2026-05-28 — Rodada 6 planejada

> Leia este arquivo ao iniciar sua sessão. Ele define o que cada agente deve fazer agora.
> Após concluir cada item, atualize o status aqui e em `bugs_found.md` / `security_report.md`.

---

## Status geral

| Agente | Status | Última ação |
|--------|--------|-------------|
| Agente 1 — Backend | 🆕 Rodada 6 aguardando | cron lembretes, recibos recorrentes, audit log, paginação cursor |
| Agente 2 — Frontend | 🆕 Rodada 6 aguardando | calendário vencimentos, linha do tempo cliente, pesquisa global, paginação histórico |
| Agente 3 — DevOps | 🆕 Rodada 6 aguardando | backup S3 automático, node-cron, renovação presigned URLs |
| Agente 4 — QA | 🆕 Aguardando | Revisar após Rodada 6 |
| Agente 5 — Analytics | 🆕 Rodada 6 aguardando | gráfico comparativo multi-ano, DRE simplificado, exportar analytics PDF |
| Agente 6 — Integrações | 🆕 Rodada 6 aguardando | fix email recibo (404), lembrete WhatsApp API, renovar presigned URLs |
| **Deploy** | ✅ Em produção | commit `7c64675` — dashboard select ano |

---

## RODADA 5 — Novas features (2026-05-28)

---

## AGENTE 1 — BACKEND — Rodada 5

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| `GET /api/relatorios/por-responsavel` | Agrupa recibos por `responsavel` (quem emitiu). Retorna `[{ responsavel, total_recibos, receita_total, ticket_medio }]` ordenado por receita desc. Role: `financeiroOnly` | 🔴 Alta |
| `GET /api/relatorios/resumo-mes` | Retorna KPIs para o dashboard home: receita do mês atual, receita do mês anterior, variação percentual, quantidade de recibos do mês, clientes novos do mês, total de clientes inadimplentes. Sem parâmetros. Role: `auth` | 🔴 Alta |
| `PATCH /api/clientes/:id/observacao` | Adiciona uma observação livre ao cliente. Body: `{ texto }`. Mantém array `observacoes[]` com `{ texto, data, autor }`. Role: `financeiroOnly` | 🟡 Média |
| `GET /api/relatorios/formas-pagamento` | Contagem e receita total por `forma_pagamento` (PIX, dinheiro, boleto etc). Role: `financeiroOnly`. Útil para gráfico de pizza | 🟡 Média |
| `POST /api/clientes/:id/parcela/:num/lembrete` | Registra que um lembrete foi enviado para a parcela (`lembrete_enviado_em: timestamp`). Atualiza NeDB. Role: `financeiroOnly` | 🔵 Baixa |

### Regras
- Só mexa em `web/server.js`
- Todo endpoint novo: `auth` + role adequado
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 2 — FRONTEND — Rodada 5

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Dashboard home com KPIs de comparação | Adicionar ao dashboard principal: card "Variação mês" com percentual (verde/vermelho), card "Clientes inadimplentes" com contagem, card "Parcelas vencendo em 7 dias" com contagem. Chamar `GET /api/relatorios/resumo-mes` ao carregar o dashboard | 🔴 Alta |
| Campo email no formulário de recibo | Adicionar campo opcional "E-mail do cliente" no formulário de geração de recibo. Após gerar recibo com sucesso, se email preenchido, mostrar botão "Enviar por e-mail" que chama `POST /api/notificacoes/enviar-recibo-email` | 🔴 Alta |
| Link WhatsApp no telefone do cliente | No card do cliente e no modal de detalhe do cliente, transformar o campo `telefone` em link `https://wa.me/55{telefone_limpo}` que abre o WhatsApp com mensagem pré-formatada: "Olá {nome}, segue o contato do escritório Araujo Prev." | 🔴 Alta |
| Filtros avançados no histórico | Adicionar filtros no histórico de recibos além de ano/mês: por `escritorio`, `forma_pagamento`, `responsavel`, e range de valor (mínimo/máximo). Filtros ficam em um painel colapsável "Filtros avançados" | 🟡 Média |
| Aba "Por Responsável" no painel admin | Nova aba usando `GET /api/relatorios/por-responsavel` — tabela com nome, total de recibos, receita total, ticket médio. Barra de progresso proporcional à receita | 🟡 Média |
| Observações no modal do cliente | Campo de texto livre no modal de edição do cliente + botão "Adicionar observação". Lista de observações anteriores exibida no modal de detalhe. Usa `PATCH /api/clientes/:id/observacao` | 🟡 Média |
| Gráfico de pizza formas de pagamento | No painel admin (aba Analytics ou nova aba), gráfico de pizza com distribuição de formas de pagamento. Usa `GET /api/relatorios/formas-pagamento` | 🔵 Baixa |

### Regras
- Só mexa em `web/public/app.js`, `index.html` e `style.css`
- Link WhatsApp: limpar telefone de máscaras (`(`, `)`, `-`, ` `) antes de montar a URL
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 5 — ANALYTICS — Rodada 2

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Exportar Analytics em Excel (XLSX) | Botão "Exportar Excel" na aba Analytics — gera planilha com 3 abas: "Ranking clientes", "Receita mensal", "Por escritório". Usar biblioteca `xlsx` (já pode adicionar em package.json) | 🔴 Alta |
| Aba "Por Responsável" no painel admin | Consumir `GET /api/relatorios/por-responsavel` e exibir: tabela ranqueada com receita por responsável + gráfico de barras horizontal. Barra de progresso proporcional ao maior valor | 🔴 Alta |
| Gráfico de pizza formas de pagamento | Nova aba ou seção no Analytics: gráfico de pizza com `GET /api/relatorios/formas-pagamento`. Chart.js type `doughnut`. Mostrar percentual e valor total por forma | 🟡 Média |
| Filtro de período no gráfico mensal | No gráfico de receita mensal do Analytics, além do filtro de ano, adicionar seletor de mês inicial e final para ver períodos personalizados (ex: Mar–Jun/2026) | 🟡 Média |

### Regras
- Pode tocar em `server.js` E `app.js/index.html`
- Para export Excel: adicionar `xlsx` ou `exceljs` em `web/package.json`
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 6 — INTEGRAÇÕES — Rodada 2

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Lembrete automático de parcelas por email | No startup do servidor (após `initDb()`), verificar parcelas com `data_vencimento` nos próximos 3 dias que ainda não tiveram lembrete enviado (`lembrete_enviado_em` ausente). Para cada uma, enviar email ao `SMTP_ADMIN` com nome do cliente, valor e data. Registrar envio via `PATCH /api/clientes/:id/parcela/:num/lembrete`. Só executa se SMTP configurado | 🔴 Alta |
| Botão "Enviar lembrete WhatsApp" no cliente | No modal de detalhe do cliente, para cada parcela pendente/atrasada, botão "Lembrete WhatsApp" que abre `https://wa.me/55{telefone}?text=...` com mensagem pré-formatada incluindo nome, valor e data de vencimento. Não requer API — é link direto | 🔴 Alta |
| Gov.br — página de erro amigável | Ao falhar o callback Gov.br, redirecionar para `/govbr-erro.html` com mensagem clara em PT-BR e botão "Tentar novamente". Criar o HTML estático em `web/public/` | 🟡 Média |
| Webhook de recibo gerado (opcional) | `POST /api/webhooks/recibo-gerado` — ao gerar recibo, se variável `WEBHOOK_URL` estiver configurada, fazer POST para ela com dados do recibo (name, value, date, client). Útil para integrações futuras (Zapier, n8n) | 🔵 Baixa |

### Regras
- Só mexa em `server.js` para endpoints, `public/` para páginas estáticas
- Lembrete automático: usar `setTimeout` de 30s após startup para não bloquear inicialização
- Após terminar: atualizar `docs/changelog.md`

---

## Ordem de execução sugerida (Rodada 5)
1. **Agente 1** (endpoints novos) — desbloqueia Agentes 2 e 5
2. **Agentes 2, 5 e 6** em paralelo (podem iniciar com endpoints já existentes)
3. **Agente 4 (QA)** — revisão e deploy após todos terminarem

---

## RODADA 6 — Qualidade, automação e UX (2026-05-28)

> Foco desta rodada: corrigir bugs críticos, automatizar processos manuais e melhorar a experiência de uso no dia a dia.

---

## AGENTE 1 — BACKEND — Rodada 6

### Bugs críticos (obrigatório)

| Bug | Descrição | Arquivo |
|-----|-----------|---------|
| Lembrete de parcelas não recorrente | `setTimeout` de 30s roda só no startup. Substituir por `node-cron` para executar todo dia às 8h. Adicionar `node-cron` ao `package.json`. Lógica já existe — só mudar o gatilho | `server.js` |
| Paginação por cursor | `GET /api/recibos?limit=5000` carrega tudo de uma vez. Implementar paginação por cursor: `?cursor=<_id>&limit=50` retornando `{ recibos, nextCursor }`. Manter compatibilidade com `?limit=5000` para o script de importação | `server.js` |

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| `POST /api/recibos/:id/recorrente` | Cria um novo recibo baseado em um existente, incrementando mês na data e na referência automaticamente. Body: `{ data, referencia }` (opcionais — override do auto-calculado). Role: `financeiroOnly` | 🔴 Alta |
| `GET /api/admin/audit-log` | Retorna as últimas 500 entradas do log de auditoria (`auditoria.db`). Filtros: `?usuario=&acao=&de=&ate=`. Role: `adminOnly` | 🟡 Média |
| Middleware de auditoria | Criar função `registrarAuditoria(req, acao, dados)` chamada nos endpoints críticos: criar/editar/excluir recibo, pagar parcela, deletar cliente, criar/excluir usuário. Salva em `auditoria.db`: `{ ts, usuario, role, acao, entidade_id, dados_antes, dados_depois }` | 🟡 Média |
| `GET /api/relatorios/comparativo-anos` | Retorna receita mensal agrupada por ano: `{ ano, meses: [{ mes, receita, qtd }] }`. Todos os anos disponíveis no banco. Sem parâmetros. Role: `semRecepcao` | 🟡 Média |
| `GET /api/relatorios/dre` | DRE simplificado: por mês do ano selecionado — receita bruta, ticket médio, variação MoM, acumulado do ano. Parâmetro: `?ano=`. Role: `semRecepcao` | 🔵 Baixa |

### Regras
- Só mexa em `web/server.js` e `web/package.json`
- `node-cron`: usar expressão `'0 8 * * *'` (todo dia às 8h no fuso de São Paulo)
- Auditoria: nunca logar senha, token ou CPF completo (mascarar: `***.***.*00-**`)
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 2 — FRONTEND — Rodada 6

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Calendário de vencimentos | Nova aba no painel admin "Calendário". Grid de dias do mês atual mostrando quantas parcelas vencem em cada dia (badge numérico no dia). Clicar no dia lista os clientes. Usar CSS grid puro (sem lib externa). Dados: filtrar `listaClientes` localmente | 🔴 Alta |
| Pesquisa global (Ctrl+K) | Atalho `Ctrl+K` abre modal de busca flutuante. Digitar nome ou CPF mostra resultados de clientes E recibos simultaneamente (max 5 cada). Clicar no resultado navega para a tela correta e abre o detalhe. Fechar com Esc | 🔴 Alta |
| Paginação no histórico | O histórico hoje carrega tudo. Implementar paginação: mostrar 50 por vez, botão "Carregar mais" no rodapé da lista. Manter os filtros funcionando sobre os registros já carregados. Usar o endpoint existente com `?limit=50&cursor=` | 🟡 Média |
| Botão "Recibo Recorrente" | No card do histórico e no modal de detalhe, botão "Recorrente" que chama `POST /api/recibos/:id/recorrente` e abre o formulário de geração pré-preenchido com os dados do mês seguinte para revisão antes de confirmar | 🟡 Média |
| Linha do tempo no cliente | No modal de detalhe do cliente, nova aba "Timeline" com lista cronológica de: recibos gerados, parcelas pagas, observações adicionadas, lembretes enviados. Ícone diferente para cada tipo. Ordenado do mais recente para o mais antigo. Dados já disponíveis localmente | 🟡 Média |
| Tela de Auditoria | Nova aba no painel admin "Auditoria" (só admin vê). Tabela: Data/hora, Usuário, Ação, Detalhe. Filtros: por usuário e por tipo de ação. Consumir `GET /api/admin/audit-log` | 🔵 Baixa |

### Regras
- Só mexa em `web/public/app.js`, `index.html` e `style.css`
- Calendário: grid 7 colunas (Dom–Sab), destacar dias com vencimento em vermelho se tiver atrasado, amarelo se vence hoje ou amanhã
- Pesquisa global: debounce de 200ms, não fazer chamada à API — filtrar `historicoRecibos` e `listaClientes` localmente
- Aba Auditoria: esconder do menu se `userRole !== 'admin'`
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 3 — DEVOPS — Rodada 6

### Tarefas

| Tarefa | Descrição | Prioridade |
|--------|-----------|------------|
| Instalar `node-cron` | Adicionar `node-cron ^3.0` em `web/package.json`. Necessário para o cron de lembretes do Agente 1 | 🔴 Alta |
| Backup automático diário para S3 | Script que roda todo dia às 2h (via node-cron): comprime `recibos.db` + `clientes.db` em ZIP com timestamp no nome e envia para o bucket S3 em pasta `/backups/`. Só executa se `BUCKET_NAME` configurado | 🟡 Média |
| Renovação automática de presigned URLs | Script semanal (via node-cron): varre todos os recibos com `link_comprovante` contendo `/api/comprovante-s3/`, extrai o filename e gera nova presigned URL com 30 dias. Atualiza no NeDB e na planilha (via `atualizarNoSheets`). Só executa se S3 configurado | 🟡 Média |
| Documentar variáveis novas | Adicionar em `docs/architecture.md`: variáveis `NODE_CRON_TIMEZONE` (default: `America/Sao_Paulo`) e comportamento do backup automático | 🔵 Baixa |

### Regras
- Só mexa em `web/package.json`, `web/server.js` (seção de inicialização), `docs/architecture.md`
- Crons: usar `node-cron` com timezone `America/Sao_Paulo`
- Backup S3: nome do arquivo `backup-YYYY-MM-DD-HHmm.zip`, pasta `backups/` no bucket
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 5 — ANALYTICS — Rodada 6

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Gráfico comparativo multi-ano | Na aba Analytics, abaixo do gráfico de período atual, novo gráfico de linha sobrepondo os anos disponíveis (2024, 2025, 2026). Cada ano é uma linha de cor diferente. Eixo X = meses (Jan–Dez), Eixo Y = receita. Dados: `GET /api/relatorios/comparativo-anos` | 🔴 Alta |
| DRE simplificado | Nova aba no painel admin "DRE". Tabela por mês do ano selecionado: Mês, Receita Bruta, Qtd Recibos, Ticket Médio, Variação MoM (% e seta), Acumulado do Ano. Rodapé: totais. Botão "Exportar PDF" com cabeçalho do escritório. Consumir `GET /api/relatorios/dre?ano=` | 🔴 Alta |
| Exportar Analytics em PDF | Na aba Analytics, botão "Exportar PDF" que gera relatório com: período selecionado, gráfico de receita (como imagem via `chart.toBase64Image()`), top 5 clientes, resumo do período. Usar `jsPDF` (já disponível no projeto) | 🟡 Média |
| Mapa de calor por dia da semana | Na aba Analytics, tabela de calor (heatmap) mostrando qual dia da semana e horário concentra mais recibos gerados (usa o campo `timestamp` do recibo). Ajuda a entender padrões operacionais | 🔵 Baixa |

### Regras
- Pode tocar em `server.js` (endpoints novos) E `app.js/index.html` (visualizações)
- Gráfico multi-ano: cores fixas por ano (2024=cinza, 2025=dourado, 2026=verde)
- DRE: variação positiva em verde, negativa em vermelho, seta ↑↓
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 6 — INTEGRAÇÕES — Rodada 6

### Bugs críticos (obrigatório)

| Bug | Descrição |
|-----|-----------|
| `POST /api/notificacoes/enviar-recibo-email` retorna 404 | O endpoint está implementado mas retorna status 404 hardcoded. Corrigir para realmente gerar o PDF e enviar por nodemailer. O campo `email` já existe no formulário de geração de recibo. Se SMTP não configurado, retornar erro claro (503) em vez de 404 |

### Features novas

| Feature | Descrição | Prioridade |
|---------|-----------|------------|
| Webhook com retry | O webhook de recibo gerado (`WEBHOOK_URL`) hoje é fire-and-forget. Implementar retry: 3 tentativas com backoff exponencial (1s, 4s, 16s). Logar falhas permanentes com detalhes | 🟡 Média |
| Template de email customizável | As mensagens de email (inadimplência, recibo, lembrete parcela) hoje têm HTML fixo no código. Mover os templates para arquivos `.html` em `web/templates/` e carregar com `fs.readFile`. Substituir variáveis com `replace()`. Facilita customização futura sem mexer no código | 🟡 Média |
| Envio de comprovante por WhatsApp (Z-API) | Se variável `ZAPI_INSTANCE` e `ZAPI_TOKEN` estiverem configuradas, ao gerar recibo com telefone preenchido, oferecer botão "Enviar por WhatsApp" que chama a Z-API para enviar o PDF diretamente. Sem a variável, continua com link wa.me/ | 🔵 Baixa |

### Regras
- Só mexa em `server.js` para endpoints, `web/templates/` para HTMLs de email
- Fix do email: testar com `nodemailer.createTestAccount()` se SMTP não configurado (modo sandbox)
- Templates: criar `web/templates/email-recibo.html`, `email-inadimplencia.html`, `email-lembrete.html`
- Após terminar: atualizar `docs/changelog.md`

---

## AGENTE 4 — QA — Rodada 6

Quando todos os agentes terminarem:
- Verificar que `docs/changelog.md` foi atualizado por todos
- Testar o cron de lembretes manualmente (chamar a função direto, sem esperar 8h)
- Confirmar que `POST /api/notificacoes/enviar-recibo-email` não retorna mais 404
- Testar paginação por cursor no histórico (50 registros, carregar mais)
- Testar pesquisa global (Ctrl+K) com nome e CPF
- Revisar auditoria: criar recibo, editar, deletar — verificar se aparece no log
- Confirmar que nenhum agente tocou fora do seu domínio
- Aprovar deploy após revisão

---

## Ordem de execução sugerida (Rodada 6)
1. **Agente 3** (node-cron no package.json) — desbloqueia Agente 1
2. **Agente 1** (backend: cron, recorrente, auditoria, endpoints) — desbloqueia Agentes 2, 5 e 6
3. **Agentes 2, 5 e 6** em paralelo
4. **Agente 4 (QA)** — revisão e deploy

---

## Histórico de rodadas anteriores

### Rodada 5 (2026-05-28) — Entregue ✅
- Backend: resumo-mes, por-responsavel, formas-pagamento, observações cliente, lembrete parcela
- Frontend: KPIs dashboard, email recibo, links WhatsApp, filtros avançados, aba Por Responsável, observações cliente
- Integrações: lembrete automático parcelas, botão WhatsApp, govbr-erro.html, webhook recibo
- Extras: role precatórios, escritório padronizado (select), normalização histórica, Caixa 2025 importado (1.378 recibos), select ano no dashboard

### Rodada 4 (2026-05-27) — Entregue ✅
- Backend: SEC-012, SEC-014, SEC-017, projeção, por-escritório, backup-db
- Frontend: skeleton, aba Projeção, aba Por Escritório, botão backup
- Analytics: aba Analytics completa, filtro de ano, fix inadimplência
- Integrações: SMTP email-inadimplência + recibo por email, Gov.br melhorias

### Rodada 3 (2026-05-27) — Entregue ✅
- Backend: inadimplência, nome_completo, histórico edições, paginação, ZIP
- Frontend: 7 features (inadimplência, parcelas vencendo, busca global, atalhos, ZIP, histórico, nome_completo)
- DevOps: archiver, nodemailer docs, SMTP vars em architecture.md

### Rodada 2 (2026-05-27) — Entregue ✅
- Backend: soft delete, CPF/CNPJ, status atrasado, SEC-010, BUG-009/012/014
- Frontend: validação CPF/CNPJ, aviso sessão, auto-fill, excluir cliente com confirmação
- DevOps: express-rate-limit

### Rodada 1 (2026-05-25) — Entregue ✅
- 16 bugs corrigidos, 7 vulnerabilidades fechadas
- SEC-008 (rate limit), SEC-009 (magic bytes), SEC-013 (upload 5MB)

---

## AGENTE 4 — QA (revisor — não implementa)

Quando os agentes da Rodada 5 terminarem:
- Verificar `docs/changelog.md` atualizado por todos
- Confirmar domínios respeitados (nenhum agente tocou fora do seu escopo)
- Revisar SEC-011 (JWT localStorage) e SEC-018 (SG porta 8080) — abertas, ação manual
- Aprovar deploy após revisão

---

## Vulnerabilidades abertas remanescentes

| Item | Severidade | Descrição |
|------|-----------|-----------|
| SEC-011 | Média | JWT em localStorage — migração para httpOnly cookie é complexa, adiada |
| SEC-018 | Baixa | Verificar SG do EB bloqueia porta 8080 externamente — ação manual no AWS Console |
