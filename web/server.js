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
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
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
const rateLimit = require("express-rate-limit");
const archiver = require("archiver");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

// ── GOOGLE SHEETS ───────────────────────────────────────────
const SHEET_ID = process.env.SHEET_ID || "1qbpuZo5HLQHw4itjWbnXJNjBjIy63So3erMswhP2-68";
const SHEET_NAME = "Respostas ao formulário 1";
const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];

function getSheetsClient() {
  const credsB64 = process.env.GOOGLE_CREDENTIALS;
  if (!credsB64) {
    console.warn("⚠️  GOOGLE_CREDENTIALS não configurado — integração com Sheets desativada.");
    return null;
  }
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

// Testa a conexão com o Sheets no startup para detectar problemas cedo
async function testarConexaoSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "spreadsheetId" });
    console.log("✅ Conexão com Google Sheets OK.");
  } catch (e) {
    console.error(`❌ FALHA na conexão com Google Sheets: ${e.message}`);
    console.error("   → Recibos NÃO serão salvos na planilha enquanto isso persistir.");
    console.error(`   → Planilha ID: ${SHEET_ID}`);
  }
}

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "1BUAPGfIIyehGWkmYlas0SYER3kriQK_H";

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

// Converte presigned URL S3 para path relativo — nunca expõe URL temporária na planilha (SEC-014)
function sanitizarLinkParaSheets(link) {
  if (!link) return "";
  // Presigned URL: https://bucket.s3.region.amazonaws.com/KEY?X-Amz-...
  const s3Match = link.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
  if (s3Match) return `/api/comprovante-s3/${s3Match[1]}`;
  return link;
}

async function registrarNoSheets(dados) {
  const sheets = getSheetsClient();
  if (!sheets) return false;
  try {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const horaFormatada = agora.toLocaleTimeString("pt-BR");
    const carimbo = `${agora.toLocaleDateString("pt-BR")} ${horaFormatada}`;

    // Usa a data do pagamento informada; cai para hoje se ausente
    const dataPagamento = dados.data || agora.toLocaleDateString("pt-BR");
    const [dp, mp] = dataPagamento.split("/");
    const mesPagamento = (dp && mp && mp.length <= 2)
      ? MESES[parseInt(mp, 10) - 1] || MESES[agora.getMonth()]
      : MESES[agora.getMonth()];

    const linha = [
      carimbo,                                          // A: Carimbo de data/hora
      dados.nome || "",                                 // B: Nome completo do cliente
      dados.cpf || "",                                  // C: CPF do cliente
      dados.valor ? `R$ ${dados.valor}` : "",            // D: Valor pago
      dataPagamento,                                    // E: Data do pagamento
      dataPagamento,                                    // F: Data do depósito
      dados.forma_pagamento || "",                      // G: Forma de pagamento
      dados.motivo_pagamento || dados.complemento || "Honorários Advocatícios", // H: Motivo de pagamento
      dados.escritorio || "",                           // I: Escritório
      "",                                               // J: Alguma observação (não usado)
      sanitizarLinkParaSheets(dados.link_comprovante),   // K: Anexo comprovante (path relativo — SEC-014)
      mesPagamento,                                     // L: Mês
      dados.num_recibo || "",                           // M: Número do recibo
      dados.emitido_por || "",                          // N: Responsável (emitido por)
      dados.referencia || "",                           // O: Referência (gaveta)
    ];

    // Determina a próxima linha vazia lendo a coluna A inteira — evita table-detection
    // do values.append que pode inserir no meio dos dados quando há linhas em branco.
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    const nextRow = (colA.data.values || []).length + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${nextRow}:O${nextRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [linha] },
    });
    console.log(`✅ Recibo ${dados.num_recibo} registrado no Google Sheets (linha ${nextRow})`);
    return true;
  } catch (e) {
    console.error("❌ Erro ao registrar no Google Sheets:", e.message);
    return e.message;
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
      sanitizarLinkParaSheets(dados.link_comprovante),      // K: Comprovante (path relativo — SEC-014)
      mes,                                                 // L: Mês
      num,                                                 // M: Número recibo
      dados.emitido_por || "",                             // N: Responsável
      dados.referencia || "",                              // O: Referência
    ];
    // Atualiza apenas colunas B-O (não mexe no carimbo)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B${rowNum}:O${rowNum}`,
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



// ── BANCO DE DADOS ─────────────────────────────────────────
const dbDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// ── UPLOAD DE COMPROVANTES ─────────────────────────────────
const uploadsDir = path.join(dbDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// S3 — usado quando BUCKET_NAME estiver configurado
const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

// Cliente S3 com credenciais IAM estáticas — necessário para presigned URLs longas.
// Credenciais do instance profile são temporárias e invalidam a URL antes do prazo.
const s3SignerClient = (process.env.S3_SIGNER_KEY_ID && process.env.S3_SIGNER_SECRET)
  ? new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.S3_SIGNER_KEY_ID,
        secretAccessKey: process.env.S3_SIGNER_SECRET,
      },
    })
  : s3Client; // fallback para instance profile se env vars não estiverem definidas

// Gera URL pré-assinada do S3 para links de comprovante na planilha.
// Serviço de conta Google (service account) não tem cota de armazenamento no Drive,
// portanto não é possível fazer upload; presigned URL é o único caminho viável.
async function linkParaSheets(link) {
  if (!link) return "";
  const s3Match = link.match(/^\/api\/comprovante-s3\/(.+)$/);
  if (!s3Match) return link;

  const bucket = process.env.BUCKET_NAME;
  if (!bucket) return link;

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: s3Match[1] });
    const urlPromise = getSignedUrl(s3SignerClient, cmd, { expiresIn: 30 * 24 * 3600 });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000));
    return await Promise.race([urlPromise, timeoutPromise]);
  } catch (e) {
    console.error("❌ Presigned URL falhou:", e.message);
    return link;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const dbRecibos   = new Datastore({ filename: path.join(dbDir, "recibos.db"),   autoload: true });
const dbClientes  = new Datastore({ filename: path.join(dbDir, "clientes.db"),  autoload: true });
const dbAuditoria = new Datastore({ filename: path.join(dbDir, "auditoria.db"), autoload: true });

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
      "SELECT username, role, escritorio, created_at FROM users WHERE username != $1 ORDER BY created_at ASC",
      [ADMIN_USER]
    );
    // Sem coluna password — hash bcrypt não deve ficar exposto na planilha (SEC-010)
    const valores = rows.map(u => [u.username, u.role, u.escritorio || "", u.created_at]);
    // Limpa range antigo (incluindo col E de password residual) e reescreve sem senha
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: "Usuarios!A:E",
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

// Restaura usuários do Sheets para o Neon (chamado quando DB está vazio após reset).
// Formato atual (SEC-010): 4 colunas — username, role, escritorio, created_at (sem senha).
// Usuários restaurados recebem hash placeholder inutilizável; admin deve redefinir senhas.
async function restaurarUsuariosDeSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return 0;
  try {
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Usuarios!A:D",
    });
    const linhas = sheetRes.data.values || [];
    if (linhas.length === 0) return 0;
    let restaurados = 0;
    for (const [username, role, escritorio, created_at] of linhas) {
      if (!username) continue;
      // Hash impossível de autenticar — usuário deve ter senha redefinida pelo admin
      const placeholderHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
      const result = await pgPool.query(`
        INSERT INTO users (id, username, password, role, escritorio, created_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
        ON CONFLICT (username) DO NOTHING
      `, [username, placeholderHash, role || "financeiro", escritorio || "", created_at || new Date().toISOString()]);
      if (result.rowCount > 0) {
        restaurados++;
        console.warn(`⚠️  Usuário '${username}' restaurado sem senha — admin deve redefinir via painel.`);
      }
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
      escritorio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  // Migração: adiciona colunas caso a tabela já exista sem elas
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS escritorio TEXT NOT NULL DEFAULT ''
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referencia_padrao TEXT DEFAULT ''
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nome_completo TEXT DEFAULT ''
  `);
  // Tabela de states OAuth Gov.br — TTL gerenciado por expira_em (SEC-012)
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS govbr_states (
      state      TEXT PRIMARY KEY,
      recibo_id  TEXT NOT NULL,
      username   TEXT NOT NULL,
      expira_em  TIMESTAMPTZ NOT NULL
    )
  `);
  // Limpeza de states expirados ao iniciar
  await pgPool.query(`DELETE FROM govbr_states WHERE expira_em < NOW()`);
  console.log("✅ Tabela govbr_states pronta.");

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
          INSERT INTO users (id, username, password, role, escritorio, created_at)
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
          ON CONFLICT (username) DO NOTHING
        `, [u.username, hash, u.role || "financeiro", u.escritorio || "", new Date().toISOString()]);
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
      range: `${SHEET_NAME}!A4:O`,
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
      const num        = row[12] || `${String(i + 1).padStart(4, "0")}/${(data.split("/")[2] || String(new Date().getFullYear()))}`;
      const emitido_por = row[13] || "";
      const referencia  = row[14] || "";
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
      await insert(dbRecibos, { num, nome, cpf, municipio_uf: "", valor, data, emitido_por, complemento: "", referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp });
      importados++;
    }
    console.log(`✅ ${importados} recibos restaurados da planilha Google Sheets.`);
  } catch (e) {
    console.error("❌ Erro ao sincronizar recibos da planilha:", e.message);
  }
}
testarConexaoSheets();
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
      // Nunca sobrescreve link existente — só preenche se banco estiver vazio
      if (recibo.link_comprovante) continue;
      // Nunca salva presigned URL (expira em horas) — só Drive links
      if (link.includes("amazonaws.com")) continue;
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
    const todos = await find(dbRecibos, NAO_DELETADO);
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
    const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: 1 });
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
    const todos = await find(dbRecibos, NAO_DELETADO);
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
      // Converte URL pública S3 ou presigned URL (https://bucket.s3.*.amazonaws.com/KEY?X-Amz-...)
      const matchS3 = r.link_comprovante.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
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
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self'; " +
    "frame-src https://drive.google.com blob:;"
  );
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

// Bloqueia recepcao E precatorios — usado em operações de escrita (criar/editar/deletar)
function financeiroOnly(req, res, next) {
  if (req.user.role === "recepcao" || req.user.role === "precatorios")
    return res.status(403).json({ erro: "Sem permissão para esta ação." });
  next();
}

// Bloqueia apenas recepcao — relatórios e leituras que precatorios pode acessar
function semRecepcao(req, res, next) {
  if (req.user.role === "recepcao") return res.status(403).json({ erro: "Sem permissão para esta ação." });
  next();
}

// Bloqueia apenas precatorios — permite recepcao criar/editar (mas não excluir) clientes
function semPrecatorios(req, res, next) {
  if (req.user.role === "precatorios") return res.status(403).json({ erro: "Sem permissão para esta ação." });
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

function findLimited(db, query, sort, limitN) {
  return new Promise((res, rej) => {
    let cursor = db.find(query);
    if (sort) cursor = cursor.sort(sort);
    if (limitN) cursor = cursor.limit(limitN);
    cursor.exec((err, docs) => err ? rej(err) : res(docs));
  });
}

function maskCPF(cpf) {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`;
  if (d.length === 14) return `**.***.***/****-**`;
  return "***";
}

async function registrarAuditoria(req, acao, entidade_id, dados) {
  try {
    await insert(dbAuditoria, {
      ts: new Date().toISOString(),
      usuario: req.user?.username || "sistema",
      role: req.user?.role || "",
      acao,
      entidade_id: entidade_id || "",
      dados: dados || {},
    });
  } catch (e) {
    console.error(`❌ Auditoria falhou (${acao}):`, e.message);
  }
}

// ── ROTAS AUTH ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas de login. Aguarde 15 minutos." },
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ erro: "Dados inválidos" });
  const { rows } = await pgPool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ erro: "Usuário ou senha incorretos" });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" });
});

// ── DADOS DO USUÁRIO LOGADO ────────────────────────────────
app.get("/api/me", auth, async (req, res) => {
  const { rows } = await pgPool.query(
    "SELECT id, username, nome_completo, role, escritorio, referencia_padrao FROM users WHERE id=$1",
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado" });
  res.json(rows[0]);
});

app.put("/api/me/referencia", auth, async (req, res) => {
  const { referencia_padrao } = req.body;
  if (typeof referencia_padrao !== "string") return res.status(400).json({ erro: "Valor inválido" });
  if (referencia_padrao.length > 20) return res.status(400).json({ erro: "Referência muito longa (máx. 20 caracteres)." });
  await pgPool.query(
    "UPDATE users SET referencia_padrao=$1 WHERE id=$2",
    [referencia_padrao.toUpperCase(), req.user.id]
  );
  res.json({ ok: true });
});

app.put("/api/me/nome-completo", auth, async (req, res) => {
  const { nome_completo } = req.body;
  if (typeof nome_completo !== "string") return res.status(400).json({ erro: "Valor inválido" });
  if (nome_completo.length > 80) return res.status(400).json({ erro: "Nome muito longo (máx. 80 caracteres)." });
  await pgPool.query("UPDATE users SET nome_completo=$1 WHERE id=$2", [nome_completo.trim(), req.user.id]);
  res.json({ ok: true });
});

// ── UPLOAD COMPROVANTE ─────────────────────────────────────
app.post("/api/upload-comprovante", auth, upload.single("comprovante"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

    // Validação de magic bytes — rejeita arquivos com assinatura desconhecida
    const sig = req.file.buffer.slice(0, 8);
    const isPDF  = sig.slice(0, 4).toString("ascii") === "%PDF";
    const isJPEG = sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF;
    const isPNG  = sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47;
    if (!isPDF && !isJPEG && !isPNG) {
      return res.status(400).json({ erro: "Tipo de arquivo não permitido. Envie PDF, JPEG ou PNG." });
    }

    const ext = path.extname(req.file.originalname) || "";
    const nomeArquivo = `comprovante_${crypto.randomBytes(8).toString("hex")}${ext}`;

    // S3 quando bucket configurado
    const bucket = process.env.BUCKET_NAME;
    if (bucket) {
      const key = `comprovantes/${nomeArquivo}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      return res.json({ link: `/api/comprovante-s3/${key}` });
    }

    // Fallback: arquivo local
    fs.writeFileSync(path.join(uploadsDir, nomeArquivo), req.file.buffer);
    res.json({ link: `/api/comprovante/${nomeArquivo}` });
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
  const linkValido = /^(\/api\/comprovante|https:\/\/drive\.google\.com|https:\/\/.*\.amazonaws\.com)/.test(link_comprovante);
  if (!linkValido) return res.status(400).json({ erro: "Formato de link inválido." });
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

// ── ROTAS CLIENTES ─────────────────────────────────────────
function parseBRL(str) {
  return parseFloat(String(str || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function gerarParcelas(numParcelas, valorContrato) {
  const valorParcela = numParcelas > 0 ? valorContrato / numParcelas : 0;
  return Array.from({ length: numParcelas }, (_, i) => ({
    num: i + 1,
    valor: valorParcela,
    status: "pendente",
    data_vencimento: "",
    data_recebimento: "",
    data_deposito: "",
    recibo_id: "",
    recibo_num: "",
    observacao: "",
  }));
}

function recalcularResumo(parcelas) {
  if (!Array.isArray(parcelas) || parcelas.length === 0) {
    return { parcelas_pagas: 0, parcelas_restantes: 0, valor_pago: 0, valor_restante: 0, updated_at: new Date().toISOString() };
  }
  const pagas     = parcelas.filter(p => p.status === "pago");
  const restantes = parcelas.filter(p => p.status !== "pago");
  return {
    parcelas_pagas:     pagas.length,
    parcelas_restantes: restantes.length,
    valor_pago:         pagas.reduce((s, p) => s + (p.valor || 0), 0),
    valor_restante:     restantes.reduce((s, p) => s + (p.valor || 0), 0),
    updated_at:         new Date().toISOString(),
  };
}

// Registros não-deletados (soft delete) — usar em todas as queries de listagem
const NAO_DELETADO = { deletado_em: { $exists: false } };

function validarCPF(cpf) {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== Number(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === Number(d[10]);
}

function validarCNPJ(cnpj) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n) => {
    let s = 0, pos = n - 7;
    for (let i = 0; i < n; i++) { s += Number(d[i]) * pos--; if (pos < 2) pos = 9; }
    const rem = s % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

// Converte "DD/MM/YYYY" → "YYYY-MM" para filtros de mês
function mesDeData(dataStr) {
  if (!dataStr) return null;
  const parts = String(dataStr).split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}/.test(dataStr)) return dataStr.slice(0, 7);
  return null;
}

// Migração on-the-fly: clientes sem campo parcelas recebem array inicializado
function inicializarParcelasLegado(c) {
  if (c.parcelas && c.parcelas.length > 0) return c;
  const numParcelas   = c.num_parcelas || 0;
  const valorContrato = c.valor_contrato || 0;
  const valorParcela  = numParcelas > 0 ? valorContrato / numParcelas : 0;
  const jaPagas       = c.parcelas_pagas || 0;
  const parcelas = Array.from({ length: numParcelas }, (_, i) => ({
    num: i + 1,
    valor: valorParcela,
    status: i < jaPagas ? "pago" : "pendente",
    data_vencimento: "",
    data_recebimento: "",
    data_deposito: "",
    recibo_id: "",
    recibo_num: "",
    observacao: "",
  }));
  const resumo = recalcularResumo(parcelas);
  return { ...c, parcelas, ...resumo };
}

async function enriquecerCliente(c) {
  const cliente = inicializarParcelasLegado(c);
  const valorParcela = cliente.num_parcelas > 0 ? cliente.valor_contrato / cliente.num_parcelas : 0;
  const hoje = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const parcelas = (cliente.parcelas || []).map(p => {
    if (p.status === "pendente" && p.data_vencimento && p.data_vencimento < hoje) {
      return { ...p, status: "atrasado" };
    }
    return p;
  });
  return { ...cliente, parcelas, id: cliente._id, valor_parcela: valorParcela };
}

// Busca por CPF — deve vir antes de /:id para não colidir
app.get("/api/clientes/cpf/:cpf", auth, async (req, res) => {
  const cliente = await findOne(dbClientes, { cpf: req.params.cpf });
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  res.json(await enriquecerCliente(cliente));
});

app.get("/api/clientes", auth, async (req, res) => {
  const clientes = await find(dbClientes, NAO_DELETADO, { nome: 1 });
  const enriquecidos = await Promise.all(clientes.map(enriquecerCliente));
  res.json(enriquecidos);
});

app.get("/api/clientes/:id", auth, async (req, res) => {
  const cliente = await findOne(dbClientes, { _id: req.params.id, ...NAO_DELETADO });
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  res.json(await enriquecerCliente(cliente));
});

app.post("/api/clientes", auth, semPrecatorios, async (req, res) => {
  const {
    nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
    valor_beneficio, num_beneficios, valor_contrato, num_parcelas,
  } = req.body;
  if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
  if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
  const digsCliente = (cpf || "").replace(/\D/g, "");
  if (digsCliente.length === 11 && !validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
  if (digsCliente.length === 14 && !validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

  // Calcula valor_contrato: prefere o enviado, senão calcula a partir dos benefícios
  const vBeneficio  = Number(valor_beneficio) || 0;
  const nBeneficios = Number(num_beneficios) || 0;
  const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
  if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });

  const existente = await findOne(dbClientes, { cpf });
  if (existente) return res.status(400).json({ erro: "Já existe um cliente cadastrado com este CPF." });

  const nParcelas = Number(num_parcelas);
  const parcelas  = gerarParcelas(nParcelas, vContrato);
  const resumo    = recalcularResumo(parcelas);

  const doc = await insert(dbClientes, {
    nome, cpf,
    telefone: telefone || "",
    endereco: endereco || "",
    municipio_uf,
    firma: firma || "",
    referencia: referencia || "",
    valor_beneficio: vBeneficio,
    num_beneficios: nBeneficios,
    valor_contrato: vContrato,
    num_parcelas: nParcelas,
    valor_parcela: nParcelas > 0 ? vContrato / nParcelas : 0,
    parcelas,
    ...resumo,
    created_at: new Date().toISOString(),
  });
  res.json(await enriquecerCliente(doc));
});

app.put("/api/clientes/:id", auth, semPrecatorios, async (req, res) => {
  const {
    nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
    valor_beneficio, num_beneficios, valor_contrato, num_parcelas, parcelas,
  } = req.body;
  if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
  if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
  const digsEdit = (cpf || "").replace(/\D/g, "");
  if (digsEdit.length === 11 && !validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
  if (digsEdit.length === 14 && !validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

  const vBeneficio  = Number(valor_beneficio) || 0;
  const nBeneficios = Number(num_beneficios) || 0;
  const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
  if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });

  const outro = await findOne(dbClientes, { cpf });
  if (outro && outro._id !== req.params.id) return res.status(400).json({ erro: "CPF já cadastrado em outro cliente." });

  const nParcelas = Number(num_parcelas);
  const atual     = await findOne(dbClientes, { _id: req.params.id });
  if (!atual) return res.status(404).json({ erro: "Cliente não encontrado." });

  // Usa o array de parcelas enviado pelo front; se não veio, mantém o existente ou regenera
  let novasParcelas;
  if (Array.isArray(parcelas) && parcelas.length > 0) {
    novasParcelas = parcelas;
  } else if (atual && Array.isArray(atual.parcelas) && atual.parcelas.length === nParcelas) {
    novasParcelas = atual.parcelas;
  } else {
    // Número de parcelas mudou: regenera preservando as pagas
    const parcelasAntigas = (atual && Array.isArray(atual.parcelas)) ? atual.parcelas : [];
    novasParcelas = gerarParcelas(nParcelas, vContrato).map((p, i) => {
      const antiga = parcelasAntigas[i];
      return antiga ? { ...p, ...antiga, num: p.num, valor: p.valor } : p;
    });
  }

  const resumo = recalcularResumo(novasParcelas);

  await update(dbClientes, { _id: req.params.id }, {
    nome, cpf,
    telefone: telefone || "",
    endereco: endereco || "",
    municipio_uf,
    firma: firma || "",
    referencia: referencia || "",
    valor_beneficio: vBeneficio,
    num_beneficios: nBeneficios,
    valor_contrato: vContrato,
    num_parcelas: nParcelas,
    valor_parcela: nParcelas > 0 ? vContrato / nParcelas : 0,
    parcelas: novasParcelas,
    ...resumo,
  });
  const atualizado = await findOne(dbClientes, { _id: req.params.id });
  res.json(await enriquecerCliente(atualizado));
});

app.delete("/api/clientes/:id", auth, financeiroOnly, async (req, res) => {
  const cliente = await findOne(dbClientes, { _id: req.params.id });
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  await update(dbClientes, { _id: req.params.id }, {
    deletado_em: new Date().toISOString(),
    deletado_por: req.user.username,
  });
  registrarAuditoria(req, "excluir_cliente", req.params.id, { nome: cliente.nome, cpf: maskCPF(cliente.cpf) });
  res.json({ ok: true });
});

// ── OBSERVAÇÕES DE CLIENTE ─────────────────────────────────
app.post("/api/clientes/:id/observacoes", auth, financeiroOnly, async (req, res) => {
  try {
    const cliente = await findOne(dbClientes, { _id: req.params.id, ...NAO_DELETADO });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    const { texto } = req.body;
    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({ erro: "Texto da observação é obrigatório." });
    }
    if (texto.trim().length > 500) {
      return res.status(400).json({ erro: "Observação muito longa (máx. 500 caracteres)." });
    }
    const novaObs = { texto: texto.trim(), autor: req.user.username, criado_em: new Date().toISOString() };
    const observacoes = [...(cliente.observacoes || []), novaObs];
    await update(dbClientes, { _id: req.params.id }, { observacoes });
    const atualizado = await findOne(dbClientes, { _id: req.params.id });
    res.json(await enriquecerCliente(atualizado));
  } catch (e) {
    console.error("Erro ao salvar observação:", e.message);
    res.status(500).json({ erro: "Erro ao salvar observação." });
  }
});

app.delete("/api/clientes/:id/observacoes/:idx", auth, adminOnly, async (req, res) => {
  try {
    const cliente = await findOne(dbClientes, { _id: req.params.id, ...NAO_DELETADO });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    const idx = parseInt(req.params.idx, 10);
    const observacoes = [...(cliente.observacoes || [])];
    if (isNaN(idx) || idx < 0 || idx >= observacoes.length) {
      return res.status(400).json({ erro: "Índice de observação inválido." });
    }
    observacoes.splice(idx, 1);
    await update(dbClientes, { _id: req.params.id }, { observacoes });
    const atualizado = await findOne(dbClientes, { _id: req.params.id });
    res.json(await enriquecerCliente(atualizado));
  } catch (e) {
    console.error("Erro ao remover observação:", e.message);
    res.status(500).json({ erro: "Erro ao remover observação." });
  }
});

// ── LEMBRETE ENVIADO — PARCELA ─────────────────────────────
// Registra que um lembrete de cobrança foi enviado ao cliente para a parcela N
app.post("/api/clientes/:id/parcela/:num/lembrete", auth, financeiroOnly, async (req, res) => {
  try {
    const cliente = await findOne(dbClientes, { _id: req.params.id, ...NAO_DELETADO });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    const num = parseInt(req.params.num, 10);
    if (!num || num < 1) return res.status(400).json({ erro: "Número de parcela inválido." });
    const parcelasAtual = inicializarParcelasLegado(cliente).parcelas;
    const parcela = parcelasAtual.find(p => p.num === num);
    if (!parcela) return res.status(404).json({ erro: "Parcela não encontrada." });
    const parcelas = parcelasAtual.map(p =>
      p.num === num
        ? { ...p, lembrete_enviado_em: new Date().toISOString(), lembrete_enviado_por: req.user.username }
        : p
    );
    const resumo = recalcularResumo(parcelas);
    await update(dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
    const atualizado = await findOne(dbClientes, { _id: req.params.id });
    res.json(await enriquecerCliente(atualizado));
  } catch (e) {
    console.error("Erro ao registrar lembrete:", e.message);
    res.status(500).json({ erro: "Erro ao registrar lembrete." });
  }
});

app.patch("/api/clientes/:id/parcela/:num", auth, financeiroOnly, async (req, res) => {
  const cliente = await findOne(dbClientes, { _id: req.params.id });
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  const num = Number(req.params.num);
  if (!num || num < 1) return res.status(400).json({ erro: "Número de parcela inválido." });

  // Whitelist de campos aceitos — evita sobrescrever num/valor por engano
  const { status, data_recebimento, data_deposito, recibo_id, recibo_num, observacao, data_vencimento } = req.body;
  const STATUS_VALIDOS = ["pendente", "pago", "atrasado"];
  if (status !== undefined && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: "Status inválido. Use: pendente, pago ou atrasado." });
  }
  const atualizacao = {};
  if (status           !== undefined) atualizacao.status           = status;
  if (data_recebimento !== undefined) atualizacao.data_recebimento = data_recebimento;
  if (data_deposito    !== undefined) atualizacao.data_deposito    = data_deposito;
  if (recibo_id        !== undefined) atualizacao.recibo_id        = recibo_id;
  if (recibo_num       !== undefined) atualizacao.recibo_num       = recibo_num;
  if (observacao       !== undefined) atualizacao.observacao       = observacao;
  if (data_vencimento  !== undefined) atualizacao.data_vencimento  = data_vencimento;

  const parcelasAtuais = inicializarParcelasLegado(cliente).parcelas;
  const parcelas = parcelasAtuais.map(p =>
    p.num === num ? { ...p, ...atualizacao } : p
  );
  const resumo = recalcularResumo(parcelas);
  await update(dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
  if (status !== undefined) {
    registrarAuditoria(req, "atualizar_parcela", req.params.id, { num_parcela: num, status_novo: status });
  }
  const salvo = await findOne(dbClientes, { _id: req.params.id });
  res.json(await enriquecerCliente(salvo));
});

// ── ROTAS RECIBOS ──────────────────────────────────────────
app.get("/api/recibos", auth, async (req, res) => {
  const isRecepcao = req.user.role === "recepcao" && req.user.escritorio;

  // Modo cursor: ?cursor=<timestamp> retorna próxima página sem carregar tudo em memória
  if (req.query.cursor !== undefined) {
    const cursorTs = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const query = { ...NAO_DELETADO };
    if (cursorTs) query.timestamp = { $lt: cursorTs };
    if (isRecepcao) {
      const escEsc = req.user.escritorio.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.escritorio = { $regex: new RegExp("^" + escEsc + "$", "i") };
    }
    const docs = await findLimited(dbRecibos, query, { timestamp: -1 }, limit + 1);
    const hasMore = docs.length > limit;
    const recibos = docs.slice(0, limit).map(r => ({ ...r, id: r._id }));
    const nextCursor = hasMore && recibos.length > 0 ? String(recibos[recibos.length - 1].timestamp) : null;
    return res.json({ recibos, nextCursor, hasMore });
  }

  // Modo legado page/limit — mantém compatibilidade com scripts de importação e frontend atual
  const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: -1 });
  const filtrados = isRecepcao
    ? todos.filter(r => (r.escritorio || "").toUpperCase() === req.user.escritorio.toUpperCase())
    : todos;
  const total = filtrados.length;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit) || 50));
  const totalPaginas = Math.ceil(total / limit) || 1;
  const recibos = filtrados.slice((page - 1) * limit, page * limit).map(r => ({ ...r, id: r._id }));
  res.json({ recibos, total, pagina: page, totalPaginas });
});

app.post("/api/recibos", auth, async (req, res) => {
  if (req.user.role === "precatorios") return res.status(403).json({ erro: "Sem permissão para esta ação." });
  const { num, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, motivo_pagamento, link_comprovante, timestamp } = req.body;
  // Recepcao sempre usa o escritorio do seu perfil — impede digitação livre e garante nome padronizado
  const escritorio = req.user.role === "recepcao"
    ? (req.user.escritorio || "")
    : (req.body.escritorio || "");
  const digsCPF = (cpf || "").replace(/\D/g, "");
  if (digsCPF.length === 11 && !validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
  if (digsCPF.length === 14 && !validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });
  // Se CPF já existe, usa o nome já cadastrado (CPF é identidade única do cliente)
  const existente = await findOne(dbRecibos, { cpf });
  const nome = existente
    ? existente.nome
    : (req.body.nome || "").replace(/\b\w/g, c => c.toUpperCase());
  const doc = await insert(dbRecibos, { num, nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio, motivo_pagamento: motivo_pagamento||"", link_comprovante: link_comprovante||"", timestamp });
  registrarAuditoria(req, "criar_recibo", doc._id, { num, nome, escritorio, valor, cpf: maskCPF(cpf) });
  const sheets_result = await registrarNoSheets({ num_recibo: num, nome, cpf, municipio_uf, valor, data, complemento, referencia, emitido_por, forma_pagamento, escritorio, motivo_pagamento, link_comprovante });
  dispararWebhook({ num, nome, cpf, municipio_uf, valor, data, emitido_por, forma_pagamento, escritorio, referencia });
  res.json({ id: doc._id, sheets_ok: sheets_result === true, sheets_erro: sheets_result !== true ? sheets_result : null });
});

app.put("/api/recibos/:id", auth, financeiroOnly, async (req, res) => {
  const { nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante } = req.body;
  const upd = { nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"" };
  if (link_comprovante) upd.link_comprovante = link_comprovante;

  // Histórico de edições — diff dos campos auditados antes de sobrescrever
  const atual = await findOne(dbRecibos, { _id: req.params.id });
  const CAMPOS_AUDITADOS = ["nome","cpf","municipio_uf","valor","data","emitido_por","complemento","referencia","forma_pagamento","escritorio","motivo_pagamento","link_comprovante"];
  const campos_alterados = CAMPOS_AUDITADOS
    .filter(c => String(atual?.[c] ?? "") !== String(upd[c] ?? ""))
    .map(c => ({ campo: c, anterior: String(atual?.[c] ?? ""), novo: String(upd[c] ?? "") }));
  const historico_edicoes = atual?.historico_edicoes || [];
  if (campos_alterados.length > 0) {
    historico_edicoes.push({ data: new Date().toISOString(), editado_por: req.user.username, campos_alterados });
  }

  await update(dbRecibos, { _id: req.params.id }, { ...upd, historico_edicoes });
  registrarAuditoria(req, "editar_recibo", req.params.id, { campos_alterados: campos_alterados.map(c => c.campo) });
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (recibo && recibo.num) {
    atualizarNoSheets(recibo.num, recibo);
  }
  res.json({ ok: true });
});

app.delete("/api/recibos/:id", auth, financeiroOnly, async (req, res) => {
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (!recibo) return res.status(404).json({ erro: "Recibo não encontrado." });
  await update(dbRecibos, { _id: req.params.id }, {
    deletado_em: new Date().toISOString(),
    deletado_por: req.user.username,
  });
  registrarAuditoria(req, "excluir_recibo", req.params.id, { num: recibo.num, nome: recibo.nome });
  res.json({ ok: true });
});

// ── RECIBO RECORRENTE — clona pro mês seguinte ──────────────
app.post("/api/recibos/:id/recorrente", auth, financeiroOnly, async (req, res) => {
  try {
    const original = await findOne(dbRecibos, { _id: req.params.id, ...NAO_DELETADO });
    if (!original) return res.status(404).json({ erro: "Recibo não encontrado." });

    // Avança um mês na data (DD/MM/YYYY)
    const [dd, mm, yyyy] = (original.data || "").split("/");
    let newMes = parseInt(mm, 10) + 1;
    let newAno = parseInt(yyyy, 10);
    if (newMes > 12) { newMes = 1; newAno++; }
    const defaultData = `${(dd || "01").padStart(2, "0")}/${String(newMes).padStart(2, "0")}/${newAno}`;
    const newData = req.body.data || defaultData;
    const newReferencia = req.body.referencia !== undefined ? req.body.referencia : (original.referencia || "");

    // Próximo número no ano da nova data
    const anoNum = (newData.split("/")[2]) || String(new Date().getFullYear());
    const todos = await find(dbRecibos, {});
    let maior = 0;
    for (const r of todos) {
      const match = (r.num || "").match(/^(\d+)\/(\d{4})$/);
      if (match && match[2] === anoNum) {
        const seq = parseInt(match[1], 10);
        if (seq > maior) maior = seq;
      }
    }
    const newNum = `${String(maior + 1).padStart(4, "0")}/${anoNum}`;

    const novoRecibo = {
      num: newNum,
      nome: original.nome,
      cpf: original.cpf,
      municipio_uf: original.municipio_uf || "",
      valor: original.valor,
      data: newData,
      emitido_por: original.emitido_por || "",
      complemento: original.complemento || "",
      referencia: newReferencia,
      forma_pagamento: original.forma_pagamento || "",
      escritorio: original.escritorio || "",
      motivo_pagamento: original.motivo_pagamento || "",
      link_comprovante: "",
      timestamp: Date.now(),
    };

    const doc = await insert(dbRecibos, novoRecibo);
    registrarAuditoria(req, "criar_recibo_recorrente", doc._id, { num: newNum, origem_num: original.num });
    const sheetsResult = await registrarNoSheets({ ...novoRecibo, num_recibo: newNum });
    dispararWebhook(novoRecibo);
    res.json({ id: doc._id, num: newNum, data: newData, sheets_ok: sheetsResult === true });
  } catch (e) {
    console.error("Erro ao criar recibo recorrente:", e.message);
    res.status(500).json({ erro: "Erro ao criar recibo recorrente." });
  }
});

app.get("/api/proximo-num", auth, async (req, res) => {
  const ano = String(new Date().getFullYear());
  const todos = await find(dbRecibos, {});
  // Pega o maior número do ano atual a partir do campo num (formato "NNNN/AAAA")
  let maior = 0;
  for (const r of todos) {
    const match = (r.num || "").match(/^(\d+)\/(\d{4})$/);
    if (match && match[2] === ano) {
      const seq = parseInt(match[1], 10);
      if (seq > maior) maior = seq;
    }
  }
  const num = maior + 1;
  res.json({ num: `${String(num).padStart(4, "0")}/${ano}` });
});

// ── RELATÓRIO DE INADIMPLÊNCIA ─────────────────────────────
app.get("/api/relatorios/inadimplencia", auth, semRecepcao, async (req, res) => {
  try {
    const clientes = await find(dbClientes, NAO_DELETADO);
    const hoje = new Date().toISOString().slice(0, 10);
    const relatorio = [];
    for (const c of clientes) {
      const enriquecido = await enriquecerCliente(c);
      const atrasadas = (enriquecido.parcelas || []).filter(p => p.status === "atrasado");
      if (atrasadas.length === 0) continue;
      relatorio.push({
        id: enriquecido._id,
        nome: enriquecido.nome,
        cpf: enriquecido.cpf,
        telefone: enriquecido.telefone || "",
        parcelas_atrasadas: atrasadas.length,
        valor_em_aberto: atrasadas.reduce((s, p) => s + (p.valor || 0), 0),
        parcelas: atrasadas.map(p => ({
          num: p.num,
          valor: p.valor,
          data_vencimento: p.data_vencimento,
          dias_atraso: p.data_vencimento
            ? Math.floor((new Date(hoje) - new Date(p.data_vencimento)) / 86400000)
            : null,
        })),
      });
    }
    relatorio.sort((a, b) => b.valor_em_aberto - a.valor_em_aberto);
    res.json({ total_inadimplentes: relatorio.length, relatorio });
  } catch (e) {
    console.error("Erro ao gerar relatório de inadimplência:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatório." });
  }
});

// ── HELPER: gera buffer PDF de um recibo do banco ──────────
async function gerarBufferPDFRecibo(recibo) {
  const logoPath = path.join(__dirname, "public", "logo.png");
  const logoExists = fs.existsSync(logoPath);
  const digits = (recibo.cpf || "").replace(/\D/g, "");
  const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
  const complemento = recibo.complemento ? ` - ${recibo.complemento}` : "";
  const MESES_EXT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const [dia, mes, ano] = (recibo.data || "").split("/");
  const mesNome = MESES_EXT[parseInt(mes, 10) - 1] || "";
  const data_extenso = dia && mes && ano ? `${parseInt(dia, 10)} de ${mesNome} de ${ano}` : (recibo.data || "");
  const textoCorpo = `Recebemos do (a) senhor (a) ${recibo.nome}, residente e domiciliado(a) no Município de ${recibo.municipio_uf}, a importância de R$ ${recibo.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ margin: 60, size: "A4" });
    pdf.on("data", c => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
    pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
      .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
    pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);
    const lx = pdf.page.margins.left;
    const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);
    pdf.fontSize(12).font("Helvetica-Bold")
      .text(`Recibo Nº ${recibo.num}${recibo.referencia ? "   |   Ref: " + recibo.referencia : ""}`, { align: "center" }).moveDown(0.2);
    pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);
    pdf.fontSize(11).font("Helvetica").text(textoCorpo, { align: "justify" }).moveDown(0.6);
    pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);
    pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);
    pdf.text(`${recibo.municipio_uf}, ${data_extenso}`, { align: "left" }).moveDown(6);
    pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
    pdf.fontSize(10).text(recibo.nome, { align: "center" }).moveDown(0.1);
    pdf.fontSize(9).text(`${labelDoc}: ${recibo.cpf}`, { align: "center" }).moveDown(5);
    pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
    pdf.fontSize(10).text(recibo.emitido_por || "A ARAUJO PREV", { align: "left" });
    if (logoExists) pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
    pdf.end();
  });
}

// ── EXPORTAR RECIBOS EM LOTE (ZIP) ──────────────────────────
app.post("/api/recibos/exportar-zip", auth, financeiroOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ erro: "Informe ao menos um ID." });
    if (ids.length > 100) return res.status(400).json({ erro: "Máximo de 100 recibos por exportação." });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="recibos_${Date.now()}.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", e => { console.error("Erro archiver:", e.message); });
    archive.pipe(res);

    for (const id of ids) {
      const recibo = await findOne(dbRecibos, { _id: id });
      if (!recibo || recibo.deletado_em) continue;
      try {
        const buf = await gerarBufferPDFRecibo(recibo);
        const nomeArq = `recibo_${(recibo.num || id).replace(/[\/\\]/g, "-")}_${(recibo.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_").toLowerCase()}.pdf`;
        archive.append(buf, { name: nomeArq });
      } catch (e) {
        console.error(`Erro ao gerar PDF do recibo ${id}:`, e.message);
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error("Erro ao exportar ZIP:", e.message);
    if (!res.headersSent) res.status(500).json({ erro: "Erro ao gerar arquivo ZIP." });
  }
});

// ── RELATÓRIO: PROJEÇÃO DE RECEBIMENTOS (6 MESES) ──────────
app.get("/api/relatorios/projecao", auth, semRecepcao, async (req, res) => {
  try {
    const clientes = await find(dbClientes, NAO_DELETADO);
    const hoje = new Date();
    // Mapa mes-chave → valor acumulado para os próximos 6 meses
    const mesesPT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const limite = new Date(hoje.getFullYear(), hoje.getMonth() + 6, 1);
    const mapa = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const chave = `${mesesPT[d.getMonth()]}/${d.getFullYear()}`;
      mapa[chave] = 0;
    }
    for (const c of clientes) {
      const enriquecido = await enriquecerCliente(c);
      for (const p of (enriquecido.parcelas || [])) {
        if (p.status === "pago") continue;
        if (!p.data_vencimento) continue;
        const [aaaa, mm] = p.data_vencimento.split("-");
        if (!aaaa || !mm) continue;
        const venc = new Date(parseInt(aaaa), parseInt(mm) - 1, 1);
        if (venc < new Date(hoje.getFullYear(), hoje.getMonth(), 1) || venc >= limite) continue;
        const chave = `${mesesPT[venc.getMonth()]}/${venc.getFullYear()}`;
        if (chave in mapa) mapa[chave] += p.valor || 0;
      }
    }
    const resultado = Object.entries(mapa).map(([mes, valor]) => ({ mes, valor: Math.round(valor * 100) / 100 }));
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar projeção:", e.message);
    res.status(500).json({ erro: "Erro ao gerar projeção." });
  }
});

// ── RELATÓRIO: RECEITA POR ESCRITÓRIO ──────────────────────
app.get("/api/relatorios/por-escritorio", auth, semRecepcao, async (req, res) => {
  try {
    const recibos  = await find(dbRecibos,  NAO_DELETADO);
    const clientes = await find(dbClientes, NAO_DELETADO);
    const escritorios = {};
    for (const r of recibos) {
      const esc = (r.escritorio || "").trim() || "(sem escritório)";
      if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
      const val = parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      escritorios[esc].receita      += val;
      escritorios[esc].qtd_recibos  += 1;
    }
    for (const c of clientes) {
      const esc = (c.escritorio || "").trim() || "(sem escritório)";
      if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
      escritorios[esc].qtd_clientes += 1;
    }
    const resultado = Object.values(escritorios)
      .map(e => ({ ...e, receita: Math.round(e.receita * 100) / 100 }))
      .sort((a, b) => b.receita - a.receita);
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar relatório por escritório:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatório." });
  }
});

// ── RESUMO MENSAL COM KPIs COMPARATIVOS ─────────────────────
app.get("/api/relatorios/resumo-mes", auth, async (req, res) => {
  try {
    const hoje = new Date();
    const mes = req.query.mes || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

    const [ano, mNum] = mes.split("-").map(Number);
    const dataMesAnterior = new Date(ano, mNum - 2, 1);
    const mesAnterior = `${dataMesAnterior.getFullYear()}-${String(dataMesAnterior.getMonth() + 1).padStart(2, "0")}`;

    const [recibos, clientes] = await Promise.all([
      find(dbRecibos, NAO_DELETADO),
      find(dbClientes, NAO_DELETADO),
    ]);

    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const delta = (base, atual) => base === 0 ? null : Math.round(((atual - base) / base) * 1000) / 10;

    const doMes      = recibos.filter(r => mesDeData(r.data) === mes);
    const doAnterior = recibos.filter(r => mesDeData(r.data) === mesAnterior);

    const receitaMes      = doMes.reduce((s, r) => s + parseValor(r), 0);
    const receitaAnterior = doAnterior.reduce((s, r) => s + parseValor(r), 0);
    const ticketMes       = doMes.length ? receitaMes / doMes.length : 0;
    const ticketAnterior  = doAnterior.length ? receitaAnterior / doAnterior.length : 0;
    const clientesMes      = clientes.filter(c => c.created_at && c.created_at.slice(0, 7) === mes).length;
    const clientesAnterior = clientes.filter(c => c.created_at && c.created_at.slice(0, 7) === mesAnterior).length;

    res.json({
      mes,
      mes_anterior: mesAnterior,
      receita_mes:             Math.round(receitaMes * 100) / 100,
      receita_anterior:        Math.round(receitaAnterior * 100) / 100,
      delta_receita:           delta(receitaAnterior, receitaMes),
      recibos_mes:             doMes.length,
      recibos_anterior:        doAnterior.length,
      delta_recibos:           delta(doAnterior.length, doMes.length),
      ticket_medio:            Math.round(ticketMes * 100) / 100,
      ticket_anterior:         Math.round(ticketAnterior * 100) / 100,
      delta_ticket:            delta(ticketAnterior, ticketMes),
      clientes_novos:          clientesMes,
      clientes_novos_anterior: clientesAnterior,
      delta_clientes:          delta(clientesAnterior, clientesMes),
    });
  } catch (e) {
    console.error("Erro ao gerar resumo-mes:", e.message);
    res.status(500).json({ erro: "Erro ao gerar resumo do mês." });
  }
});

// ── RECEITA POR RESPONSÁVEL ──────────────────────────────────
app.get("/api/relatorios/por-responsavel", auth, semRecepcao, async (req, res) => {
  try {
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const filtrados = req.query.mes
      ? recibos.filter(r => mesDeData(r.data) === req.query.mes)
      : recibos;
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const mapa = {};
    for (const r of filtrados) {
      const resp = (r.emitido_por || "").trim() || "(não informado)";
      if (!mapa[resp]) mapa[resp] = { responsavel: resp, total_recibos: 0, receita_total: 0 };
      mapa[resp].total_recibos += 1;
      mapa[resp].receita_total += parseValor(r);
    }
    const resultado = Object.values(mapa)
      .map(r => ({
        responsavel:   r.responsavel,
        total_recibos: r.total_recibos,
        receita_total: Math.round(r.receita_total * 100) / 100,
        ticket_medio:  r.total_recibos ? Math.round((r.receita_total / r.total_recibos) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.receita_total - a.receita_total);
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar relatório por responsável:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatório." });
  }
});

// ── RECEITA POR FORMA DE PAGAMENTO ──────────────────────────
app.get("/api/relatorios/formas-pagamento", auth, semRecepcao, async (req, res) => {
  try {
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const filtrados = req.query.mes
      ? recibos.filter(r => mesDeData(r.data) === req.query.mes)
      : recibos;
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const mapa = {};
    let totalReceita = 0;
    for (const r of filtrados) {
      const forma = (r.forma_pagamento || "").trim() || "(não informado)";
      if (!mapa[forma]) mapa[forma] = { forma, recibos: 0, receita: 0 };
      const val = parseValor(r);
      mapa[forma].recibos += 1;
      mapa[forma].receita += val;
      totalReceita += val;
    }
    const resultado = Object.values(mapa)
      .map(f => ({
        ...f,
        receita:    Math.round(f.receita * 100) / 100,
        percentual: totalReceita ? Math.round((f.receita / totalReceita) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.receita - a.receita);
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar relatório de formas de pagamento:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatório." });
  }
});

// ── COMPARATIVO DE ANOS ─────────────────────────────────────
app.get("/api/relatorios/comparativo-anos", auth, semRecepcao, async (req, res) => {
  try {
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const mapa = {};
    for (const r of recibos) {
      const mesAno = mesDeData(r.data);
      if (!mesAno) continue;
      const [ano, mes] = mesAno.split("-").map(Number);
      if (!mapa[ano]) mapa[ano] = {};
      if (!mapa[ano][mes]) mapa[ano][mes] = { receita: 0, qtd: 0 };
      mapa[ano][mes].receita += parseValor(r);
      mapa[ano][mes].qtd += 1;
    }
    const resultado = Object.entries(mapa)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ano, mesesObj]) => ({
        ano: Number(ano),
        meses: Array.from({ length: 12 }, (_, i) => ({
          mes: i + 1,
          receita: Math.round((mesesObj[i + 1]?.receita || 0) * 100) / 100,
          qtd: mesesObj[i + 1]?.qtd || 0,
        })),
      }));
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar comparativo-anos:", e.message);
    res.status(500).json({ erro: "Erro ao gerar comparativo de anos." });
  }
});

// ── DRE SIMPLIFICADO ─────────────────────────────────────────
app.get("/api/relatorios/dre", auth, semRecepcao, async (req, res) => {
  try {
    const ano = parseInt(req.query.ano || new Date().getFullYear(), 10);
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const MESES_NOME = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const porMes = Array.from({ length: 12 }, () => ({ receita: 0, qtd: 0 }));
    for (const r of recibos) {
      const mesAno = mesDeData(r.data);
      if (!mesAno) continue;
      const [anoR, mesR] = mesAno.split("-").map(Number);
      if (anoR !== ano) continue;
      porMes[mesR - 1].receita += parseValor(r);
      porMes[mesR - 1].qtd += 1;
    }
    let acumulado = 0;
    const meses = porMes.map((m, i) => {
      const receitaBruta = Math.round(m.receita * 100) / 100;
      const ticketMedio  = m.qtd ? Math.round((m.receita / m.qtd) * 100) / 100 : 0;
      const anterior     = i > 0 ? porMes[i - 1].receita : null;
      const variacaoMom  = anterior !== null && anterior > 0
        ? Math.round(((m.receita - anterior) / anterior) * 1000) / 10
        : null;
      acumulado += m.receita;
      return {
        mes: MESES_NOME[i],
        mes_num: i + 1,
        receita_bruta: receitaBruta,
        qtd_recibos: m.qtd,
        ticket_medio: ticketMedio,
        variacao_mom: variacaoMom,
        acumulado: Math.round(acumulado * 100) / 100,
      };
    });
    res.json({ ano, meses, total_ano: Math.round(acumulado * 100) / 100 });
  } catch (e) {
    console.error("Erro ao gerar DRE:", e.message);
    res.status(500).json({ erro: "Erro ao gerar DRE." });
  }
});

// ── BACKUP DO BANCO DE DADOS ────────────────────────────────
app.get("/api/admin/backup-db", auth, adminOnly, async (req, res) => {
  try {
    const dbDir = path.join(__dirname, "data");
    const arquivos = ["recibos.db", "clientes.db"].filter(f => fs.existsSync(path.join(dbDir, f)));
    if (arquivos.length === 0) return res.status(404).json({ erro: "Nenhum arquivo de banco encontrado." });

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="backup_db_${ts}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", e => { console.error("Erro backup ZIP:", e.message); });
    archive.pipe(res);
    for (const f of arquivos) {
      archive.file(path.join(dbDir, f), { name: f });
    }
    await archive.finalize();
  } catch (e) {
    console.error("Erro ao gerar backup:", e.message);
    if (!res.headersSent) res.status(500).json({ erro: "Erro ao gerar backup." });
  }
});

// ── LOG DE AUDITORIA ────────────────────────────────────────
app.get("/api/admin/audit-log", auth, adminOnly, async (req, res) => {
  try {
    const { usuario, acao, de, ate } = req.query;
    const query = {};
    if (usuario) query.usuario = usuario;
    if (acao) query.acao = acao;
    if (de || ate) {
      query.ts = {};
      if (de) query.ts.$gte = new Date(de).toISOString();
      if (ate) query.ts.$lte = new Date(ate + "T23:59:59").toISOString();
    }
    const logs = await find(dbAuditoria, query, { ts: -1 });
    res.json(logs.slice(0, 500));
  } catch (e) {
    console.error("Erro ao buscar audit-log:", e.message);
    res.status(500).json({ erro: "Erro ao buscar log de auditoria." });
  }
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
  const { rows } = await pgPool.query("SELECT id, username, role, escritorio, created_at FROM users ORDER BY created_at ASC");
  res.json(rows);
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  const { username, password, role, escritorio } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
  const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
  if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role inválido." });
  // Recepção sem escritório vinculado não filtra nada — força informar
  if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritório para usuário de recepção." });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pgPool.query(
      "INSERT INTO users (id, username, password, role, escritorio, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id",
      [username, hash, role || "financeiro", escritorio || "", new Date().toISOString()]
    );
    registrarAuditoria(req, "criar_usuario", rows[0].id, { username, role: role || "financeiro" });
    sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
    res.json({ id: rows[0].id, username });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ erro: "Usuário já existe" });
    throw e;
  }
});

app.put("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { username, password, role, escritorio } = req.body;
  if (!username) return res.status(400).json({ erro: "Preencha o usuário." });
  const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
  if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role inválido." });
  if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritório para usuário de recepção." });
  if (password) {
    await pgPool.query(
      "UPDATE users SET username=$1, role=$2, escritorio=$3, password=$4 WHERE id=$5",
      [username, role || "financeiro", escritorio || "", bcrypt.hashSync(password, 10), req.params.id]
    );
  } else {
    await pgPool.query(
      "UPDATE users SET username=$1, role=$2, escritorio=$3 WHERE id=$4",
      [username, role || "financeiro", escritorio || "", req.params.id]
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
  registrarAuditoria(req, "excluir_usuario", req.params.id, { username: rows[0].username });
  sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
  res.json({ ok: true });
});

// ── SYNC FORÇADO: NeDB → Google Sheets ─────────────────────
app.post("/api/admin/sync-sheets", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado (verifique GOOGLE_CREDENTIALS no EB)." });

  try {
    // Lê todos os recibos do banco local, ordenados por timestamp
    const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: 1 });
    if (todos.length === 0) return res.json({ ok: true, enviados: 0, mensagem: "Nenhum recibo no banco." });

    // Lê números de recibo já existentes na planilha (coluna M a partir da linha 4)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!M4:M`,
    });
    const naPlilha = new Set((existing.data.values || []).flat().map(v => String(v || "").trim()).filter(Boolean));

    // Filtra apenas os que ainda não estão na planilha
    const faltando = todos.filter(r => r.num && !naPlilha.has(String(r.num).trim()));
    if (faltando.length === 0) return res.json({
      ok: true, enviados: 0,
      mensagem: `Todos os ${todos.length} recibos já estão na planilha (${naPlilha.size} entradas detectadas na coluna M).`
    });

    // Monta as linhas para inserção em lote
    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    // r.data vem como "DD/MM/YYYY" do banco — new Date() interpreta como MM/DD, invertendo mês/dia
    function parseDateBR(str) {
      if (!str) return null;
      const [d, m, y] = String(str).split("/");
      if (!d || !m || !y) return null;
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(dt.getTime()) ? null : dt;
    }
    const linhas = await Promise.all(faltando.map(async r => {
      const dt = parseDateBR(r.data) || new Date(r.timestamp || Date.now());
      const mes = MESES_LOCAL[dt.getMonth()] || "";
      const dataFmt = dt.toLocaleDateString("pt-BR");
      const tsDate = r.timestamp ? new Date(r.timestamp) : dt;
      const carimbo = tsDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      return [
        carimbo,                                                          // A: Carimbo
        r.nome || "",                                                     // B: Nome
        r.cpf || "",                                                      // C: CPF
        r.valor ? `R$ ${r.valor}` : "",                                   // D: Valor
        r.data || dataFmt,                                                // E: Data pagamento
        r.data || dataFmt,                                                // F: Data depósito
        r.forma_pagamento || "",                                          // G: Forma pagamento
        r.motivo_pagamento || r.complemento || "Honorários Advocatícios", // H: Motivo
        r.escritorio || "",                                               // I: Escritório
        "",                                                               // J: Observação
        await linkParaSheets(r.link_comprovante || ""),                   // K: Comprovante
        mes,                                                              // L: Mês
        r.num || "",                                                      // M: Número recibo
        r.emitido_por || "",                                              // N: Responsável
        r.referencia || "",                                               // O: Referência
      ];
    }));

    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:O`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: linhas },
    });

    const rangeEscrito = appendResult.data.updates?.updatedRange || "desconhecido";
    console.log(`✅ Sync forçado: ${linhas.length} recibo(s) escritos no range ${rangeEscrito}.`);
    res.json({
      ok: true,
      enviados: linhas.length,
      mensagem: `${linhas.length} recibo(s) adicionados. Total no banco: ${todos.length}. Na planilha antes: ${naPlilha.size}. Escrito em: ${rangeEscrito}.`
    });
  } catch (e) {
    console.error("❌ Erro no sync forçado para Sheets:", e.message);
    res.status(500).json({ erro: "Erro ao sincronizar planilha." });
  }
});

// ── LIMPAR DUPLICATAS NA PLANILHA ────────────────────────────
app.post("/api/admin/limpar-duplicatas", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado." });

  try {
    // Descobre o sheetId numérico da aba
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties" });
    const sheetMeta = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheetMeta) return res.status(404).json({ erro: `Aba "${SHEET_NAME}" não encontrada.` });
    const sheetId = sheetMeta.properties.sheetId;

    // Lê todas as linhas (col M = num_recibo, índice 12)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:M`,
    });
    const rows = result.data.values || [];

    // Identifica linhas duplicadas pelo num_recibo (col M)
    // Mantém a PRIMEIRA ocorrência, marca as demais para deletar
    const seen = new Set();
    const toDelete = []; // índices de linha (0-based) a deletar, do maior pro menor
    rows.forEach((row, idx) => {
      const num = String(row[12] || "").trim();
      if (!num) return; // linha sem número — ignora
      if (seen.has(num)) {
        toDelete.push(idx);
      } else {
        seen.add(num);
      }
    });

    if (toDelete.length === 0) {
      return res.json({ ok: true, removidas: 0, mensagem: "Nenhuma duplicata encontrada na planilha." });
    }

    // Deleta do fim para o começo para não deslocar índices
    toDelete.sort((a, b) => b - a);
    const requests = toDelete.map(rowIdx => ({
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });

    console.log(`✅ Limpeza: ${toDelete.length} linha(s) duplicada(s) removida(s).`);
    res.json({ ok: true, removidas: toDelete.length, mensagem: `${toDelete.length} linha(s) duplicada(s) removida(s) com sucesso.` });
  } catch (e) {
    console.error("❌ Erro ao limpar duplicatas:", e.message);
    res.status(500).json({ erro: "Erro ao limpar duplicatas." });
  }
});

// ── IMPORTAR PLANILHA → BANCO (MERGE/UPSERT, funciona mesmo com banco não-vazio) ──
app.post("/api/admin/importar-de-sheets", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado." });
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:O`,
    });
    const rows = result.data.values || [];
    if (rows.length === 0) return res.json({ ok: true, importados: 0, mensagem: "Planilha vazia." });

    let importados = 0;
    let ignorados = 0;
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
      const num        = row[12] || `${String(i + 1).padStart(4, "0")}/${(data.split("/")[2] || String(new Date().getFullYear()))}`;
      const emitido_por = row[13] || "";
      const referencia  = row[14] || "";

      // Se já existe no banco pelo número, pula
      const existente = num ? await findOne(dbRecibos, { num }) : null;
      if (existente) { ignorados++; continue; }

      let timestamp = Date.now() - (rows.length - i) * 1000;
      if (carimbo) {
        const [datePart, timePart] = carimbo.split(" ");
        const [d, m, y] = (datePart || "").split("/");
        if (y && m && d) {
          const t = new Date(`${y}-${m}-${d}T${timePart || "00:00:00"}`).getTime();
          if (!isNaN(t)) timestamp = t;
        }
      }
      await insert(dbRecibos, { num, nome, cpf, municipio_uf: "", valor, data, emitido_por, complemento: "", referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp });
      importados++;
    }
    console.log(`✅ Importação da planilha: ${importados} novo(s), ${ignorados} já existiam.`);
    res.json({ ok: true, importados, ignorados, mensagem: `${importados} recibo(s) importado(s) da planilha. ${ignorados} já existiam no banco.` });
  } catch (e) {
    console.error("❌ Erro ao importar da planilha:", e.message);
    res.status(500).json({ erro: "Erro ao importar da planilha." });
  }
});

// ── IMPORTAÇÃO EM MASSA VIA JSON (para restaurar dados do Excel/backup) ──────
app.post("/api/admin/importar-bulk", auth, adminOnly, async (req, res) => {
  const registros = req.body;
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ erro: "Envie um array de registros." });

  let importados = 0;
  let ignorados = 0;
  const erros = [];

  for (const r of registros) {
    try {
      const num = r.num || "";
      if (!num) { ignorados++; continue; }

      const existente = await findOne(dbRecibos, { num });
      if (existente) { ignorados++; continue; }

      await insert(dbRecibos, {
        num,
        nome:             (r.nome || "").replace(/\b\w/g, c => c.toUpperCase()),
        cpf:              r.cpf || "",
        municipio_uf:     r.municipio_uf || "",
        valor:            r.valor || "",
        data:             r.data || "",
        emitido_por:      r.emitido_por || "",
        complemento:      r.complemento || "",
        referencia:       r.referencia || "",
        forma_pagamento:  r.forma_pagamento || "",
        escritorio:       r.escritorio || "",
        motivo_pagamento: r.motivo_pagamento || "",
        link_comprovante: r.link_comprovante || "",
        timestamp:        r.timestamp || Date.now(),
      });
      importados++;
    } catch (e) {
      erros.push(`${r.num}: ${e.message}`);
    }
  }

  console.log(`✅ importar-bulk: ${importados} importados, ${ignorados} ignorados, ${erros.length} erros`);
  res.json({ ok: true, importados, ignorados, erros: erros.slice(0, 10),
    mensagem: `${importados} registro(s) importado(s). ${ignorados} já existiam. Execute "Reescrever planilha" para sincronizar.` });
});

// ── LIMPAR PLANILHA E REESCREVER DO ZERO ────────────────────
app.post("/api/admin/reescrever-planilha", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado." });

  try {
    // Lê todos os recibos do banco ordenados por timestamp
    const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: 1 });
    if (todos.length === 0) return res.json({ ok: true, mensagem: "Nenhum recibo no banco." });

    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    function parseDateBR(str) {
      if (!str) return null;
      const [d, m, y] = String(str).split("/");
      if (!d || !m || !y) return null;
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(dt.getTime()) ? null : dt;
    }

    // 1. Monta todas as linhas ANTES de limpar (sem gerar presigned URLs — evita timeout)
    const linhas = todos.map(r => {
      const dt = parseDateBR(r.data) || new Date(r.timestamp || Date.now());
      const tsDate = r.timestamp ? new Date(r.timestamp) : dt;
      const carimbo = tsDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const mes = MESES_LOCAL[dt.getMonth()] || "";
      const dataFmt = dt.toLocaleDateString("pt-BR");
      return [
        carimbo,
        r.nome || "",
        r.cpf || "",
        r.valor ? `R$ ${r.valor}` : "",
        r.data || dataFmt,
        r.data || dataFmt,
        r.forma_pagamento || "",
        r.motivo_pagamento || r.complemento || "Honorários Advocatícios",
        r.escritorio || "",
        "",
        r.link_comprovante || "",
        mes,
        r.num || "",
        r.emitido_por || "",
        r.referencia || "",
      ];
    });

    // 2. Descobre sheetId e rowCount para deletar fisicamente as linhas extras
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetMeta = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheetMeta) return res.status(404).json({ erro: `Aba "${SHEET_NAME}" não encontrada.` });
    const sheetId = sheetMeta.properties.sheetId;
    const totalRows = sheetMeta.properties.gridProperties?.rowCount || 0;

    // 3. Deleta fisicamente linhas extras (deixa 1 no fim — Sheets exige ao menos 1 linha não-congelada)
    if (totalRows > 4) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              // endIndex exclusivo: deleta índices 3..(totalRows-2), mantém última linha
              range: { sheetId, dimension: "ROWS", startIndex: 3, endIndex: totalRows - 1 },
            },
          }],
        },
      });
    }

    // 4. Limpa valores remanescentes (a linha que sobrou + qualquer resíduo)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:Z`,
    });

    // 5. Escreve todos os recibos a partir da linha 4 (Sheets expande automaticamente)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A4:O${3 + linhas.length}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: linhas },
    });

    console.log(`✅ Planilha reescrita: ${linhas.length} recibo(s) do banco.`);
    res.json({ ok: true, total: linhas.length, mensagem: `Planilha limpa e reescrita com ${linhas.length} recibo(s) do banco.` });
  } catch (e) {
    console.error("❌ Erro ao reescrever planilha:", e.message);
    res.status(500).json({ erro: "Erro ao reescrever planilha.", detalhe: e.message });
  }
});

// ── NORMALIZAR CAMPOS LIVRES (escritório + forma de pagamento) ────────────────
function normalizarEscritorio(raw) {
  const v = (raw || "").trim().toUpperCase().replace(/[-/,]+/g, " ").replace(/\s+/g, " ").trim();
  if (v.includes("TERRA RICA"))              return "Terra Rica - PR";
  if (v.includes("TEODORO"))                 return "Teodoro Sampaio - SP";
  if (v.includes("PRESIDENTE VENCESLAU") ||
      v.includes("PRES VENCESLAU"))          return "Presidente Venceslau - SP";
  if (v.includes("PRIMAVERA"))               return "Primavera - SP";
  if (v.includes("IVINHEMA"))                return "Ivinhema - MS";
  return raw;
}

function normalizarFormaPagamento(raw) {
  const v = (raw || "").trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÃÕÂÊÔÇ0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (v === "PIX" || v === "PÌX")            return "Pix";
  if (v.includes("LOTÉRIC") ||
      v.includes("LOTERIC"))                 return "Depósito lotérica";
  if (v.includes("CAIXA"))                   return "Depósito caixa";
  if (v.includes("BB"))                      return "Depósito BB";
  if (v === "TED")                           return "TED";
  if (v.includes("TRANSFER"))               return "Transferência bancária";
  if (v.includes("DINHEIRO"))               return "Dinheiro";
  if (v.includes("CHEQUE"))                 return "Cheque";
  return raw;
}

app.post("/api/admin/normalizar-escritorios", auth, adminOnly, async (req, res) => {
  try {
    const todos = await find(dbRecibos, {});
    let atualizados = 0;
    for (const r of todos) {
      const novoEsc  = normalizarEscritorio(r.escritorio);
      const novaForma = normalizarFormaPagamento(r.forma_pagamento);
      const mudou = novoEsc !== r.escritorio || novaForma !== r.forma_pagamento;
      if (mudou) {
        await update(dbRecibos, { _id: r._id }, { escritorio: novoEsc, forma_pagamento: novaForma });
        atualizados++;
      }
    }
    console.log(`✅ Dados normalizados: ${atualizados} recibo(s)`);
    res.json({ ok: true, atualizados, total: todos.length });
  } catch (e) {
    console.error("❌ Erro ao normalizar:", e.message);
    res.status(500).json({ erro: "Erro ao normalizar.", detalhe: e.message });
  }
});

// ── IMPORTAR CLIENTES DOS RECIBOS ─────────────────────────
app.post("/api/admin/importar-clientes-dos-recibos", auth, financeiroOnly, async (req, res) => {
  try {
    const todosRecibos   = await find(dbRecibos, NAO_DELETADO);
    const clientesExist  = await find(dbClientes, NAO_DELETADO);
    const cpfsExistentes = new Set(clientesExist.map(c => (c.cpf || "").replace(/\D/g, "")));
    const nomesExist     = new Set(clientesExist.map(c => (c.nome || "").toUpperCase()));

    // Agrupa recibos por CPF (ou por nome se CPF vazio)
    const mapa = {};
    for (const r of todosRecibos) {
      if (!r.nome) continue;
      const key = r.cpf ? r.cpf.replace(/\D/g, "") : ("__nome__" + r.nome.toUpperCase());
      if (!mapa[key]) mapa[key] = { nome: r.nome, cpf: r.cpf || "", municipio_uf: r.municipio_uf || "", referencia: r.referencia || "", recibos: [] };
      mapa[key].recibos.push(r);
    }

    let importados = 0, ignorados = 0;
    for (const key of Object.keys(mapa)) {
      const g = mapa[key];
      const cpfDigits = g.cpf.replace(/\D/g, "");

      // Pula se já existe (por CPF ou por nome quando sem CPF)
      if (cpfDigits && cpfsExistentes.has(cpfDigits)) { ignorados++; continue; }
      if (!cpfDigits && nomesExist.has(g.nome.toUpperCase())) { ignorados++; continue; }

      // Valida CPF/CNPJ se preenchido — pula inválido
      if (cpfDigits && cpfDigits.length === 11 && !validarCPF(g.cpf)) { ignorados++; continue; }
      if (cpfDigits && cpfDigits.length === 14 && !validarCNPJ(g.cpf)) { ignorados++; continue; }

      // Usa o recibo mais recente para dados de referência
      const recente = g.recibos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
      const totalValor = g.recibos.reduce((s, r) => s + (parseFloat((r.valor || "0").toString().replace(/\./g, "").replace(",", ".")) || 0), 0);
      const nRec = g.recibos.length;

      const doc = {
        nome:            recente.nome.toUpperCase(),
        cpf:             g.cpf || "",
        telefone:        "",
        endereco:        "",
        municipio_uf:    recente.municipio_uf || "",
        firma:           recente.escritorio   || "",
        referencia:      recente.referencia   || "",
        valor_beneficio: 0,
        num_beneficios:  0,
        valor_contrato:  totalValor > 0 ? totalValor : 1,
        num_parcelas:    nRec,
        valor_parcela:   totalValor > 0 ? totalValor / nRec : 1,
        parcelas:        [],
        parcelas_pagas:  nRec,
        parcelas_restantes: 0,
        valor_pago:      totalValor,
        valor_restante:  0,
        created_at:      new Date().toISOString(),
      };

      await insert(dbClientes, doc);
      importados++;
    }

    console.log(`[${new Date().toISOString()}] ✅ Importar clientes dos recibos: ${importados} importados, ${ignorados} já existiam`);
    res.json({ ok: true, importados, ignorados });
  } catch (e) {
    console.error("❌ Erro ao importar clientes dos recibos:", e.message);
    res.status(500).json({ erro: "Erro ao importar clientes.", detalhe: e.message });
  }
});

// ── CORRIGIR DATAS NA PLANILHA ────────────────────────────
app.post("/api/admin/corrigir-datas", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado." });

  try {
    // Lê todos os recibos do banco indexados por num_recibo
    const todos = await find(dbRecibos, NAO_DELETADO);
    const dbMap = new Map(todos.map(r => [String(r.num || "").trim(), r]));

    // Lê todas as linhas da planilha
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:M`,
    });
    const rows = result.data.values || [];

    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    function parseDateBR(str) {
      if (!str) return null;
      const [d, m, y] = String(str).split("/");
      if (!d || !m || !y) return null;
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(dt.getTime()) ? null : dt;
    }

    const updates = [];
    rows.forEach((row, idx) => {
      const num = String(row[12] || "").trim();
      if (!num) return;
      const rec = dbMap.get(num);
      if (!rec) return;

      // Reconstrói carimbo e mês a partir do timestamp do banco
      const dt = parseDateBR(rec.data) || new Date(rec.timestamp || Date.now());
      const tsDate = rec.timestamp ? new Date(rec.timestamp) : dt;
      const carimbo = tsDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const mes = MESES_LOCAL[dt.getMonth()] || "";
      const dataFmt = dt.toLocaleDateString("pt-BR");

      const rowNum = idx + 1; // planilha é 1-based
      updates.push({ rowNum, carimbo, mes, dataFmt, dataBR: rec.data || dataFmt });
    });

    if (updates.length === 0) {
      return res.json({ ok: true, corrigidas: 0, mensagem: "Nenhuma linha para corrigir." });
    }

    // Atualiza em lote: coluna A (carimbo), E (data pag), F (data dep), L (mês)
    const data = updates.map(u => ({
      range: `${SHEET_NAME}!A${u.rowNum}`,
      values: [[u.carimbo]],
    })).concat(updates.map(u => ({
      range: `${SHEET_NAME}!E${u.rowNum}:F${u.rowNum}`,
      values: [[u.dataBR, u.dataBR]],
    }))).concat(updates.map(u => ({
      range: `${SHEET_NAME}!L${u.rowNum}`,
      values: [[u.mes]],
    })));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });

    console.log(`✅ Datas corrigidas em ${updates.length} linha(s).`);
    res.json({ ok: true, corrigidas: updates.length, mensagem: `Datas corrigidas em ${updates.length} linha(s) da planilha.` });
  } catch (e) {
    console.error("❌ Erro ao corrigir datas:", e.message);
    res.status(500).json({ erro: "Erro ao corrigir datas." });
  }
});

// ── EMAIL SMTP ─────────────────────────────────────────────
// Variáveis de ambiente necessárias no Elastic Beanstalk:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=email@dominio.com
//   SMTP_PASS=senha_de_app          ← use App Password do Google, não a senha da conta
//   SMTP_FROM=Araujo Prev <email@dominio.com>
//   SMTP_ADMIN=email-do-admin@dominio.com  ← destinatário dos alertas de inadimplência

function smtpConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function criarTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function enviarEmail({ to, subject, html, attachments = [] }) {
  if (!smtpConfigurado()) {
    console.warn("⚠️  SMTP não configurado — e-mail não enviado.");
    return false;
  }
  const transporter = criarTransporter();
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    console.log(`✅ E-mail enviado para ${to} — messageId: ${info.messageId}`);
    return true;
  } catch (e) {
    console.error(`❌ Falha ao enviar e-mail para ${to}: ${e.message}`);
    return false;
  }
}

// Carrega template HTML de web/templates/ e substitui variáveis {{chave}} pelos valores.
function carregarTemplate(nome, variaveis = {}) {
  try {
    const templatePath = path.join(__dirname, "templates", nome);
    let html = fs.readFileSync(templatePath, "utf8");
    for (const [chave, valor] of Object.entries(variaveis)) {
      html = html.replaceAll(`{{${chave}}}`, valor ?? "");
    }
    return html;
  } catch (e) {
    console.error(`❌ Erro ao carregar template ${nome}: ${e.message}`);
    return null;
  }
}

// POST /api/notificacoes/email-inadimplencia
// Envia e-mail ao admin com lista de clientes inadimplentes.
// Requer role admin ou financeiro.
app.post("/api/notificacoes/email-inadimplencia", auth, financeiroOnly, async (req, res) => {
  if (!smtpConfigurado()) {
    return res.status(503).json({ erro: "Integração de e-mail não configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
  }

  const adminEmail = process.env.SMTP_ADMIN || process.env.SMTP_USER;
  if (!adminEmail) {
    return res.status(503).json({ erro: "Defina SMTP_ADMIN com o e-mail do destinatário do alerta." });
  }

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const clientes = await find(dbClientes, NAO_DELETADO);
    const inadimplentes = [];

    for (const cliente of clientes) {
      const parcelas = cliente.parcelas || [];
      const atrasadas = parcelas.filter(p => {
        if (p.status === "pago") return false;
        if (!p.data_vencimento) return false;
        const [d, m, y] = p.data_vencimento.split("/");
        const venc = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        return venc < hoje;
      });

      if (atrasadas.length === 0) continue;

      const valorAberto = atrasadas.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
      const maisAntiga = atrasadas.reduce((min, p) => {
        const [d, m, y] = p.data_vencimento.split("/");
        const v = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        return v < min ? v : min;
      }, new Date());
      const diasAtraso = Math.floor((hoje - maisAntiga) / (1000 * 60 * 60 * 24));

      inadimplentes.push({
        nome: cliente.nome,
        cpf: cliente.cpf || "",
        parcelasAtrasadas: atrasadas.length,
        valorAberto: valorAberto.toFixed(2),
        diasAtraso,
      });
    }

    inadimplentes.sort((a, b) => parseFloat(b.valorAberto) - parseFloat(a.valorAberto));

    const totalValor = inadimplentes.reduce((acc, c) => acc + parseFloat(c.valorAberto), 0);
    const dataRelatorio = hoje.toLocaleDateString("pt-BR");

    const linhasTabela = inadimplentes.length === 0
      ? `<p style="color:#16a34a">Nenhum cliente inadimplente no momento. ✅</p>`
      : `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">
          <thead><tr style="background:#1E40AF;color:#fff">
            <th style="padding:8px 10px;text-align:left">Cliente</th>
            <th style="padding:8px 10px">Parcelas</th>
            <th style="padding:8px 10px">Valor Aberto</th>
            <th style="padding:8px 10px">Atraso</th>
          </tr></thead>
          <tbody>${inadimplentes.map(c => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${c.nome}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${c.parcelasAtrasadas}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">R$ ${parseFloat(c.valorAberto).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${c.diasAtraso} dias</td>
            </tr>`).join("")}
          </tbody>
        </table>`;

    const html = carregarTemplate("email-inadimplencia.html", {
      data_relatorio: dataRelatorio,
      total_clientes: inadimplentes.length,
      total_valor: totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      tabela_clientes: linhasTabela,
    }) || `<p>Inadimplência ${dataRelatorio}: ${inadimplentes.length} cliente(s) — R$ ${totalValor.toFixed(2)}</p>`;

    const ok = await enviarEmail({
      to: adminEmail,
      subject: `[Araujo Prev] Inadimplência — ${inadimplentes.length} cliente(s) — ${dataRelatorio}`,
      html,
    });

    if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configurações SMTP." });

    console.log(`[${new Date().toISOString()}] E-mail de inadimplência enviado por ${req.user.username} — ${inadimplentes.length} clientes`);
    res.json({ ok: true, inadimplentes: inadimplentes.length, destinatario: adminEmail });
  } catch (e) {
    console.error("❌ Erro ao gerar relatório de inadimplência por e-mail:", e.message);
    res.status(500).json({ erro: "Erro interno ao processar relatório." });
  }
});

// POST /api/notificacoes/enviar-recibo-email
// Gera PDF do recibo em memória e envia como anexo para o e-mail do cliente.
// Aceita email_cliente OU email (alias usado pelo frontend); num_recibo OU num (alias).
// CPF, municipio_uf e data_extenso são opcionais — o PDF é gerado sem eles se ausentes.
app.post("/api/notificacoes/enviar-recibo-email", auth, financeiroOnly, async (req, res) => {
  if (!smtpConfigurado()) {
    return res.status(503).json({ erro: "Integração de e-mail não configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
  }

  const body = req.body;
  // Aceita aliases usados pelo frontend (email → email_cliente, num → num_recibo)
  const emailDest = body.email_cliente || body.email || "";
  const numRecibo = body.num_recibo || body.num || "";
  const { nome, cpf = "", valor, data, emitido_por, complemento, referencia, municipio_uf = "", data_extenso = "" } = body;

  if (!emailDest || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDest)) {
    return res.status(400).json({ erro: "E-mail do destinatário inválido ou não informado." });
  }
  if (!nome || !valor) {
    return res.status(400).json({ erro: "Campos obrigatórios ausentes: nome, valor." });
  }

  try {
    const digits = cpf.replace(/\D/g, "");
    const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
    const textoComplemento = complemento ? ` - ${complemento}` : "";
    const logoPath = path.join(__dirname, "public", "logo.png");
    const logoExists = fs.existsSync(logoPath);

    const textoCorpo = `Recebemos do (a) senhor (a) ${nome}${municipio_uf ? `, residente e domiciliado(a) no Município de ${municipio_uf}` : ""}, a importância de R$ ${valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${textoComplemento}.`;

    const chunks = [];
    const pdf = new PDFDocument({ margin: 60, size: "A4" });
    pdf.on("data", c => chunks.push(c));
    await new Promise((resolve, reject) => {
      pdf.on("end", resolve);
      pdf.on("error", reject);

      if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
      pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
        .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
      pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);

      const lx = pdf.page.margins.left;
      const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);

      pdf.fontSize(12).font("Helvetica-Bold")
        .text(`Recibo Nº ${numRecibo}${referencia ? "   |   Ref: " + referencia : ""}`, { align: "center" }).moveDown(0.2);
      pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);
      pdf.fontSize(11).font("Helvetica").text(textoCorpo, { align: "justify" }).moveDown(0.6);
      pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);
      if (municipio_uf || data_extenso) {
        pdf.text(`${municipio_uf}, ${data_extenso}`, { align: "left" }).moveDown(6);
      } else {
        pdf.moveDown(6);
      }
      pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
      pdf.fontSize(10).text(nome, { align: "center" }).moveDown(0.1);
      if (cpf) pdf.fontSize(9).text(`${labelDoc}: ${cpf}`, { align: "center" }).moveDown(5);
      else pdf.moveDown(5);
      pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
      pdf.fontSize(10).text(emitido_por || "A ARAUJO PREV", { align: "left" });
      if (logoExists) pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
      pdf.end();
    });

    const pdfBuf = Buffer.concat(chunks);
    const nomeArquivo = `recibo_${String(numRecibo).replace(/[\/\\]/g, "-")}.pdf`;

    const html = carregarTemplate("email-recibo.html", {
      nome,
      num_recibo: numRecibo,
      valor,
      data: data || "",
    }) || `<p>Olá ${nome}, segue em anexo o recibo Nº ${numRecibo} no valor de R$ ${valor}.</p>`;

    const ok = await enviarEmail({
      to: emailDest,
      subject: `Recibo de Honorários Nº ${numRecibo} — Araujo Prev`,
      html,
      attachments: [{ filename: nomeArquivo, content: pdfBuf, contentType: "application/pdf" }],
    });

    if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configurações SMTP." });

    console.log(`[${new Date().toISOString()}] Recibo ${numRecibo} enviado por e-mail para ${emailDest} por ${req.user.username}`);
    res.json({ ok: true, destinatario: emailDest });
  } catch (e) {
    console.error("❌ Erro ao enviar recibo por e-mail:", e.message);
    res.status(500).json({ erro: "Erro interno ao processar envio." });
  }
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

// States OAuth Gov.br persistidos no Neon (SEC-012 — sem Map em memória)

// PASSO 1 — Inicia fluxo OAuth2: retorna URL de redirecionamento para o Gov.br
app.get("/api/govbr/iniciar", auth, async (req, res) => {
  if (!govbrConfigurado()) {
    return res.status(503).json({ erro: "Integração Gov.br não configurada. Aguardando credenciais." });
  }
  const { recibo_id } = req.query;
  if (!recibo_id) return res.status(400).json({ erro: "recibo_id obrigatório" });

  try {
    const state = gerarState();
    await pgPool.query(
      `INSERT INTO govbr_states (state, recibo_id, username, expira_em)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [state, recibo_id, req.user.username]
    );

    const params = new URLSearchParams({
      response_type: "code",
      client_id: GOVBR_CLIENT_ID,
      scope: "openid email profile govbr_empresa govbr_confiabilidades",
      redirect_uri: GOVBR_REDIRECT_URI,
      state,
      nonce: gerarState(),
    });

    res.json({ url: `${GOVBR_BASE_URL}/authorize?${params.toString()}` });
  } catch (e) {
    console.error("Erro ao iniciar Gov.br:", e.message);
    res.status(500).json({ erro: "Erro interno ao iniciar autenticação Gov.br." });
  }
});

// PASSO 2 — Callback: Gov.br redireciona aqui após o cliente autenticar
app.get("/api/govbr/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const agora = new Date().toISOString();

  if (error) {
    const mensagem = error_description
      ? `${error}: ${error_description}`
      : error === "access_denied"
        ? "Acesso negado pelo usuário no Gov.br."
        : `Erro retornado pelo Gov.br: ${error}`;
    console.warn(`[${agora}] Gov.br callback — erro retornado pelo provedor: ${mensagem}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(mensagem)}`);
  }

  const { rows: stateRows } = await pgPool.query(
    `DELETE FROM govbr_states WHERE state = $1 RETURNING recibo_id, username, expira_em`,
    [state]
  );
  const stateData = stateRows[0] ? { recibo_id: stateRows[0].recibo_id, user: stateRows[0].username, expires: new Date(stateRows[0].expira_em).getTime() } : null;
  if (!stateData) {
    console.warn(`[${agora}] Gov.br callback — state desconhecido ou já utilizado: ${state}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão expirada ou inválida. Inicie o processo novamente.")}`);
  }
  if (Date.now() > stateData.expires) {
    console.warn(`[${agora}] Gov.br callback — state expirado para usuário ${stateData.user}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão Gov.br expirada (limite de 10 minutos). Tente novamente.")}`);
  }

  console.log(`[${agora}] Gov.br callback — iniciando troca de code por token para recibo ${stateData.recibo_id} (usuário: ${stateData.user})`);

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
    if (!tokenData.access_token) {
      console.error(`[${agora}] Gov.br callback — token não recebido. Resposta: ${JSON.stringify(tokenData)}`);
      throw new Error("Token de acesso não recebido. Verifique as credenciais Gov.br ou tente novamente.");
    }

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
    console.log(`[${new Date().toISOString()}] ✅ Recibo ${stateData.recibo_id} assinado via Gov.br por ${assinatura.nome_assinante} (CPF: ${assinatura.cpf_assinante || "n/d"}) — usuário do sistema: ${stateData.user}`);

    res.redirect(`/?govbr_ok=1&recibo_id=${stateData.recibo_id}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Erro no callback Gov.br para recibo ${stateData?.recibo_id}: ${e.message}`);
    const msgUsuario = e.message.includes("Token") || e.message.includes("userinfo")
      ? "Falha na comunicação com Gov.br. Tente novamente em instantes."
      : e.message;
    res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(msgUsuario)}`);
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

// ── WEBHOOK — RECIBO GERADO ────────────────────────────────
// Dispara um POST para WEBHOOK_URL (se configurado) a cada recibo salvo.
// Retry: 3 tentativas com backoff exponencial (1s → 4s → 16s).
// Fire-and-forget — não bloqueia a resposta HTTP ao cliente.
async function dispararWebhook(dadosRecibo) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  const payload = JSON.stringify({
    evento: "recibo_gerado",
    recibo: {
      num:             dadosRecibo.num,
      nome:            dadosRecibo.nome,
      cpf:             dadosRecibo.cpf,
      valor:           dadosRecibo.valor,
      data:            dadosRecibo.data,
      forma_pagamento: dadosRecibo.forma_pagamento || "",
      escritorio:      dadosRecibo.escritorio || "",
      emitido_por:     dadosRecibo.emitido_por || "",
      referencia:      dadosRecibo.referencia || "",
    },
    timestamp: new Date().toISOString(),
  });

  const MAX_TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (resp.ok) {
        console.log(`[${new Date().toISOString()}] ✅ Webhook disparado → ${url} (status ${resp.status}, tentativa ${tentativa})`);
        return;
      }
      console.warn(`[${new Date().toISOString()}] ⚠️  Webhook → ${url} retornou status ${resp.status} (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
    } catch (e) {
      console.warn(`[${new Date().toISOString()}] ⚠️  Webhook → ${url} falhou: ${e.message} (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
    }
    if (tentativa < MAX_TENTATIVAS) {
      const delay = Math.pow(4, tentativa - 1) * 1000; // 1s, 4s, 16s
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`[${new Date().toISOString()}] ❌ Webhook permanentemente falhou após ${MAX_TENTATIVAS} tentativas → ${url} (recibo: ${dadosRecibo.num})`);
}

// ── LEMBRETE AUTOMÁTICO DE PARCELAS ────────────────────────
// Executa 30s após startup para não bloquear a inicialização.
// Envia e-mail ao SMTP_ADMIN com parcelas que vencem nos próximos 3 dias
// e ainda não tiveram lembrete registrado (lembrete_enviado_em ausente).
async function verificarEEnviarLembretesParcelasProximas() {
  if (!smtpConfigurado()) return;

  const adminEmail = process.env.SMTP_ADMIN || process.env.SMTP_USER;
  if (!adminEmail) return;

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje);
    limite.setDate(hoje.getDate() + 3);

    const clientes = await find(dbClientes, NAO_DELETADO);
    const lembretes = [];

    for (const cliente of clientes) {
      const parcelasInicializadas = inicializarParcelasLegado(cliente).parcelas;
      for (const p of parcelasInicializadas) {
        if (p.status === "pago") continue;
        if (p.lembrete_enviado_em) continue;
        if (!p.data_vencimento) continue;

        const [d, m, y] = p.data_vencimento.split("/");
        const venc = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        if (venc >= hoje && venc <= limite) {
          lembretes.push({ cliente, parcela: p, venc });
        }
      }
    }

    if (lembretes.length === 0) {
      console.log(`[${new Date().toISOString()}] Lembrete automático: nenhuma parcela vencendo nos próximos 3 dias.`);
      return;
    }

    const linhasLembrete = `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">
        <thead><tr style="background:#d97706;color:#fff">
          <th style="padding:8px 10px;text-align:left">Cliente</th>
          <th style="padding:8px 10px">Parcela</th>
          <th style="padding:8px 10px">Valor</th>
          <th style="padding:8px 10px">Vencimento</th>
        </tr></thead>
        <tbody>${lembretes.map(l => `
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${l.cliente.nome}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${l.parcela.num}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">R$ ${parseFloat(l.parcela.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${l.parcela.data_vencimento}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;

    const html = carregarTemplate("email-lembrete.html", {
      data_relatorio: new Date().toLocaleDateString("pt-BR"),
      total_parcelas: lembretes.length,
      tabela_parcelas: linhasLembrete,
    }) || `<p>${lembretes.length} parcela(s) vencem nos próximos 3 dias.</p>`;

    const ok = await enviarEmail({
      to: adminEmail,
      subject: `[Araujo Prev] ${lembretes.length} parcela(s) vencem nos próximos 3 dias`,
      html,
    });

    if (ok) {
      // Registra lembrete_enviado_em em cada parcela diretamente no NeDB
      const agora = new Date().toISOString();
      for (const l of lembretes) {
        const parcelasAtualizadas = inicializarParcelasLegado(l.cliente).parcelas.map(p =>
          p.num === l.parcela.num
            ? { ...p, lembrete_enviado_em: agora, lembrete_enviado_por: "sistema" }
            : p
        );
        const resumo = recalcularResumo(parcelasAtualizadas);
        await update(dbClientes, { _id: l.cliente._id }, { parcelas: parcelasAtualizadas, ...resumo });
      }
      console.log(`[${agora}] ✅ Lembretes de parcela enviados: ${lembretes.length} parcela(s) — destinatário: ${adminEmail}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Erro no lembrete automático de parcelas: ${e.message}`);
  }
}

// ── CRON — LEMBRETE DIÁRIO ─────────────────────────────────
// Executa todo dia às 8h no horário de Brasília
cron.schedule("0 8 * * *", () => {
  console.log(`[${new Date().toISOString()}] 🕗 Cron disparado: verificando lembretes de parcelas...`);
  verificarEEnviarLembretesParcelasProximas();
}, { timezone: "America/Sao_Paulo" });

// ── BACKUP AUTOMÁTICO DIÁRIO PARA S3 ───────────────────────
// Zipa recibos.db + clientes.db e grava em s3://BUCKET/backups/YYYY-MM-DD_backup_db.zip
async function fazerBackupDiario() {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    console.warn(`[${new Date().toISOString()}] ⚠️  Backup diário ignorado — BUCKET_NAME não configurado.`);
    return;
  }
  const ts = new Date().toISOString().slice(0, 10);
  const chaveS3 = `backups/${ts}_backup_db.zip`;
  try {
    const dataDir = path.join(__dirname, "data");
    const arquivos = ["recibos.db", "clientes.db"].filter(f => fs.existsSync(path.join(dataDir, f)));
    if (arquivos.length === 0) {
      console.warn(`[${new Date().toISOString()}] ⚠️  Backup: nenhum arquivo .db encontrado em ${dataDir}`);
      return;
    }

    const zipBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("data", chunk => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
      for (const f of arquivos) archive.file(path.join(dataDir, f), { name: f });
      archive.finalize();
    });

    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: chaveS3,
      Body: zipBuffer,
      ContentType: "application/zip",
    }));
    console.log(`[${new Date().toISOString()}] ✅ Backup diário → s3://${bucket}/${chaveS3} (${(zipBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Erro no backup diário: ${e.message}`);
  }
}

// Executa todo dia às 02:00 BRT (05:00 UTC)
cron.schedule("0 5 * * *", () => {
  console.log(`[${new Date().toISOString()}] 🕗 Cron disparado: backup diário para S3...`);
  fazerBackupDiario();
}, { timezone: "UTC" });

// ── RENOVAÇÃO SEMANAL DE PRESIGNED URLS NO GOOGLE SHEETS ──
// Percorre a coluna K da planilha e regera URLs de 30 dias para cada link S3 encontrado.
async function renovarPresignedUrlsSheets() {
  const sheets = getSheetsClient();
  const bucket = process.env.BUCKET_NAME;
  if (!sheets || !bucket) {
    console.warn(`[${new Date().toISOString()}] ⚠️  Renovação de URLs ignorada — Sheets ou BUCKET_NAME não configurados.`);
    return;
  }
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!K:K`,
    });
    const linhas = resp.data.values || [];

    const atualizacoes = [];
    for (let i = 0; i < linhas.length; i++) {
      const celK = (linhas[i][0] || "").trim();
      if (!celK) continue;

      // Aceita /api/comprovante-s3/KEY e presigned URLs expiradas (https://...amazonaws.com/KEY?X-Amz-...)
      const s3PathMatch = celK.match(/^\/api\/comprovante-s3\/(.+)$/);
      const presignedMatch = celK.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
      const chave = s3PathMatch ? s3PathMatch[1] : presignedMatch ? presignedMatch[1] : null;
      if (!chave) continue;

      try {
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: decodeURIComponent(chave) });
        const novaUrl = await getSignedUrl(s3SignerClient, cmd, { expiresIn: 30 * 24 * 3600 });
        atualizacoes.push({ range: `${SHEET_NAME}!K${i + 1}`, values: [[novaUrl]] });
      } catch (e) {
        console.warn(`[${new Date().toISOString()}] ⚠️  Não foi possível renovar URL para chave "${chave}": ${e.message}`);
      }
    }

    if (atualizacoes.length === 0) {
      console.log(`[${new Date().toISOString()}] ℹ️  Renovação de URLs: nenhum link S3 encontrado na planilha.`);
      return;
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: atualizacoes },
    });
    console.log(`[${new Date().toISOString()}] ✅ Renovação de presigned URLs — ${atualizacoes.length} link(s) atualizado(s).`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Erro na renovação de presigned URLs: ${e.message}`);
  }
}

// Executa todo domingo às 03:00 BRT (06:00 UTC)
cron.schedule("0 6 * * 0", () => {
  console.log(`[${new Date().toISOString()}] 🕗 Cron disparado: renovação de presigned URLs no Sheets...`);
  renovarPresignedUrlsSheets();
}, { timezone: "UTC" });

// ── INICIAR ────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ Araujo Prev rodando em http://localhost:${PORT}`);
  // Executa também no startup (30s) para verificar parcelas do dia sem esperar o cron das 8h
  setTimeout(verificarEEnviarLembretesParcelasProximas, 30_000);
});
