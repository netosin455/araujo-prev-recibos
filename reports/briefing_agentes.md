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
| Agente 1 — Backend | ✅ Rodada 1 concluída | BUG-006, BUG-008, SEC-008, SEC-009, SEC-013 |
| Agente 2 — Frontend | ✅ Rodada 1 concluída | BUG-007, BUG-010, BUG-011 |
| Agente 3 — DevOps | ✅ Rodada 1 concluída | express-rate-limit, architecture.md |
| Agente 4 — QA | ✅ Auditoria completa | bugs_found.md, security_report.md, briefing_agentes.md |
| **Deploy** | ✅ Em produção | commit `5376587` |
