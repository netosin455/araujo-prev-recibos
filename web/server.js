// =============================================================
//  SERVIDOR — web/server.js (entry point)
//  Roda na AWS. Nunca abre no navegador, só no terminal/servidor.
//
//  Após a Fase 1 da refatoração este arquivo só faz:
//  - Configuração (env, banco, S3, upload, middlewares)
//  - Montagem das rotas modularizadas (routes/*)
//  - Inicialização (services/startup), cron jobs e health check
//    (services/cron) e app.listen
//
//  Onde mexer agora:
//  - Rotas/regras de negócio → routes/*.js
//  - Helpers puros           → services/helpers.js
//  - E-mail SMTP             → services/email.js
//  - Rotinas de boot         → services/startup.js
//  - Cron jobs/health check  → services/cron.js
// =============================================================
require("dotenv").config();
const express = require("express");
const { Pool, types } = require("pg");
// NUMERIC (OID 1700) vem como string por padrão — força conversão para float
types.setTypeParser(1700, (val) => val === null ? null : parseFloat(val));
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const logger = require("./services/logger");
const { withTimeout, fetchWithTimeout } = require("./services/timeout");
const { getSheetsClient, testarConexaoSheets, linkParaSheets, SHEET_ID, SHEET_NAME } = require("./services/google-sheets");
const helpers = require("./services/helpers");
const email = require("./services/email");

const app = express();
// Erros de handlers async caem no error handler global em vez de derrubar o
// processo (Express 4 + Node 15+) — precisa vir ANTES de qualquer rota
require("./middleware/async-wrap")(app);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error("❌ ERRO: Defina a variável de ambiente JWT_SECRET antes de iniciar.");
  process.exit(1);
}

// ── NEON (PostgreSQL) ─────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  logger.error("❌ ERRO: Defina a variável de ambiente DATABASE_URL (Neon) antes de iniciar.");
  process.exit(1);
}
// DB_SSL=false permite apontar pra um Postgres local (sem certificado público
// confiável, ex: mesma instância EC2) sem afetar o Neon em produção, que
// continua exigindo SSL por padrão.
const useDbSsl = process.env.DB_SSL !== "false";
const pgPool = new Pool({ connectionString: DATABASE_URL, ssl: useDbSsl ? { rejectUnauthorized: true } : false });
// Conexão OCIOSA que cai (rede/Neon) emite 'error' fora de qualquer rota — sem
// listener, o processo morre. Loga e segue; o pool cria conexão nova sozinho.
pgPool.on("error", (err) => logger.error("Pool Postgres (conexão ociosa):", err.message));

// Última linha de defesa: rejeição que escapar de tudo é logada em vez de
// derrubar o servidor (Node 15+ mata o processo por padrão)
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection (não deveria acontecer — investigar):", reason instanceof Error ? reason.message : String(reason));
});

const db = require("./services/database")(pgPool);
const { find, findOne, insert, update, remove, count, findLimited } = db;

// ── DIRETÓRIOS DE DADOS/UPLOADS ───────────────────────────────
const dbDir = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const uploadsDir = path.join(dbDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── S3 ────────────────────────────────────────────────────────
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

// ── UPLOAD (multer em memória) ────────────────────────────────
const MIME_AUDIT = new Set(["image/jpeg","image/png","image/webp","image/gif","application/pdf","application/xml","text/xml"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_AUDIT.has(file.mimetype)) return cb(null, true);
    cb(new Error("Tipo de arquivo não permitido. Use JPEG, PNG, WebP, GIF, PDF ou XML."));
  },
});

// ── TABELAS / CONSTANTES ──────────────────────────────────────
const dbRecibos       = "recibos";
const dbClientes      = "clientes";
const dbAuditoria     = "auditoria";
const dbNotificacoes  = "notificacoes";
const dbConfig        = "config";
const NAO_DELETADO = { deletado_em: { $exists: false } }; // registros não-deletados (soft delete)

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  logger.error("❌ ERRO: Defina as variáveis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.");
  process.exit(1);
}
// Usuários extras via variável de ambiente USERS_JSON (base64 de JSON array)
const USERS_JSON = process.env.USERS_JSON;

// ── INICIALIZAÇÃO (migrações, restaurações, normalizações) ───
const startup = require("./services/startup")({
  pgPool, db, dbDir, ADMIN_USER, ADMIN_PASS, USERS_JSON, dbRecibos, dbClientes, NAO_DELETADO,
});
// As rotinas de boot (Neon, Google Sheets, normalizações) são disparadas DEPOIS
// que o servidor já está escutando — ver o callback de app.listen no fim do arquivo.
// Isso garante que um timeout/lentidão do Google Sheets nunca atrase o boot do HTTP.

// ── MIDDLEWARE ────────────────────────────────────────────────
app.disable("x-powered-by");
// gzip em tudo (JSON e estáticos) — payloads de texto encolhem ~10x
app.use(require("compression")());
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Força HTTPS quando atrás de proxy reverso (ELB)
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] === "http") return res.redirect(301, "https://" + req.headers.host + req.url);
  next();
});

// Headers de segurança (antes do express.static para cobrir arquivos estáticos)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  // HSTS — browser só acessa via HTTPS pelos próximos 6 meses
  if (req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15768000; includeSubDomains");
  }
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    // style-src-elem SEM 'unsafe-inline': blocos <style> injetados são bloqueados
    // (o vetor forte de CSS injection). style-src-attr mantém os atributos style=""
    // até a migração completa pra classes (Falha #3 — fase 2). O style-src genérico
    // fica como fallback pra navegadores antigos que não conhecem -elem/-attr.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "style-src-elem 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "style-src-attr 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: blob: https://*.amazonaws.com; " +
    "connect-src 'self' https://*.amazonaws.com; " +
    "frame-src https://drive.google.com blob: https://*.amazonaws.com; " +
    // frame-ancestors é a versão moderna do X-Frame-Options — cobre navegadores
    // que ignoram o header antigo e é a recomendação atual do OWASP
    "frame-ancestors 'none';"
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
// Estáticos com cache de 7 dias — o cache-busting ?v= nos <script> invalida quando
// o código muda; o index.html continua no-store (setado acima) para pegar o v novo
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store, must-revalidate");
  },
}));

const mw = require("./middleware/auth")({ jwt, JWT_SECRET, ADMIN_USER, pgPool });
const { auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios } = mw;

// Auditoria de ações (grava na tabela auditoria; falha nunca derruba a request)
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
    logger.error(`❌ Auditoria falhou (${acao}):`, e.message);
  }
}

// ── RATE LIMITERS ─────────────────────────────────────────────
// TEMPORÁRIO (20/07/2026) — limite alto durante testes de migração do banco
// (Carlo pediu pra não travar em 15min enquanto testa login repetidamente).
// REVERTER pra max: 10 assim que os testes terminarem.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas de login. Aguarde 15 minutos." },
});

// Limiter genérico para mutações (POST / PUT / DELETE)
const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas requisições. Aguarde 15 minutos." },
});

// ── MONTAGEM DAS ROTAS MODULARIZADAS ──────────────────────────
const routeDeps = {
  auth, adminOnly, financeiroOnly, semRecepcao, semPrecatorios,
  pgPool, jwt, JWT_SECRET, bcrypt, loginLimiter, mutationLimiter,
  dbClientes, dbRecibos, dbAuditoria, dbNotificacoes, dbConfig,
  NAO_DELETADO, find, findOne, insert, update, remove, count, findLimited,
  enriquecerCliente: helpers.enriquecerCliente, registrarAuditoria, maskCPF: helpers.maskCPF,
  validarCPF: helpers.validarCPF, validarCNPJ: helpers.validarCNPJ,
  campoTextoInvalido: helpers.campoTextoInvalido,
  gerarParcelas: helpers.gerarParcelas, recalcularResumo: helpers.recalcularResumo,
  inicializarParcelasLegado: helpers.inicializarParcelasLegado, numeroSeguro: helpers.numeroSeguro,
  getSheetsClient, sincronizarUsuariosParaSheets: startup.sincronizarUsuariosParaSheets, ADMIN_USER,
  SHEET_ID, SHEET_NAME, linkParaSheets,
  s3Client, withTimeout, fetchWithTimeout,
  upload, crypto, fs, path,
  smtpConfigurado: email.smtpConfigurado,
  // Exportação assíncrona (SQS + Lambda) e geração de URL assinada de download
  enviarJobExport: require("./services/fila").enviarJobExport,
  filaExportConfigurada: require("./services/fila").filaConfigurada,
  s3SignerClient, getSignedUrl, GetObjectCommand,
  BUCKET_NAME: process.env.BUCKET_NAME,
  MIRROR_LOCAL_DIR: process.env.MIRROR_LOCAL_DIR || "",
  // transporter criado sob demanda
  get transporter() { return email.criarTransporter(); },
};
// Rate limiter global para mutações (exceto login, que tem limiter próprio mais restrito)
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.path.startsWith("/api/login")) {
    return mutationLimiter(req, res, next);
  }
  next();
});

require("./routes/auth")(app, routeDeps);
require("./routes/clientes")(app, routeDeps);
require("./routes/admin")(app, routeDeps);
require("./routes/misc")(app, routeDeps);
require("./routes/notificacoes")(app, routeDeps);
require("./routes/govbr")(app, routeDeps);
require("./routes/recibos")(app, routeDeps);
require("./routes/documentos")(app, routeDeps);

const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
app.use("/api-docs", auth, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── ERROR HANDLER GLOBAL — nunca retorna HTML ─────────────────
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ erro: "Arquivo muito grande. Maximo permitido: 5MB." });
  }
  if (err.name === "MulterError" || err.message?.startsWith("Tipo de arquivo")) {
    // Mensagem fixa — nunca ecoar err.message ao cliente (SEC Falha #6)
    return res.status(400).json({ erro: "Arquivo inválido. Use JPEG, PNG, WebP, GIF, PDF ou XML." });
  }
  logger.error("Erro interno:", err);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

// ── CRON JOBS + HEALTH CHECK (services/cron.js) ───────────────
const { verificarEEnviarLembretesParcelasProximas } = require("./services/cron")({
  app, pgPool, db, dbClientes, NAO_DELETADO, s3Client, s3SignerClient,
});

// ── INICIAR ───────────────────────────────────────────────────
app.listen(PORT, async () => {
  logger.info(`✅ Araujo Prev rodando em http://localhost:${PORT}`);

  // ── Rotinas de boot em segundo plano ────────────────────────
  // O HTTP já está aceitando conexões neste ponto. Todas as tarefas abaixo rodam
  // de forma assíncrona e isolada: uma falha/timeout (ex.: Google Sheets offline)
  // apenas loga o erro e NUNCA impede o servidor de responder (login, recibos, etc.).
  setImmediate(() => {
    // Neon primeiro (as normalizações dependem do schema existir).
    startup.initDb()
      .then(() => {
        startup.normalizarDados();
        startup.unificarNomesPorCPF();
      })
      .catch(e => logger.error("❌ Erro ao inicializar Neon:", e.message));

    // Google Sheets — totalmente não-bloqueante e tolerante a falha/timeout.
    Promise.resolve()
      .then(() => testarConexaoSheets())
      .then(() => startup.sincronizarDeSheets())
      .then(() => startup.sincronizarComprovantes())
      .then(() => startup.corrigirLinksComprovante())
      .catch(e => logger.error("⚠️ Sincronização com Google Sheets falhou (não-bloqueante):", e.message));
  });

  // Executa também no startup (30s) para verificar parcelas do dia sem esperar o cron das 8h
  setTimeout(verificarEEnviarLembretesParcelasProximas, 30_000);
});
