// ============================================================
// services/startup.js — Rotinas de inicialização e migração
// (initDb, restaurações do Google Sheets, normalizações).
// Movido de server.js na Fase 1 da refatoração.
// ============================================================
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const logger = require("./logger");
const { getSheetsClient, SHEET_ID, SHEET_NAME } = require("./google-sheets");

module.exports = function criarStartup({ pgPool, db, dbDir, ADMIN_USER, ADMIN_PASS, USERS_JSON, dbRecibos, dbClientes, NAO_DELETADO }) {
  const { find, findOne, insert, update, count } = db;

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
    logger.info(`âœ… ${valores.length} usuÃ¡rio(s) sincronizados para o Sheets.`);
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
        logger.error("âŒ Erro ao criar aba Usuarios:", e2.message);
      }
    } else {
      logger.error("âŒ Erro ao sincronizar usuÃ¡rios para Sheets:", e.message);
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
        logger.warn(`âš ï¸  UsuÃ¡rio '${username}' restaurado sem senha â€” admin deve redefinir via painel.`);
      }
    }
    logger.info(`âœ… ${restaurados} usuÃ¡rio(s) restaurados do Sheets para o Neon.`);
    return restaurados;
  } catch (e) {
    logger.error("âŒ Erro ao restaurar usuÃ¡rios do Sheets:", e.message);
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

  logger.info("ðŸ”„ Auto-migraÃ§Ã£o NeDB â†’ Neon iniciada...");
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
  logger.info(`  âœ… Recibos: ${ok} migrados, ${err} erros`);

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
  logger.info(`  âœ… Clientes: ${ok} migrados, ${err} erros`);

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
  logger.info(`  âœ… Auditoria: ${ok} migrados, ${err} erros`);
  logger.info("ðŸŽ‰ Auto-migraÃ§Ã£o concluÃ­da!");
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
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0
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
  logger.info("âœ… Tabela govbr_states pronta.");

  // Admin: sempre atualiza senha/role para refletir env vars (conta de sistema)
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
  await pgPool.query(`
    INSERT INTO users (id, username, password, role, created_at)
    VALUES (gen_random_uuid()::text, $1, $2, 'admin', $3)
    ON CONFLICT (username) DO UPDATE SET password = $2, role = 'admin'
  `, [ADMIN_USER, adminHash, new Date().toISOString()]);
  logger.info("âœ… UsuÃ¡rio admin configurado (Neon).");

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
          logger.info(`âœ… UsuÃ¡rio ${u.username} criado via USERS_JSON.`);
        }
      }
    } catch (e) {
      logger.error("âŒ Erro ao processar USERS_JSON:", e.message);
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

  // Contador atômico de numeração de recibo (por ano). Reservar o próximo número
  // via UPDATE ... RETURNING nesta tabela é à prova de corrida — dois recibos
  // criados ao mesmo tempo NUNCA recebem o mesmo número (fim dos duplicados/500).
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS recibo_counters (
      ano    INTEGER PRIMARY KEY,
      ultimo INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Semeia o contador de cada ano com o MAIOR número já existente, pra continuar
  // de onde está (não reiniciar no 0001). Idempotente: GREATEST nunca reduz o
  // contador, então rodar todo boot é seguro e ainda se auto-corrige.
  await pgPool.query(`
    INSERT INTO recibo_counters (ano, ultimo)
    SELECT (split_part(num, '/', 2))::int AS ano,
           MAX((split_part(num, '/', 1))::int) AS ultimo
      FROM recibos
     WHERE num ~ '^[0-9]+/[0-9]{4}$' AND deletado_em IS NULL
     GROUP BY split_part(num, '/', 2)
    ON CONFLICT (ano) DO UPDATE
      SET ultimo = GREATEST(recibo_counters.ultimo, EXCLUDED.ultimo)
  `);

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
  await pgPool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS valor_entrada NUMERIC(12,2) NOT NULL DEFAULT 0`);

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

  // Jobs de exportação em lote (processados de forma assíncrona via SQS + Lambda)
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS export_jobs (
      id         TEXT        PRIMARY KEY,
      status     TEXT        NOT NULL DEFAULT 'fila',
      total      INT         NOT NULL DEFAULT 0,
      prontos    INT         NOT NULL DEFAULT 0,
      formato    TEXT        NOT NULL DEFAULT 'pdf',
      s3_key     TEXT,
      url        TEXT,
      erro       TEXT,
      criado_por TEXT        NOT NULL DEFAULT '',
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_export_jobs_criado ON export_jobs (criado_em DESC)`);

  // Fichário — documentos (fotos/PDFs) de cada cliente. Arquivos ficam no S3;
  // aqui só os metadados + as chaves S3 (original e miniatura). Soft-delete.
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS documentos (
      id           TEXT        PRIMARY KEY,
      cliente_cpf  TEXT        NOT NULL,
      tipo         TEXT        NOT NULL DEFAULT '',
      nome         TEXT        NOT NULL DEFAULT '',
      s3_key       TEXT        NOT NULL,
      s3_key_thumb TEXT,
      content_type TEXT        NOT NULL DEFAULT '',
      tamanho      INTEGER     NOT NULL DEFAULT 0,
      criado_por   TEXT        NOT NULL DEFAULT '',
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deletado_em  TIMESTAMPTZ
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_documentos_cpf ON documentos (cliente_cpf) WHERE deletado_em IS NULL`);

  logger.info("âœ… Tabelas recibos, clientes e auditoria prontas.");

  // Auto-migraÃ§Ã£o NeDB â†’ Neon: roda uma Ãºnica vez se as tabelas estiverem vazias
  await autoMigrarNedb();

  // Se o banco tem sÃ³ o admin (reset detectado), tenta restaurar do Sheets
  const { rows: countRows } = await pgPool.query(
    "SELECT COUNT(*) AS total FROM users WHERE username != $1", [ADMIN_USER]
  );
  const totalNaoAdmin = parseInt(countRows[0].total, 10);
  logger.info(`â„¹ï¸  UsuÃ¡rios no banco Neon (exceto admin): ${totalNaoAdmin}`);
  if (totalNaoAdmin === 0) {
    logger.info("âš ï¸  Banco vazio â€” tentando restaurar usuÃ¡rios do Sheets...");
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
    let importados = 0, ignorados = 0;
    const numsVistos = new Set(); // evita duplicar números repetidos NA PRÓPRIA planilha
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
      // Dedup: pula número repetido na planilha ou já existente no banco.
      if (numsVistos.has(num)) { ignorados++; continue; }
      numsVistos.add(num);
      if (await findOne(dbRecibos, { num })) { ignorados++; continue; }
      try {
        await insert(dbRecibos, { num, nome, cpf, municipio_uf: "", valor, data, emitido_por, complemento: "", referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante, timestamp });
        importados++;
      } catch (errIns) {
        // Índice único de num ou erro pontual — pula sem abortar o restore inteiro.
        ignorados++;
        logger.warn(`sincronizarDeSheets: pulado num ${num}: ${errIns.message}`);
      }
    }
    logger.info(`âœ… ${importados} recibos restaurados da planilha Google Sheets (${ignorados} ignorados/duplicados).`);
  } catch (e) {
    logger.error("âŒ Erro ao sincronizar recibos da planilha:", e.message);
  }
}

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
    if (atualizados > 0) logger.info(`âœ… ${atualizados} comprovantes sincronizados da planilha.`);
  } catch (e) {
    logger.error("âŒ Erro ao sincronizar comprovantes:", e.message);
  }
}

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
    if (corrigidos > 0) logger.info(`âœ… ${corrigidos} registros normalizados (nome/CPF).`);
  } catch (e) {
    logger.error("âŒ Erro ao normalizar dados:", e.message);
  }
}

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
    if (corrigidos > 0) logger.info(`âœ… ${corrigidos} registros com nome unificado por CPF.`);
  } catch (e) {
    logger.error("âŒ Erro ao unificar nomes por CPF:", e.message);
  }
}

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
    if (corrigidos > 0) logger.info(`âœ… ${corrigidos} links de comprovante corrigidos.`);
  } catch (e) {
    logger.error("âŒ Erro ao corrigir links de comprovante:", e.message);
  }
}

  return {
    sincronizarUsuariosParaSheets,
    restaurarUsuariosDeSheets,
    autoMigrarNedb,
    initDb,
    sincronizarDeSheets,
    sincronizarComprovantes,
    normalizarDados,
    unificarNomesPorCPF,
    corrigirLinksComprovante,
  };
};
