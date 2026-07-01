// ============================================================
// routes/admin.js — Administração: usuários, backup, sync sheets
// ============================================================
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

module.exports = function registerAdminRoutes(app, deps) {
  // deps has: auth, adminOnly, pgPool, dbAuditoria, dbClientes, dbRecibos, dbNotificacoes, dbConfig, find, findOne, insert, update, remove, count, findLimited, registrarAuditoria, maskCPF, getSheetsClient, sincronizarUsuariosParaSheets, bcrypt, ADMIN_USER, s3Client, withTimeout, JWT_SECRET, jwt, NAO_DELETADO, SHEET_ID, SHEET_NAME, linkParaSheets, s3SignerClient

  // ── BACKUP DO BANCO DE DADOS ────────────────────────────────
  app.get("/api/admin/backup-db", deps.auth, deps.adminOnly, async (req, res) => {
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

  // ── ROTAS USUÁRIOS ─────────────────────────────────────────
  app.get("/api/users", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const { rows } = await deps.pgPool.query("SELECT id, username, role, escritorio, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC");
      res.json(rows);
    } catch (e) {
      console.error("Erro ao listar usuários:", e.message);
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
      deps.sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
      res.json({ id: rows[0].id, username });
    } catch (e) {
      if (e.code === "23505") return res.status(400).json({ erro: "Usuário já existe" });
      console.error("Erro ao criar usuário:", e.message);
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
          "UPDATE users SET username=$1, role=$2, escritorio=$3, password=$4 WHERE id=$5",
          [username, role || "financeiro", escritorio || "", deps.bcrypt.hashSync(password, 10), req.params.id]
        );
      } else {
        await deps.pgPool.query(
          "UPDATE users SET username=$1, role=$2, escritorio=$3 WHERE id=$4",
          [username, role || "financeiro", escritorio || "", req.params.id]
        );
      }
      deps.sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao atualizar usuário:", e.message);
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
      deps.sincronizarUsuariosParaSheets().catch(e => console.error("❌ Sync Sheets falhou:", e.message));
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao excluir usuário:", e.message);
      res.status(500).json({ erro: "Erro ao excluir usuário." });
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
          await deps.linkParaSheets(r.link_comprovante || "", deps.s3SignerClient),
          mes,
          r.num || "",
          r.emitido_por || "",
          r.referencia || "",
        ];
      }));

      const appendResult = await sheets.spreadsheets.values.append({
        spreadsheetId: deps.SHEET_ID,
        range: `${deps.SHEET_NAME}!A4:O`,
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
};
