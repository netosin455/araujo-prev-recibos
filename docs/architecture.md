# Arquitetura — Araujo Prev Recibos

**Última atualização:** 2026-05-27

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express |
| Frontend | HTML + CSS + JavaScript vanilla (sem frameworks) |
| Banco de dados de usuários | Neon (PostgreSQL gerenciado) |
| Banco de dados de recibos/clientes | NeDB (arquivo local no servidor) |
| Hospedagem | AWS Elastic Beanstalk |
| Armazenamento de arquivos | AWS S3 (comprovantes) com fallback local |
| Integração de planilha | Google Sheets API v4 |
| Geração de documentos | `docx` (Word) + `pdfkit` (PDF) |
| Assinatura digital | Gov.br OAuth2 |
| Testes | Jest |

---

## Arquivos principais

```
web/
├── server.js          — Backend completo (Express, rotas, banco de dados, geração de doc)
└── public/
    ├── index.html     — SPA com todos os modais e telas
    ├── app.js         — Toda a lógica do frontend
    └── style.css      — Design system com CSS variables
```

---

## Fluxo de dados — Geração de recibo

```
Usuário preenche formulário
    → app.js: gerarRecibo()
    → POST /api/recibos (salva no NeDB)
    → POST /api/gerar-recibo (gera DOCX/PDF)
    → registrarNoSheets() [assíncrono, sem bloquear resposta]
    → Frontend baixa o documento
```

## Fluxo de dados — Parcelas de cliente

```
Cadastro de cliente
    → POST /api/clientes
    → server.js: gerarParcelas(num, valor) → array de parcelas
    → recalcularResumo(parcelas) → totais
    → Salvo no NeDB (clientes.db)

Registrar pagamento
    → app.js: confirmarPagamentoParcela()
    → PATCH /api/clientes/:id/parcela/:num
    → server.js: whitelist de campos aceitos
    → recalcularResumo(parcelas atualizadas)
    → NeDB atualizado

Clientes antigos (sem campo parcelas)
    → GET /api/clientes retorna cliente
    → server.js: inicializarParcelasLegado() reconstrói array on-the-fly
    → Baseado em parcelas_pagas (count) para marcar quais são "pago"
    → Não persiste no banco — apenas enriquece a resposta
```

---

## Autenticação e autorização

- JWT com expiração de 8 horas, armazenado em `localStorage`
- Middleware `auth`: verifica token + confirma que o usuário ainda existe no Neon
- Middleware `adminOnly`: restringe a `username === ADMIN_USER`
- Middleware `financeiroOnly`: bloqueia role `recepcao`
- Roles disponíveis: `admin`, `financeiro`, `recepcao`

---

## Banco de dados

### Neon (PostgreSQL) — tabela `users`
```sql
id              TEXT PRIMARY KEY
username        TEXT UNIQUE NOT NULL
password        TEXT NOT NULL          -- bcrypt hash
role            TEXT NOT NULL DEFAULT 'financeiro'
escritorio      TEXT NOT NULL DEFAULT ''
referencia_padrao TEXT DEFAULT ''
created_at      TEXT NOT NULL
```

### NeDB (arquivos locais)
- `web/data/recibos.db` — todos os recibos emitidos
- `web/data/clientes.db` — cadastro de clientes com controle de parcelas
- Compactados automaticamente pelo NeDB

---

## Resiliência e backup

- Recibos são espelhados no Google Sheets na emissão (fallback de recuperação)
- Usuários são sincronizados para uma aba do Sheets a cada mudança
- Se o banco Neon for resetado, `initDb()` detecta banco vazio e restaura usuários do Sheets
- Se `recibos.db` for apagado, `sincronizarDeSheets()` recria todos os recibos ao iniciar

**Fluxo de reescrita da planilha (`/api/admin/reescrever-planilha`):**
1. Monta todas as linhas em memória (sem gerar URLs presigned — evita timeout)
2. Obtém `sheetId` e `rowCount` via `spreadsheets.get`
3. Deleta fisicamente as linhas extras com `deleteDimension` (mantém 1 não-congelada — exigência do Sheets)
4. Limpa valores remanescentes com `values.clear`
5. Escreve todos os recibos com `values.update` a partir de A4

---

## Decisões arquiteturais

**Por que NeDB em vez de PostgreSQL para recibos e clientes?**
NeDB é um arquivo local no servidor EB. O Neon (Postgres gerenciado) tem latência de rede a cada operação e é usado para usuários (dados pequenos, críticos para auth). Recibos e clientes são lidos/escritos com alta frequência; NeDB evita latência. O Google Sheets é o backup de recuperação.

**Por que SPA sem framework JS?**
O cliente explicitamente pediu sem frameworks novos. O projeto é pequeno o suficiente para gerenciar manualmente o DOM. Adicionar React/Vue introduziria custo de build e curva de manutenção para um time sem experiência com eles.

**Por que `parcelas` como array dentro do documento do cliente?**
NeDB não tem JOINs. Guardar as parcelas embutidas no documento do cliente mantém a leitura como uma operação atômica e evita a necessidade de múltiplos `find()` por requisição.

**Por que migração on-the-fly (sem salvar) para clientes legados?**
Clientes antigos não têm campo `parcelas`. Forçar uma migração de banco no startup seria arriscado (pode falhar, bloqueando o servidor). A migração on-the-fly via `inicializarParcelasLegado()` é segura e reversível.
