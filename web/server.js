// =============================================================
//  SERVIDOR â€” web/server.js
//  Roda na AWS. Nunca abre no navegador, sÃ³ no terminal/servidor.
//
//  O QUE ESSE ARQUIVO FAZ:
//  - Recebe os pedidos do navegador (login, salvar recibo, etc.)
//  - Verifica se o usuÃ¡rio estÃ¡ logado e tem permissÃ£o
//  - Salva e busca dados no banco de dados
//  - Gera o documento Word (.docx) do recibo
//
//  QUANDO MEXER AQUI:
//  - Mudar campos do recibo
//  - Mudar regras de permissÃ£o (quem pode fazer o quÃª)
//  - Mudar tempo de expiraÃ§Ã£o do login (atualmente 8h)
//  - Adicionar novas funcionalidades no servidor
// =============================================================
require("dotenv").config();
const express = require("express");
const { Pool, types } = require("pg");
// NUMERIC (OID 1700) vem como string por padrÃ£o â€” forÃ§a conversÃ£o para float
types.setTypeParser(1700, (val) => val === null ? null : parseFloat(val));
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { randomUUID } = require("crypto");
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
const cookieParser = require("cookie-parser");
const archiver = require("archiver");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { withTimeout, fetchWithTimeout } = require("./services/timeout");

// â”€â”€ GOOGLE SHEETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { getSheetsClient, testarConexaoSheets, uploadParaDrive, sanitizarLinkParaSheets, registrarNoSheets, atualizarNoSheets, linkParaSheets, renovarPresignedUrlsSheets, SHEET_ID, SHEET_NAME, MESES } = require("./services/google-sheets");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("âŒ ERRO: Defina a variÃ¡vel de ambiente JWT_SECRET antes de iniciar.");
  process.exit(1);
}

// â”€â”€ NEON (PostgreSQL) â€” usuÃ¡rios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("âŒ ERRO: Defina a variÃ¡vel de ambiente DATABASE_URL (Neon) antes de iniciar.");
  process.exit(1);
}
const pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// MÃ³dulos
const db = require("./services/database")(pgPool);
const { find, findOne, insert, update, remove, count, findLimited } = db;

// â”€â”€ BANCO DE DADOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dbDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// â”€â”€ UPLOAD DE COMPROVANTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const uploadsDir = path.join(dbDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// S3 â€” usado quando BUCKET_NAME estiver configurado
const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

// Cliente S3 com credenciais IAM estÃ¡ticas â€” necessÃ¡rio para presigned URLs longas.
// Credenciais do instance profile sÃ£o temporÃ¡rias e invalidam a URL antes do prazo.
const s3SignerClient = (process.env.S3_SIGNER_KEY_ID && process.env.S3_SIGNER_SECRET)
  ? new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.S3_SIGNER_KEY_ID,
        secretAccessKey: process.env.S3_SIGNER_SECRET,
      },
    })
  : s3Client; // fallback para instance profile se env vars nÃ£o estiverem definidas

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Neon (PostgreSQL) â€” dados principais
const dbRecibos       = "recibos";
const dbClientes      = "clientes";
const dbAuditoria     = "auditoria";
const dbNotificacoes  = "notificacoes";
const dbConfig        = "config";

// Registros nÃ£o-deletados (soft delete)
const NAO_DELETADO = { deletado_em: { $exists: false } };

// Admin padrÃ£o via variÃ¡veis de ambiente
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error("âŒ ERRO: Defina as variÃ¡veis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.");
  process.exit(1);
}

// UsuÃ¡rios extras via variÃ¡vel de ambiente USERS_JSON (base64 de JSON array)
// Formato: [{"username":"financeiro","password":"senha","role":"financeiro"}, ...]
// Para gerar: btoa(JSON.stringify([...])) no console do navegador
const USERS_JSON = process.env.USERS_JSON;

// â”€â”€ BACKUP DE USUÃRIOS NO GOOGLE SHEETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Salva todos os usuÃ¡rios (exceto admin) na aba "Usuarios" da planilha.
// Armazena o hash bcrypt â€” nÃ£o Ã© texto puro, nÃ£o dÃ¡ pra reverter.
async function sincronizarUsuariosParaSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    const { rows } = await pgPool.query(
      "SELECT username, role, escritorio, created_at FROM users WHERE username != $1 AND deleted_at IS NULL ORDER BY created_at ASC",
      [ADMIN_USER]
    );
    // Sem coluna password â€” hash bcrypt nÃ£o deve ficar exposto na planilha (SEC-010)
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
    console.log(`âœ… ${valores.length} usuÃ¡rio(s) sincronizados para o Sheets.`);
  } catch (e) {
    // Aba pode nÃ£o existir ainda â€” tenta criar
    if (e.message && e.message.includes("Unable to parse range")) {
      try {
        const sheets2 = getSheetsClient();
        await sheets2.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: "Usuarios" } } }] },
        });
        await sincronizarUsuariosParaSheets();
      } catch (e2) {
        console.error("âŒ Erro ao criar aba Usuarios:", e2.message);
      }
    } else {
      console.error("âŒ Erro ao sincronizar usuÃ¡rios para Sheets:", e.message);
    }
  }
}

// Restaura usuÃ¡rios do Sheets para o Neon (chamado quando DB estÃ¡ vazio apÃ³s reset).
// Formato atual (SEC-010): 4 colunas â€” username, role, escritorio, created_at (sem senha).
// UsuÃ¡rios restaurados recebem hash placeholder inutilizÃ¡vel; admin deve redefinir senhas.
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
      // Hash impossÃ­vel de autenticar â€” usuÃ¡rio deve ter senha redefinida pelo admin
      const placeholderHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
      const result = await pgPool.query(`
        INSERT INTO users (id, username, password, role, escritorio, created_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
        ON CONFLICT (username) DO NOTHING
      `, [username, placeholderHash, role || "financeiro", escritorio || "", created_at || new Date().toISOString()]);
      if (result.rowCount > 0) {
        restaurados++;
        console.warn(`âš ï¸  UsuÃ¡rio '${username}' restaurado sem senha â€” admin deve redefinir via painel.`);
      }
    }
    console.log(`âœ… ${restaurados} usuÃ¡rio(s) restaurados do Sheets para o Neon.`);
    return restaurados;
  } catch (e) {
    console.error("âŒ Erro ao restaurar usuÃ¡rios do Sheets:", e.message);
    return 0;
  }
}

// â”€â”€ AUTO-MIGRAÃ‡ÃƒO NEDB â†’ NEON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Roda automaticamente no startup se as tabelas estiverem vazias
// e os arquivos .db ainda existirem no servidor.
async function autoMigrarNedb() {
  function lerDb(nome) {
    const p = path.join(dbDir, `${nome}.db`);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8").split("\n")
      .map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  const recibosDb = lerDb("recibos");
  if (!recibosDb.length) return; // sem .db, nada a migrar

  const { rows: [{ n }] } = await pgPool.query("SELECT COUNT(*) AS n FROM recibos");
  if (parseInt(n) > 0) return; // jÃ¡ tem dados no Neon, pula

  console.log("ðŸ”„ Auto-migraÃ§Ã£o NeDB â†’ Neon iniciada...");
  let ok = 0, err = 0;

  for (const r of recibosDb) {
    try {
      await pgPool.query(`INSERT INTO recibos
        (id,num,nome,cpf,municipio_uf,valor,data,emitido_por,complemento,
         referencia,forma_pagamento,escritorio,motivo_pagamento,link_comprovante,
         timestamp,assinatura_govbr,historico_edicoes,deletado_em,deletado_por)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT(id) DO NOTHING`,
        [r._id,r.num||"",r.nome||"",r.cpf||"",r.municipio_uf||"",r.valor||"",r.data||"",
         r.emitido_por||"",r.complemento||"",r.referencia||"",r.forma_pagamento||"",
         r.escritorio||"",r.motivo_pagamento||"",r.link_comprovante||"",r.timestamp||0,
         r.assinatura_govbr?JSON.stringify(r.assinatura_govbr):null,
         JSON.stringify(r.historico_edicoes||[]),r.deletado_em||null,r.deletado_por||null]);
      ok++;
    } catch { err++; }
  }
  console.log(`  âœ… Recibos: ${ok} migrados, ${err} erros`);

  ok = 0; err = 0;
  for (const c of lerDb("clientes")) {
    try {
      await pgPool.query(`INSERT INTO clientes
        (id,nome,cpf,telefone,endereco,municipio_uf,firma,referencia,valor_beneficio,
         num_beneficios,valor_contrato,num_parcelas,valor_parcela,parcelas,parcelas_pagas,
         parcelas_restantes,valor_pago,valor_restante,observacoes,updated_at,created_at,
         deletado_em,deletado_por)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT(id) DO NOTHING`,
        [c._id,c.nome||"",c.cpf||"",c.telefone||"",c.endereco||"",c.municipio_uf||"",
         c.firma||"",c.referencia||"",Number(c.valor_beneficio)||0,Number(c.num_beneficios)||0,
         Number(c.valor_contrato)||0,Number(c.num_parcelas)||0,Number(c.valor_parcela)||0,
         JSON.stringify(c.parcelas||[]),Number(c.parcelas_pagas)||0,
         Number(c.parcelas_restantes)||0,Number(c.valor_pago)||0,Number(c.valor_restante)||0,
         JSON.stringify(c.observacoes||[]),c.updated_at||null,c.created_at||null,
         c.deletado_em||null,c.deletado_por||null]);
      ok++;
    } catch { err++; }
  }
  console.log(`  âœ… Clientes: ${ok} migrados, ${err} erros`);

  ok = 0; err = 0;
  for (const a of lerDb("auditoria")) {
    try {
      await pgPool.query(`INSERT INTO auditoria(id,ts,usuario,role,acao,entidade_id,dados)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
        [a._id,a.ts||"",a.usuario||"",a.role||"",a.acao||"",a.entidade_id||"",
         JSON.stringify(a.dados||{})]);
      ok++;
    } catch { err++; }
  }
  console.log(`  âœ… Auditoria: ${ok} migrados, ${err} erros`);
  console.log("ðŸŽ‰ Auto-migraÃ§Ã£o concluÃ­da!");
}

// â”€â”€ INICIALIZAÃ‡ÃƒO DO BANCO DE USUÃRIOS (Neon) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // MigraÃ§Ã£o: adiciona colunas caso a tabela jÃ¡ exista sem elas
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS escritorio TEXT NOT NULL DEFAULT ''
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referencia_padrao TEXT DEFAULT ''
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nome_completo TEXT DEFAULT ''
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL
  `);
  // Tabela de states OAuth Gov.br â€” TTL gerenciado por expira_em (SEC-012)
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
  console.log("âœ… Tabela govbr_states pronta.");

  // Admin: sempre atualiza senha/role para refletir env vars (conta de sistema)
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
  await pgPool.query(`
    INSERT INTO users (id, username, password, role, created_at)
    VALUES (gen_random_uuid()::text, $1, $2, 'admin', $3)
    ON CONFLICT (username) DO UPDATE SET password = $2, role = 'admin'
  `, [ADMIN_USER, adminHash, new Date().toISOString()]);
  console.log("âœ… UsuÃ¡rio admin configurado (Neon).");

  // UsuÃ¡rios extras via USERS_JSON â€” sÃ³ cria se nÃ£o existir, nunca sobrescreve
  // Isso garante que senhas alteradas pelo painel nÃ£o sejam resetadas no deploy
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
          console.log(`âœ… UsuÃ¡rio ${u.username} criado via USERS_JSON.`);
        }
      }
    } catch (e) {
      console.error("âŒ Erro ao processar USERS_JSON:", e.message);
    }
  }

  // Tabelas principais â€” recibos, clientes e auditoria
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS recibos (
      id                TEXT        PRIMARY KEY,
      num               TEXT        NOT NULL DEFAULT '',
      nome              TEXT        NOT NULL DEFAULT '',
      cpf               TEXT        NOT NULL DEFAULT '',
      municipio_uf      TEXT        NOT NULL DEFAULT '',
      valor             TEXT        NOT NULL DEFAULT '',
      data              TEXT        NOT NULL DEFAULT '',
      emitido_por       TEXT        NOT NULL DEFAULT '',
      complemento       TEXT        NOT NULL DEFAULT '',
      referencia        TEXT        NOT NULL DEFAULT '',
      forma_pagamento   TEXT        NOT NULL DEFAULT '',
      escritorio        TEXT        NOT NULL DEFAULT '',
      motivo_pagamento  TEXT        NOT NULL DEFAULT '',
      link_comprovante  TEXT        NOT NULL DEFAULT '',
      timestamp         BIGINT      NOT NULL DEFAULT 0,
      assinatura_govbr  JSONB,
      assinatura_token  TEXT,
      assinatura_status TEXT        NOT NULL DEFAULT 'pendente',
      assinatura_expira_em TIMESTAMPTZ,
      historico_edicoes JSONB       NOT NULL DEFAULT '[]',
      deletado_em       TEXT,
      deletado_por      TEXT
    )
  `);
  // Migração: assinatura remota por link (colunas adicionadas a tabelas já existentes)
  await pgPool.query(`ALTER TABLE recibos ADD COLUMN IF NOT EXISTS assinatura_token TEXT`);
  await pgPool.query(`ALTER TABLE recibos ADD COLUMN IF NOT EXISTS assinatura_status TEXT NOT NULL DEFAULT 'pendente'`);
  await pgPool.query(`ALTER TABLE recibos ADD COLUMN IF NOT EXISTS assinatura_expira_em TIMESTAMPTZ`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_recibos_cpf       ON recibos (cpf)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_recibos_num       ON recibos (num)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_recibos_timestamp ON recibos (timestamp DESC)`);
  await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recibos_num_unique ON recibos (num) WHERE deletado_em IS NULL`);
  await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recibos_assinatura_token ON recibos (assinatura_token) WHERE assinatura_token IS NOT NULL`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id                  TEXT          PRIMARY KEY,
      nome                TEXT          NOT NULL DEFAULT '',
      cpf                 TEXT          NOT NULL DEFAULT '',
      telefone            TEXT          NOT NULL DEFAULT '',
      endereco            TEXT          NOT NULL DEFAULT '',
      municipio_uf        TEXT          NOT NULL DEFAULT '',
      firma               TEXT          NOT NULL DEFAULT '',
      referencia          TEXT          NOT NULL DEFAULT '',
      valor_beneficio     NUMERIC(12,2) NOT NULL DEFAULT 0,
      num_beneficios      INTEGER       NOT NULL DEFAULT 0,
      valor_contrato      NUMERIC(12,2) NOT NULL DEFAULT 0,
      num_parcelas        INTEGER       NOT NULL DEFAULT 0,
      valor_parcela       NUMERIC(12,2) NOT NULL DEFAULT 0,
      parcelas            JSONB         NOT NULL DEFAULT '[]',
      parcelas_pagas      INTEGER       NOT NULL DEFAULT 0,
      parcelas_restantes  INTEGER       NOT NULL DEFAULT 0,
      valor_pago          NUMERIC(12,2) NOT NULL DEFAULT 0,
      valor_restante      NUMERIC(12,2) NOT NULL DEFAULT 0,
      observacoes         JSONB         NOT NULL DEFAULT '[]',
      updated_at          TEXT,
      created_at          TEXT,
      deletado_em         TEXT,
      deletado_por        TEXT
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clientes_cpf  ON clientes (cpf)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome)`);
  await pgPool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS auto_recibo BOOLEAN NOT NULL DEFAULT false`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id          TEXT  PRIMARY KEY,
      ts          TEXT  NOT NULL DEFAULT '',
      usuario     TEXT  NOT NULL DEFAULT '',
      role        TEXT  NOT NULL DEFAULT '',
      acao        TEXT  NOT NULL DEFAULT '',
      entidade_id TEXT  NOT NULL DEFAULT '',
      dados       JSONB NOT NULL DEFAULT '{}'
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_auditoria_ts ON auditoria (ts DESC)`);
  console.log("âœ… Tabelas recibos, clientes e auditoria prontas.");

  // Auto-migraÃ§Ã£o NeDB â†’ Neon: roda uma Ãºnica vez se as tabelas estiverem vazias
  await autoMigrarNedb();

  // Se o banco tem sÃ³ o admin (reset detectado), tenta restaurar do Sheets
  const { rows: countRows } = await pgPool.query(
    "SELECT COUNT(*) AS total FROM users WHERE username != $1", [ADMIN_USER]
  );
  const totalNaoAdmin = parseInt(countRows[0].total, 10);
  console.log(`â„¹ï¸  UsuÃ¡rios no banco Neon (exceto admin): ${totalNaoAdmin}`);
  if (totalNaoAdmin === 0) {
    console.log("âš ï¸  Banco vazio â€” tentando restaurar usuÃ¡rios do Sheets...");
    await restaurarUsuariosDeSheets();
  }
}

// Sincroniza recibos da planilha se o banco estiver vazio (restauraÃ§Ã£o apÃ³s troca de servidor)
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
    console.log(`âœ… ${importados} recibos restaurados da planilha Google Sheets.`);
  } catch (e) {
    console.error("âŒ Erro ao sincronizar recibos da planilha:", e.message);
  }
}
testarConexaoSheets();
sincronizarDeSheets();
initDb().catch(e => console.error("âŒ Erro ao inicializar Neon:", e.message));

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
      // Tenta achar pelo nÃºmero do recibo, senÃ£o pelo CPF + data
      let recibo = null;
      if (num) recibo = await findOne(dbRecibos, { num });
      if (!recibo && cpf) recibo = await findOne(dbRecibos, { cpf, data: row[4] || "" });
      if (!recibo) continue;
      // Nunca sobrescreve link existente â€” sÃ³ preenche se banco estiver vazio
      if (recibo.link_comprovante) continue;
      // Nunca salva presigned URL (expira em horas) â€” sÃ³ Drive links
      if (link.includes("amazonaws.com")) continue;
      await update(dbRecibos, { _id: recibo._id }, { link_comprovante: link });
      atualizados++;
    }
    if (atualizados > 0) console.log(`âœ… ${atualizados} comprovantes sincronizados da planilha.`);
  } catch (e) {
    console.error("âŒ Erro ao sincronizar comprovantes:", e.message);
  }
}
sincronizarComprovantes();

// Normaliza nomes e CPFs jÃ¡ existentes no banco
async function normalizarDados() {
  try {
    const todos = await find(dbRecibos, NAO_DELETADO);
    let corrigidos = 0;
    for (const r of todos) {
      const updates = {};
      // Title Case no nome
      const nomeNorm = (r.nome || "").replace(/\b\w/g, c => c.toUpperCase());
      if (nomeNorm !== r.nome) updates.nome = nomeNorm;
      // CPF: formata se vier sem mÃ¡scara
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
    if (corrigidos > 0) console.log(`âœ… ${corrigidos} registros normalizados (nome/CPF).`);
  } catch (e) {
    console.error("âŒ Erro ao normalizar dados:", e.message);
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
    // Corrige todos os registros que tÃªm nome diferente do canonical
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
    if (corrigidos > 0) console.log(`âœ… ${corrigidos} registros com nome unificado por CPF.`);
  } catch (e) {
    console.error("âŒ Erro ao unificar nomes por CPF:", e.message);
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
      // Converte URL pÃºblica S3 ou presigned URL (https://bucket.s3.*.amazonaws.com/KEY?X-Amz-...)
      const matchS3 = r.link_comprovante.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
      if (matchS3) {
        await update(dbRecibos, { _id: r._id }, { link_comprovante: `/api/comprovante-s3/${matchS3[1]}` });
        corrigidos++;
      }
    }
    if (corrigidos > 0) console.log(`âœ… ${corrigidos} links de comprovante corrigidos.`);
  } catch (e) {
    console.error("âŒ Erro ao corrigir links de comprovante:", e.message);
  }
}
corrigirLinksComprovante();

// â”€â”€ MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// ForÃ§a HTTPS quando atrÃ¡s de proxy reverso (ELB)
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] === "http") return res.redirect(301, "https://" + req.headers.host + req.url);
  next();
});

// Headers de seguranÃ§a (antes do express.static para cobrir arquivos estÃ¡ticos)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self'; " +
    "frame-src https://drive.google.com blob:;"
  );
  next();
});

app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/index.html") {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const mw = require("./middleware/auth")({ jwt, JWT_SECRET, ADMIN_USER, pgPool });
const { auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios } = mw;

// â”€â”€ PostgreSQL helpers (substitutos dos helpers NeDB) â”€â”€â”€â”€â”€â”€â”€
// Campos JSONB por tabela â€” o driver pg jÃ¡ parseia automaticamente,
// mas precisamos fazer JSON.stringify ao escrever via $set
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
    console.error(`âŒ Auditoria falhou (${acao}):`, e.message);
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas de login. Aguarde 15 minutos." },
});

// â”€â”€ MONTAGEM DAS ROTAS MODULARIZADAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const routeDeps = {
  auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios,
  pgPool, jwt, JWT_SECRET, bcrypt, loginLimiter,
  dbClientes, dbRecibos, dbAuditoria, dbNotificacoes, dbConfig,
  NAO_DELETADO, find, findOne, insert, update, remove, count, findLimited,
  enriquecerCliente, registrarAuditoria, maskCPF,
  validarCPF, validarCNPJ, gerarParcelas, recalcularResumo, inicializarParcelasLegado,
  getSheetsClient, sincronizarUsuariosParaSheets, ADMIN_USER,
  s3Client, withTimeout, fetchWithTimeout,
  upload, crypto, fs, path,
  smtpConfigurado,
  // transporter criado sob demanda (criarTransporter é hoisted)
  get transporter() { return criarTransporter(); },
};
require("./routes/auth")(app, routeDeps);
require("./routes/clientes")(app, routeDeps);
require("./routes/admin")(app, routeDeps);
require("./routes/misc")(app, routeDeps);
require("./routes/recibos")(app, routeDeps);



// â”€â”€ ROTAS CLIENTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseBRL(str) {
  return parseFloat(String(str || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function gerarParcelas(numParcelas, valorContrato) {
  const valorParcela = numParcelas > 0 ? valorContrato / numParcelas : 0;
  const hoje = new Date();
  const diaVencto = String(hoje.getDate()).padStart(2, "0");
  return Array.from({ length: numParcelas }, (_, i) => {
    let mesVencto = hoje.getMonth() + 1 + i + 1;
    let anoVencto = hoje.getFullYear();
    while (mesVencto > 12) { mesVencto -= 12; anoVencto++; }
    const dataVenc = `${diaVencto}/${String(mesVencto).padStart(2, "0")}/${anoVencto}`;
    return {
      num: i + 1,
      valor: valorParcela,
      status: "pendente",
      data_vencimento: dataVenc,
      data_recebimento: "",
      data_deposito: "",
      recibo_id: "",
      recibo_num: "",
      observacao: "",
    };
  });
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

// (NAO_DELETADO declarado perto do topo â€” ver inÃ­cio do arquivo)

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

// Converte "DD/MM/YYYY" â†’ "YYYY-MM" para filtros de mÃªs
function mesDeData(dataStr) {
  if (!dataStr) return null;
  const parts = String(dataStr).split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}/.test(dataStr)) return dataStr.slice(0, 7);
  return null;
}

// MigraÃ§Ã£o on-the-fly: clientes sem campo parcelas recebem array inicializado
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

app.get("/api/clientes", auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await pgPool.query(
    `SELECT * FROM ${dbClientes} WHERE deletado_em IS NULL ORDER BY nome ASC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const total = await count(dbClientes, NAO_DELETADO);
  const enriquecidos = await Promise.all(rows.map(r => ({ ...r, _id: r.id })).map(enriquecerCliente));
  res.json({ clientes: enriquecidos, total, limit, offset });
});

// â”€â”€ RELATÃ“RIO DE INADIMPLÃŠNCIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    console.error("Erro ao gerar relatÃ³rio de inadimplÃªncia:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatÃ³rio." });
  }
});

app.get("/api/relatorios/projecao", auth, semRecepcao, async (req, res) => {
  try {
    const clientes = await find(dbClientes, NAO_DELETADO);
    const hoje = new Date();
    // Mapa mes-chave â†’ valor acumulado para os prÃ³ximos 6 meses
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
    console.error("Erro ao gerar projeÃ§Ã£o:", e.message);
    res.status(500).json({ erro: "Erro ao gerar projeÃ§Ã£o." });
  }
});

// â”€â”€ RELATÃ“RIO: RECEITA POR ESCRITÃ“RIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/relatorios/por-escritorio", auth, semRecepcao, async (req, res) => {
  try {
    const recibos  = await find(dbRecibos,  NAO_DELETADO);
    const clientes = await find(dbClientes, NAO_DELETADO);
    const escritorios = {};
    for (const r of recibos) {
      const esc = (r.escritorio || "").trim() || "(sem escritÃ³rio)";
      if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
      const val = parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      escritorios[esc].receita      += val;
      escritorios[esc].qtd_recibos  += 1;
    }
    for (const c of clientes) {
      const esc = (c.escritorio || "").trim() || "(sem escritÃ³rio)";
      if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
      escritorios[esc].qtd_clientes += 1;
    }
    const resultado = Object.values(escritorios)
      .map(e => ({ ...e, receita: Math.round(e.receita * 100) / 100 }))
      .sort((a, b) => b.receita - a.receita);
    res.json(resultado);
  } catch (e) {
    console.error("Erro ao gerar relatÃ³rio por escritÃ³rio:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatÃ³rio." });
  }
});

// â”€â”€ RESUMO MENSAL COM KPIs COMPARATIVOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    res.status(500).json({ erro: "Erro ao gerar resumo do mÃªs." });
  }
});

// â”€â”€ RECEITA POR RESPONSÃVEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/relatorios/por-responsavel", auth, semRecepcao, async (req, res) => {
  try {
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const filtrados = req.query.mes
      ? recibos.filter(r => mesDeData(r.data) === req.query.mes)
      : recibos;
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const mapa = {};
    for (const r of filtrados) {
      const resp = (r.emitido_por || "").trim() || "(nÃ£o informado)";
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
    console.error("Erro ao gerar relatÃ³rio por responsÃ¡vel:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatÃ³rio." });
  }
});

// â”€â”€ RECEITA POR FORMA DE PAGAMENTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const forma = (r.forma_pagamento || "").trim() || "(nÃ£o informado)";
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
    console.error("Erro ao gerar relatÃ³rio de formas de pagamento:", e.message);
    res.status(500).json({ erro: "Erro ao gerar relatÃ³rio." });
  }
});

// â”€â”€ COMPARATIVO DE ANOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ DRE SIMPLIFICADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/relatorios/dre", auth, semRecepcao, async (req, res) => {
  try {
    const ano = parseInt(req.query.ano || new Date().getFullYear(), 10);
    const recibos = await find(dbRecibos, NAO_DELETADO);
    const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    const MESES_NOME = ["Janeiro","Fevereiro","MarÃ§o","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
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

// â”€â”€ BACKUP DO BANCO DE DADOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ LOG DE AUDITORIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/admin/audit-log", auth, adminOnly, async (req, res) => {
  try {
    const { usuario, acao, de, ate } = req.query;
    let sql = `SELECT * FROM ${dbAuditoria} WHERE 1=1`;
    const params = [];
    if (usuario) { params.push(usuario); sql += ` AND usuario = $${params.length}`; }
    if (acao) { params.push(acao); sql += ` AND acao = $${params.length}`; }
    if (de) { params.push(new Date(de).toISOString()); sql += ` AND ts >= $${params.length}`; }
    if (ate) { params.push(new Date(ate + "T23:59:59").toISOString()); sql += ` AND ts <= $${params.length}`; }
    sql += " ORDER BY ts DESC LIMIT 500";
    const { rows } = await pgPool.query(sql, params);
    res.json(rows.map(r => ({ ...r, _id: r.id })));
  } catch (e) {
    console.error("Erro ao buscar audit-log:", e.message);
    res.status(500).json({ erro: "Erro ao buscar log de auditoria." });
  }
});

// â”€â”€ GERAR DOCUMENTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const textoCorpo = `Recebemos do (a) senhor (a) ${dados.nome}, residente e domiciliado(a) no MunicÃ­pio de ${dados.municipio_uf}, a importÃ¢ncia de R$ ${dados.valor} referentes aos honorÃ¡rios advocatÃ­cios relacionados Ã  AÃ§Ã£o PrevidenciÃ¡ria${complemento}.`;

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
      p("A ARAUJO SERVIÃ‡OS LTDA ME", { align: AlignmentType.CENTER, bold: true, size: 14, color: "1E40AF", spaceAfter: 40 }),
      p("A ARAUJO PREV", { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 40 }),
      linha(),
      p(`Recibo NÂº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 20 }),
      p("RECIBO DE HONORÃRIOS ADVOCATÃCIOS", { align: AlignmentType.CENTER, bold: true, size: 14, spaceAfter: 80 }),
      p(textoCorpo, { align: AlignmentType.JUSTIFIED, spaceAfter: 60 }),
      p("Por ser verdade, firmo o presente que segue datado e assinado.", { align: AlignmentType.JUSTIFIED, spaceAfter: 80 }),
      linha(),
      p(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: AlignmentType.LEFT, spaceAfter: 3600 }),
      // Assinatura do cliente â€” centro
      p("________________________________________", { align: AlignmentType.CENTER, spaceAfter: 40 }),
      p(dados.nome, { align: AlignmentType.CENTER, size: 10, spaceAfter: 20 }),
      p(`${labelDoc}: ${dados.cpf}`, { align: AlignmentType.CENTER, size: 9, spaceAfter: 2800 }),
      // Assinatura do emissor â€” esquerda
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
      // â”€â”€ Gerar PDF â”€â”€
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
          .text("A ARAUJO SERVIÃ‡OS LTDA ME", { align: "center" }).moveDown(0.2);
        pdf.fontSize(12).fillColor("#000000")
          .text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);

        // Linha separadora
        const lx = pdf.page.margins.left;
        const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
        pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);

        pdf.fontSize(12).font("Helvetica-Bold")
          .text(`Recibo NÂº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: "center" }).moveDown(0.2);
        pdf.fontSize(14).text("RECIBO DE HONORÃRIOS ADVOCATÃCIOS", { align: "center" }).moveDown(0.8);

        pdf.fontSize(11).font("Helvetica")
          .text(textoCorpo, { align: "justify" }).moveDown(0.6);
        pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);

        pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);

        pdf.text(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: "left" }).moveDown(6);

        // Assinatura cliente â€” centro
        const cx = pdf.page.width / 2;
        pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
        pdf.fontSize(10).text(dados.nome, { align: "center" }).moveDown(0.1);
        pdf.fontSize(9).text(`${labelDoc}: ${dados.cpf}`, { align: "center" }).moveDown(5);

        // Assinatura emissor â€” esquerda
        pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
        pdf.fontSize(10).text(dados.emitido_por || "A ARAUJO PREV", { align: "left" });

        // Logo rodapÃ©
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
      // â”€â”€ Gerar DOCX (padrÃ£o) â”€â”€
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

// â”€â”€ ROTAS USUÃRIOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/api/users", auth, adminOnly, async (req, res) => {
  const { rows } = await pgPool.query("SELECT id, username, role, escritorio, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC");
  res.json(rows);
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  const { username, password, role, escritorio } = req.body;
  if (!username || !password) return res.status(400).json({ erro: "Preencha usuÃ¡rio e senha" });
  const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
  if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role invÃ¡lido." });
  // RecepÃ§Ã£o sem escritÃ³rio vinculado nÃ£o filtra nada â€” forÃ§a informar
  if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritÃ³rio para usuÃ¡rio de recepÃ§Ã£o." });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pgPool.query(
      "INSERT INTO users (id, username, password, role, escritorio, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id",
      [username, hash, role || "financeiro", escritorio || "", new Date().toISOString()]
    );
    registrarAuditoria(req, "criar_usuario", rows[0].id, { username, role: role || "financeiro" });
    sincronizarUsuariosParaSheets().catch(e => console.error("âŒ Sync Sheets falhou:", e.message));
    res.json({ id: rows[0].id, username });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ erro: "UsuÃ¡rio jÃ¡ existe" });
    throw e;
  }
});

app.put("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { username, password, role, escritorio } = req.body;
  if (!username) return res.status(400).json({ erro: "Preencha o usuÃ¡rio." });
  const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
  if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role invÃ¡lido." });
  if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritÃ³rio para usuÃ¡rio de recepÃ§Ã£o." });
  const { rows: exists } = await pgPool.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!exists[0]) return res.status(404).json({ erro: "UsuÃ¡rio nÃ£o encontrado." });
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
  sincronizarUsuariosParaSheets().catch(e => console.error("âŒ Sync Sheets falhou:", e.message));
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  const { rows } = await pgPool.query("SELECT username FROM users WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: "UsuÃ¡rio nÃ£o encontrado." });
  if (rows[0].username === ADMIN_USER) return res.status(400).json({ erro: "NÃ£o Ã© possÃ­vel remover o admin." });
  await pgPool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [req.params.id]);
  registrarAuditoria(req, "excluir_usuario", req.params.id, { username: rows[0].username });
  sincronizarUsuariosParaSheets().catch(e => console.error("âŒ Sync Sheets falhou:", e.message));
  res.json({ ok: true });
});

// â”€â”€ SYNC FORÃ‡ADO: NeDB â†’ Google Sheets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/admin/sync-sheets", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets nÃ£o configurado (verifique GOOGLE_CREDENTIALS no EB)." });

  try {
    // LÃª todos os recibos do banco local, ordenados por timestamp
    const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: 1 });
    if (todos.length === 0) return res.json({ ok: true, enviados: 0, mensagem: "Nenhum recibo no banco." });

    // LÃª nÃºmeros de recibo jÃ¡ existentes na planilha (coluna M a partir da linha 4)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!M4:M`,
    });
    const naPlilha = new Set((existing.data.values || []).flat().map(v => String(v || "").trim()).filter(Boolean));

    // Filtra apenas os que ainda nÃ£o estÃ£o na planilha
    const faltando = todos.filter(r => r.num && !naPlilha.has(String(r.num).trim()));
    if (faltando.length === 0) return res.json({
      ok: true, enviados: 0,
      mensagem: `Todos os ${todos.length} recibos jÃ¡ estÃ£o na planilha (${naPlilha.size} entradas detectadas na coluna M).`
    });

    // Monta as linhas para inserÃ§Ã£o em lote
    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÃ‡O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    // r.data vem como "DD/MM/YYYY" do banco â€” new Date() interpreta como MM/DD, invertendo mÃªs/dia
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
        r.data || dataFmt,                                                // F: Data depÃ³sito
        r.forma_pagamento || "",                                          // G: Forma pagamento
        r.motivo_pagamento || r.complemento || "HonorÃ¡rios AdvocatÃ­cios", // H: Motivo
        r.escritorio || "",                                               // I: EscritÃ³rio
        "",                                                               // J: ObservaÃ§Ã£o
        await linkParaSheets(r.link_comprovante || "", s3SignerClient),   // K: Comprovante
        mes,                                                              // L: MÃªs
        r.num || "",                                                      // M: NÃºmero recibo
        r.emitido_por || "",                                              // N: ResponsÃ¡vel
        r.referencia || "",                                               // O: ReferÃªncia
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
    console.log(`âœ… Sync forÃ§ado: ${linhas.length} recibo(s) escritos no range ${rangeEscrito}.`);
    res.json({
      ok: true,
      enviados: linhas.length,
      mensagem: `${linhas.length} recibo(s) adicionados. Total no banco: ${todos.length}. Na planilha antes: ${naPlilha.size}. Escrito em: ${rangeEscrito}.`
    });
  } catch (e) {
    console.error("âŒ Erro no sync forÃ§ado para Sheets:", e.message);
    res.status(500).json({ erro: "Erro ao sincronizar planilha." });
  }
});

// â”€â”€ LIMPAR DUPLICATAS NA PLANILHA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/admin/limpar-duplicatas", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets nÃ£o configurado." });

  try {
    // Descobre o sheetId numÃ©rico da aba
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties" });
    const sheetMeta = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheetMeta) return res.status(404).json({ erro: `Aba "${SHEET_NAME}" nÃ£o encontrada.` });
    const sheetId = sheetMeta.properties.sheetId;

    // LÃª todas as linhas (col M = num_recibo, Ã­ndice 12)
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:M`,
    });
    const rows = result.data.values || [];

    // Identifica linhas duplicadas pelo num_recibo (col M)
    // MantÃ©m a PRIMEIRA ocorrÃªncia, marca as demais para deletar
    const seen = new Set();
    const toDelete = []; // Ã­ndices de linha (0-based) a deletar, do maior pro menor
    rows.forEach((row, idx) => {
      const num = String(row[12] || "").trim();
      if (!num) return; // linha sem nÃºmero â€” ignora
      if (seen.has(num)) {
        toDelete.push(idx);
      } else {
        seen.add(num);
      }
    });

    if (toDelete.length === 0) {
      return res.json({ ok: true, removidas: 0, mensagem: "Nenhuma duplicata encontrada na planilha." });
    }

    // Deleta do fim para o comeÃ§o para nÃ£o deslocar Ã­ndices
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

    console.log(`âœ… Limpeza: ${toDelete.length} linha(s) duplicada(s) removida(s).`);
    res.json({ ok: true, removidas: toDelete.length, mensagem: `${toDelete.length} linha(s) duplicada(s) removida(s) com sucesso.` });
  } catch (e) {
    console.error("âŒ Erro ao limpar duplicatas:", e.message);
    res.status(500).json({ erro: "Erro ao limpar duplicatas." });
  }
});

// â”€â”€ IMPORTAR PLANILHA â†’ BANCO (MERGE/UPSERT, funciona mesmo com banco nÃ£o-vazio) â”€â”€
app.post("/api/admin/importar-de-sheets", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets nÃ£o configurado." });
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

      // Se jÃ¡ existe no banco pelo nÃºmero, pula
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
    console.log(`âœ… ImportaÃ§Ã£o da planilha: ${importados} novo(s), ${ignorados} jÃ¡ existiam.`);
    res.json({ ok: true, importados, ignorados, mensagem: `${importados} recibo(s) importado(s) da planilha. ${ignorados} jÃ¡ existiam no banco.` });
  } catch (e) {
    console.error("âŒ Erro ao importar da planilha:", e.message);
    res.status(500).json({ erro: "Erro ao importar da planilha." });
  }
});

// â”€â”€ IMPORTAÃ‡ÃƒO EM MASSA VIA JSON (para restaurar dados do Excel/backup) â”€â”€â”€â”€â”€â”€
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

  console.log(`âœ… importar-bulk: ${importados} importados, ${ignorados} ignorados, ${erros.length} erros`);
  res.json({ ok: true, importados, ignorados, erros: erros.slice(0, 10),
    mensagem: `${importados} registro(s) importado(s). ${ignorados} jÃ¡ existiam. Execute "Reescrever planilha" para sincronizar.` });
});

// â”€â”€ LIMPAR PLANILHA E REESCREVER DO ZERO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/admin/reescrever-planilha", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets nÃ£o configurado." });

  try {
    // LÃª todos os recibos do banco ordenados por timestamp
    const todos = await find(dbRecibos, NAO_DELETADO, { timestamp: 1 });
    if (todos.length === 0) return res.json({ ok: true, mensagem: "Nenhum recibo no banco." });

    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÃ‡O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    function parseDateBR(str) {
      if (!str) return null;
      const [d, m, y] = String(str).split("/");
      if (!d || !m || !y) return null;
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(dt.getTime()) ? null : dt;
    }

    // 1. Monta todas as linhas ANTES de limpar (sem gerar presigned URLs â€” evita timeout)
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
        r.motivo_pagamento || r.complemento || "HonorÃ¡rios AdvocatÃ­cios",
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
    if (!sheetMeta) return res.status(404).json({ erro: `Aba "${SHEET_NAME}" nÃ£o encontrada.` });
    const sheetId = sheetMeta.properties.sheetId;
    const totalRows = sheetMeta.properties.gridProperties?.rowCount || 0;

    // 3. Deleta fisicamente linhas extras (deixa 1 no fim â€” Sheets exige ao menos 1 linha nÃ£o-congelada)
    if (totalRows > 4) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              // endIndex exclusivo: deleta Ã­ndices 3..(totalRows-2), mantÃ©m Ãºltima linha
              range: { sheetId, dimension: "ROWS", startIndex: 3, endIndex: totalRows - 1 },
            },
          }],
        },
      });
    }

    // 4. Limpa valores remanescentes (a linha que sobrou + qualquer resÃ­duo)
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

    console.log(`âœ… Planilha reescrita: ${linhas.length} recibo(s) do banco.`);
    res.json({ ok: true, total: linhas.length, mensagem: `Planilha limpa e reescrita com ${linhas.length} recibo(s) do banco.` });
  } catch (e) {
    console.error("âŒ Erro ao reescrever planilha:", e.message);
    res.status(500).json({ erro: "Erro ao reescrever planilha.", detalhe: e.message });
  }
});

// â”€â”€ NORMALIZAR CAMPOS LIVRES (escritÃ³rio + forma de pagamento) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const v = (raw || "").trim().toUpperCase().replace(/[^A-ZÃÃ‰ÃÃ“ÃšÃƒÃ•Ã‚ÃŠÃ”Ã‡0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (v === "PIX" || v === "PÃŒX")            return "Pix";
  if (v.includes("LOTÃ‰RIC") ||
      v.includes("LOTERIC"))                 return "DepÃ³sito lotÃ©rica";
  if (v.includes("CAIXA"))                   return "DepÃ³sito caixa";
  if (v.includes("BB"))                      return "DepÃ³sito BB";
  if (v === "TED")                           return "TED";
  if (v.includes("TRANSFER"))               return "TransferÃªncia bancÃ¡ria";
  if (v.includes("DINHEIRO"))               return "Dinheiro";
  if (v.includes("CHEQUE"))                 return "Cheque";
  return raw;
}

// â”€â”€ MIGRAÃ‡ÃƒO NEDB â†’ NEON (endpoint Ãºnico, seguro rodar N vezes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/admin/migrar-nedb", auth, adminOnly, async (req, res) => {
  const result = { recibos: { ok: 0, skip: 0 }, clientes: { ok: 0, skip: 0 }, auditoria: { ok: 0, skip: 0 }, erros: [] };
  function lerDb(nome) {
    const p = path.join(dbDir, `${nome}.db`);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8").split("\n")
      .map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  // Recibos
  for (const r of lerDb("recibos")) {
    try {
      await pgPool.query(`
        INSERT INTO recibos (id,num,nome,cpf,municipio_uf,valor,data,emitido_por,complemento,
          referencia,forma_pagamento,escritorio,motivo_pagamento,link_comprovante,timestamp,
          assinatura_govbr,historico_edicoes,deletado_em,deletado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (id) DO NOTHING`,
        [ r._id, r.num||"", r.nome||"", r.cpf||"", r.municipio_uf||"", r.valor||"",
          r.data||"", r.emitido_por||"", r.complemento||"", r.referencia||"",
          r.forma_pagamento||"", r.escritorio||"", r.motivo_pagamento||"",
          r.link_comprovante||"", r.timestamp||0,
          r.assinatura_govbr ? JSON.stringify(r.assinatura_govbr) : null,
          JSON.stringify(r.historico_edicoes||[]),
          r.deletado_em||null, r.deletado_por||null ]);
      result.recibos.ok++;
    } catch(e) { result.recibos.skip++; result.erros.push(`recibo ${r._id}: ${e.message}`); }
  }

  // Clientes
  for (const c of lerDb("clientes")) {
    try {
      await pgPool.query(`
        INSERT INTO clientes (id,nome,cpf,telefone,endereco,municipio_uf,firma,referencia,
          valor_beneficio,num_beneficios,valor_contrato,num_parcelas,valor_parcela,parcelas,
          parcelas_pagas,parcelas_restantes,valor_pago,valor_restante,observacoes,
          updated_at,created_at,deletado_em,deletado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO NOTHING`,
        [ c._id, c.nome||"", c.cpf||"", c.telefone||"", c.endereco||"", c.municipio_uf||"",
          c.firma||"", c.referencia||"", Number(c.valor_beneficio)||0, Number(c.num_beneficios)||0,
          Number(c.valor_contrato)||0, Number(c.num_parcelas)||0, Number(c.valor_parcela)||0,
          JSON.stringify(c.parcelas||[]), Number(c.parcelas_pagas)||0,
          Number(c.parcelas_restantes)||0, Number(c.valor_pago)||0, Number(c.valor_restante)||0,
          JSON.stringify(c.observacoes||[]), c.updated_at||null, c.created_at||null,
          c.deletado_em||null, c.deletado_por||null ]);
      result.clientes.ok++;
    } catch(e) { result.clientes.skip++; result.erros.push(`cliente ${c._id}: ${e.message}`); }
  }

  // Auditoria
  for (const a of lerDb("auditoria")) {
    try {
      await pgPool.query(`
        INSERT INTO auditoria (id,ts,usuario,role,acao,entidade_id,dados)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [ a._id, a.ts||"", a.usuario||"", a.role||"", a.acao||"",
          a.entidade_id||"", JSON.stringify(a.dados||{}) ]);
      result.auditoria.ok++;
    } catch(e) { result.auditoria.skip++; result.erros.push(`audit ${a._id}: ${e.message}`); }
  }

  res.json({ ok: true, resultado: result });
});

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
    console.log(`âœ… Dados normalizados: ${atualizados} recibo(s)`);
    res.json({ ok: true, atualizados, total: todos.length });
  } catch (e) {
    console.error("âŒ Erro ao normalizar:", e.message);
    res.status(500).json({ erro: "Erro ao normalizar.", detalhe: e.message });
  }
});

// â”€â”€ IMPORTAR CLIENTES DOS RECIBOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // Pula se jÃ¡ existe (por CPF ou por nome quando sem CPF)
      if (cpfDigits && cpfsExistentes.has(cpfDigits)) { ignorados++; continue; }
      if (!cpfDigits && nomesExist.has(g.nome.toUpperCase())) { ignorados++; continue; }

      // Valida CPF/CNPJ se preenchido â€” pula invÃ¡lido
      if (cpfDigits && cpfDigits.length === 11 && !validarCPF(g.cpf)) { ignorados++; continue; }
      if (cpfDigits && cpfDigits.length === 14 && !validarCNPJ(g.cpf)) { ignorados++; continue; }

      // Usa o recibo mais recente para dados de referÃªncia
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

    console.log(`[${new Date().toISOString()}] âœ… Importar clientes dos recibos: ${importados} importados, ${ignorados} jÃ¡ existiam`);
    res.json({ ok: true, importados, ignorados });
  } catch (e) {
    console.error("âŒ Erro ao importar clientes dos recibos:", e.message);
    res.status(500).json({ erro: "Erro ao importar clientes.", detalhe: e.message });
  }
});

// â”€â”€ CORRIGIR DATAS NA PLANILHA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/api/admin/corrigir-datas", auth, adminOnly, async (req, res) => {
  const sheets = getSheetsClient();
  if (!sheets) return res.status(503).json({ erro: "Google Sheets nÃ£o configurado." });

  try {
    // LÃª todos os recibos do banco indexados por num_recibo
    const todos = await find(dbRecibos, NAO_DELETADO);
    const dbMap = new Map(todos.map(r => [String(r.num || "").trim(), r]));

    // LÃª todas as linhas da planilha
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:M`,
    });
    const rows = result.data.values || [];

    const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÃ‡O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
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

      // ReconstrÃ³i carimbo e mÃªs a partir do timestamp do banco
      const dt = parseDateBR(rec.data) || new Date(rec.timestamp || Date.now());
      const tsDate = rec.timestamp ? new Date(rec.timestamp) : dt;
      const carimbo = tsDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const mes = MESES_LOCAL[dt.getMonth()] || "";
      const dataFmt = dt.toLocaleDateString("pt-BR");

      const rowNum = idx + 1; // planilha Ã© 1-based
      updates.push({ rowNum, carimbo, mes, dataFmt, dataBR: rec.data || dataFmt });
    });

    if (updates.length === 0) {
      return res.json({ ok: true, corrigidas: 0, mensagem: "Nenhuma linha para corrigir." });
    }

    // Atualiza em lote: coluna A (carimbo), E (data pag), F (data dep), L (mÃªs)
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

    console.log(`âœ… Datas corrigidas em ${updates.length} linha(s).`);
    res.json({ ok: true, corrigidas: updates.length, mensagem: `Datas corrigidas em ${updates.length} linha(s) da planilha.` });
  } catch (e) {
    console.error("âŒ Erro ao corrigir datas:", e.message);
    res.status(500).json({ erro: "Erro ao corrigir datas." });
  }
});

// â”€â”€ EMAIL SMTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VariÃ¡veis de ambiente necessÃ¡rias no Elastic Beanstalk:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=email@dominio.com
//   SMTP_PASS=senha_de_app          â† use App Password do Google, nÃ£o a senha da conta
//   SMTP_FROM=Araujo Prev <email@dominio.com>
//   SMTP_ADMIN=email-do-admin@dominio.com  â† destinatÃ¡rio dos alertas de inadimplÃªncia

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
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function enviarEmail({ to, subject, html, attachments = [] }) {
  if (!smtpConfigurado()) {
    console.warn("âš ï¸  SMTP nÃ£o configurado â€” e-mail nÃ£o enviado.");
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
    console.log(`âœ… E-mail enviado para ${to} â€” messageId: ${info.messageId}`);
    return true;
  } catch (e) {
    console.error(`âŒ Falha ao enviar e-mail para ${to}: ${e.message}`);
    return false;
  }
}

// Carrega template HTML de web/templates/ e substitui variÃ¡veis {{chave}} pelos valores.
function carregarTemplate(nome, variaveis = {}) {
  try {
    const templatePath = path.join(__dirname, "templates", nome);
    let html = fs.readFileSync(templatePath, "utf8");
    for (const [chave, valor] of Object.entries(variaveis)) {
      html = html.replaceAll(`{{${chave}}}`, valor ?? "");
    }
    return html;
  } catch (e) {
    console.error(`âŒ Erro ao carregar template ${nome}: ${e.message}`);
    return null;
  }
}

// GET /api/notificacoes
// Retorna notificaÃ§Ãµes para a central de notificaÃ§Ãµes (parcelas vencendo/vencidas)
app.get("/api/notificacoes", auth, async (req, res) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const notificacoes = [];
    const clientes = await find(dbClientes, NAO_DELETADO);

    for (const c of clientes) {
      const parcelas = c.parcelas || [];
      parcelas.forEach((p, idx) => {
        if (p.status === "pago" || p.pago) return;
        if (!p.data_vencimento) return;
        const partes = p.data_vencimento.split("/");
        if (partes.length !== 3) return;
        const venc = new Date(parseInt(partes[2], 10), parseInt(partes[1], 10) - 1, parseInt(partes[0], 10));
        if (isNaN(venc.getTime())) return;
        const diff = Math.floor((venc - hoje) / 86400000);

        let gravidade = "info";
        let titulo = "";
        if (diff < 0) {
          gravidade = "danger";
          titulo = "Parcela vencida";
        } else if (diff <= 2) {
          gravidade = "warning";
          titulo = "Parcela prÃ³xima do vencimento";
        } else if (diff <= 7) {
          gravidade = "info";
          titulo = "Parcela a vencer";
        } else {
          return;
        }

        notificacoes.push({
          id: c._id + "-" + idx,
          tipo: "vencimento",
          titulo,
          texto: (c.nome || "Cliente") + " â€” Parcela " + (idx + 1) + (diff < 0 ? " venceu hÃ¡ " + Math.abs(diff) + " dia(s)" : " vence em " + diff + " dia(s)"),
          lido: false,
          gravidade,
          data: venc.toISOString(),
          ref: { clienteId: c._id, parcelaIdx: idx }
        });
      });
    }

    notificacoes.sort((a, b) => new Date(a.data) - new Date(b.data));
    const naoLidas = notificacoes.filter(n => !n.lido).length;
    res.json({ notificacoes: notificacoes.slice(0, 50), naoLidas });
  } catch (err) {
    console.error("Erro ao buscar notificaÃ§Ãµes:", err);
    res.status(500).json({ erro: "Erro ao buscar notificaÃ§Ãµes" });
  }
});

// POST /api/notificacoes/marcar-lidas
app.post("/api/notificacoes/marcar-lidas", auth, (req, res) => {
  // As notificaÃ§Ãµes sÃ£o volÃ¡teis (calculadas sob demanda), entÃ£o "marcar como lido"
  // Ã© apenas no front-end, mas aceitamos a requisiÃ§Ã£o para compatibilidade.
  res.json({ ok: true });
});

// POST /api/notificacoes/email-inadimplencia
// Envia e-mail ao admin com lista de clientes inadimplentes.
// Requer role admin ou financeiro.
app.post("/api/notificacoes/email-inadimplencia", auth, financeiroOnly, async (req, res) => {
  if (!smtpConfigurado()) {
    return res.status(503).json({ erro: "IntegraÃ§Ã£o de e-mail nÃ£o configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
  }

  const adminEmail = process.env.SMTP_ADMIN || process.env.SMTP_USER;
  if (!adminEmail) {
    return res.status(503).json({ erro: "Defina SMTP_ADMIN com o e-mail do destinatÃ¡rio do alerta." });
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
      ? `<p style="color:#16a34a">Nenhum cliente inadimplente no momento. âœ…</p>`
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
    }) || `<p>InadimplÃªncia ${dataRelatorio}: ${inadimplentes.length} cliente(s) â€” R$ ${totalValor.toFixed(2)}</p>`;

    const ok = await enviarEmail({
      to: adminEmail,
      subject: `[Araujo Prev] InadimplÃªncia â€” ${inadimplentes.length} cliente(s) â€” ${dataRelatorio}`,
      html,
    });

    if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configuraÃ§Ãµes SMTP." });

    console.log(`[${new Date().toISOString()}] E-mail de inadimplÃªncia enviado por ${req.user.username} â€” ${inadimplentes.length} clientes`);
    res.json({ ok: true, inadimplentes: inadimplentes.length, destinatario: adminEmail });
  } catch (e) {
    console.error("âŒ Erro ao gerar relatÃ³rio de inadimplÃªncia por e-mail:", e.message);
    res.status(500).json({ erro: "Erro interno ao processar relatÃ³rio." });
  }
});

// Gera PDF do recibo em memÃ³ria e envia como anexo para o e-mail do cliente.
// Aceita email_cliente OU email (alias usado pelo frontend); num_recibo OU num (alias).
// CPF, municipio_uf e data_extenso sÃ£o opcionais â€” o PDF Ã© gerado sem eles se ausentes.
app.post("/api/notificacoes/enviar-recibo-email", auth, financeiroOnly, async (req, res) => {
  if (!smtpConfigurado()) {
    return res.status(503).json({ erro: "IntegraÃ§Ã£o de e-mail nÃ£o configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
  }

  const body = req.body;
  // Aceita aliases usados pelo frontend (email â†’ email_cliente, num â†’ num_recibo)
  const emailDest = body.email_cliente || body.email || "";
  const numRecibo = body.num_recibo || body.num || "";
  const { nome, cpf = "", valor, data, emitido_por, complemento, referencia, municipio_uf = "", data_extenso = "" } = body;

  if (!emailDest || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDest)) {
    return res.status(400).json({ erro: "E-mail do destinatÃ¡rio invÃ¡lido ou nÃ£o informado." });
  }
  if (!nome || !valor) {
    return res.status(400).json({ erro: "Campos obrigatÃ³rios ausentes: nome, valor." });
  }

  try {
    const digits = cpf.replace(/\D/g, "");
    const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
    const textoComplemento = complemento ? ` - ${complemento}` : "";
    const logoPath = path.join(__dirname, "public", "logo.png");
    const logoExists = fs.existsSync(logoPath);

    const textoCorpo = `Recebemos do (a) senhor (a) ${nome}${municipio_uf ? `, residente e domiciliado(a) no MunicÃ­pio de ${municipio_uf}` : ""}, a importÃ¢ncia de R$ ${valor} referentes aos honorÃ¡rios advocatÃ­cios relacionados Ã  AÃ§Ã£o PrevidenciÃ¡ria${textoComplemento}.`;

    const chunks = [];
    const pdf = new PDFDocument({ margin: 60, size: "A4" });
    pdf.on("data", c => chunks.push(c));
    await new Promise((resolve, reject) => {
      pdf.on("end", resolve);
      pdf.on("error", reject);

      if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
      pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
        .text("A ARAUJO SERVIÃ‡OS LTDA ME", { align: "center" }).moveDown(0.2);
      pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);

      const lx = pdf.page.margins.left;
      const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);

      pdf.fontSize(12).font("Helvetica-Bold")
        .text(`Recibo NÂº ${numRecibo}${referencia ? "   |   Ref: " + referencia : ""}`, { align: "center" }).moveDown(0.2);
      pdf.fontSize(14).text("RECIBO DE HONORÃRIOS ADVOCATÃCIOS", { align: "center" }).moveDown(0.8);
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
    }) || `<p>OlÃ¡ ${nome}, segue em anexo o recibo NÂº ${numRecibo} no valor de R$ ${valor}.</p>`;

    const ok = await enviarEmail({
      to: emailDest,
      subject: `Recibo de HonorÃ¡rios NÂº ${numRecibo} â€” Araujo Prev`,
      html,
      attachments: [{ filename: nomeArquivo, content: pdfBuf, contentType: "application/pdf" }],
    });

    if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configuraÃ§Ãµes SMTP." });

    console.log(`[${new Date().toISOString()}] Recibo ${numRecibo} enviado por e-mail para ${emailDest} por ${req.user.username}`);
    res.json({ ok: true, destinatario: emailDest });
  } catch (e) {
    console.error("âŒ Erro ao enviar recibo por e-mail:", e.message);
    res.status(500).json({ erro: "Erro interno ao processar envio." });
  }
});

// â”€â”€ GOV.BR â€” ASSINATURA DIGITAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Credenciais fornecidas pelo Gov.br apÃ³s cadastro em:
// https://www.gov.br/governodigital/pt-br/privacidade-e-seguranca/login-unico
//
// VariÃ¡veis de ambiente necessÃ¡rias no Elastic Beanstalk:
//   GOVBR_CLIENT_ID     â†’ client_id recebido do Gov.br
//   GOVBR_CLIENT_SECRET â†’ client_secret recebido do Gov.br
//   GOVBR_REDIRECT_URI  â†’ URL de callback (ex: http://seu-dominio/api/govbr/callback)
//
// Ambientes:
//   HomologaÃ§Ã£o: https://sso.staging.acesso.gov.br
//   ProduÃ§Ã£o:    https://sso.acesso.gov.br

const GOVBR_CLIENT_ID     = process.env.GOVBR_CLIENT_ID     || "";
const GOVBR_CLIENT_SECRET = process.env.GOVBR_CLIENT_SECRET || "";
const GOVBR_REDIRECT_URI  = process.env.GOVBR_REDIRECT_URI  || "";
const GOVBR_BASE_URL      = process.env.GOVBR_ENV === "producao"
  ? "https://sso.acesso.gov.br"
  : "https://sso.staging.acesso.gov.br";

// Verifica se Gov.br estÃ¡ configurado
function govbrConfigurado() {
  return !!(GOVBR_CLIENT_ID && GOVBR_CLIENT_SECRET && GOVBR_REDIRECT_URI);
}

// Gera state aleatÃ³rio para seguranÃ§a OAuth2
function gerarState() {
  return require("crypto").randomBytes(16).toString("hex");
}

// States OAuth Gov.br persistidos no Neon (SEC-012 â€” sem Map em memÃ³ria)

// PASSO 1 â€” Inicia fluxo OAuth2: retorna URL de redirecionamento para o Gov.br
app.get("/api/govbr/iniciar", auth, async (req, res) => {
  if (!govbrConfigurado()) {
    return res.status(503).json({ erro: "IntegraÃ§Ã£o Gov.br nÃ£o configurada. Aguardando credenciais." });
  }
  const { recibo_id } = req.query;
  if (!recibo_id) return res.status(400).json({ erro: "recibo_id obrigatÃ³rio" });

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
    res.status(500).json({ erro: "Erro interno ao iniciar autenticaÃ§Ã£o Gov.br." });
  }
});

// PASSO 2 â€” Callback: Gov.br redireciona aqui apÃ³s o cliente autenticar
app.get("/api/govbr/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const agora = new Date().toISOString();

  if (error) {
    const mensagem = error_description
      ? `${error}: ${error_description}`
      : error === "access_denied"
        ? "Acesso negado pelo usuÃ¡rio no Gov.br."
        : `Erro retornado pelo Gov.br: ${error}`;
    console.warn(`[${agora}] Gov.br callback â€” erro retornado pelo provedor: ${mensagem}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(mensagem)}`);
  }

  const { rows: stateRows } = await pgPool.query(
    `DELETE FROM govbr_states WHERE state = $1 RETURNING recibo_id, username, expira_em`,
    [state]
  );
  const stateData = stateRows[0] ? { recibo_id: stateRows[0].recibo_id, user: stateRows[0].username, expires: new Date(stateRows[0].expira_em).getTime() } : null;
  if (!stateData) {
    console.warn(`[${agora}] Gov.br callback â€” state desconhecido ou jÃ¡ utilizado: ${state}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("SessÃ£o expirada ou invÃ¡lida. Inicie o processo novamente.")}`);
  }
  if (Date.now() > stateData.expires) {
    console.warn(`[${agora}] Gov.br callback â€” state expirado para usuÃ¡rio ${stateData.user}`);
    return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("SessÃ£o Gov.br expirada (limite de 10 minutos). Tente novamente.")}`);
  }

  console.log(`[${agora}] Gov.br callback â€” iniciando troca de code por token para recibo ${stateData.recibo_id} (usuÃ¡rio: ${stateData.user})`);

  try {
    // Troca code por token
    const tokenRes = await fetchWithTimeout(`${GOVBR_BASE_URL}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: GOVBR_REDIRECT_URI,
        client_id: GOVBR_CLIENT_ID,
        client_secret: GOVBR_CLIENT_SECRET,
      }),
    }, 15000);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error(`[${agora}] Gov.br callback â€” token nÃ£o recebido. Resposta: ${JSON.stringify(tokenData)}`);
      throw new Error("Token de acesso nÃ£o recebido. Verifique as credenciais Gov.br ou tente novamente.");
    }

    // Busca dados do usuÃ¡rio (nome, CPF)
    const userRes = await fetchWithTimeout(`${GOVBR_BASE_URL}/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }, 15000);
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
    console.log(`[${new Date().toISOString()}] âœ… Recibo ${stateData.recibo_id} assinado via Gov.br por ${assinatura.nome_assinante} (CPF: ${assinatura.cpf_assinante || "n/d"}) â€” usuÃ¡rio do sistema: ${stateData.user}`);

    res.redirect(`/?govbr_ok=1&recibo_id=${stateData.recibo_id}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] âŒ Erro no callback Gov.br para recibo ${stateData?.recibo_id}: ${e.message}`);
    const msgUsuario = e.message.includes("Token") || e.message.includes("userinfo")
      ? "Falha na comunicaÃ§Ã£o com Gov.br. Tente novamente em instantes."
      : e.message;
    res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(msgUsuario)}`);
  }
});

// PASSO 3 â€” Retorna status da assinatura de um recibo
app.get("/api/govbr/status/:id", auth, async (req, res) => {
  const recibo = await findOne(dbRecibos, { _id: req.params.id });
  if (!recibo) return res.status(404).json({ erro: "Recibo nÃ£o encontrado" });
  res.json({
    assinado: !!recibo.assinatura_govbr,
    assinatura: recibo.assinatura_govbr || null,
    configurado: govbrConfigurado(),
  });
});

// ════════════════════════════════════════════════════════════
// ASSINATURA REMOTA POR LINK
// A moça da cobrança gera um link; o cliente assina de casa, sem login.
// Segurança: o link usa um token aleatório (crypto.randomBytes), NUNCA o id
// do recibo, pois o recibo contém dados sensíveis (CPF, valor, nome).
// ════════════════════════════════════════════════════════════
const ASSINATURA_LINK_TTL_DIAS = 7;

function baseUrlDaRequisicao(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

// Gera (ou reaproveita) o link de assinatura — autenticado, papel financeiro
app.post("/api/recibos/:id/link-assinatura", auth, financeiroOnly, async (req, res) => {
  try {
    const recibo = await findOne(dbRecibos, { _id: req.params.id });
    if (!recibo || recibo.deletado_em) return res.status(404).json({ erro: "Recibo não encontrado." });
    if (recibo.assinatura_govbr) return res.status(409).json({ erro: "Este recibo já está assinado." });

    const agora = Date.now();
    const expiraAtual = recibo.assinatura_expira_em ? new Date(recibo.assinatura_expira_em).getTime() : 0;
    let token = recibo.assinatura_token;
    // Reusa o token se ainda válido; senão gera um novo.
    if (!token || expiraAtual < agora) {
      token = crypto.randomBytes(24).toString("hex");
      const expira = new Date(agora + ASSINATURA_LINK_TTL_DIAS * 24 * 60 * 60 * 1000);
      await update(dbRecibos, { _id: recibo._id }, {
        assinatura_token: token,
        assinatura_status: "pendente",
        assinatura_expira_em: expira.toISOString(),
      });
    }
    registrarAuditoria(req, "gerar_link_assinatura", recibo._id, { num: recibo.num, nome: recibo.nome });
    res.json({ url: `${baseUrlDaRequisicao(req)}/assinar/${token}`, token });
  } catch (e) {
    console.error("Erro ao gerar link de assinatura:", e);
    res.status(500).json({ erro: "Erro ao gerar link de assinatura." });
  }
});

// Busca recibo por token — helper interno
async function buscarReciboPorToken(token) {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return { erro: "invalido" };
  const recibo = await findOne(dbRecibos, { assinatura_token: token });
  if (!recibo || recibo.deletado_em) return { erro: "invalido" };
  if (recibo.assinatura_expira_em && new Date(recibo.assinatura_expira_em).getTime() < Date.now()) {
    return { erro: "expirado" };
  }
  return { recibo };
}

// PÚBLICO — dados mínimos do recibo para a tela de assinatura (sem auth)
app.get("/api/assinatura/:token", async (req, res) => {
  const { recibo, erro } = await buscarReciboPorToken(req.params.token);
  if (erro === "expirado") return res.status(410).json({ erro: "Este link de assinatura expirou." });
  if (erro) return res.status(404).json({ erro: "Link inválido ou não encontrado." });
  res.json({
    num: recibo.num,
    nome: recibo.nome,
    cpf_mascarado: maskCPF(recibo.cpf),
    valor: recibo.valor,
    data: recibo.data,
    ja_assinado: !!recibo.assinatura_govbr,
  });
});

// PÚBLICO — salva a assinatura desenhada pelo cliente (sem auth)
app.post("/api/assinatura/:token", async (req, res) => {
  try {
    const { recibo, erro } = await buscarReciboPorToken(req.params.token);
    if (erro === "expirado") return res.status(410).json({ erro: "Este link de assinatura expirou." });
    if (erro) return res.status(404).json({ erro: "Link inválido ou não encontrado." });
    if (recibo.assinatura_govbr) return res.status(409).json({ erro: "Este recibo já foi assinado." });

    const { assinatura, nome_confirmado, cpf_confirmado } = req.body || {};
    if (!assinatura || typeof assinatura !== "string" || !assinatura.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ erro: "Assinatura inválida." });
    }
    if (assinatura.length > 600000) {
      return res.status(413).json({ erro: "Assinatura muito grande." });
    }
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
    await update(dbRecibos, { _id: recibo._id }, {
      assinatura_govbr: {
        metodo: "remoto",
        nome_assinante: (nome_confirmado || recibo.nome || "").toString().slice(0, 200),
        cpf_assinante: (cpf_confirmado || recibo.cpf || "").toString().slice(0, 20),
        assinado_em: agora.toLocaleString("pt-BR"),
        ip,
        imagem: assinatura,
      },
      assinatura_status: "assinado",
    });
    console.log(`[${new Date().toISOString()}] ✅ Recibo ${recibo._id} (Nº ${recibo.num}) assinado remotamente. IP: ${ip}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao salvar assinatura remota:", e);
    res.status(500).json({ erro: "Erro ao registrar assinatura." });
  }
});

// PÚBLICO — serve a página de assinatura (sem auth, sem cookies)
app.get("/assinar/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assinar.html"));
});

// â”€â”€ WEBHOOK â€” RECIBO GERADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dispara um POST para WEBHOOK_URL (se configurado) a cada recibo salvo.
// â”€â”€ LEMBRETE AUTOMÃTICO DE PARCELAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa 30s apÃ³s startup para nÃ£o bloquear a inicializaÃ§Ã£o.
// Envia e-mail ao SMTP_ADMIN com parcelas que vencem nos prÃ³ximos 3 dias
// e ainda nÃ£o tiveram lembrete registrado (lembrete_enviado_em ausente).
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
      console.log(`[${new Date().toISOString()}] Lembrete automÃ¡tico: nenhuma parcela vencendo nos prÃ³ximos 3 dias.`);
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
    }) || `<p>${lembretes.length} parcela(s) vencem nos prÃ³ximos 3 dias.</p>`;

    const ok = await enviarEmail({
      to: adminEmail,
      subject: `[Araujo Prev] ${lembretes.length} parcela(s) vencem nos prÃ³ximos 3 dias`,
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
      console.log(`[${agora}] âœ… Lembretes de parcela enviados: ${lembretes.length} parcela(s) â€” destinatÃ¡rio: ${adminEmail}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] âŒ Erro no lembrete automÃ¡tico de parcelas: ${e.message}`);
  }
}

// â”€â”€ CRON â€” LEMBRETE DIÃRIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa todo dia Ã s 8h no horÃ¡rio de BrasÃ­lia
cron.schedule("0 8 * * *", () => {
  console.log(`[${new Date().toISOString()}] ðŸ•— Cron disparado: verificando lembretes de parcelas...`);
  verificarEEnviarLembretesParcelasProximas();
}, { timezone: "America/Sao_Paulo" });

// â”€â”€ BACKUP AUTOMÃTICO DIÃRIO PARA S3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Zipa recibos.db + clientes.db e grava em s3://BUCKET/backups/YYYY-MM-DD_backup_db.zip
async function fazerBackupDiario() {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    console.warn(`[${new Date().toISOString()}] âš ï¸  Backup diÃ¡rio ignorado â€” BUCKET_NAME nÃ£o configurado.`);
    return;
  }
  const ts = new Date().toISOString().slice(0, 10);
  const chaveS3 = `backups/${ts}_backup_db.zip`;
  try {
    const dataDir = path.join(__dirname, "data");
    const arquivos = ["recibos.db", "clientes.db"].filter(f => fs.existsSync(path.join(dataDir, f)));
    if (arquivos.length === 0) {
      console.warn(`[${new Date().toISOString()}] âš ï¸  Backup: nenhum arquivo .db encontrado em ${dataDir}`);
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

    await withTimeout(s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: chaveS3,
      Body: zipBuffer,
      ContentType: "application/zip",
    })), 30000);
    console.log(`[${new Date().toISOString()}] âœ… Backup diÃ¡rio â†’ s3://${bucket}/${chaveS3} (${(zipBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] âŒ Erro no backup diÃ¡rio: ${e.message}`);
  }
}

// Executa todo dia Ã s 02:00 BRT (05:00 UTC)
cron.schedule("0 5 * * *", () => {
  console.log(`[${new Date().toISOString()}] ðŸ•— Cron disparado: backup diÃ¡rio para S3...`);
  fazerBackupDiario();
}, { timezone: "UTC" });

// â”€â”€ RENOVAÃ‡ÃƒO SEMANAL DE PRESIGNED URLS NO GOOGLE SHEETS â”€â”€
// Percorre a coluna K da planilha e regera URLs de 30 dias para cada link S3 encontrado.
// Executa todo domingo Ã s 03:00 BRT (06:00 UTC)
cron.schedule("0 6 * * 0", () => {
  console.log(`[${new Date().toISOString()}] ðŸ•— Cron disparado: renovaÃ§Ã£o de presigned URLs no Sheets...`);
  renovarPresignedUrlsSheets(s3SignerClient);
}, { timezone: "UTC" });

// â”€â”€ CRON â€” INADIMPLÃŠNCIA + EMAIL DIÃRIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa todo dia Ã s 8h no horÃ¡rio de BrasÃ­lia: marca parcelas vencidas como atrasadas
// e envia e-mail ao admin se houver inadimplentes.
cron.schedule("0 8 * * *", async () => {
  console.log("[CRON] Verificando parcelas inadimplentes...");
  try {
    const clientes = await find(dbClientes, NAO_DELETADO);
    const hoje = new Date().toISOString().slice(0, 10);
    let totalCount = 0;
    for (const c of clientes) {
      let count = 0;
      const parcelas = (c.parcelas || []).map(p => {
        if (p.status === "pendente" && p.data_vencimento) {
          const [d, m, y] = p.data_vencimento.split("/");
          if (d && m && y) {
            const vencFormatado = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            if (vencFormatado < hoje) {
              count++;
              return { ...p, status: "atrasado" };
            }
          }
        }
        return p;
      });
      if (count > 0) {
        await update(dbClientes, { _id: c._id }, { parcelas });
        totalCount += count;
      }
    }
    console.log(`[CRON] ${totalCount} parcela(s) marcada(s) como atrasada(s).`);
    if (totalCount > 0 && smtpConfigurado()) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_ADMIN || process.env.SMTP_USER;
      if (adminEmail) {
        try {
          await enviarEmail({
            to: adminEmail,
            subject: `[Araujo Prev] ${totalCount} parcela(s) inadimplente(s)`,
            html: `<p>OlÃ¡,</p><p>${totalCount} parcela(s) estÃ£o vencidas e foram marcadas como atrasadas automaticamente.</p><p>Acesse o sistema para mais detalhes.</p>`,
          });
          console.log(`[CRON] Email de inadimplÃªncia enviado para ${adminEmail}`);
        } catch(e) {
          console.error("[CRON] Erro ao enviar email:", e.message);
        }
      }
    }
  } catch(e) {
    console.error("[CRON] Erro na verificaÃ§Ã£o:", e.message);
  }
}, { timezone: "America/Sao_Paulo" });
// ---- CRON - AUTO-RECIBOS MENSAIS ------------------------------------
cron.schedule("0 8 1 * *", async () => {
  console.log(`[${new Date().toISOString()}] Cron auto-recibos disparado...`);
  try {
    const clientes = await find(dbClientes, { auto_recibo: true, ...NAO_DELETADO });
    let gerados = 0;
    for (const c of clientes) {
      const enriquecido = await enriquecerCliente(c);
      const valorRecibo = enriquecido.valor_parcela || enriquecido.valor_contrato || 0;
      if (valorRecibo <= 0) continue;
      const timestamp = Date.now();
      const num = `${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}${String(gerados+1).padStart(3,"0")}`;
      await insert(dbRecibos, {
        num,
        nome: enriquecido.nome,
        cpf: enriquecido.cpf,
        municipio_uf: enriquecido.municipio_uf || "",
        valor: valorRecibo,
        data: new Date().toLocaleDateString("pt-BR"),
        emitido_por: "Sistema (auto)",
        complemento: "Mensalidade automática",
        referencia: enriquecido.referencia || "",
        forma_pagamento: "",
        escritorio: enriquecido.firma || "",
        timestamp,
        auto: true,
      });
      gerados++;
    }
    console.log(`[${new Date().toISOString()}] Auto-recibos: ${gerados} recibo(s) gerado(s).`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Erro no auto-recibos:`, e.message);
  }
}, { timezone: "America/Sao_Paulo" });



// â”€â”€ INICIAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Error handler global — nunca retorna HTML
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ erro: "Arquivo muito grande. Maximo permitido: 5MB." });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ erro: "Erro no upload: " + err.message });
  }
  console.error("Erro interno:", err);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

app.listen(PORT, async () => {
  console.log(`âœ… Araujo Prev rodando em http://localhost:${PORT}`);
  // Executa tambÃ©m no startup (30s) para verificar parcelas do dia sem esperar o cron das 8h
  setTimeout(verificarEEnviarLembretesParcelasProximas, 30_000);
});
