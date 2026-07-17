// Testes de integração das rotas REAIS (sem servidor externo, sem Neon).
// Monta os módulos de routes/* num Express de teste com o banco mockado —
// o middleware de auth é o real (cookie httpOnly + JWT), só o Postgres é fake.
// Uso: npm test (roda via node --test)
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const express = require(path.join(__dirname, "..", "web", "node_modules", "express"));
const cookieParser = require(path.join(__dirname, "..", "web", "node_modules", "cookie-parser"));
const jwt = require(path.join(__dirname, "..", "web", "node_modules", "jsonwebtoken"));
const bcrypt = require(path.join(__dirname, "..", "web", "node_modules", "bcryptjs"));
const request = require(path.join(__dirname, "..", "web", "node_modules", "supertest"));

const JWT_SECRET = "segredo-de-teste";
const ADMIN_USER = "admin";

// ── Fakes ──────────────────────────────────────────────────
function criarFakes() {
  const chamadas = { update: [], auditoria: [], findLimited: [] };
  const dados = { findOne: {} }; // findOne responde por tabela via fila de respostas
  const fakes = {
    chamadas,
    dados,
    pgPool: { query: async () => ({ rows: [{ id: "u1" }] }) }, // auth middleware: usuário existe
    find: async () => [],
    findOne: async (tabela) => {
      const fila = dados.findOne[tabela] || [];
      return fila.length ? fila.shift() : null;
    },
    insert: async (tabela, doc) => ({ ...doc, _id: doc._id || "novo" }),
    update: async (tabela, query, upd) => { chamadas.update.push({ tabela, query, upd }); },
    remove: async () => {},
    count: async () => 0,
    findLimited: async (tabela, query, sort, limit) => {
      chamadas.findLimited.push({ tabela, limit });
      return dados.findLimitedResposta || [];
    },
  };
  return fakes;
}

function tokenPara(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "1h" });
}

function criarApp(fakes) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const mw = require("../web/middleware/auth")({ jwt, JWT_SECRET, ADMIN_USER, pgPool: fakes.pgPool });
  const deps = {
    ...mw,
    pgPool: fakes.pgPool, jwt, JWT_SECRET, bcrypt,
    dbRecibos: "recibos", dbClientes: "clientes", dbAuditoria: "auditoria",
    dbNotificacoes: "notificacoes", dbConfig: "config",
    NAO_DELETADO: { deletado_em: { $exists: false } },
    find: fakes.find, findOne: fakes.findOne, insert: fakes.insert,
    update: fakes.update, remove: fakes.remove, count: fakes.count, findLimited: fakes.findLimited,
    registrarAuditoria: (req, acao, id, extra) => fakes.chamadas.auditoria.push({ acao, id, extra }),
    maskCPF: (c) => "***",
    validarCPF: () => true, validarCNPJ: () => true,
    enriquecerCliente: async (c) => c,
    gerarParcelas: () => [], recalcularResumo: (c) => c,
    inicializarParcelasLegado: (c) => c, numeroSeguro: (n) => Number(n) || 0,
    getSheetsClient: () => null, sincronizarUsuariosParaSheets: async () => {},
    ADMIN_USER, SHEET_ID: "", SHEET_NAME: "", linkParaSheets: (l) => l,
    s3Client: null, withTimeout: (p) => p, fetchWithTimeout: async () => ({}),
    upload: { single: () => (req, res, next) => next() },
    crypto: require("node:crypto"), fs: require("node:fs"), path,
    smtpConfigurado: () => false,
    enviarJobExport: async () => {}, filaExportConfigurada: () => false,
    s3SignerClient: null, getSignedUrl: async () => "", GetObjectCommand: class {},
    BUCKET_NAME: "", MIRROR_LOCAL_DIR: "",
    get transporter() { return null; },
  };
  return { app, deps };
}

const FINANCEIRO = { id: "u1", username: "maria", role: "financeiro", escritorio: "" };
const ADMIN = { id: "u1", username: ADMIN_USER, role: "admin", escritorio: "" };

// ── Middleware de auth (real) ──────────────────────────────
describe("middleware auth (cookie httpOnly)", () => {
  let app;
  beforeEach(() => {
    const fakes = criarFakes();
    const ctx = criarApp(fakes);
    require("../web/routes/recibos")(ctx.app, ctx.deps);
    app = ctx.app;
  });

  it("sem token retorna 401", async () => {
    const res = await request(app).delete("/api/recibos/r1");
    assert.equal(res.status, 401);
  });

  it("token inválido retorna 401", async () => {
    const res = await request(app).delete("/api/recibos/r1").set("Cookie", "token=lixo");
    assert.equal(res.status, 401);
  });
});

// ── Soft delete de recibos ─────────────────────────────────
describe("DELETE /api/recibos/:id (soft delete)", () => {
  it("marca deletado_em/deletado_por em vez de apagar e registra auditoria", async () => {
    const fakes = criarFakes();
    fakes.dados.findOne.recibos = [{ _id: "r1", num: "0001/2026", nome: "João" }];
    const ctx = criarApp(fakes);
    require("../web/routes/recibos")(ctx.app, ctx.deps);

    const res = await request(ctx.app).delete("/api/recibos/r1")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`);

    assert.equal(res.status, 200);
    assert.equal(fakes.chamadas.update.length, 1);
    const { upd } = fakes.chamadas.update[0];
    assert.ok(upd.deletado_em, "deve marcar deletado_em");
    assert.equal(upd.deletado_por, "maria");
    assert.equal(fakes.chamadas.auditoria[0].acao, "excluir_recibo");
  });

  it("recepcao não pode excluir (403)", async () => {
    const fakes = criarFakes();
    const ctx = criarApp(fakes);
    require("../web/routes/recibos")(ctx.app, ctx.deps);
    const res = await request(ctx.app).delete("/api/recibos/r1")
      .set("Cookie", `token=${tokenPara({ ...FINANCEIRO, role: "recepcao" })}`);
    assert.equal(res.status, 403);
  });
});

// ── Soft delete de clientes ────────────────────────────────
describe("DELETE /api/clientes/:id (soft delete)", () => {
  it("marca deletado_em e registra auditoria com CPF mascarado", async () => {
    const fakes = criarFakes();
    fakes.dados.findOne.clientes = [{ _id: "c1", nome: "Maria", cpf: "52998224725" }];
    const ctx = criarApp(fakes);
    require("../web/routes/clientes")(ctx.app, ctx.deps);

    const res = await request(ctx.app).delete("/api/clientes/c1")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`);

    assert.equal(res.status, 200);
    assert.ok(fakes.chamadas.update[0].upd.deletado_em);
    assert.equal(fakes.chamadas.auditoria[0].acao, "excluir_cliente");
    assert.equal(fakes.chamadas.auditoria[0].extra.cpf, "***", "CPF deve ir mascarado pra auditoria");
  });
});

// ── Exportação em lote (ZIP) ───────────────────────────────
describe("POST /api/recibos/exportar-zip", () => {
  let ctx, fakes;
  beforeEach(() => {
    fakes = criarFakes();
    ctx = criarApp(fakes);
    require("../web/routes/recibos")(ctx.app, ctx.deps);
  });

  it("sem ids retorna 400", async () => {
    const res = await request(ctx.app).post("/api/recibos/exportar-zip")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`).send({ ids: [] });
    assert.equal(res.status, 400);
  });

  it("mais de 100 ids retorna 400", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `r${i}`);
    const res = await request(ctx.app).post("/api/recibos/exportar-zip")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`).send({ ids });
    assert.equal(res.status, 400);
    assert.match(res.body.erro, /100/);
  });

  it("sem fila configurada devolve ZIP direto (content-type)", async () => {
    // findOne devolve null pra todo id → ZIP sai vazio, mas o caminho síncrono é exercitado
    const res = await request(ctx.app).post("/api/recibos/exportar-zip")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`).send({ ids: ["r1", "r2"] });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/zip/);
  });

  it("recepcao não exporta (403)", async () => {
    const res = await request(ctx.app).post("/api/recibos/exportar-zip")
      .set("Cookie", `token=${tokenPara({ ...FINANCEIRO, role: "recepcao" })}`).send({ ids: ["r1"] });
    assert.equal(res.status, 403);
  });
});

// ── Lixeira (admin) ────────────────────────────────────────
describe("Lixeira /api/admin/lixeira", () => {
  let ctx, fakes;
  beforeEach(() => {
    fakes = criarFakes();
    ctx = criarApp(fakes);
    require("../web/routes/admin")(ctx.app, ctx.deps);
  });

  it("não-admin recebe 403", async () => {
    const res = await request(ctx.app).get("/api/admin/lixeira")
      .set("Cookie", `token=${tokenPara(FINANCEIRO)}`);
    assert.equal(res.status, 403);
  });

  it("lista no máximo 10 de cada tipo", async () => {
    fakes.dados.findLimitedResposta = [];
    const res = await request(ctx.app).get("/api/admin/lixeira")
      .set("Cookie", `token=${tokenPara(ADMIN)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { recibos: [], clientes: [] });
    assert.ok(fakes.chamadas.findLimited.every(c => c.limit === 10), "limite deve ser 10");
  });

  it("restaurar tipo inválido retorna 400", async () => {
    const res = await request(ctx.app).post("/api/admin/lixeira/usuarios/x/restaurar")
      .set("Cookie", `token=${tokenPara(ADMIN)}`);
    assert.equal(res.status, 400);
  });

  it("restaurar id inexistente retorna 404", async () => {
    const res = await request(ctx.app).post("/api/admin/lixeira/recibos/nao-existe/restaurar")
      .set("Cookie", `token=${tokenPara(ADMIN)}`);
    assert.equal(res.status, 404);
  });

  it("restaurar recibo com num em conflito retorna 409", async () => {
    fakes.dados.findOne.recibos = [
      { _id: "r1", num: "0001/2026", nome: "João", deletado_em: "2026-07-17" }, // o deletado
      { _id: "r2", num: "0001/2026", nome: "Outro" },                            // conflito ativo
    ];
    const res = await request(ctx.app).post("/api/admin/lixeira/recibos/r1/restaurar")
      .set("Cookie", `token=${tokenPara(ADMIN)}`);
    assert.equal(res.status, 409);
    assert.equal(fakes.chamadas.update.length, 0, "não deve restaurar com conflito");
  });

  it("restaurar com sucesso limpa deletado_em/por e audita", async () => {
    fakes.dados.findOne.recibos = [
      { _id: "r1", num: "0001/2026", nome: "João", deletado_em: "2026-07-17" },
      null, // sem conflito de num
    ];
    const res = await request(ctx.app).post("/api/admin/lixeira/recibos/r1/restaurar")
      .set("Cookie", `token=${tokenPara(ADMIN)}`);
    assert.equal(res.status, 200);
    const { upd } = fakes.chamadas.update[0];
    assert.equal(upd.deletado_em, null);
    assert.equal(upd.deletado_por, null);
    assert.equal(fakes.chamadas.auditoria[0].acao, "restaurar_recibo");
  });
});

// ── Login (rota real, banco mockado) ───────────────────────
describe("POST /api/login", () => {
  function appLogin(usuarioNoBanco) {
    const fakes = criarFakes();
    fakes.pgPool = {
      query: async (sql) => {
        if (/SELECT \* FROM users/.test(sql)) return { rows: usuarioNoBanco ? [usuarioNoBanco] : [] };
        return { rows: [{ id: "u1" }] };
      },
    };
    const ctx = criarApp(fakes);
    require("../web/routes/auth")(ctx.app, ctx.deps);
    return ctx.app;
  }

  it("usuário inexistente retorna 401", async () => {
    const res = await request(appLogin(null)).post("/api/login")
      .send({ username: "x", password: "y" });
    assert.equal(res.status, 401);
  });

  it("senha errada retorna 401", async () => {
    const user = { id: "u1", username: "maria", password: bcrypt.hashSync("certa", 4), role: "financeiro" };
    const res = await request(appLogin(user)).post("/api/login")
      .send({ username: "maria", password: "errada" });
    assert.equal(res.status, 401);
  });

  it("login correto retorna 200 com cookie httpOnly e sem token no body", async () => {
    const user = { id: "u1", username: "maria", password: bcrypt.hashSync("certa", 4), role: "financeiro" };
    const res = await request(appLogin(user)).post("/api/login")
      .send({ username: "maria", password: "certa" });
    assert.equal(res.status, 200);
    const cookie = (res.headers["set-cookie"] || []).join(";");
    assert.match(cookie, /token=/, "deve setar cookie token");
    assert.match(cookie, /HttpOnly/i, "cookie deve ser httpOnly");
    assert.equal(res.body.token, undefined, "token não pode vazar no body (SEC-011)");
    assert.equal(res.body.username, "maria");
  });

  it("payload não-string retorna 400", async () => {
    const res = await request(appLogin(null)).post("/api/login")
      .send({ username: { $ne: "" }, password: "x" });
    assert.equal(res.status, 400);
  });
});
