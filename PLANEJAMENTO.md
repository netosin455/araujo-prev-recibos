# Planejamento — Araujo Prev Recibos

> Arquivo de notas de desenvolvimento. Atualizado a cada conversa com Claude.
> Última atualização: 2026-04-01

---

## Visão Geral do Sistema

Sistema de gestão de recibos de honorários advocatícios para A Araujo Serviços Ltda ME.

- **Backend:** Node.js + Express, banco NeDB (arquivo local), JWT auth
- **Frontend:** HTML/CSS/JS vanilla + Electron (app desktop Windows)
- **Documentos gerados:** `.docx` via lib `docx`
- **Deploy:** AWS Elastic Beanstalk, auto-deploy via CodePipeline no push do `main`
- **URL prod:** http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com/
- **Repo GitHub:** netosin455/araujo-prev-recibos

### Papéis de usuário
| Role | Permissões |
|------|-----------|
| admin | tudo, incluindo gestão de usuários |
| financeiro | criar, ler, editar, deletar recibos |
| recepcao | somente leitura |

### Arquivos principais
| Arquivo | Função |
|---------|--------|
| `web/server.js` | Backend principal: rotas, auth, geração de recibo, usuários |
| `web/public/index.html` | Interface web |
| `web/public/app.js` | Lógica frontend web |
| `frontend/main.js` | Electron: janela, geração de recibo via IPC |
| `frontend/renderer.js` | Electron: UI desktop |
| `web/data/` | Bancos NeDB (users.db, recibos.db) |

---

## Features em Planejamento

### 1. Exportar recibo automaticamente para planilha Excel

**Status:** Aguardando Carlo passar o formato da planilha (colunas, ordem)

**Ideia:**
- Ao gerar um recibo (`/api/gerar-recibo`), além de salvar no NeDB, registrar na planilha Excel
- A lib `xlsx` já está instalada no projeto
- O `.docx` gerado pode ser salvo em pasta organizada e referenciado na linha da planilha

**Perguntas pendentes:**
- [ ] Qual o formato/colunas da planilha? (Carlo vai passar o modelo)
- [ ] A planilha fica local (no servidor / no PC) ou precisa ir pra algum lugar (Google Sheets, OneDrive)?
- [ ] Quer o arquivo `.docx` como anexo na célula ou só o caminho/link?

---

### 2. Assinatura Digital

**Status:** Aguardando Carlo confirmar o caso de uso

**Contexto:** Pessoas que saem de carro pela firma precisam assinar algum documento.

**Opções levantadas:**
- **Opção A — Assinatura simples** (rápida): canvas no app, assina com dedo/mouse, imagem inserida no `.docx`. Sem valor jurídico formal. Ideal pra uso interno.
- **Opção B — Assinatura com validade jurídica**: integração com ClickSign (BR) ou DocuSign. Tem custo mensal. Retorna certificado.

**Perguntas pendentes:**
- [ ] O que precisa ser assinado? O recibo de honorários ou outro documento (ex: vale-transporte, autorização de saída)?
- [ ] Precisa ter validade jurídica ou é só pra controle interno?
- [ ] Quem assina — o cliente, o funcionário, ou ambos?

---

## Histórico de Decisões

| Data | Decisão | Motivo |
|------|---------|--------|
| 2026-04-01 | Levantamento de features: Excel + assinatura digital | Solicitado por Carlo |

---

## Notas Técnicas

- A geração de recibo acontece em `web/server.js` na rota `POST /api/gerar-recibo`
- O relatório Excel existente está em `GET /api/relatorio-excel` — pode servir de base para a feature de exportação automática
- O Electron tem acesso ao filesystem local — útil pra salvar `.docx` organizado por pasta/data
