// Fichário — documentos (fotos/PDFs) por cliente.
// Arquivos ficam no S3 (privado, acessados por URL assinada temporária).
// As FOTOS já chegam redimensionadas do navegador (canvas): o "arquivo" é a
// versão reduzida e o "thumb" é a miniatura leve — a grade carrega rápido e o
// upload gasta pouca banda (bom pro pessoal de campo no celular). Sem sharp.
const multer = require("multer");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

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

  // ── Ponto ÚNICO de gravação de arquivo (futuro: espelhar no servidor local) ──
  async function salvarArquivo(key, buffer, contentType) {
    await deps.s3Client.send(new PutObjectCommand({
      Bucket: deps.BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
    }));
    return key;
  }

  // URL assinada temporária (o arquivo NUNCA é público)
  async function urlAssinada(key, ttl = 3600) {
    if (!key) return "";
    try {
      return await deps.getSignedUrl(
        deps.s3SignerClient,
        new deps.GetObjectCommand({ Bucket: deps.BUCKET_NAME, Key: key }),
        { expiresIn: ttl }
      );
    } catch {
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
        console.error("Erro ao salvar documento:", e.message);
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
      console.error("Erro ao listar documentos:", e.message);
      res.status(500).json({ erro: "Erro ao listar documentos." });
    }
  });

  // ── EXCLUIR (soft-delete) — só financeiro/admin ──────────────
  app.delete("/api/documentos/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const { rows } = await deps.pgPool.query(
        `UPDATE documentos SET deletado_em=NOW() WHERE id=$1 AND deletado_em IS NULL RETURNING nome`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ erro: "Documento não encontrado." });
      deps.registrarAuditoria(req, "excluir_documento", req.params.id, { nome: rows[0].nome });
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao excluir documento:", e.message);
      res.status(500).json({ erro: "Erro ao excluir documento." });
    }
  });
};
