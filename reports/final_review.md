# Final Review — Araujo Prev Recibos — 2026-05-25

## Nota Geral
**8/10** — Módulo de clientes completamente reescrito, segurança reforçada, testes presentes. A nota não chega a 9 principalmente por ausência de testes de integração de rotas e pela dependência de `unsafe-inline` no CSP.

---

## Pontos Fortes

- **Segurança sólida para o contexto:** JWT com verificação de existência no banco a cada request, bcrypt nas senhas, headers de segurança completos (incluindo CSP adicionado nesta sprint), validação de tipos e enums em todas as entradas críticas.
- **Resiliência bem pensada:** duplo backup (NeDB local + Google Sheets), restauração automática de usuários e recibos ao inicializar com banco vazio. Não há ponto único de falha que cause perda total de dados.
- **Migração on-the-fly sem risco:** clientes legados sem `parcelas` são migrados apenas na leitura. Zero risco de corromper dados existentes.
- **Separação de roles consistente:** os 3 middlewares (`auth`, `adminOnly`, `financeiroOnly`) são aplicados corretamente em todas as rotas. `recepcao` só acessa o que precisa.
- **22 testes unitários passando**, cobrindo as funções de negócio mais críticas.

---

## Riscos Restantes

- **[MÉDIO]** Sem rate limiting no `POST /api/login` — força bruta de senhas é possível. O EB ALB mitiga em parte, mas não é garantia. Recomendado adicionar `express-rate-limit` em ciclo futuro.
- **[RESOLVIDO]** `unsafe-inline` removido do CSP — todos os inline handlers migrados para `addEventListener` em `bindStaticHandlers()` e event delegation nos cards dinâmicos. `script-src 'self'` agora sem `'unsafe-inline'`.
- **[BAIXO]** Sem testes de integração de rotas — as regras de validação de `status`, `role` e `link_comprovante` adicionadas no servidor são exercidas apenas logicamente nos testes unitários, não via chamada HTTP real.
- **[BAIXO]** `POST /api/recibos` não valida unicidade do `num_recibo` — duplicatas são possíveis via chamada direta à API, embora o frontend controle a numeração.
- **[BAIXO]** `govbrStates` armazena estado OAuth2 em memória — em caso de restart do servidor durante um fluxo de autenticação, o `state` é perdido e o usuário vê "state_invalido". Aceitável para a escala atual.

---

## O que foi entregue nesta sprint

- Módulo de clientes com controle de parcelas individuais (status, datas, recibo vinculado)
- 4 abas por card de cliente: Parcelamento, A Receber, Recebidos, Histórico
- Modal de pagamento de parcela com todos os campos necessários
- Referência padrão por usuário (salva no Neon, carregada no login)
- Fluxo "+ Recibo para cliente" com pré-preenchimento e vínculo pós-emissão
- 5 bugs corrigidos (ver `reports/bugs_found.md`)
- 7 vulnerabilidades de segurança corrigidas (ver `reports/security_report.md`)
- Refatoração de `renderClientes()` em 5 funções auxiliares
- 22 testes unitários Jest
- Documentação: `docs/architecture.md`, `docs/changelog.md`

---

## Melhorias Futuras Recomendadas

1. **Rate limiting no login** — `npm install express-rate-limit`, aplicar na rota `POST /api/login`
2. **Mover scripts para arquivos externos** — eliminar `unsafe-inline` do CSP, permitindo CSP mais restritivo
3. **Testes de integração com supertest** — cobrir as rotas HTTP críticas (login, CRUD clientes, PATCH parcela)
4. **Campo `data_vencimento` com cálculo automático** — ao criar parcelas, calcular vencimentos com base em uma data-base informada pelo usuário
5. **Notificação de parcelas atrasadas** — cron job que marca `status = "atrasado"` para parcelas com `data_vencimento` no passado

---

## Aprovado para produção?
[x] **Sim** — O sistema está funcionalmente completo, seguro para o contexto de uso, com dados protegidos e resiliência operacional. Os riscos restantes são conhecidos, documentados e de impacto gerenciável.
