// ============================================================
// middleware/auth.js — Middleware de autenticação e autorização
// ============================================================
module.exports = function createAuthMiddleware(deps) {
  const { jwt, JWT_SECRET, ADMIN_USER, pgPool } = deps;

  async function auth(req, res, next) {
    // Só cookie httpOnly — o fallback via header Authorization foi removido
    // (SEC — Falha #4): header pode ser setado por JS, cookie httpOnly não.
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ erro: "Não autorizado" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const { rows } = await pgPool.query(
        "SELECT id, token_version FROM users WHERE id = $1 AND deleted_at IS NULL",
        [payload.id]
      );
      if (!rows[0]) return res.status(401).json({ erro: "Sessão inválida, faça login novamente" });
      // token_version defasada = logout aconteceu depois que este token foi emitido
      if ((rows[0].token_version || 0) !== (payload.token_version || 0)) {
        return res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
      }
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
    if (req.user.role === "recepcao" || req.user.role === "precatorios")
      return res.status(403).json({ erro: "Sem permissão para esta ação." });
    next();
  }

  function semRecepcao(req, res, next) {
    if (req.user.role === "recepcao") return res.status(403).json({ erro: "Sem permissão para esta ação." });
    next();
  }

  function semPrecatorios(req, res, next) {
    if (req.user.role === "precatorios") return res.status(403).json({ erro: "Sem permissão para esta ação." });
    next();
  }

  return { auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios };
};
