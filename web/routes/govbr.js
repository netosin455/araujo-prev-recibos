// ============================================================
// routes/govbr.js — Assinatura digital Gov.br (OAuth2) e
// assinatura remota por link (token público).
// Movido de routes/misc.js e server.js na Fase 1 da refatoração.
// ============================================================
const logger = require("../services/logger");

module.exports = function registerGovbrRoutes(app, deps) {
  const { auth, financeiroOnly, dbRecibos, findOne, update, registrarAuditoria, maskCPF, crypto, path } = deps;

  // ── GOV.BR — ASSINATURA DIGITAL ────────────────────────────
  const GOVBR_CLIENT_ID     = process.env.GOVBR_CLIENT_ID     || "";
  const GOVBR_CLIENT_SECRET = process.env.GOVBR_CLIENT_SECRET || "";
  const GOVBR_REDIRECT_URI  = process.env.GOVBR_REDIRECT_URI  || "";
  const GOVBR_BASE_URL      = process.env.GOVBR_ENV === "producao"
    ? "https://sso.acesso.gov.br"
    : "https://sso.staging.acesso.gov.br";

  function govbrConfigurado() {
    return !!(GOVBR_CLIENT_ID && GOVBR_CLIENT_SECRET && GOVBR_REDIRECT_URI);
  }

  function gerarState() {
    return require("crypto").randomBytes(16).toString("hex");
  }

  // PASSO 1 — Inicia fluxo OAuth2: retorna URL de redirecionamento para o Gov.br
  app.get("/api/govbr/iniciar", deps.auth, async (req, res) => {
    if (!govbrConfigurado()) {
      return res.status(503).json({ erro: "Integração Gov.br não configurada. Aguardando credenciais." });
    }
    const { recibo_id } = req.query;
    if (!recibo_id) return res.status(400).json({ erro: "recibo_id obrigatório" });

    try {
      const state = gerarState();
      await deps.pgPool.query(
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
      logger.error("Erro ao iniciar Gov.br:", e.message);
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
      logger.warn(`[${agora}] Gov.br callback — erro retornado pelo provedor: ${mensagem}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(mensagem)}`);
    }

    const { rows: stateRows } = await deps.pgPool.query(
      `DELETE FROM govbr_states WHERE state = $1 RETURNING recibo_id, username, expira_em`,
      [state]
    );
    const stateData = stateRows[0] ? { recibo_id: stateRows[0].recibo_id, user: stateRows[0].username, expires: new Date(stateRows[0].expira_em).getTime() } : null;
    if (!stateData) {
      logger.warn(`[${agora}] Gov.br callback — state desconhecido ou já utilizado: ${state}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão expirada ou inválida. Inicie o processo novamente.")}`);
    }
    if (Date.now() > stateData.expires) {
      logger.warn(`[${agora}] Gov.br callback — state expirado para usuário ${stateData.user}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão Gov.br expirada (limite de 10 minutos). Tente novamente.")}`);
    }

    logger.info(`[${agora}] Gov.br callback — iniciando troca de code por token para recibo ${stateData.recibo_id} (usuário: ${stateData.user})`);

    try {
      // Troca code por token
      const tokenRes = await deps.fetchWithTimeout(`${GOVBR_BASE_URL}/token`, {
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
        logger.error(`[${agora}] Gov.br callback — token não recebido. Resposta: ${JSON.stringify(tokenData)}`);
        throw new Error("Token de acesso não recebido. Verifique as credenciais Gov.br ou tente novamente.");
      }

      // Busca dados do usuário (nome, CPF)
      const userRes = await deps.fetchWithTimeout(`${GOVBR_BASE_URL}/userinfo`, {
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

      await deps.update(deps.dbRecibos, { _id: stateData.recibo_id }, { assinatura_govbr: assinatura });
      logger.info(`[${new Date().toISOString()}] ✅ Recibo ${stateData.recibo_id} assinado via Gov.br por ${assinatura.nome_assinante} (CPF: ${assinatura.cpf_assinante || "n/d"}) — usuário do sistema: ${stateData.user}`);

      res.redirect(`/?govbr_ok=1&recibo_id=${stateData.recibo_id}`);
    } catch (e) {
      logger.error(`[${new Date().toISOString()}] ❌ Erro no callback Gov.br para recibo ${stateData?.recibo_id}: ${e.message}`);
      const msgUsuario = e.message.includes("Token") || e.message.includes("userinfo")
        ? "Falha na comunicação com Gov.br. Tente novamente em instantes."
        : e.message;
      res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(msgUsuario)}`);
    }
  });

  // PASSO 3 — Retorna status da assinatura de um recibo
  app.get("/api/govbr/status/:id", deps.auth, async (req, res) => {
    const recibo = await deps.findOne(deps.dbRecibos, { _id: req.params.id });
    if (!recibo) return res.status(404).json({ erro: "Recibo não encontrado" });
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
    logger.error("Erro ao gerar link de assinatura:", e);
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
    logger.info(`✅ Recibo ${recibo._id} (Nº ${recibo.num}) assinado remotamente. IP: ${ip}`);
    res.json({ ok: true });
  } catch (e) {
    logger.error("Erro ao salvar assinatura remota:", e);
    res.status(500).json({ erro: "Erro ao registrar assinatura." });
  }
});

// PÚBLICO — serve a página de assinatura (sem auth, sem cookies)
app.get("/assinar/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assinar.html"));
});
};
