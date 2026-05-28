# Briefing dos Agentes — Araujo Prev Recibos

**Última atualização:** 2026-05-28 — Agente 4 (QA)

> Leia este arquivo ao iniciar sua sessão. Ele define o que cada agente deve fazer agora.
> Após concluir cada item, atualize o status aqui e em `bugs_found.md` / `security_report.md`.

---

## Status geral

| Agente | Status | Última ação |
|--------|--------|-------------|
| Agente 1 — Backend | 🆕 Rodada 5 aguardando | Ver seção abaixo |
| Agente 2 — Frontend | 🆕 Rodada 5 aguardando | Ver seção abaixo |
| Agente 3 — DevOps | ✅ Rodada 3 concluída | SMTP docs, nodemailer, NeDB monitoring |
| Agente 4 — QA | ✅ Revisão R4 concluída | commit 4181e60 — deploy ok |
| Agente 5 — Analytics | 🆕 Rodada 2 aguardando | Ver seção abaixo |
| Agente 6 — Integrações | 🆕 Rodada 2 aguardando | Ver seção abaixo |
| **Deploy** | ✅ Em produção | commit `4181e60` |

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

## Histórico de rodadas anteriores

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
