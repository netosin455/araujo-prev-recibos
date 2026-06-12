// ============================================================
// routes/auth.js — Login, logout, me, preferências do usuário
// ============================================================
module.exports = function registerAuthRoutes(app, deps) {
  const { pgPool, jwt, JWT_SECRET, bcrypt } = deps;

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ erro: "Preencha usuário e senha" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ erro: "Dados inválidos" });
    const { rows } = await pgPool.query("SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL", [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ erro: "Usuário ou senha incorretos" });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" }, JWT_SECRET, { expiresIn: "8h" });
    const isSecure = req.headers["x-forwarded-proto"] === "https" || req.protocol === "https";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "strict",
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json({ username: user.username, role: user.role || "financeiro", escritorio: user.escritorio || "" });
  });

  app.post("/api/logout", (req, res) => {
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
