# Log de Alterações — Araujo Prev

> Registro de tudo que foi pensado, decidido e alterado no projeto.
> Formato: data → raciocínio → o que foi feito.

---

## 2026-04-05

### Proteção contra perda de dados após troca de servidor (AWS)
**Problema:** Quando o Elastic Beanstalk substitui a instância EC2 (health check, scaling, update de plataforma), os arquivos NeDB são apagados. Deploys normais de código não causam isso, mas eventos de infraestrutura sim.  
**Solução implementada em `web/server.js`:**

1. **Usuários persistentes via `USERS_JSON`:** Todos os usuários não-admin podem ser definidos como variável de ambiente no EB. A cada startup, o servidor garante que existam. Formato: array JSON base64 com `[{username, password, role}]`.

2. **Restauração automática de recibos da planilha:** Função `sincronizarDeSheets()` executada no startup. Se `recibos.db` estiver vazio, importa todos os registros do Google Sheets automaticamente. O número do recibo agora também é gravado na coluna M da planilha (antes só salvava até L).

**Próximo passo obrigatório:** Adicionar `USERS_JSON` no Elastic Beanstalk com os usuários existentes.

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

---

## 2026-04-01 — Correção: carregamento infinito no celular

**Problema relatado:** App travava carregando infinitamente no celular.  
**Raciocínio:** O servidor respondia normalmente (200 OK em 0.5s), então não era problema de servidor. A causa era o `<link>` do Google Fonts sem `preload` — o navegador mobile bloqueava toda a renderização da página esperando as fontes carregarem. Em redes móveis lentas isso trava a tela indefinidamente.  
**Arquivo alterado:** `web/public/index.html` — bloco de importação de fontes no `<head>`

**O que foi feito:**
- Adicionado `<link rel="preconnect">` para `fonts.googleapis.com` e `fonts.gstatic.com`
- Fonte carregada com `rel="preload" as="style"` + `onload` — não bloqueia mais a renderização
- Adicionado `<noscript>` fallback para navegadores sem JavaScript

---

## 2026-04-01 — Integração Google Sheets

**Solicitado por:** Carlo  
**Raciocínio:** Ao gerar um recibo, o sistema deve automaticamente registrar uma linha na planilha "Caixa Araújo Prev 2026". Usamos conta de serviço do Google Cloud (projeto sunny-advantage-468503-m4) para autenticação server-to-server, sem precisar de login manual.

**Segurança:** Credenciais armazenadas como variável de ambiente `GOOGLE_CREDENTIALS` em base64 — nunca no código ou no repositório. O arquivo `.env` já estava no `.gitignore`.

**Arquivos alterados:**
- `web/server.js` — adicionado `getSheetsClient()`, `registrarNoSheets()` no topo, e chamada em `POST /api/recibos`
- `web/package.json` — `googleapis` adicionado como dependência
- `web/.env` — `GOOGLE_CREDENTIALS` adicionado (não vai para o GitHub)

**Mapeamento de colunas (planilha → campo do recibo):**
| Coluna da planilha | Campo usado |
|---|---|
| Carimbo de data/hora | data/hora atual |
| Nome completo do cliente | dados.nome |
| CPF do cliente | dados.cpf |
| Valor pago | dados.valor |
| Data do pagamento | data atual |
| Data do depósito | data atual |
| Forma de pagamento | vazio (não coletado no recibo) |
| Motivo de pagamento | dados.complemento ou "Honorários Advocatícios" |
| Escritório | dados.municipio_uf |
| Observação | dados.referencia |
| Anexo comprovante | vazio |
| Mês | mês atual em português |

**Pendente:** Configurar `GOOGLE_CREDENTIALS` no Elastic Beanstalk (AWS) para funcionar em produção.

---

## 2026-04-01 — Fix 502: googleapis faltando no deploy AWS

**Problema:** 502 Bad Gateway após deploy da integração Google Sheets.  
**Raciocínio:** O AWS Elastic Beanstalk roda `npm install` usando o `package.json` da **raiz** do repositório, não o `web/package.json`. O `googleapis` havia sido adicionado apenas no `web/package.json`, então não era instalado em produção e o servidor crashava ao iniciar.  
**Arquivo alterado:** `package.json` (raiz) — adicionado `"googleapis": "^171.4.0"` nas dependências.

---

## 2026-04-01 — Novos campos: Forma de Pagamento e Escritório

**Solicitado por:** Carlo  
**Raciocínio:** A planilha "Caixa Araújo Prev 2026" tem colunas de Forma de Pagamento e Escritório que não eram coletadas no formulário. Sem esses campos, as colunas ficavam vazias na planilha.

**Arquivos alterados:**
- `web/public/index.html` — adicionados dois `<select>` no formulário de recibo: Forma de Pagamento e Escritório
- `web/public/app.js` — coleta os novos campos em `gerarRecibo()`, envia para `/api/recibos`, limpa em `limparCampos()`, preenche em `editarRecibo()`
- `web/server.js` — salva `forma_pagamento` e `escritorio` no NeDB; envia para `registrarNoSheets()` corretamente

**Mapeamento corrigido:**
- Coluna "Forma de pagamento" → `dados.forma_pagamento` (antes estava vazio)
- Coluna "Escritório" → `dados.escritorio` (antes usava município do cliente — errado)

**Escritórios disponíveis no select:**
- Terra Rica - PR
- Presidente Venceslau - SP
- Paranavaí - PR

---

## 2026-04-01 — Escritório: select → input livre

**Solicitado por:** Carlo  
**Raciocínio:** Melhor deixar quem emite digitar o escritório livremente do que forçar uma lista fixa.  
**Arquivo alterado:** `web/public/index.html` — campo `escritorio` trocado de `<select>` para `<input type="text">`.

---

## 2026-04-01 — Fix: campos novos incluídos no PUT (edição de recibo)

**Raciocínio:** Ao conferir o mapeamento completo das colunas, notei que o `PUT /api/recibos/:id` não incluía `forma_pagamento` e `escritorio`. Ao editar um recibo existente, esses campos seriam apagados do banco.  
**Arquivo alterado:** `web/server.js` — rota `PUT /api/recibos/:id` atualizada.

---

## 2026-04-01 — Segurança: arquivo JSON de credenciais deletado

**Raciocínio:** O arquivo `sunny-advantage-468503-m4-7d996556c0ec.json` continha a chave privada da conta de serviço do Google. Após as credenciais serem convertidas para base64 e salvas no `.env`, o arquivo original em `Downloads/` não tinha mais utilidade e representava risco de segurança.  
**Ação:** Arquivo deletado de `C:\Users\carlo\Downloads\`.

---

## 2026-04-01 — Fix: carregamento infinito no celular (scripts externos)

**Problema:** App ainda travava carregando no celular mesmo após o fix das fontes.  
**Raciocínio:** Havia 4 scripts externos carregando de forma bloqueante no final do HTML: Chart.js, xlsx, jsPDF e jspdf-autotable. Em redes móveis lentas, qualquer um travando impede a página de renderizar.  
**Arquivo alterado:** `web/public/index.html` — adicionado `defer` nos 4 scripts externos e no `app.js`.

---

## 2026-04-01 — Fix definitivo carregamento mobile: libs locais

**Problema:** App continuava carregando infinitamente no celular mesmo após fixes anteriores.  
**Raciocínio:** As 4 bibliotecas JS (Chart.js, xlsx, jsPDF, autotable) eram carregadas do CDN jsdelivr.net. Em redes mobile brasileiras o CDN pode travar ou ter latência muito alta, impedindo a página de inicializar.  
**Solução:** Baixadas as 4 libs e servidas localmente em `web/public/libs/`. Agora o app não depende de nenhum recurso externo para carregar — tudo vem do próprio servidor AWS.  
**Arquivos alterados:**
- `web/public/libs/chart.min.js` — criado
- `web/public/libs/xlsx.min.js` — criado
- `web/public/libs/jspdf.min.js` — criado
- `web/public/libs/jspdf.autotable.min.js` — criado
- `web/public/index.html` — scripts apontam para `libs/` em vez do CDN

---

## 2026-04-01 — Fix mobile: lazy load xlsx e jspdf

**Problema:** Mesmo com libs locais, celular continuava travando.  
**Raciocínio:** O payload inicial de JS era ~1.5MB — xlsx.min.js sozinho tem 861KB. Mobile com memória limitada e JS engine mais lento trava ao tentar parsear 1.5MB de JS na carga inicial.  
**Solução:** xlsx e jspdf removidos do carregamento inicial. Criada função `carregarLib()` que injeta o script dinamicamente sob demanda. Cada função de exportação agora chama `garantirXLSX()` ou `garantirJSPDF()` antes de executar. Payload inicial: ~210KB (só chart.js + app.js).  
**Arquivos alterados:**
- `web/public/index.html` — removidos xlsx, jspdf e autotable do `<script>`
- `web/public/app.js` — adicionadas `carregarLib()`, `garantirXLSX()`, `garantirJSPDF()`; todas as 7 funções de exportação convertidas para `async`

---

## 2026-04-01 — Fix mobile: redirecionamento HTTPS→HTTP

**Problema:** Celular dava ERR_CONNECTION_TIMED_OUT — o browser mobile tenta HTTPS automaticamente mas o servidor só tem HTTP.  
**Tentativa:** Solicitado certificado SSL no AWS Certificate Manager — falhou porque a AWS não emite certificados para subdomínios `.elasticbeanstalk.com` (domínio que ela mesma controla).  
**Solução:** Adicionado middleware no Express que detecta requisições HTTPS (via header `x-forwarded-proto`) e redireciona para HTTP.  
**Observação:** Solução definitiva seria ter um domínio próprio (ex: `araujo-prev.com.br`) para emitir certificado SSL real.  
**Arquivo alterado:** `web/server.js` — middleware de redirecionamento HTTPS→HTTP adicionado antes do `express.static`.

---

## 2026-04-01 — Fix planilha: valor com R$, campo motivo de pagamento

**Problema:** Registro na planilha chegava com valor sem `R$` e coluna "Motivo de pagamento" vazia.  
**Raciocínio:** O valor era enviado cru (ex: `1.111,11`) sem prefixo. O motivo estava usando o campo `complemento` que é livre e muitas vezes vazio.  
**Solução:**
- Valor formatado como `R$ X` no `registrarNoSheets()`
- Adicionado campo **Motivo de Pagamento** (select) no formulário com opções: Ação judicial, Ação administrativa, Honorários Advocatícios, Consultoria
- Campo salvo no NeDB e enviado para coluna correta na planilha

**Arquivos alterados:** `web/server.js`, `web/public/index.html`, `web/public/app.js`

---

## 2026-04-01 — Debug: endpoint para verificar cabeçalhos reais do Sheets

**Problema:** Dados chegando nas colunas erradas da planilha — "Honorários Advocatícios" aparecia em "Alguma observação?" (shift de +2 colunas).  
**Raciocínio:** O código envia os dados na ordem certa, mas o mapeamento pode estar errado porque a planilha é uma aba de respostas de formulário Google e pode ter colunas extras ou ordem diferente da assumida. Sem ver o cabeçalho real, impossível corrigir com certeza.  
**Solução temporária:** Adicionado endpoint `GET /api/debug-sheets-headers` que lê a linha 1 da planilha e retorna o mapeamento coluna→cabeçalho. Após Carlo consultar o endpoint, corrigiremos o array `linha` no `registrarNoSheets()`.  
**Arquivo alterado:** `web/server.js` — nova rota de debug adicionada antes de `// ── ROTAS RECIBOS`.

---

## 2026-04-01 — Fix definitivo: colunas Sheets alinhadas

**Problema:** Dados inseridos nas colunas erradas (ex: "Honorários" aparecia em "Alguma observação?", nome aparecia em coluna K).  
**Raciocínio:** A planilha tem logo e cabeçalho nas linhas 1-2, dados só a partir da linha 4. O método `append` da API do Google Sheets se confundia com isso e jogava os dados em posições erradas. Confirmado vendo a planilha real: a célula selecionada K261 tinha "CARLOS PEGORARO NETO (TESTE)" — o nome estava 9 colunas deslocado.  
**Solução:** Trocado `append` por lógica explícita: lê quantas linhas já existem a partir de A4, calcula a próxima linha vazia, escreve exatamente naquela linha com `update`. Agora não depende do API adivinhar onde colocar.  
**Arquivo alterado:** `web/server.js` — função `registrarNoSheets()` reescrita.

---

## 2026-04-01 — Troca de emojis por Bootstrap Icons

**Solicitado por:** Carlo  
**Raciocínio:** Emojis têm renderização inconsistente entre sistemas e ficam amadores. Bootstrap Icons dão um visual mais profissional e consistente.  
**O que foi feito:**
- Adicionada lib Bootstrap Icons 1.11.3 via CDN (preload, não bloqueia renderização)
- Substituídos todos os emojis por `<i class="bi bi-...">` em `index.html` e `app.js`
- Search box: removido CSS `::before` com emoji, adicionado `<i class="bi bi-search">` no HTML
- Ícone de tema (lua/sol): atualizado para `bi-moon-stars` / `bi-sun-fill`, lógica de troca ajustada em `app.js`

**Arquivos alterados:** `web/public/index.html`, `web/public/app.js`

---

## 2026-04-02 — Redesign do documento Word do recibo

**Solicitado por:** Carlo  
**Raciocínio:** O layout antigo tinha espaço em branco excessivo antes da logo, assinatura do emissor centralizada e possibilidade de ultrapassar 1 página.  
**O que foi feito:**
- Assinatura do emissor (emitido_por) movida para o **canto inferior esquerdo**
- Assinatura do cliente (nome + CPF) ficou no **lado direito** — usando tabela de 2 colunas sem borda
- Espaçamentos reduzidos para caber em 1 página (spaceAfter: 800→240 após data, 120→80 nos parágrafos)
- Logo aproximada do conteúdo (before: 700→320)
- Adicionada label "Emitido por" abaixo da assinatura do emissor

**Arquivo alterado:** `web/server.js` — rota `POST /api/gerar-recibo`, bloco de montagem do documento.

---

## 2026-04-02 — Layout final do recibo aprovado

**Layout definido:**
- Logo no topo
- Corpo do recibo
- Assinatura do cliente centralizada (meio da página)
- Assinatura do emissor no canto inferior esquerdo
- Logo no rodapé
- Espaçamento: 3600 após data, 600 após assinatura do cliente

---

## 2026-04-02 — Upload de comprovante de depósito

**Solicitado por:** Carlo (após conversa com coordenador financeiro Lucas Bassetto)  
**Raciocínio:** O comprovante chega via WhatsApp (Pix/Ted) ou impresso no caixa. Na hora de gerar o recibo, quem emite já anexa o comprovante no sistema — igual ao fluxo do formulário Google antigo.  
**O que foi feito:**
- Adicionado campo "Comprovante de depósito" (upload opcional) no formulário
- Arquivo sobe pro Google Drive via API (mesma conta de serviço)
- Link público gerado e salvo na coluna "Anexo comprovante" da planilha
- Lib `multer` instalada para lidar com upload de arquivos no servidor
- Nova rota `POST /api/upload-comprovante`
- Limite de 20MB por arquivo, aceita imagem e PDF

**Arquivos alterados:** `web/server.js`, `web/public/index.html`, `web/public/app.js`, `web/package.json`, `package.json`

_Próxima entrada será adicionada aqui quando houver nova alteração._
