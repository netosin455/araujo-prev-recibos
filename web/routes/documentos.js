// Fichário — documentos (fotos/PDFs) por cliente.
const logger = require("../services/logger");
// Arquivos ficam no S3 (privado, acessados por URL assinada temporária).
// As FOTOS já chegam redimensionadas do navegador (canvas): o "arquivo" é a
// versão reduzida e o "thumb" é a miniatura leve — a grade carrega rápido e o
// upload gasta pouca banda (bom pro pessoal de campo no celular). Sem sharp.
const multer = require("multer");
const archiver = require("archiver");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const MIME_OK = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

module.exports = function registerDocumentoRoutes(app, deps) {
  const uploadDoc = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB (mesmo já reduzida, PDF pode ser grande)
    fileFilter: (req, file, cb) =>
      MIME_OK.has(file.mimetype)
        ? cb(null, true)
        : cb(new Error("Tipo não permitido. Envie foto (JPG/PNG/WebP) ou PDF.")),
  });
  const nd = v => String(v || "").replace(/\D/g, "");

  // ── Ponto ÚNICO de gravação: S3 + espelho local (se configurado) ──
  async function salvarArquivo(key, buffer, contentType) {
    await deps.s3Client.send(new PutObjectCommand({
      Bucket: deps.BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
    }));
    if (deps.MIRROR_LOCAL_DIR) {
      const caminho = deps.path.join(deps.MIRROR_LOCAL_DIR, key);
      await deps.fs.mkdir(deps.path.dirname(caminho), { recursive: true });
      await deps.fs.writeFile(caminho, buffer);
    }
    return key;
  }

  // URL assinada temporária (fallback pra rota local se S3 falhar)
  async function urlAssinada(key, ttl = 86400) { // 24h — evita link expirar com a tela aberta/cache
    if (!key) return "";
    try {
      return await deps.getSignedUrl(
        deps.s3SignerClient,
        new deps.GetObjectCommand({ Bucket: deps.BUCKET_NAME, Key: key }),
        { expiresIn: ttl }
      );
    } catch {
      if (deps.MIRROR_LOCAL_DIR) return `/api/arquivo-local/${key}`;
      return "";
    }
  }

  // ── ENVIAR documento (campo "arquivo" obrigatório; "thumb" opcional p/ fotos) ──
  app.post("/api/clientes/:cpf/documentos", deps.auth, (req, res) => {
    uploadDoc.fields([{ name: "arquivo", maxCount: 1 }, { name: "thumb", maxCount: 1 }])(req, res, async (err) => {
      if (err) return res.status(400).json({ erro: err.message });
      try {
        if (!deps.BUCKET_NAME) return res.status(500).json({ erro: "Armazenamento (S3) não configurado no servidor." });
        const cpf = nd(req.params.cpf);
        if (cpf.length < 11) return res.status(400).json({ erro: "CPF inválido." });
        const arquivo = req.files && req.files.arquivo && req.files.arquivo[0];
        const thumbFile = req.files && req.files.thumb && req.files.thumb[0];
        if (!arquivo) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

        const tipo = (req.body.tipo || "Outro").toString().slice(0, 60);
        const nome = (req.body.nome || arquivo.originalname || "documento").toString().slice(0, 200);
        const id = deps.crypto.randomUUID();
        const isPdf = arquivo.mimetype === "application/pdf";
        const s3_key = `clientes/${cpf}/${id}.${isPdf ? "pdf" : "jpg"}`;
        let s3_key_thumb = null;

        await salvarArquivo(s3_key, arquivo.buffer, arquivo.mimetype);
        if (thumbFile && !isPdf) {
          s3_key_thumb = `clientes/${cpf}/thumb_${id}.jpg`;
          await salvarArquivo(s3_key_thumb, thumbFile.buffer, "image/jpeg");
        }

        await deps.pgPool.query(
          `INSERT INTO documentos (id,cliente_cpf,tipo,nome,s3_key,s3_key_thumb,content_type,tamanho,criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, cpf, tipo, nome, s3_key, s3_key_thumb, arquivo.mimetype, arquivo.size, req.user.username]
        );
        deps.registrarAuditoria(req, "adicionar_documento", id, { cpf: deps.maskCPF(cpf), tipo, nome });

        res.json({
          id, tipo, nome, content_type: arquivo.mimetype, is_pdf: isPdf,
          thumb_url: await urlAssinada(s3_key_thumb),
          url: await urlAssinada(s3_key),
          criado_por: req.user.username, criado_em: new Date().toISOString(),
        });
      } catch (e) {
        logger.error("Erro ao salvar documento:", e.message);
        res.status(500).json({ erro: "Erro ao salvar o documento." });
      }
    });
  });

  // ── LISTAR documentos do cliente (só chamado quando a aba Fichário abre) ──
  app.get("/api/clientes/:cpf/documentos", deps.auth, async (req, res) => {
    try {
      const cpf = nd(req.params.cpf);
      const { rows } = await deps.pgPool.query(
        `SELECT id,tipo,nome,s3_key,s3_key_thumb,content_type,criado_por,criado_em
         FROM documentos WHERE cliente_cpf=$1 AND deletado_em IS NULL ORDER BY criado_em DESC`,
        [cpf]
      );
      const documentos = await Promise.all(rows.map(async r => ({
        id: r.id, tipo: r.tipo, nome: r.nome, content_type: r.content_type,
        criado_por: r.criado_por, criado_em: r.criado_em,
        is_pdf: (r.content_type || "").includes("pdf") || !r.s3_key_thumb,
        thumb_url: await urlAssinada(r.s3_key_thumb),
        url: await urlAssinada(r.s3_key),
      })));
      res.json({ documentos });
    } catch (e) {
      logger.error("Erro ao listar documentos:", e.message);
      res.status(500).json({ erro: "Erro ao listar documentos." });
    }
  });

  // ── BAIXAR TODOS os documentos do cliente num ZIP ────────────
  // Pra montar processo: RG + CPF + comprovantes de uma vez, direto do S3.
  app.get("/api/clientes/:cpf/documentos/zip", deps.auth, async (req, res) => {
    try {
      const cpf = nd(req.params.cpf);
      if (cpf.length < 11) return res.status(400).json({ erro: "CPF inválido." });
      const { rows } = await deps.pgPool.query(
        `SELECT id,tipo,nome,s3_key,content_type FROM documentos
         WHERE cliente_cpf=$1 AND deletado_em IS NULL ORDER BY tipo, criado_em`,
        [cpf]
      );
      if (rows.length === 0) return res.status(404).json({ erro: "Cliente sem documentos." });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="documentos_${cpf}.zip"`);
      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", e => { logger.error("Erro archiver docs:", e.message); });
      archive.pipe(res);

      const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
      for (let i = 0; i < rows.length; i++) {
        const d = rows[i];
        try {
          const obj = await deps.withTimeout(
            deps.s3Client.send(new GetObjectCommand({ Bucket: deps.BUCKET_NAME, Key: d.s3_key })), 20000);
          const ext = deps.path.extname(d.s3_key) || ((d.content_type || "").includes("pdf") ? ".pdf" : ".jpg");
          const nomeArq = `${String(i + 1).padStart(2, "0")}_${semAcento(d.tipo)}_${semAcento(d.nome).slice(0, 60)}${ext}`;
          archive.append(obj.Body, { name: nomeArq });
        } catch (e) {
          logger.error(`Erro ao baixar doc ${d.id} do S3:`, e.message);
        }
      }
      deps.registrarAuditoria(req, "exportar_docs_cliente", cpf, { cpf: deps.maskCPF(cpf), total: rows.length });
      await archive.finalize();
    } catch (e) {
      logger.error("Erro no ZIP de documentos:", e.message);
      if (!res.headersSent) res.status(500).json({ erro: "Erro ao gerar ZIP de documentos." });
    }
  });

  // ── EXCLUIR (soft-delete) — só financeiro/admin ──────────────
  app.delete("/api/documentos/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const { rows } = await deps.pgPool.query(
        `UPDATE documentos SET deletado_em=NOW() WHERE id=$1 AND deletado_em IS NULL RETURNING nome, s3_key, s3_key_thumb`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ erro: "Documento não encontrado." });
      // Remove do espelho local se existir
      if (deps.MIRROR_LOCAL_DIR && rows[0].s3_key) {
        const localArquivo = deps.path.join(deps.MIRROR_LOCAL_DIR, rows[0].s3_key);
        const localThumb = rows[0].s3_key_thumb ? deps.path.join(deps.MIRROR_LOCAL_DIR, rows[0].s3_key_thumb) : null;
        deps.fs.unlink(localArquivo).catch(() => {});
        if (localThumb) deps.fs.unlink(localThumb).catch(() => {});
      }
      deps.registrarAuditoria(req, "excluir_documento", req.params.id, { nome: rows[0].nome });
      res.json({ ok: true });
    } catch (e) {
      logger.error("Erro ao excluir documento:", e.message);
      res.status(500).json({ erro: "Erro ao excluir documento." });
    }
  });

  // ── BUSCA para a seção Fichário (clientes + contagem + capa) ──
  app.get("/api/fichario/busca", deps.auth, async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      // Paginação: evita carregar TODOS os clientes (e gerar uma URL assinada da
      // capa de cada um) numa tacada só. Busca limit+1 para saber se há mais páginas
      // sem precisar de um COUNT(*) separado.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const { rows } = await deps.pgPool.query(`
        SELECT c.id, c.nome, c.cpf,
          (SELECT COUNT(*) FROM documentos d
           WHERE d.cliente_cpf = regexp_replace(c.cpf, '[^0-9]', '', 'g')
           AND d.deletado_em IS NULL) AS qtd_docs,
          (SELECT d2.s3_key_thumb FROM documentos d2
           WHERE d2.cliente_cpf = regexp_replace(c.cpf, '[^0-9]', '', 'g')
           AND d2.deletado_em IS NULL
           ORDER BY d2.criado_em DESC LIMIT 1) AS cover_thumb
        FROM clientes c
        WHERE c.deletado_em IS NULL
          AND ($1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.cpf ILIKE '%' || $1 || '%')
        ORDER BY CASE WHEN $1 = '' THEN 0 ELSE 1 END, c.nome ASC
        LIMIT $2 OFFSET $3
      `, [q, limit + 1, offset]);
      const temMais = rows.length > limit;
      const pagina = temMais ? rows.slice(0, limit) : rows;
      const clientes = await Promise.all(pagina.map(async r => ({
        id: r.id, nome: r.nome, cpf: r.cpf,
        qtd_docs: parseInt(r.qtd_docs) || 0,
        cover_thumb_url: await urlAssinada(r.cover_thumb),
      })));
      res.json({ clientes, temMais });
    } catch (e) {
      logger.error("Erro ao buscar fichário:", e.message);
      res.status(500).json({ erro: "Erro ao buscar clientes." });
    }
  });

  // ── SERVIR arquivo do espelho local (fallback quando S3 falha) ──
  app.get("/api/arquivo-local/*", deps.auth, async (req, res) => {
    try {
      if (!deps.MIRROR_LOCAL_DIR) return res.status(404).json({ erro: "Espelho local não configurado." });
      const key = req.params[0];
      if (!key || key.includes("..")) return res.status(400).json({ erro: "Caminho inválido." });
      const caminho = deps.path.resolve(deps.path.join(deps.MIRROR_LOCAL_DIR, key));
      if (!caminho.startsWith(deps.path.resolve(deps.MIRROR_LOCAL_DIR))) {
        return res.status(403).json({ erro: "Acesso negado." });
      }
      const buf = await deps.fs.readFile(caminho);
      const ext = deps.path.extname(key).toLowerCase();
      const mime = ({ ".pdf": "application/pdf", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" })[ext] || "image/jpeg";
      res.setHeader("Content-Type", mime);
      res.send(buf);
    } catch (e) {
      if (e.code === "ENOENT") return res.status(404).json({ erro: "Arquivo não encontrado no espelho local." });
      logger.error("Erro ao servir arquivo local:", e.message);
      res.status(500).json({ erro: "Erro ao servir arquivo." });
    }
  });
};
