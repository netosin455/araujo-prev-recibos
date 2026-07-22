// ============================================================
// routes/admin.js — Administração: usuários, backup, sync sheets
// ============================================================
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

module.exports = function registerAdminRoutes(app, deps) {
  // deps has: auth, adminOnly, pgPool, dbAuditoria, dbClientes, dbRecibos, dbNotificacoes, dbConfig, find, findOne, insert, update, remove, count, findLimited, registrarAuditoria, maskCPF, getSheetsClient, sincronizarUsuariosParaSheets, bcrypt, ADMIN_USER, s3Client, withTimeout, JWT_SECRET, jwt, NAO_DELETADO, SHEET_ID, SHEET_NAME, linkParaSheets, s3SignerClient

  // ── BACKUP DO BANCO DE DADOS (dump do Neon em JSON) ─────────
  // Reescrito: a versão antiga zipava arquivos NeDB locais que não existem
  // desde a migração pro Postgres — o botão retornava 404 sempre.
  app.get("/api/admin/backup-db", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const tabelas = ["recibos", "clientes", "auditoria", "documentos"];
      const dumps = await Promise.all(
        tabelas.map(t => deps.pgPool.query(`SELECT * FROM ${t}`))
      );

      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="backup_db_${ts}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", e => { logger.error("Erro backup ZIP:", e.message); });
      archive.pipe(res);
      tabelas.forEach((t, i) => {
        archive.append(JSON.stringify(dumps[i].rows, null, 1), { name: `${t}.json` });
      });
      archive.append(JSON.stringify({ gerado_em: new Date().toISOString(), origem: "Neon PostgreSQL", tabelas: tabelas.map((t, i) => ({ tabela: t, registros: dumps[i].rows.length })) }, null, 2), { name: "manifesto.json" });
      deps.registrarAuditoria(req, "backup_db", "", { tabelas: tabelas.length });
      await archive.finalize();
    } catch (e) {
      logger.error("Erro ao gerar backup:", e.message);
      if (!res.headersSent) res.status(500).json({ erro: "Erro ao gerar backup." });
    }
  });

  // ── ROTAS USUÁRIOS ─────────────────────────────────────────
  app.get("/api/users", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { rows } = await deps.pgPool.query("SELECT id, username, role, escritorio, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC");
      res.json(rows);
    } catch (e) {
      logger.error("Erro ao listar usuários:", e.message);
      res.status(500).json({ erro: "Erro ao listar usuários." });
    }
  });

  app.post("/api/users", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { username, password, role, escritorio } = req.body;
      if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
      const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
      if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role inválido." });
      if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritório para usuário de recepção." });
      const hash = deps.bcrypt.hashSync(password, 10);
      const { rows } = await deps.pgPool.query(
        "INSERT INTO users (id, username, password, role, escritorio, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id",
        [username, hash, role || "financeiro", escritorio || "", new Date().toISOString()]
      );
      deps.registrarAuditoria(req, "criar_usuario", rows[0].id, { username, role: role || "financeiro" });
      deps.sincronizarUsuariosParaSheets().catch(e => logger.error("❌ Sync Sheets falhou:", e.message));
      res.json({ id: rows[0].id, username });
    } catch (e) {
      if (e.code === "23505") return res.status(400).json({ erro: "Usuário já existe" });
      logger.error("Erro ao criar usuário:", e.message);
      res.status(500).json({ erro: "Erro ao criar usuário." });
    }
  });

  app.put("/api/users/:id", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { username, password, role, escritorio } = req.body;
      if (!username) return res.status(400).json({ erro: "Preencha o usuário." });
      const ROLES_VALIDOS = ["admin", "financeiro", "recepcao", "precatorios"];
      if (role && !ROLES_VALIDOS.includes(role)) return res.status(400).json({ erro: "Role inválido." });
      if (role === "recepcao" && !escritorio) return res.status(400).json({ erro: "Informe o escritório para usuário de recepção." });
      const { rows: exists } = await deps.pgPool.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
      if (!exists[0]) return res.status(404).json({ erro: "Usuário não encontrado." });
      if (password) {
        await deps.pgPool.query(
          "UPDATE users SET username=$1, role=$2, escritorio=$3, password=$4, token_version=token_version+1 WHERE id=$5",
          [username, role || "financeiro", escritorio || "", deps.bcrypt.hashSync(password, 10), req.params.id]
        );
      } else {
        await deps.pgPool.query(
          "UPDATE users SET username=$1, role=$2, escritorio=$3, token_version=token_version+1 WHERE id=$4",
          [username, role || "financeiro", escritorio || "", req.params.id]
        );
      }
      deps.sincronizarUsuariosParaSheets().catch(e => logger.error("❌ Sync Sheets falhou:", e.message));
      res.json({ ok: true });
    } catch (e) {
      logger.error("Erro ao atualizar usuário:", e.message);
      res.status(500).json({ erro: "Erro ao atualizar usuário." });
    }
  });

  app.delete("/api/users/:id", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { rows } = await deps.pgPool.query("SELECT username FROM users WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado." });
      if (rows[0].username === deps.ADMIN_USER) return res.status(400).json({ erro: "Não é possível remover o admin." });
      await deps.pgPool.query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [req.params.id]);
      deps.registrarAuditoria(req, "excluir_usuario", req.params.id, { username: rows[0].username });
      deps.sincronizarUsuariosParaSheets().catch(e => logger.error("❌ Sync Sheets falhou:", e.message));
      res.json({ ok: true });
    } catch (e) {
      logger.error("Erro ao excluir usuário:", e.message);
      res.status(500).json({ erro: "Erro ao excluir usuário." });
    }
  });

  // ── LIXEIRA (soft delete) — listar e restaurar ─────────────
  app.get("/api/admin/lixeira", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const DELETADO = { deletado_em: { $exists: true } };
      // Só os 10 mais recentes de cada — a lixeira é pra recuperar exclusão
      // acidental recente, não pra navegar o histórico inteiro (isso é a auditoria)
      const [recibos, clientes, docsRes] = await Promise.all([
        deps.findLimited(deps.dbRecibos, DELETADO, { deletado_em: -1 }, 10),
        deps.findLimited(deps.dbClientes, DELETADO, { deletado_em: -1 }, 10),
        deps.pgPool.query(
          `SELECT id, nome, tipo, cliente_cpf, deletado_em FROM documentos
           WHERE deletado_em IS NOT NULL ORDER BY deletado_em DESC LIMIT 10`
        ),
      ]);
      res.json({
        recibos: recibos.map(r => ({ id: r.id, num: r.num, nome: r.nome, valor: r.valor, data: r.data, deletado_em: r.deletado_em, deletado_por: r.deletado_por })),
        clientes: clientes.map(c => ({ id: c.id, nome: c.nome, cpf: deps.maskCPF(c.cpf || ""), deletado_em: c.deletado_em, deletado_por: c.deletado_por })),
        documentos: docsRes.rows.map(d => ({ id: d.id, nome: d.nome, tipo: d.tipo, cpf: deps.maskCPF(d.cliente_cpf || ""), deletado_em: d.deletado_em })),
      });
    } catch (e) {
      logger.error("Erro ao listar lixeira:", e.message);
      res.status(500).json({ erro: "Erro ao listar lixeira." });
    }
  });

  app.post("/api/admin/lixeira/:tipo/:id/restaurar", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { tipo, id } = req.params;
      if (tipo !== "recibos" && tipo !== "clientes" && tipo !== "documentos") return res.status(400).json({ erro: "Tipo inválido." });
      // Documentos vivem em tabela própria (pgPool direto), sem coluna deletado_por
      if (tipo === "documentos") {
        const { rows } = await deps.pgPool.query(
          `UPDATE documentos SET deletado_em=NULL WHERE id=$1 AND deletado_em IS NOT NULL RETURNING nome, tipo, cliente_cpf`,
          [id]
        );
        if (rows.length === 0) return res.status(404).json({ erro: "Registro não encontrado na lixeira." });
        deps.registrarAuditoria(req, "restaurar_documento", id,
          { nome: rows[0].nome, tipo: rows[0].tipo, cpf: deps.maskCPF(rows[0].cliente_cpf || "") });
        return res.json({ ok: true });
      }
      const tabela = tipo === "recibos" ? deps.dbRecibos : deps.dbClientes;
      const doc = await deps.findOne(tabela, { _id: id, deletado_em: { $exists: true } });
      if (!doc) return res.status(404).json({ erro: "Registro não encontrado na lixeira." });
      // O índice único de num só vale para recibos ativos — evita colisão ao restaurar
      if (tipo === "recibos" && doc.num) {
        const conflito = await deps.findOne(deps.dbRecibos, { num: doc.num, ...deps.NAO_DELETADO });
        if (conflito) return res.status(409).json({ erro: `Já existe um recibo ativo com o número ${doc.num}. Não é possível restaurar.` });
      }
      await deps.update(tabela, { _id: id }, { deletado_em: null, deletado_por: null });
      deps.registrarAuditoria(req, tipo === "recibos" ? "restaurar_recibo" : "restaurar_cliente", id,
        tipo === "recibos" ? { num: doc.num, nome: doc.nome } : { nome: doc.nome, cpf: deps.maskCPF(doc.cpf || "") });
      res.json({ ok: true });
    } catch (e) {
      logger.error("Erro ao restaurar da lixeira:", e.message);
      res.status(500).json({ erro: "Erro ao restaurar registro." });
    }
  });

  // ── SYNC FORÇADO: NeDB → Google Sheets ─────────────────────
  app.post("/api/admin/sync-sheets", deps.auth, deps.adminOnly, async (req, res) => {
    const sheets = deps.getSheetsClient();
    if (!sheets) return res.status(503).json({ erro: "Google Sheets não configurado (verifique GOOGLE_CREDENTIALS no EB)." });

    try {
      const todos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO, { timestamp: 1 });
      if (todos.length === 0) return res.json({ ok: true, enviados: 0, mensagem: "Nenhum recibo no banco." });

      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: deps.SHEET_ID,
        range: `${deps.SHEET_NAME}!M4:M`,
      });
      const naPlilha = new Set((existing.data.values || []).flat().map(v => String(v || "").trim()).filter(Boolean));

      const faltando = todos.filter(r => r.num && !naPlilha.has(String(r.num).trim()));
      if (faltando.length === 0) return res.json({
        ok: true, enviados: 0,
        mensagem: `Todos os ${todos.length} recibos já estão na planilha (${naPlilha.size} entradas detectadas na coluna M).`
      });

      const MESES_LOCAL = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
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
          await require("../services/google-sheets").celulaComprovante(r.link_comprovante || "", deps.s3SignerClient),
          mes,
          r.num || "",
          r.emitido_por || "",
          r.referencia || "",
        ];
      }));

      // NUNCA usar values.append com INSERT_ROWS (lição do CLAUDE.md 2026-05-28:
      // linha em branco no meio faz a detecção de tabela inserir no topo).
      // Determinístico: conta as linhas da coluna A e escreve a partir da próxima.
      const colA = await sheets.spreadsheets.values.get({
        spreadsheetId: deps.SHEET_ID,
        range: `${deps.SHEET_NAME}!A:A`,
      });
      const nextRow = (colA.data.values || []).length + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: deps.SHEET_ID,
        range: `${deps.SHEET_NAME}!A${nextRow}:O${nextRow + linhas.length - 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: linhas },
      });

      const rangeEscrito = `A${nextRow}:O${nextRow + linhas.length - 1}`;
      logger.info(`✅ Sync forçado: ${linhas.length} recibo(s) escritos no range ${rangeEscrito}.`);
      res.json({
        ok: true,
        enviados: linhas.length,
        mensagem: `${linhas.length} recibo(s) adicionados. Total no banco: ${todos.length}. Na planilha antes: ${naPlilha.size}. Escrito em: ${rangeEscrito}.`
      });
    } catch (e) {
      logger.error("❌ Erro no sync forçado para Sheets:", e.message);
      res.status(500).json({ erro: "Erro ao sincronizar planilha." });
    }
  });

  // ════════════════════════════════════════════════════════════
  // Rotas administrativas movidas de server.js (Fase 1 da refatoração)
  // ════════════════════════════════════════════════════════════
  const logger = require("../services/logger");
  const { normalizarEscritorio, normalizarFormaPagamento, validarCPF, validarCNPJ } = require("../services/helpers");
  const { auth, adminOnly, financeiroOnly, pgPool, dbRecibos, dbClientes, dbAuditoria, NAO_DELETADO,
          find, findOne, insert, update, getSheetsClient, SHEET_ID, SHEET_NAME, linkParaSheets, s3SignerClient } = deps;
  const dbDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");

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
    logger.error("Erro ao buscar audit-log:", e.message);
    res.status(500).json({ erro: "Erro ao buscar log de auditoria." });
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

    logger.info(`âœ… Limpeza: ${toDelete.length} linha(s) duplicada(s) removida(s).`);
    res.json({ ok: true, removidas: toDelete.length, mensagem: `${toDelete.length} linha(s) duplicada(s) removida(s) com sucesso.` });
  } catch (e) {
    logger.error("âŒ Erro ao limpar duplicatas:", e.message);
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
    logger.info(`âœ… ImportaÃ§Ã£o da planilha: ${importados} novo(s), ${ignorados} jÃ¡ existiam.`);
    res.json({ ok: true, importados, ignorados, mensagem: `${importados} recibo(s) importado(s) da planilha. ${ignorados} jÃ¡ existiam no banco.` });
  } catch (e) {
    logger.error("âŒ Erro ao importar da planilha:", e.message);
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

  logger.info(`âœ… importar-bulk: ${importados} importados, ${ignorados} ignorados, ${erros.length} erros`);
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

    logger.info(`âœ… Planilha reescrita: ${linhas.length} recibo(s) do banco.`);
    // A reescrita grava caminhos crus na coluna K (rápido) — em segundo plano,
    // converte tudo pra "Ver comprovante" clicável sem esperar o cron de domingo
    setImmediate(() => {
      require("../services/google-sheets").renovarPresignedUrlsSheets(s3SignerClient)
        .catch(err => logger.warn("Renovação pós-reescrita falhou: " + err.message));
    });
    res.json({ ok: true, total: linhas.length, mensagem: `Planilha limpa e reescrita com ${linhas.length} recibo(s) do banco. Links de comprovante serão reativados em instantes.` });
  } catch (e) {
    logger.error("âŒ Erro ao reescrever planilha:", e.message);
    res.status(500).json({ erro: "Erro ao reescrever planilha.", detalhe: e.message });
  }
});


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
    logger.info(`âœ… Dados normalizados: ${atualizados} recibo(s)`);
    res.json({ ok: true, atualizados, total: todos.length });
  } catch (e) {
    logger.error("âŒ Erro ao normalizar:", e.message);
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

    logger.info(`âœ… Importar clientes dos recibos: ${importados} importados, ${ignorados} jÃ¡ existiam`);
    res.json({ ok: true, importados, ignorados });
  } catch (e) {
    logger.error("âŒ Erro ao importar clientes dos recibos:", e.message);
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

    logger.info(`âœ… Datas corrigidas em ${updates.length} linha(s).`);
    res.json({ ok: true, corrigidas: updates.length, mensagem: `Datas corrigidas em ${updates.length} linha(s) da planilha.` });
  } catch (e) {
    logger.error("âŒ Erro ao corrigir datas:", e.message);
    res.status(500).json({ erro: "Erro ao corrigir datas." });
  }
});
};
