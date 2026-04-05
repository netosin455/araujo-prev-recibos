// =============================================================
//  SERVIDOR — web/server.js
//  Roda na AWS. Nunca abre no navegador, só no terminal/servidor.
//
//  O QUE ESSE ARQUIVO FAZ:
//  - Recebe os pedidos do navegador (login, salvar recibo, etc.)
//  - Verifica se o usuário está logado e tem permissão
//  - Salva e busca dados no banco de dados
//  - Gera o documento Word (.docx) do recibo
//
//  QUANDO MEXER AQUI:
//  - Mudar campos do recibo
//  - Mudar regras de permissão (quem pode fazer o quê)
//  - Mudar tempo de expiração do login (atualmente 8h)
//  - Adicionar novas funcionalidades no servidor
// =============================================================
require("dotenv").config();
const express = require("express");
const Datastore = require("@seald-io/nedb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle, Table, TableRow, TableCell, WidthType } = require("docx");
const { google } = require("googleapis");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── GOOGLE SHEETS ───────────────────────────────────────────
const SHEET_ID = "1qbpuZo5HLQHw4itjWbnXJNjBjIy63So3erMswhP2-68";
const SHEET_NAME = "Respostas ao formulário 1";
const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];

function getSheetsClient() {
  const credsB64 = process.env.GOOGLE_CREDENTIALS;
  if (!credsB64) return null;
  try {
    const creds = JSON.parse(Buffer.from(credsB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  } catch (e) {
    console.error("❌ Erro ao inicializar Google Sheets:", e.message);
    return null;
  }
}

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "1tAZamgITcl9NtATn7zujEhBTZ_TSIbLRI3vs9k5V9XAaZPvazb59NfqiKNnjcjwzbiaWQsb6";

async function uploadParaDrive(buffer, nomeArquivo, mimeType) {
  const credsB64 = process.env.GOOGLE_CREDENTIALS;
  if (!credsB64) return null;
  try {
    const creds = JSON.parse(Buffer.from(credsB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const drive = google.drive({ version: "v3", auth });
    const { Readable } = require("stream");
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    const meta = { name: nomeArquivo };
    if (DRIVE_FOLDER_ID) meta.parents = [DRIVE_FOLDER_ID];
    const res = await drive.files.create({
      requestBody: meta,
      media: { mimeType, body: stream },
      fields: "id",
    });
    const fileId = res.data.id;
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
    return `https://drive.google.com/file/d/${fileId}/view`;
  } catch (e) {
    console.error("❌ Erro ao fazer upload pro Drive:", e.message);
    return null;
  }
}

async function registrarNoSheets(dados) {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    const agora = new Date();
    const mes = MESES[agora.getMonth()];
    const dataFormatada = agora.toLocaleDateString("pt-BR");
    const horaFormatada = agora.toLocaleTimeString("pt-BR");
    const carimbo = `${dataFormatada} ${horaFormatada}`;

    const linha = [
      carimbo,                                          // A: Carimbo de data/hora
      dados.nome || "",                                 // B: Nome completo do cliente
      dados.cpf || "",                                  // C: CPF do cliente
      dados.valor ? `R$ ${dados.valor}` : "",            // D: Valor pago
      dataFormatada,                                    // E: Data do pagamento
      dataFormatada,                                    // F: Data do depósito
      dados.forma_pagamento || "",                      // G: Forma de pagamento
      dados.motivo_pagamento || dados.complemento || "Honorários Advocatícios", // H: Motivo de pagamento
      dados.escritorio || "",                           // I: Escritório
      "",                                               // J: Alguma observação (não usado)
      dados.link_comprovante || "",                     // K: Anexo comprovante
      mes,                                              // L: Mês
      dados.num_recibo || "",                           // M: Número do recibo (backup para restauração)
    ];

    // Busca última linha com dado na coluna A (a partir da linha 4, pulando logo+cabeçalho)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:A`,
    });
    const nRows = (existing.data.values || []).length;
    const nextRow = 4 + nRows;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${nextRow}:M${nextRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [linha] },
    });
    console.log(`✅ Recibo ${dados.num_recibo} registrado no Google Sheets`);
  } catch (e) {
    console.error("❌ Erro ao registrar no Google Sheets:", e.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ ERRO: Defina a variável de ambiente JWT_SECRET antes de iniciar.");
  process.exit(1);
}

// ── RATE LIMIT LOGIN ───────────────────────────────────────
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count > 10;
}

// ── BANCO DE DADOS ─────────────────────────────────────────
const dbDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbUsers   = new Datastore({ filename: path.join(dbDir, "users.db"),   autoload: true });
const dbRecibos = new Datastore({ filename: path.join(dbDir, "recibos.db"), autoload: true });

dbUsers.ensureIndex({ fieldName: "username", unique: true });

// Admin padrão via variáveis de ambiente
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error("❌ ERRO: Defina as variáveis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.");
  process.exit(1);
}
dbUsers.findOne({ username: ADMIN_USER }, (err, doc) => {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  if (!doc) {
    dbUsers.insert({ username: ADMIN_USER, password: hash, role: "admin", created_at: new Date().toISOString() });
    console.log("✅ Usuário admin criado.");
  } else {
    dbUsers.update({ username: ADMIN_USER }, { $set: { password: hash, role: "admin" } }, {});
    console.log("✅ Senha do admin atualizada.");
  }
});

// Usuários extras via variável de ambiente USERS_JSON (base64 de JSON array)
// Formato: [{"username":"financeiro","password":"senha","role":"financeiro"}, ...]
// Para gerar: btoa(JSON.stringify([...])) no console do navegador
const USERS_JSON = process.env.USERS_JSON;
if (USERS_JSON) {
  try {
    const extraUsers = JSON.parse(Buffer.from(USERS_JSON, "base64").toString("utf8"));
    for (const u of extraUsers) {
      if (!u.username || !u.password) continue;
      const hash = bcrypt.hashSync(u.password, 10);
      dbUsers.findOne({ username: u.username }, (err, doc) => {
        if (!doc) {
          dbUsers.insert({ username: u.username, password: hash, role: u.role || "financeiro", created_at: new Date().toISOString() });
          console.log(`✅ Usuário ${u.username} criado.`);
        } else {
          dbUsers.update({ username: u.username }, { $set: { password: hash, role: u.role || "financeiro" } }, {});
          console.log(`✅ Usuário ${u.username} atualizado.`);
        }
      });
    }
  } catch (e) {
    console.error("❌ Erro ao processar USERS_JSON:", e.message);
  }
}

// Sincroniza recibos da planilha se o banco estiver vazio (restauração após troca de servidor)
async function sincronizarDeSheets() {
  try {
    const total = await count(dbRecibos, {});
    if (total > 0) return;
    const sheets = getSheetsClient();
    if (!sheets) return;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:M`,
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return;
    let importados = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const carimbo = row[0] || "";
      const nome    = (row[1] || "").replace(/\b\w/g, c => c.toUpperCase());
      const cpf     = row[2] || "";
      const valor   = (row[3] || "").replace(/R\$\s*/i, "").trim();
      const data    = row[4] || "";
      const forma_pagamento  = row[6] || "";
      const motivo_pagamento = row[7] || "";
      const escritorio       = row[8] || "";
      const link_comprovante = row[10] || "";
      const num = row[12] || `${String(i + 1).padStart(4, "0")}/${(data.split("/")[2] || String(new Date().getFullYear()))}`;
      // Converte carimbo "DD/MM/YYYY HH:MM:SS" em timestamp
      let timestamp = Date.now() - (rows.length - i) * 1000;
      if (carimbo) {
        const [datePart, timePart] = carimbo.split(" ");
        const [d, m, y] = (datePart || "").split("/");
        if (y && m && d) {
          const t = new Date(`${y}-${m}-${d}T${timePart || "00:00:00"}`).getTime();
          if (!isNaN(t)) timestamp = t;
        }
      }
      await insert(dbRecibos, { num, nome, cpf, municipio_uf: "", valor, data, emitido_por: "", complemento: "", referencia: "", forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp });
      importados++;
    }
    console.log(`✅ ${importados} recibos restaurados da planilha Google Sheets.`);
  } catch (e) {
    console.error("❌ Erro ao sincronizar recibos da planilha:", e.message);
  }
}
sincronizarDeSheets();

// Normaliza nomes e CPFs já existentes no banco
async function normalizarDados() {
  try {
    const todos = await find(dbRecibos, {});
    let corrigidos = 0;
    for (const r of todos) {
      const updates = {};
      // Title Case no nome
      const nomeNorm = (r.nome || "").replace(/\b\w/g, c => c.toUpperCase());
      if (nomeNorm !== r.nome) updates.nome = nomeNorm;
      // CPF: formata se vier sem máscara
      const digits = (r.cpf || "").replace(/\D/g, "");
      let cpfNorm = r.cpf;
      if (digits.length === 11) cpfNorm = digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
      else if (digits.length === 14) cpfNorm = digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
      if (cpfNorm !== r.cpf) updates.cpf = cpfNorm;
      if (Object.keys(updates).length > 0) {
        await update(dbRecibos, { _id: r._id }, updates);
        corrigidos++;
      }
    }
    if (corrigidos > 0) console.log(`✅ ${corrigidos} registros normalizados (nome/CPF).`);
  } catch (e) {
    console.error("❌ Erro ao normalizar dados:", e.message);
  }
}
normalizarDados();

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));

// Redireciona HTTPS → HTTP (o EB não tem certificado SSL próprio)
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"];
  if (proto === "https") return res.redirect(301, "http://" + req.headers.host + req.url);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Headers de segurança
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

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

function adminOnly(req, res, next) {
  if (req.user.username !== ADMIN_USER) return res.status(403).json({ erro: "Acesso restrito ao administrador." });
  next();
}

function financeiroOnly(req, res, next) {
  if (req.user.role === "recepcao") return res.status(403).json({ erro: "Sem permissão para esta ação." });
  next();
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
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (checkRateLimit(ip)) return res.status(429).json({ erro: "Muitas tentativas. Aguarde 15 minutos." });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ erro: "Dados inválidos" });
  const user = await findOne(dbUsers, { username });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ erro: "Usuário ou senha incorretos" });
  }
  const token = jwt.sign({ id: user._id, username: user.username, role: user.role || "financeiro" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username: user.username, role: user.role || "financeiro" });
});

// ── DEBUG: lê cabeçalhos reais da planilha ─────────────────
app.get("/api/debug-sheets-headers", auth, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(500).json({ error: "GOOGLE_CREDENTIALS não configurado" });
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!1:1`,
    });
    const headers = (r.data.values || [[]])[0];
    res.json(headers.map((h, i) => ({ col: String.fromCharCode(65 + i), header: h })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UPLOAD COMPROVANTE ─────────────────────────────────────
app.post("/api/upload-comprovante", auth, upload.single("comprovante"), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });
  const link = await uploadParaDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
  if (!link) return res.status(500).json({ erro: "Erro ao subir arquivo pro Drive." });
  res.json({ link });
});

// ── ROTAS RECIBOS ──────────────────────────────────────────
app.get("/api/recibos", auth, async (req, res) => {
  const recibos = await find(dbRecibos, {}, { timestamp: -1 });
  res.json(recibos.map(r => ({ ...r, id: r._id })));
});

app.post("/api/recibos", auth, async (req, res) => {
  const { num, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp } = req.body;
  const nome = (req.body.nome || "").replace(/\b\w/g, c => c.toUpperCase());
  const doc = await insert(dbRecibos, { num, nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"", link_comprovante: link_comprovante||"", timestamp });
  registrarNoSheets({ num_recibo: num, nome, cpf, municipio_uf, valor, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante });
  res.json({ id: doc._id });
});

app.put("/api/recibos/:id", auth, financeiroOnly, async (req, res) => {
  const { nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento } = req.body;
  await update(dbRecibos, { _id: req.params.id }, { nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"" });
  res.json({ ok: true });
});

app.delete("/api/recibos/:id", auth, financeiroOnly, async (req, res) => {
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

    const semBorda = { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } };

    children.push(
      p("A ARAUJO SERVIÇOS LTDA ME", { align: AlignmentType.CENTER, bold: true, size: 14, color: "1E40AF", spaceAfter: 40 }),
      p("A ARAUJO PREV", { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 40 }),
      linha(),
      p(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 20 }),
      p("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: AlignmentType.CENTER, bold: true, size: 14, spaceAfter: 80 }),
      p(textoCorpo, { align: AlignmentType.JUSTIFIED, spaceAfter: 60 }),
      p("Por ser verdade, firmo o presente que segue datado e assinado.", { align: AlignmentType.JUSTIFIED, spaceAfter: 80 }),
      linha(),
      p(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: AlignmentType.LEFT, spaceAfter: 3600 }),
      // Assinatura do cliente — centro
      p("________________________________________", { align: AlignmentType.CENTER, spaceAfter: 40 }),
      p(dados.nome, { align: AlignmentType.CENTER, size: 10, spaceAfter: 20 }),
      p(`${labelDoc}: ${dados.cpf}`, { align: AlignmentType.CENTER, size: 9, spaceAfter: 2800 }),
      // Assinatura do emissor — esquerda
      p("________________________", { align: AlignmentType.LEFT, spaceAfter: 40 }),
      p(dados.emitido_por || "A ARAUJO PREV", { align: AlignmentType.LEFT, size: 10, spaceAfter: 0 }),
    );

    if (logoExists) {
      children.push(
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 0 }, children: [new ImageRun({ data: fs.readFileSync(logoPath), transformation: { width: 180, height: 68 }, type: "png" })] }),
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
    console.error("Erro ao gerar recibo:", e.message);
    res.status(500).json({ erro: "Erro ao gerar documento." });
  }
});

// ── ROTAS USUÁRIOS ─────────────────────────────────────────
app.get("/api/users", auth, adminOnly, async (req, res) => {
  const users = await find(dbUsers, {});
  res.json(users.map(u => ({ id: u._id, username: u.username, role: u.role || "financeiro", created_at: u.created_at })));
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  const exists = await findOne(dbUsers, { username });
  if (exists) return res.status(400).json({ erro: "Usuário já existe" });
  const hash = bcrypt.hashSync(password, 10);
  const doc = await insert(dbUsers, { username, password: hash, role: role || "financeiro", created_at: new Date().toISOString() });
  res.json({ id: doc._id, username });
});

app.put("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username) return res.status(400).json({ erro: "Preencha o usuário." });
  const upd = { username, role: role || "financeiro" };
  if (password) upd.password = bcrypt.hashSync(password, 10);
  await update(dbUsers, { _id: req.params.id }, upd);
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  const user = await findOne(dbUsers, { _id: req.params.id });
  if (user?.username === "admin") return res.status(400).json({ erro: "Não é possível remover o admin." });
  await remove(dbUsers, { _id: req.params.id });
  res.json({ ok: true });
});

// ── INICIAR ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Araujo Prev rodando em http://localhost:${PORT}`);
});
