# Log de Alterações — Araujo Prev

> Registro de tudo que foi pensado, decidido e alterado no projeto.
> Formato: data → raciocínio → o que foi feito.

---

## 2026-04-01

### Levantamento inicial de features
**Solicitado por:** Carlo  
**Raciocínio:** Antes de implementar qualquer coisa, explorei a estrutura do projeto para entender o que já existe e o que é viável.  
**Descobertas:**
- Stack: Node.js + Express + NeDB + docx + xlsx + Electron
- Recibos gerados como `.docx` via rota `POST /api/gerar-recibo` em `web/server.js`
- Lib `xlsx` já instalada — exportação Excel já tem base
- Relatório Excel existente em `GET /api/relatorio-excel` — pode ser reutilizado

**Features levantadas:**
1. Exportação automática para Excel ao gerar recibo
2. Assinatura digital para pessoal que sai de carro

**Pendente:** Carlo vai passar o formato da planilha Excel e confirmar o caso de uso da assinatura.

---

### Criação de arquivos de organização
**Raciocínio:** Carlo sugeriu manter um arquivo de contexto dentro do projeto para não perder o fio da conversa entre sessões.  
**Alterações:**
- Criado `PLANEJAMENTO.md` — visão geral do sistema, features planejadas, perguntas pendentes
- Criado `LOG.md` (este arquivo) — registro de raciocínio e alterações a partir de agora

---

---

## 2026-04-01 — Responsividade Mobile

**Solicitado por:** Carlo  
**Raciocínio:** O app tinha apenas um breakpoint em 768px com vários problemas: fontes pequenas demais, tabelas sem scroll horizontal, área de toque dos botões insuficiente para dedos, dashboard com 2 colunas em telas de 375px, e nenhum breakpoint para celulares pequenos.  
**Arquivo alterado:** `web/public/index.html` — bloco `/* ── MOBILE ── */`

**O que foi corrigido:**
- Fonte base aumentada para 14px no mobile (era 13px)
- Inputs e selects: padding 13px, fonte 15px (mínimo legível no celular)
- Botões: `min-height: 44px` (padrão Apple de área de toque)
- Labels: aumentadas para 11px
- Tabelas: wrapper com `overflow-x: auto` + `min-width: 500px` — agora têm scroll horizontal em vez de quebrar
- `cards-grid` (dashboard): continua 2 colunas no tablet, mas desce para 1 coluna em telas ≤480px
- Scrollbar da nav horizontal escondida (mais limpo)
- Toast reposicionado para ocupar largura total no mobile
- Adicionado breakpoint extra `@media(max-width:480px)` para celulares pequenos (iPhone SE, Galaxy S)
- Abas admin com `flex:1` para ocupar largura total no mobile
- `topbar-badge` escondido em telas muito pequenas (economiza espaço)

_Próxima entrada será adicionada aqui quando houver nova alteração._
