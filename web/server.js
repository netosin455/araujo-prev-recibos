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
const { Pool } = require("pg");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const Datastore = require("@seald-io/nedb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle, Table, TableRow, TableCell, WidthType } = require("docx");
const PDFDocument = require("pdfkit");
const { google } = require("googleapis");
const multer = require("multer");
const crypto = require("crypto");

// ── GOOGLE SHEETS ───────────────────────────────────────────
const SHEET_ID = process.env.SHEET_ID || "1qbpuZo5HLQHw4itjWbnXJNjBjIy63So3erMswhP2-68";
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
      supportsAllDrives: true,
    });
    const fileId = res.data.id;
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
    return `https://drive.google.com/file/d/${fileId}/view`;
  } catch (e) {
    console.error("❌ Erro ao fazer upload pro Drive:", e.message);
    throw e;
  }
}

async function registrarNoSheets(dados) {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
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

async function atualizarNoSheets(num, dados) {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    // Busca a linha pelo número do recibo na coluna M
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!M4:M`,
    });
    const rows = res.data.values || [];
    const idx = rows.findIndex(r => r[0] === num);
    if (idx === -1) return; // recibo não encontrado na planilha
    const rowNum = 4 + idx;
    const mes = MESES[new Date().getMonth()];
    const linha = [
      undefined,                                           // A: carimbo (não atualiza)
      dados.nome || "",                                    // B: Nome
      dados.cpf || "",                                     // C: CPF
      dados.valor ? `R$ ${dados.valor}` : "",              // D: Valor
      dados.data || "",                                    // E: Data pagamento
      dados.data || "",                                    // F: Data depósito
      dados.forma_pagamento || "",                         // G: Forma pagamento
      dados.motivo_pagamento || dados.complemento || "",   // H: Motivo
      dados.escritorio || "",                              // I: Escritório
      "",                                                  // J: Observação
      dados.link_comprovante || "",                        // K: Comprovante
      mes,                                                 // L: Mês
      num,                                                 // M: Número recibo
    ];
    // Atualiza apenas colunas B-M (não mexe no carimbo)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B${rowNum}:M${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [linha.slice(1)] },
    });
    console.log(`✅ Recibo ${num} atualizado no Google Sheets`);
  } catch (e) {
    console.error("❌ Erro ao atualizar no Google Sheets:", e.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ ERRO: Defina a variável de ambiente JWT_SECRET antes de iniciar.");
  process.exit(1);
}

// ── NEON (PostgreSQL) — usuários ───────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ ERRO: Defina a variável de ambiente DATABASE_URL (Neon) antes de iniciar.");
  process.exit(1);
}
const pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
// Usa o IP real da conexão TCP — ignora X-Forwarded-For que pode ser forjado pelo cliente
function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

// ── BANCO DE DADOS ─────────────────────────────────────────
const dbDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// ── UPLOAD DE COMPROVANTES ─────────────────────────────────
const uploadsDir = path.join(dbDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// S3 — usado quando BUCKET_NAME estiver configurado
const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const dbRecibos = new Datastore({ filename: path.join(dbDir, "recibos.db"), autoload: true });

// Admin padrão via variáveis de ambiente
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error("❌ ERRO: Defina as variáveis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.");
  process.exit(1);
}

// Usuários extras via variável de ambiente USERS_JSON (base64 de JSON array)
// Formato: [{"username":"financeiro","password":"senha","role":"financeiro"}, ...]
// Para gerar: btoa(JSON.stringify([...])) no console do navegador
const USERS_JSON = process.env.USERS_JSON;

// ── BACKUP DE USUÁRIOS NO GOOGLE SHEETS ────────────────────
// Salva todos os usuários (exceto admin) na aba "Usuarios" da planilha.
// Armazena o hash bcrypt — não é texto puro, não dá pra reverter.
async function sincronizarUsuariosParaSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    const { rows } = await pgPool.query(
      "SELECT username, password, role, created_at FROM users WHERE username != $1 ORDER BY created_at ASC",
      [ADMIN_USER]
    );
    const valores = rows.map(u => [u.username, u.password, u.role, u.created_at]);
    // Limpa a aba inteira e reescreve do zero
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: "Usuarios!A:D",
    });
    if (valores.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: "Usuarios!A1",
        valueInputOption: "RAW",
        requestBody: { values: valores },
      });
    }
    console.log(`✅ ${valores.length} usuário(s) sincronizados para o Sheets.`);
  } catch (e) {
    // Aba pode não existir ainda — tenta criar
    if (e.message && e.message.includes("Unable to parse range")) {
      try {
        const sheets2 = getSheetsClient();
        await sheets2.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: "Usuarios" } } }] },
        });
        await sincronizarUsuariosParaSheets();
      } catch (e2) {
        console.error("❌ Erro ao criar aba Usuarios:", e2.message);
      }
    } else {
      console.error("❌ Erro ao sincronizar usuários para Sheets:", e.message);
    }
  }
}

// Restaura usuários do Sheets para o Neon (chamado quando DB está vazio após reset)
async function restaurarUsuariosDeSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return 0;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Usuarios!A:D",
    });
    const linhas = res.data.values || [];
    if (linhas.length === 0) return 0;
    let restaurados = 0;
    for (const [username, passwordHash, role, created_at] of linhas) {
      if (!username || !passwordHash) continue;
      const result = await pgPool.query(`
        INSERT INTO users (id, username, password, role, created_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
        ON CONFLICT (username) DO NOTHING
      `, [username, passwordHash, role || "financeiro", created_at || new Date().toISOString()]);
      if (result.rowCount > 0) restaurados++;
    }
    console.log(`✅ ${restaurados} usuário(s) restaurados do Sheets para o Neon.`);
    return restaurados;
  } catch (e) {
    console.error("❌ Erro ao restaurar usuários do Sheets:", e.message);
    return 0;
  }
}

// ── INICIALIZAÇÃO DO BANCO DE USUÁRIOS (Neon) ──────────────
async function initDb() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role     TEXT NOT NULL DEFAULT 'financeiro',
      created_at TEXT NOT NULL
    )
  `);

  // Admin: sempre atualiza senha/role para refletir env vars (conta de sistema)
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
  await pgPool.query(`
    INSERT INTO users (id, username, password, role, created_at)
    VALUES (gen_random_uuid()::text, $1, $2, 'admin', $3)
    ON CONFLICT (username) DO UPDATE SET password = $2, role = 'admin'
  `, [ADMIN_USER, adminHash, new Date().toISOString()]);
  console.log("✅ Usuário admin configurado (Neon).");

  // Usuários extras via USERS_JSON — só cria se não existir, nunca sobrescreve
  // Isso garante que senhas alteradas pelo painel não sejam resetadas no deploy
  if (USERS_JSON) {
    try {
      const extraUsers = JSON.parse(Buffer.from(USERS_JSON, "base64").toString("utf8"));
      for (const u of extraUsers) {
        if (!u.username || !u.password) continue;
        const hash = bcrypt.hashSync(u.password, 10);
        const result = await pgPool.query(`
          INSERT INTO users (id, username, password, role, created_at)
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
          ON CONFLICT (username) DO NOTHING
        `, [u.username, hash, u.role || "financeiro", new Date().toISOString()]);
        if (result.rowCount > 0) {
          console.log(`✅ Usuário ${u.username} criado via USERS_JSON.`);
        }
      }
    } catch (e) {
      console.error("❌ Erro ao processar USERS_JSON:", e.message);
    }
  }

  // Se o banco tem só o admin (reset detectado), tenta restaurar do Sheets
  const { rows: countRows } = await pgPool.query(
    "SELECT COUNT(*) AS total FROM users WHERE username != $1", [ADMIN_USER]
  );
  const totalNaoAdmin = parseInt(countRows[0].total, 10);
  console.log(`ℹ️  Usuários no banco Neon (exceto admin): ${totalNaoAdmin}`);
  if (totalNaoAdmin === 0) {
    console.log("⚠️  Banco vazio — tentando restaurar usuários do Sheets...");
    await restaurarUsuariosDeSheets();
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
initDb().catch(e => console.error("❌ Erro ao inicializar Neon:", e.message));

// Sincroniza links de comprovante da planilha para recibos existentes no banco
async function sincronizarComprovantes() {
  try {
    const sheets = getSheetsClient();
    if (!sheets) return;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:M`,
    });
    const rows = res.data.values || [];
    let atualizados = 0;
    for (const row of rows) {
      const link = row[10] || "";
      if (!link) continue;
      const num = row[12] || "";
      const cpf = row[2] || "";
      // Tenta achar pelo número do recibo, senão pelo CPF + data
      let recibo = null;
      if (num) recibo = await findOne(dbRecibos, { num });
      if (!recibo && cpf) recibo = await findOne(dbRecibos, { cpf, data: row[4] || "" });
      if (!recibo) continue;
      if (recibo.link_comprovante === link) continue;
      await update(dbRecibos, { _id: recibo._id }, { link_comprovante: link });
      atualizados++;
    }
    if (atualizados > 0) console.log(`✅ ${atualizados} comprovantes sincronizados da planilha.`);
  } catch (e) {
    console.error("❌ Erro ao sincronizar comprovantes:", e.message);
  }
}
sincronizarComprovantes();

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

// Unifica nomes por CPF: todos os recibos do mesmo CPF ficam com o nome do registro mais antigo
async function unificarNomesPorCPF() {
  try {
    const todos = await find(dbRecibos, {}, { timestamp: 1 });
    const nomePorCPF = {};
    // Pega o nome do registro mais antigo de cada CPF
    for (const r of todos) {
      const cpfKey = (r.cpf || "").replace(/\D/g, "");
      if (!cpfKey) continue;
      if (!nomePorCPF[cpfKey]) nomePorCPF[cpfKey] = r.nome;
    }
    // Corrige todos os registros que têm nome diferente do canonical
    let corrigidos = 0;
    for (const r of todos) {
      const cpfKey = (r.cpf || "").replace(/\D/g, "");
      if (!cpfKey) continue;
      const nomeCanonical = nomePorCPF[cpfKey];
      if (nomeCanonical && r.nome !== nomeCanonical) {
        await update(dbRecibos, { _id: r._id }, { nome: nomeCanonical });
        corrigidos++;
      }
    }
    if (corrigidos > 0) console.log(`✅ ${corrigidos} registros com nome unificado por CPF.`);
  } catch (e) {
    console.error("❌ Erro ao unificar nomes por CPF:", e.message);
  }
}
unificarNomesPorCPF();

// Corrige links de comprovante gerados com URL absoluta errada (ex: http://localhost:8080/api/comprovante/...)
async function corrigirLinksComprovante() {
  try {
    const todos = await find(dbRecibos, {});
    let corrigidos = 0;
    for (const r of todos) {
      if (!r.link_comprovante) continue;
      // Converte URL absoluta local (http://localhost:8080/api/comprovante/...)
      const matchLocal = r.link_comprovante.match(/\/api\/comprovante\/(.+)$/);
      if (matchLocal && r.link_comprovante.startsWith("http")) {
        await update(dbRecibos, { _id: r._id }, { link_comprovante: `/api/comprovante/${matchLocal[1]}` });
        corrigidos++;
        continue;
      }
      // Converte URL pública S3 (https://bucket.s3.region.amazonaws.com/comprovantes/...)
      const matchS3 = r.link_comprovante.match(/amazonaws\.com\/(.+)$/);
      if (matchS3) {
        await update(dbRecibos, { _id: r._id }, { link_comprovante: `/api/comprovante-s3/${matchS3[1]}` });
        corrigidos++;
      }
    }
    if (corrigidos > 0) console.log(`✅ ${corrigidos} links de comprovante corrigidos.`);
  } catch (e) {
    console.error("❌ Erro ao corrigir links de comprovante:", e.message);
  }
}
corrigirLinksComprovante();

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));

// Aceita HTTPS normalmente (não faz downgrade para HTTP)
// Quando tiver domínio próprio + certificado SSL, descomentar para forçar HTTPS:
// app.use((req, res, next) => {
//   if (req.headers["x-forwarded-proto"] === "http") return res.redirect(301, "https://" + req.headers.host + req.url);
//   next();
// });

app.use(express.static(path.join(__dirname, "public")));

// Headers de segurança
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

async function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ erro: "Não autorizado" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Verifica se o usuário ainda existe no banco (invalida tokens de usuários deletados)
    const { rows } = await pgPool.query("SELECT id FROM users WHERE id = $1", [payload.id]);
    if (!rows[0]) return res.status(401).json({ erro: "Sessão inválida, faça login novamente" });
    req.user = payload;
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
  const ip = getClientIp(req);
  if (checkRateLimit(ip)) return res.status(429).json({ erro: "Muitas tentativas. Aguarde 15 minutos." });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ erro: "Dados inválidos" });
  const { rows } = await pgPool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ erro: "Usuário ou senha incorretos" });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role || "financeiro" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username: user.username, role: user.role || "financeiro" });
});

// ── UPLOAD COMPROVANTE ─────────────────────────────────────
app.post("/api/upload-comprovante", auth, upload.single("comprovante"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });
    const bucket = process.env.BUCKET_NAME;
    if (bucket) {
      const ext = path.extname(req.file.originalname) || "";
      const key = `comprovantes/${crypto.randomBytes(16).toString("hex")}${ext}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      res.json({ link: `/api/comprovante-s3/${key}` });
    } else {
      const filename = crypto.randomBytes(16).toString("hex") + (path.extname(req.file.originalname) || "");
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      res.json({ link: `/api/comprovante/${filename}` });
    }
  } catch (e) {
    console.error("Erro upload comprovante:", e);
    res.status(500).json({ erro: "Erro ao salvar comprovante: " + e.message });
  }
});

// ── PROXY S3: serve arquivo do bucket privado ──────────────────────────────
app.get("/api/comprovante-s3/*", auth, async (req, res) => {
  try {
    const key = req.params[0];
    const bucket = process.env.BUCKET_NAME;
    if (!bucket) return res.status(404).json({ erro: "Bucket não configurado." });
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj = await s3Client.send(cmd);
    res.setHeader("Content-Type", obj.ContentType || "application/octet-stream");
    obj.Body.pipe(res);
  } catch (e) {
    console.error("Erro ao servir comprovante S3:", e);
    res.status(404).json({ erro: "Arquivo não encontrado." });
  }
});

// ── VINCULAR COMPROVANTE A UM RECIBO (qualquer role, inclusive recepcao) ───
app.patch("/api/recibos/:id/comprovante", auth, async (req, res) => {
  const { link_comprovante } = req.body;
  if (!link_comprovante) return res.status(400).json({ erro: "link_comprovante é obrigatório." });
  await update(dbRecibos, { _id: req.params.id }, { link_comprovante });
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (recibo && recibo.num) {
    atualizarNoSheets(recibo.num, { ...recibo, link_comprovante });
  }
  res.json({ ok: true });
});

// ── VER COMPROVANTE (disco local — fallback sem S3) ────────
app.get("/api/comprovante/:filename", auth, (req, res) => {
  const safe = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
  res.sendFile(filePath);
});

// ── ROTAS RECIBOS ──────────────────────────────────────────
app.get("/api/recibos", auth, async (req, res) => {
  const recibos = await find(dbRecibos, {}, { timestamp: -1 });
  res.json(recibos.map(r => ({ ...r, id: r._id })));
});

app.post("/api/recibos", auth, async (req, res) => {
  const { num, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp } = req.body;
  // Se CPF já existe, usa o nome já cadastrado (CPF é identidade única do cliente)
  const existente = await findOne(dbRecibos, { cpf });
  const nome = existente
    ? existente.nome
    : (req.body.nome || "").replace(/\b\w/g, c => c.toUpperCase());
  const doc = await insert(dbRecibos, { num, nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"", link_comprovante: link_comprovante||"", timestamp });
  registrarNoSheets({ num_recibo: num, nome, cpf, municipio_uf, valor, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante });
  res.json({ id: doc._id });
});

app.put("/api/recibos/:id", auth, financeiroOnly, async (req, res) => {
  const { nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante } = req.body;
  const upd = { nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"" };
  if (link_comprovante) upd.link_comprovante = link_comprovante;
  await update(dbRecibos, { _id: req.params.id }, upd);
  // Atualiza também na planilha
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (recibo && recibo.num) {
    atualizarNoSheets(recibo.num, { ...upd, link_comprovante: upd.link_comprovante || recibo.link_comprovante });
  }
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

    const nomeBase = `recibo_${dados.num_recibo.replace(/[\/\\]/g, "-")}_${dados.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase()}`;

    if (dados.formato === "pdf") {
      // ── Gerar PDF ──
      const chunks = [];
      const pdf = new PDFDocument({ margin: 60, size: "A4" });
      pdf.on("data", c => chunks.push(c));
      await new Promise((resolve, reject) => {
        pdf.on("end", resolve);
        pdf.on("error", reject);

        // Logo
        if (logoExists) {
          pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
        }

        pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
          .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
        pdf.fontSize(12).fillColor("#000000")
          .text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);

        // Linha separadora
        const lx = pdf.page.margins.left;
        const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
        pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);

        pdf.fontSize(12).font("Helvetica-Bold")
          .text(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: "center" }).moveDown(0.2);
        pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);

        pdf.fontSize(11).font("Helvetica")
          .text(textoCorpo, { align: "justify" }).moveDown(0.6);
        pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);

        pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);

        pdf.text(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: "left" }).moveDown(6);

        // Assinatura cliente — centro
        const cx = pdf.page.width / 2;
        pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
        pdf.fontSize(10).text(dados.nome, { align: "center" }).moveDown(0.1);
        pdf.fontSize(9).text(`${labelDoc}: ${dados.cpf}`, { align: "center" }).moveDown(5);

        // Assinatura emissor — esquerda
        pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
        pdf.fontSize(10).text(dados.emitido_por || "A ARAUJO PREV", { align: "left" });

        // Logo rodapé
        if (logoExists) {
          pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
        }

        pdf.end();
      });

      const pdfBuf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.pdf"`);
      res.send(pdfBuf);
    } else {
      // ── Gerar DOCX (padrão) ──
      const buf = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.docx"`);
      res.send(buf);
    }
  } catch (e) {
    console.error("Erro ao gerar recibo:", e.message);
    res.status(500).json({ erro: "Erro ao gerar documento." });
  }
});

// ── ROTAS USUÁRIOS ─────────────────────────────────────────
app.get("/api/users", auth, adminOnly, async (req, res) => {
  const { rows } = await pgPool.query("SELECT id, username, role, created_at FROM users ORDER BY created_at ASC");
  res.json(rows);
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pgPool.query(
      "INSERT INTO users (id, username, password, role, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING id",
      [username, hash, role || "financeiro", new Date().toISOString()]
    );
    sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
    res.json({ id: rows[0].id, username });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ erro: "Usuário já existe" });
    throw e;
  }
});

app.put("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username) return res.status(400).json({ erro: "Preencha o usuário." });
  if (password) {
    await pgPool.query(
      "UPDATE users SET username=$1, role=$2, password=$3 WHERE id=$4",
      [username, role || "financeiro", bcrypt.hashSync(password, 10), req.params.id]
    );
  } else {
    await pgPool.query(
      "UPDATE users SET username=$1, role=$2 WHERE id=$3",
      [username, role || "financeiro", req.params.id]
    );
  }
  sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { rows } = await pgPool.query("SELECT username FROM users WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (rows[0].username === ADMIN_USER) return res.status(400).json({ erro: "Não é possível remover o admin." });
  await pgPool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
  sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
  res.json({ ok: true });
});

// ── GOV.BR — ASSINATURA DIGITAL ────────────────────────────
// Credenciais fornecidas pelo Gov.br após cadastro em:
// https://www.gov.br/governodigital/pt-br/privacidade-e-seguranca/login-unico
//
// Variáveis de ambiente necessárias no Elastic Beanstalk:
//   GOVBR_CLIENT_ID     → client_id recebido do Gov.br
//   GOVBR_CLIENT_SECRET → client_secret recebido do Gov.br
//   GOVBR_REDIRECT_URI  → URL de callback (ex: http://seu-dominio/api/govbr/callback)
//
// Ambientes:
//   Homologação: https://sso.staging.acesso.gov.br
//   Produção:    https://sso.acesso.gov.br

const GOVBR_CLIENT_ID     = process.env.GOVBR_CLIENT_ID     || "";
const GOVBR_CLIENT_SECRET = process.env.GOVBR_CLIENT_SECRET || "";
const GOVBR_REDIRECT_URI  = process.env.GOVBR_REDIRECT_URI  || "";
const GOVBR_BASE_URL      = process.env.GOVBR_ENV === "producao"
  ? "https://sso.acesso.gov.br"
  : "https://sso.staging.acesso.gov.br";

// Verifica se Gov.br está configurado
function govbrConfigurado() {
  return !!(GOVBR_CLIENT_ID && GOVBR_CLIENT_SECRET && GOVBR_REDIRECT_URI);
}

// Gera state aleatório para segurança OAuth2
function gerarState() {
  return require("crypto").randomBytes(16).toString("hex");
}

// Armazena states temporários (expira em 10 min)
const govbrStates = new Map();

// PASSO 1 — Inicia fluxo OAuth2: retorna URL de redirecionamento para o Gov.br
app.get("/api/govbr/iniciar", auth, (req, res) => {
  if (!govbrConfigurado()) {
    return res.status(503).json({ erro: "Integração Gov.br não configurada. Aguardando credenciais." });
  }
  const { recibo_id } = req.query;
  if (!recibo_id) return res.status(400).json({ erro: "recibo_id obrigatório" });

  const state = gerarState();
  govbrStates.set(state, { recibo_id, user: req.user.username, expires: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: GOVBR_CLIENT_ID,
    scope: "openid email profile govbr_empresa govbr_confiabilidades",
    redirect_uri: GOVBR_REDIRECT_URI,
    state,
    nonce: gerarState(),
  });

  res.json({ url: `${GOVBR_BASE_URL}/authorize?${params.toString()}` });
});

// PASSO 2 — Callback: Gov.br redireciona aqui após o cliente autenticar
app.get("/api/govbr/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?govbr_erro=${encodeURIComponent(error)}`);
  }

  const stateData = govbrStates.get(state);
  if (!stateData || Date.now() > stateData.expires) {
    return res.redirect("/?govbr_erro=state_invalido");
  }
  govbrStates.delete(state);

  try {
    // Troca code por token
    const tokenRes = await fetch(`${GOVBR_BASE_URL}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: GOVBR_REDIRECT_URI,
        client_id: GOVBR_CLIENT_ID,
        client_secret: GOVBR_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token não recebido");

    // Busca dados do usuário (nome, CPF)
    const userRes = await fetch(`${GOVBR_BASE_URL}/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userRes.json();

    // Salva assinatura no recibo
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const assinatura = {
      cpf_assinante: userInfo.sub || "",
      nome_assinante: userInfo.name || "",
      email_assinante: userInfo.email || "",
      nivel_confiabilidade: userInfo.amr ? userInfo.amr.join(",") : "",
      assinado_em: agora.toLocaleString("pt-BR"),
      metodo: "govbr",
    };

    await update(dbRecibos, { _id: stateData.recibo_id }, { assinatura_govbr: assinatura });
    console.log(`✅ Recibo ${stateData.recibo_id} assinado via Gov.br por ${assinatura.nome_assinante}`);

    // Redireciona de volta para o app com sucesso
    res.redirect(`/?govbr_ok=1&recibo_id=${stateData.recibo_id}`);
  } catch (e) {
    console.error("❌ Erro no callback Gov.br:", e.message);
    res.redirect(`/?govbr_erro=${encodeURIComponent(e.message)}`);
  }
});

// PASSO 3 — Retorna status da assinatura de um recibo
app.get("/api/govbr/status/:id", auth, async (req, res) => {
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (!recibo) return res.status(404).json({ erro: "Recibo não encontrado" });
  res.json({
    assinado: !!recibo.assinatura_govbr,
    assinatura: recibo.assinatura_govbr || null,
    configurado: govbrConfigurado(),
  });
});

// ── INICIAR ────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ Araujo Prev rodando em http://localhost:${PORT}`);
});
