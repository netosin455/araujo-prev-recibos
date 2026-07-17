// ============================================================
const logger = require("../services/logger");
// routes/auth.js — Login, logout, me, preferências do usuário
// ============================================================
module.exports = function registerAuthRoutes(app, deps) {
  const { pgPool, jwt, JWT_SECRET, bcrypt, loginLimiter } = deps;

  /**
   * @openapi
   * /api/login:
   *   post:
   *     tags: [Autenticação]
   *     summary: Autentica usuário e retorna cookie httpOnly
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/LoginRequest'
   *     responses:
   *       200:
   *         description: Login bem-sucedido
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 username: { type: string }
   *                 role: { type: string }
   *                 escritorio: { type: string }
   *       400:
   *         description: Dados inválidos
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Credenciais inválidas
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  app.post("/api/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ erro: "Dados inválidos" });
    const { rows } = await pgPool.query("SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL", [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ erro: "Usuário ou senha incorretos" });
    }
    // token_version dentro do JWT: logout incrementa a versão no banco e todos
    // os tokens antigos do usuário morrem na hora (SEC — Falha #2)
    const token = jwt.sign({
      id: user.id, username: user.username, role: user.role || "financeiro",
      escritorio: user.escritorio || "", token_version: user.token_version || 0,
    }, JWT_SECRET, { expiresIn: "30d" });
    const isSecure = req.headers["x-forwarded-proto"] === "https" || req.protocol === "https";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    // Auditoria de login com IP de origem — nunca bloqueia o login se falhar
    try {
      await deps.insert(deps.dbAuditoria, {
        ts: new Date().toISOString(),
        usuario: user.username,
        role: user.role || "financeiro",
        acao: "login",
        entidade_id: user.id,
        dados: { ip: req.headers["x-forwarded-for"] || req.ip || "" },
      });
    } catch (e) { logger.error("Auditoria de login falhou:", e.message); }
    res.json({ username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" });
  });

  app.post("/api/logout", deps.auth, async (req, res) => {
    // Invalida TODOS os tokens do usuário (token_version) — não só o cookie local
    try {
      await pgPool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [req.user.id]);
    } catch (e) { logger.error("Erro ao invalidar tokens no logout:", e.message); }
    res.clearCookie("token", { httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
  });

  app.get("/api/me", deps.auth, async (req, res) => {
    const { rows } = await pgPool.query(
      "SELECT id, username, nome_completo, role, escritorio, referencia_padrao FROM users WHERE id=$1 AND deleted_at IS NULL",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado" });
    res.json(rows[0]);
  });

  app.put("/api/me/referencia", deps.auth, async (req, res) => {
    const { referencia_padrao } = req.body;
    if (typeof referencia_padrao !== "string") return res.status(400).json({ erro: "Valor inválido" });
    if (referencia_padrao.length > 20) return res.status(400).json({ erro: "Referência muito longa (máx. 20 caracteres)." });
    await pgPool.query("UPDATE users SET referencia_padrao=$1 WHERE id=$2", [referencia_padrao.toUpperCase(), req.user.id]);
    res.json({ ok: true });
  });

  app.put("/api/me/nome-completo", deps.auth, async (req, res) => {
    const { nome_completo } = req.body;
    if (typeof nome_completo !== "string") return res.status(400).json({ erro: "Valor inválido" });
    if (nome_completo.length > 80) return res.status(400).json({ erro: "Nome muito longo (máx. 80 caracteres)." });
    await pgPool.query("UPDATE users SET nome_completo=$1 WHERE id=$2", [nome_completo.trim(), req.user.id]);
    res.json({ ok: true });
  });
};
