const express = require("express");
const Datastore = require("@seald-io/nedb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle } = require("docx");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "araujo-prev-2026-secret";

// ── BANCO DE DADOS ─────────────────────────────────────────
const dbDir = path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const dbUsers   = new Datastore({ filename: path.join(dbDir, "users.db"),   autoload: true });
const dbRecibos = new Datastore({ filename: path.join(dbDir, "recibos.db"), autoload: true });

dbUsers.ensureIndex({ fieldName: "username", unique: true });

// Admin padrão
dbUsers.findOne({ username: "admin" }, (err, doc) => {
  if (!doc) {
    const hash = bcrypt.hashSync("admin123", 10);
    dbUsers.insert({ username: "admin", password: hash, created_at: new Date().toISOString() });
    console.log("✅ Usuário admin criado — senha: admin123");
  }
});

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ erro: "Não autorizado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
  }
}

// Promisify nedb
function find(db, query, sort) {
  return new Promise((res, rej) => {
    let cursor = db.find(query);
    if (sort) cursor = cursor.sort(sort);
    cursor.exec((err, docs) => err ? rej(err) : res(docs));
  });
}
function findOne(db, query) {
  return new Promise((res, rej) => db.findOne(query, (err, doc) => err ? rej(err) : res(doc)));
}
function insert(db, doc) {
  return new Promise((res, rej) => db.insert(doc, (err, d) => err ? rej(err) : res(d)));
}
function update(db, query, upd) {
  return new Promise((res, rej) => db.update(query, { $set: upd }, {}, (err) => err ? rej(err) : res()));
}
function remove(db, query) {
  return new Promise((res, rej) => db.remove(query, {}, (err) => err ? rej(err) : res()));
}
function count(db, query) {
  return new Promise((res, rej) => db.count(query, (err, n) => err ? rej(err) : res(n)));
}

// ── ROTAS AUTH ─────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  const user = await findOne(dbUsers, { username });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ erro: "Usuário ou senha incorretos" });
  }
  const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username: user.username });
});

// ── ROTAS RECIBOS ──────────────────────────────────────────
app.get("/api/recibos", auth, async (req, res) => {
  const recibos = await find(dbRecibos, {}, { timestamp: -1 });
  res.json(recibos.map(r => ({ ...r, id: r._id })));
});

app.post("/api/recibos", auth, async (req, res) => {
  const { num, nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, timestamp } = req.body;
  const doc = await insert(dbRecibos, { num, nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", timestamp });
  res.json({ id: doc._id });
});

app.put("/api/recibos/:id", auth, async (req, res) => {
  const { nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia } = req.body;
  await update(dbRecibos, { _id: req.params.id }, { nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"" });
  res.json({ ok: true });
});

app.delete("/api/recibos/:id", auth, async (req, res) => {
  await remove(dbRecibos, { _id: req.params.id });
  res.json({ ok: true });
});

app.get("/api/proximo-num", auth, async (req, res) => {
  const ano = String(new Date().getFullYear());
  const todos = await find(dbRecibos, {});
  const doAno = todos.filter(r => (r.data||"").endsWith(ano));
  const num = doAno.length + 1;
  res.json({ num: `${String(num).padStart(4, "0")}/${ano}` });
});

// ── GERAR DOCUMENTO ────────────────────────────────────────
app.post("/api/gerar-recibo", auth, async (req, res) => {
  try {
    const dados = req.body;
    const digits = dados.cpf.replace(/\D/g, "");
    const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
    const complemento = dados.complemento ? ` - ${dados.complemento}` : "";

    const logoPath = path.join(__dirname, "public", "logo.png");
    const logoExists = fs.existsSync(logoPath);

    function p(text, opts = {}) {
      return new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        spacing: { after: opts.spaceAfter ?? 80 },
        children: [new TextRun({
          text, bold: opts.bold || false,
          size: (opts.size || 11) * 2,
          color: opts.color || "000000",
          font: "Arial",
        })],
      });
    }

    function linha() {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
        children: [],
      });
    }

    const textoCorpo = `Recebemos do (a) senhor (a) ${dados.nome}, residente e domiciliado(a) no Município de ${dados.municipio_uf}, a importância de R$ ${dados.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

    const children = [];

    if (logoExists) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new ImageRun({ data: fs.readFileSync(logoPath), transformation: { width: 200, height: 76 }, type: "png" })],
      }));
    }

    children.push(
      p("A ARAUJO SERVIÇOS LTDA ME", { align: AlignmentType.CENTER, bold: true, size: 14, color: "1E40AF", spaceAfter: 40 }),
      p("A ARAUJO PREV", { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 40 }),
      linha(),
      p(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 20 }),
      p("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: AlignmentType.CENTER, bold: true, size: 14, spaceAfter: 120 }),
      p(textoCorpo, { align: AlignmentType.JUSTIFIED, spaceAfter: 80 }),
      p("Por ser verdade, firmo o presente que segue datado e assinado.", { align: AlignmentType.JUSTIFIED, spaceAfter: 120 }),
      linha(),
      p(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: AlignmentType.LEFT, spaceAfter: 800 }),
      p("________________________________________", { align: AlignmentType.CENTER, spaceAfter: 160 }),
      p(`${labelDoc}: ${dados.cpf}`, { align: AlignmentType.CENTER, size: 10, spaceAfter: 0 }),
    );

    if (logoExists) {
      children.push(
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 40 }, children: [new TextRun({ text: "________________________", font: "Arial", size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: dados.emitido_por || "A ARAUJO PREV", bold: true, font: "Arial", size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 700, after: 0 }, children: [new ImageRun({ data: fs.readFileSync(logoPath), transformation: { width: 200, height: 76 }, type: "png" })] }),
      );
    }

    const doc = new Document({
      sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children }],
    });

    const buf = await Packer.toBuffer(doc);
    const nomeArquivo = `recibo_${dados.num_recibo.replace(/[\/\\]/g, "-")}_${dados.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase()}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ── ROTAS USUÁRIOS ─────────────────────────────────────────
app.get("/api/users", auth, async (req, res) => {
  const users = await find(dbUsers, {});
  res.json(users.map(u => ({ id: u._id, username: u.username, created_at: u.created_at })));
});

app.post("/api/users", auth, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  const exists = await findOne(dbUsers, { username });
  if (exists) return res.status(400).json({ erro: "Usuário já existe" });
  const hash = bcrypt.hashSync(password, 10);
  const doc = await insert(dbUsers, { username, password: hash, created_at: new Date().toISOString() });
  res.json({ id: doc._id, username });
});

app.delete("/api/users/:id", auth, async (req, res) => {
  const user = await findOne(dbUsers, { _id: req.params.id });
  if (user?.username === "admin") return res.status(400).json({ erro: "Não é possível remover o admin." });
  await remove(dbUsers, { _id: req.params.id });
  res.json({ ok: true });
});

// ── INICIAR ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Araujo Prev rodando em http://localhost:${PORT}`);
});
