const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle, Table, TableRow, TableCell, WidthType } = require("docx");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const { registrarNoSheets, atualizarNoSheets } = require("../services/google-sheets");

module.exports = function registerReciboRoutes(app, deps) {
  // deps: auth, adminOnly, financeiroOnly, semPrecatorios, pgPool, dbRecibos, dbClientes, dbAuditoria, NAO_DELETADO, find, findOne, insert, update, remove, count, findLimited, enriquecerCliente, registrarAuditoria, maskCPF, validarCPF, validarCNPJ, getSheetsClient, s3Client, withTimeout, fetchWithTimeout, upload, crypto, fs, path, sharp, JWT_SECRET, jwt, loginLimiter, bcrypt, transporter, formatDateToBR, sincronizarUsuariosParaSheets, smtpConfigurado
  // Also available via require at top of file: PutObjectCommand, GetObjectCommand, Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle, Table, TableRow, TableCell, WidthType, PDFDocument, archiver, stream, nodemailer

  // ── HELPER: gera buffer PDF de um recibo do banco ──────────
  async function gerarBufferPDFRecibo(recibo) {
    const logoPath = deps.path.join(__dirname, "public", "logo.png");
    const logoExists = deps.fs.existsSync(logoPath);
    const digits = (recibo.cpf || "").replace(/\D/g, "");
    const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
    const complemento = recibo.complemento ? ` - ${recibo.complemento}` : "";
    const MESES_EXT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    const [dia, mes, ano] = (recibo.data || "").split("/");
    const mesNome = MESES_EXT[parseInt(mes, 10) - 1] || "";
    const data_extenso = dia && mes && ano ? `${parseInt(dia, 10)} de ${mesNome} de ${ano}` : (recibo.data || "");
    const textoCorpo = `Recebemos do (a) senhor (a) ${recibo.nome}, residente e domiciliado(a) no Município de ${recibo.municipio_uf}, a importância de R$ ${recibo.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

    return new Promise((resolve, reject) => {
      const chunks = [];
      const pdf = new PDFDocument({ margin: 60, size: "A4" });
      pdf.on("data", c => chunks.push(c));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);

      if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
      pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
        .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
      pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);
      const lx = pdf.page.margins.left;
      const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);
      pdf.fontSize(12).font("Helvetica-Bold")
        .text(`Recibo Nº ${recibo.num}${recibo.referencia ? "   |   Ref: " + recibo.referencia : ""}`, { align: "center" }).moveDown(0.2);
      pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);
      pdf.fontSize(11).font("Helvetica").text(textoCorpo, { align: "justify" }).moveDown(0.6);
      pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);
      pdf.text(`${recibo.municipio_uf}, ${data_extenso}`, { align: "left" }).moveDown(6);
      pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
      pdf.fontSize(10).text(recibo.nome, { align: "center" }).moveDown(0.1);
      pdf.fontSize(9).text(`${labelDoc}: ${recibo.cpf}`, { align: "center" }).moveDown(5);
      pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
      pdf.fontSize(10).text(recibo.emitido_por || "A ARAUJO PREV", { align: "left" });
      if (logoExists) pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
      pdf.end();
    });
  }

  // ── WEBHOOK — RECIBO GERADO ────────────────────────────────
  async function dispararWebhook(dadosRecibo) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;

    const payload = JSON.stringify({
      evento: "recibo_gerado",
      recibo: {
        num:             dadosRecibo.num,
        nome:            dadosRecibo.nome,
        cpf:             dadosRecibo.cpf,
        valor:           dadosRecibo.valor,
        data:            dadosRecibo.data,
        forma_pagamento: dadosRecibo.forma_pagamento || "",
        escritorio:      dadosRecibo.escritorio || "",
        emitido_por:     dadosRecibo.emitido_por || "",
        referencia:      dadosRecibo.referencia || "",
      },
      timestamp: new Date().toISOString(),
    });

    const MAX_TENTATIVAS = 3;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        const resp = await deps.fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }, 10000);
        if (resp.ok) {
          console.log(`[${new Date().toISOString()}] ✅ Webhook disparado → ${url} (status ${resp.status}, tentativa ${tentativa})`);
          return;
        }
        console.warn(`[${new Date().toISOString()}] ⚠️  Webhook → ${url} retornou status ${resp.status} (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
      } catch (e) {
        console.warn(`[${new Date().toISOString()}] ⚠️  Webhook → ${url} falhou: ${e.message} (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
      }
      if (tentativa < MAX_TENTATIVAS) {
        const delay = Math.pow(4, tentativa - 1) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
    console.error(`[${new Date().toISOString()}] ❌ Webhook permanentemente falhou após ${MAX_TENTATIVAS} tentativas → ${url} (recibo: ${dadosRecibo.num})`);
  }

  // ── ROTAS RECIBOS ──────────────────────────────────────────
  app.get("/api/recibos", deps.auth, async (req, res) => {
    const isRecepcao = req.user.role === "recepcao" && req.user.escritorio;

    if (req.query.cursor !== undefined) {
      const cursorTs = req.query.cursor ? Number(req.query.cursor) : undefined;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
      const query = { ...deps.NAO_DELETADO };
      if (cursorTs) query.timestamp = { $lt: cursorTs };
      if (isRecepcao) {
        const escEsc = req.user.escritorio.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.escritorio = { $regex: new RegExp("^" + escEsc + "$", "i") };
      }
      const docs = await deps.findLimited(deps.dbRecibos, query, { timestamp: -1 }, limit + 1);
      const hasMore = docs.length > limit;
      const recibos = docs.slice(0, limit).map(r => ({ ...r, id: r._id }));
      const nextCursor = hasMore && recibos.length > 0 ? String(recibos[recibos.length - 1].timestamp) : null;
      return res.json({ recibos, nextCursor, hasMore });
    }

    const todos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO, { timestamp: -1 });
    const filtrados = isRecepcao
      ? todos.filter(r => (r.escritorio || "").toUpperCase() === req.user.escritorio.toUpperCase())
      : todos;
    const total = filtrados.length;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50000, Math.max(1, parseInt(req.query.limit) || 50));
    const totalPaginas = Math.ceil(total / limit) || 1;
    const recibos = filtrados.slice((page - 1) * limit, page * limit).map(r => ({ ...r, id: r._id }));
    res.json({ recibos, total, pagina: page, totalPaginas });
  });

  app.post("/api/recibos", deps.auth, async (req, res) => {
    try {
      if (req.user.role === "precatorios") return res.status(403).json({ erro: "Sem permissão para esta ação." });
      const { num, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, motivo_pagamento, link_comprovante, timestamp } = req.body;
      const escritorio = req.user.role === "recepcao"
        ? (req.user.escritorio || "")
        : (req.body.escritorio || "");
      const digsCPF = (cpf || "").replace(/\D/g, "");
      if (digsCPF.length === 11 && !deps.validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
      if (digsCPF.length === 14 && !deps.validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });
      if (num) {
        const { rows: dup } = await deps.pgPool.query("SELECT id FROM recibos WHERE num=$1 AND deletado_em IS NULL LIMIT 1", [num]);
        if (dup.length > 0) return res.status(409).json({ erro: `Já existe um recibo com o número ${num}.` });
      }
      const existente = await deps.findOne(deps.dbRecibos, { cpf });
      const nome = existente
        ? existente.nome
        : (req.body.nome || "").replace(/\b\w/g, c => c.toUpperCase());
      const ts = typeof timestamp === "number" ? timestamp : (Date.now());
      const doc = await deps.insert(deps.dbRecibos, { num, nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio, motivo_pagamento: motivo_pagamento||"", link_comprovante: link_comprovante||"", timestamp: ts });
      deps.registrarAuditoria(req, "criar_recibo", doc._id, { num, nome, escritorio, valor, cpf: deps.maskCPF(cpf) });
      registrarNoSheets({ num_recibo: num, nome, cpf, municipio_uf, valor, data, complemento, referencia, emitido_por, forma_pagamento, escritorio, motivo_pagamento, link_comprovante }).catch(e => console.error("Erro sheets (ignorado):", e));
      dispararWebhook({ num, nome, cpf, municipio_uf, valor, data, emitido_por, forma_pagamento, escritorio, referencia }).catch(e => console.error("Erro webhook (ignorado):", e));
      res.json({ id: doc._id });
    } catch (err) {
      console.error("Erro em POST /api/recibos:", err);
      res.status(500).json({ erro: "Erro interno ao salvar recibo: " + err.message });
    }
  });

  app.put("/api/recibos/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    const { nome, cpf, municipio_uf, valor, data, emitido_por, complemento, referencia, forma_pagamento, escritorio, motivo_pagamento, link_comprovante } = req.body;
    const upd = { nome, cpf, municipio_uf, valor, data, emitido_por: emitido_por||"", complemento: complemento||"", referencia: referencia||"", forma_pagamento: forma_pagamento||"", escritorio: escritorio||"", motivo_pagamento: motivo_pagamento||"" };
    if (link_comprovante) upd.link_comprovante = link_comprovante;

    const atual = await deps.findOne(deps.dbRecibos, { _id: req.params.id });
    const CAMPOS_AUDITADOS = ["nome","cpf","municipio_uf","valor","data","emitido_por","complemento","referencia","forma_pagamento","escritorio","motivo_pagamento","link_comprovante"];
    const campos_alterados = CAMPOS_AUDITADOS
      .filter(c => String(atual?.[c] ?? "") !== String(upd[c] ?? ""))
      .map(c => ({ campo: c, anterior: String(atual?.[c] ?? ""), novo: String(upd[c] ?? "") }));
    const historico_edicoes = atual?.historico_edicoes || [];
    if (campos_alterados.length > 0) {
      historico_edicoes.push({ data: new Date().toISOString(), editado_por: req.user.username, campos_alterados });
    }

    await deps.update(deps.dbRecibos, { _id: req.params.id }, { ...upd, historico_edicoes });
    deps.registrarAuditoria(req, "editar_recibo", req.params.id, { campos_alterados: campos_alterados.map(c => c.campo) });
    const recibo = await deps.findOne(deps.dbRecibos, { _id: req.params.id });
    if (recibo && recibo.num) {
      atualizarNoSheets(recibo.num, recibo);
    }
    res.json({ ok: true });
  });

  app.delete("/api/recibos/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    const recibo = await deps.findOne(deps.dbRecibos, { _id: req.params.id });
    if (!recibo) return res.status(404).json({ erro: "Recibo não encontrado." });
    await deps.update(deps.dbRecibos, { _id: req.params.id }, {
      deletado_em: new Date().toISOString(),
      deletado_por: req.user.username,
    });
    deps.registrarAuditoria(req, "excluir_recibo", req.params.id, { num: recibo.num, nome: recibo.nome });
    res.json({ ok: true });
  });

  // ── SALVAR ASSINATURA DIGITAL ──────────────────────────────
  app.put("/api/recibos/:id/assinatura", deps.auth, async (req, res) => {
    try {
      const { assinatura } = req.body;
      if (!assinatura || typeof assinatura !== "string" || !assinatura.startsWith("data:image/png;base64,")) {
        return res.status(400).json({ erro: "Assinatura inválida." });
      }
      await deps.update(deps.dbRecibos, { _id: req.params.id }, { assinatura_govbr: { nome_assinante: req.user.username, assinado_em: new Date().toLocaleString("pt-BR"), imagem: assinatura } });
      res.json({ ok: true });
    } catch (err) {
      console.error("Erro ao salvar assinatura:", err);
      res.status(500).json({ erro: "Erro ao salvar assinatura." });
    }
  });

  // ── RECIBO RECORRENTE — clona pro mês seguinte ──────────────
  

  // ---- ATUALIZAR COMPROVANTE --------------------------------------
  app.patch("/api/recibos/:id/comprovante", deps.auth, async (req, res) => {
    try {
      const { link_comprovante } = req.body;
      console.log(`[DEBUG] PATCH comprovante: recibo=${req.params.id}, link=${link_comprovante?.substring(0,80)}`);
      if (!link_comprovante) return res.status(400).json({ erro: "link_comprovante eh obrigatorio." });
      await deps.update(deps.dbRecibos, { _id: req.params.id }, { link_comprovante });
      const verificado = await deps.findOne(deps.dbRecibos, { _id: req.params.id });
      console.log(`[DEBUG] PATCH resultado: link_comprovante agora = ${verificado?.link_comprovante?.substring(0,80)}`);
      res.json({ ok: true, link: verificado?.link_comprovante || "" });
    } catch (err) {
      console.error("Erro ao atualizar comprovante:", err);
      res.status(500).json({ erro: "Erro ao atualizar comprovante." });
    }
  });

  app.post("/api/recibos/:id/recorrente", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const original = await deps.findOne(deps.dbRecibos, { _id: req.params.id, ...deps.NAO_DELETADO });
      if (!original) return res.status(404).json({ erro: "Recibo não encontrado." });

      const [dd, mm, yyyy] = (original.data || "").split("/");
      let newMes = parseInt(mm, 10) + 1;
      let newAno = parseInt(yyyy, 10);
      if (newMes > 12) { newMes = 1; newAno++; }
      const defaultData = `${(dd || "01").padStart(2, "0")}/${String(newMes).padStart(2, "0")}/${newAno}`;
      const newData = req.body.data || defaultData;
      const newReferencia = req.body.referencia !== undefined ? req.body.referencia : (original.referencia || "");

      const anoNum = (newData.split("/")[2]) || String(new Date().getFullYear());
      const todos = await deps.find(deps.dbRecibos, {});
      let maior = 0;
      for (const r of todos) {
        const match = (r.num || "").match(/^(\d+)\/(\d{4})$/);
        if (match && match[2] === anoNum) {
          const seq = parseInt(match[1], 10);
          if (seq > maior) maior = seq;
        }
      }
      const newNum = `${String(maior + 1).padStart(4, "0")}/${anoNum}`;

      const novoRecibo = {
        num: newNum,
        nome: original.nome,
        cpf: original.cpf,
        municipio_uf: original.municipio_uf || "",
        valor: original.valor,
        data: newData,
        emitido_por: original.emitido_por || "",
        complemento: original.complemento || "",
        referencia: newReferencia,
        forma_pagamento: original.forma_pagamento || "",
        escritorio: original.escritorio || "",
        motivo_pagamento: original.motivo_pagamento || "",
        link_comprovante: "",
        timestamp: Date.now(),
      };

      const doc = await deps.insert(deps.dbRecibos, novoRecibo);
      deps.registrarAuditoria(req, "criar_recibo_recorrente", doc._id, { num: newNum, origem_num: original.num });
      const sheetsResult = await registrarNoSheets({ ...novoRecibo, num_recibo: newNum });
      dispararWebhook(novoRecibo);
      res.json({ id: doc._id, num: newNum, data: newData, sheets_ok: sheetsResult === true });
    } catch (e) {
      console.error("Erro ao criar recibo recorrente:", e.message);
      res.status(500).json({ erro: "Erro ao criar recibo recorrente." });
    }
  });

  app.get("/api/proximo-num", deps.auth, async (req, res) => {
    const ano = String(new Date().getFullYear());
    const { rows } = await deps.pgPool.query(
      `SELECT num FROM ${deps.dbRecibos} WHERE num LIKE $1`,
      [`%/${ano}`]
    );
    let maior = 0;
    for (const row of rows) {
      const match = (row.num || "").match(/^(\d+)\/(\d{4})$/);
      if (match && match[2] === ano) {
        const seq = parseInt(match[1], 10);
        if (seq > maior) maior = seq;
      }
    }
    res.json({ num: `${String(maior + 1).padStart(4, "0")}/${ano}` });
  });

  // ── EXPORTAR RECIBOS EM LOTE (ZIP) ──────────────────────────
  app.post("/api/recibos/exportar-zip", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ erro: "Informe ao menos um ID." });
      if (ids.length > 100) return res.status(400).json({ erro: "Máximo de 100 recibos por exportação." });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="recibos_${Date.now()}.zip"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", e => { console.error("Erro archiver:", e.message); });
      archive.pipe(res);

      for (const id of ids) {
        const recibo = await deps.findOne(deps.dbRecibos, { _id: id });
        if (!recibo || recibo.deletado_em) continue;
        try {
          const buf = await gerarBufferPDFRecibo(recibo);
          const nomeArq = `recibo_${(recibo.num || id).replace(/[\/\\]/g, "-")}_${(recibo.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase()}.pdf`;
          archive.append(buf, { name: nomeArq });
        } catch (e) {
          console.error(`Erro ao gerar PDF do recibo ${id}:`, e.message);
        }
      }

      await archive.finalize();
    } catch (e) {
      console.error("Erro ao exportar ZIP:", e.message);
      if (!res.headersSent) res.status(500).json({ erro: "Erro ao gerar arquivo ZIP." });
    }
  });

  // ── GERAR DOCUMENTO ────────────────────────────────────────
  app.post("/api/gerar-recibo", deps.auth, async (req, res) => {
    try {
      const dados = req.body;
      const digits = dados.cpf.replace(/\D/g, "");
      const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
      const complemento = dados.complemento ? ` - ${dados.complemento}` : "";

      const logoPath = deps.path.join(__dirname, "public", "logo.png");
      const logoExists = deps.fs.existsSync(logoPath);
      let assinaturaBuffer = null;
      if (dados.assinatura && typeof dados.assinatura === "string" && dados.assinatura.startsWith("data:image/png;base64,")) {
        assinaturaBuffer = Buffer.from(dados.assinatura.split(",")[1], "base64");
      }

      function p(text, opts = {}) {
        return new Paragraph({
          alignment: opts.align || AlignmentType.LEFT,
          spacing: { after: opts.spaceAfter ?? 80 },
          children: [new TextRun({
            text, bold: opts.bold || false,
            size: (opts.size || 11) * 2,
            color: opts.color || "000000",
            font: "Arial",
          })],
        });
      }

      function linha() {
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
          children: [],
        });
      }

      const textoCorpo = `Recebemos do (a) senhor (a) ${dados.nome}, residente e domiciliado(a) no Município de ${dados.municipio_uf}, a importância de R$ ${dados.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

      const children = [];

      if (logoExists) {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new ImageRun({ data: deps.fs.readFileSync(logoPath), transformation: { width: 200, height: 76 }, type: "png" })],
        }));
      }

      const semBorda = { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } };

      children.push(
        p("A ARAUJO SERVIÇOS LTDA ME", { align: AlignmentType.CENTER, bold: true, size: 14, color: "1E40AF", spaceAfter: 40 }),
        p("A ARAUJO PREV", { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 40 }),
        linha(),
        p(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 20 }),
        p("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: AlignmentType.CENTER, bold: true, size: 14, spaceAfter: 80 }),
        p(textoCorpo, { align: AlignmentType.JUSTIFIED, spaceAfter: 60 }),
        p("Por ser verdade, firmo o presente que segue datado e assinado.", { align: AlignmentType.JUSTIFIED, spaceAfter: 80 }),
        linha(),
        p(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: AlignmentType.LEFT, spaceAfter: 3600 }),
        ...(assinaturaBuffer ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new ImageRun({ data: assinaturaBuffer, transformation: { width: 160, height: 40 }, type: "png" })] })] : []),
        p("________________________________________", { align: AlignmentType.CENTER, spaceAfter: 40 }),
        p(dados.nome, { align: AlignmentType.CENTER, size: 10, spaceAfter: 20 }),
        p(`${labelDoc}: ${dados.cpf}`, { align: AlignmentType.CENTER, size: 9, spaceAfter: 2800 }),
        p("________________________", { align: AlignmentType.LEFT, spaceAfter: 40 }),
        p(dados.emitido_por || "A ARAUJO PREV", { align: AlignmentType.LEFT, size: 10, spaceAfter: 0 }),
      );

      if (logoExists) {
        children.push(
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 0 }, children: [new ImageRun({ data: deps.fs.readFileSync(logoPath), transformation: { width: 180, height: 68 }, type: "png" })] }),
        );
      }

      const doc = new Document({
        sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children }],
      });

      const nomeBase = `recibo_${dados.num_recibo.replace(/[\/\\]/g, "-")}_${dados.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase()}`;

      if (dados.formato === "pdf") {
        const chunks = [];
        const pdf = new PDFDocument({ margin: 60, size: "A4" });
        pdf.on("data", c => chunks.push(c));
        await new Promise((resolve, reject) => {
          pdf.on("end", resolve);
          pdf.on("error", reject);

          if (logoExists) {
            pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
          }

          pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
            .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
          pdf.fontSize(12).fillColor("#000000")
            .text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);

          const lx = pdf.page.margins.left;
          const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
          pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);

          pdf.fontSize(12).font("Helvetica-Bold")
            .text(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: "center" }).moveDown(0.2);
          pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);

          pdf.fontSize(11).font("Helvetica")
            .text(textoCorpo, { align: "justify" }).moveDown(0.6);
          pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);

          pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);

          pdf.text(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: "left" }).moveDown(6);

          if (assinaturaBuffer) {
            pdf.image(assinaturaBuffer, { fit: [160, 40], align: "center" }).moveDown(0.1);
          }
          const cx = pdf.page.width / 2;
          pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
          pdf.fontSize(10).text(dados.nome, { align: "center" }).moveDown(0.1);
          pdf.fontSize(9).text(`${labelDoc}: ${dados.cpf}`, { align: "center" }).moveDown(5);

          pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
          pdf.fontSize(10).text(dados.emitido_por || "A ARAUJO PREV", { align: "left" });

          if (logoExists) {
            pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
          }

          pdf.end();
        });

        const pdfBuf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.pdf"`);
        res.send(pdfBuf);
      } else {
        const buf = await Packer.toBuffer(doc);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${nomeBase}.docx"`);
        res.send(buf);
      }
    } catch (e) {
      console.error("Erro ao gerar recibo:", e.message);
      res.status(500).json({ erro: "Erro ao gerar documento." });
    }
  });

  // ── BATCH EMAIL ──────────────────────────────────────────────
  app.post("/api/recibos/batch-email", deps.auth, async (req, res) => {
    if (!deps.smtpConfigurado()) {
      return res.status(503).json({ erro: "Integração de e-mail não configurada." });
    }
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ erro: "Nenhum recibo selecionado." });
    }
    try {
      let enviados = 0;
      for (const id of ids) {
        const recibo = await deps.findOne(deps.dbRecibos, { _id: id });
        if (!recibo || !recibo.email_cliente || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recibo.email_cliente)) continue;
        const cliente = await deps.findOne(deps.dbClientes, { nome: recibo.nome, ...deps.NAO_DELETADO });
        const cpfCliente = recibo.cpf || (cliente ? cliente.cpf : "");
        const munUf = recibo.municipio_uf || (cliente ? (cliente.municipio + "/" + cliente.uf) : "");
        await enviarReciboEmail({
          email_cliente: recibo.email_cliente,
          nome: recibo.nome,
          cpf: cpfCliente,
          valor: recibo.valor,
          num_recibo: recibo.num,
          data: recibo.data,
          emitido_por: recibo.emitido_por || "",
          complemento: recibo.complemento || "",
          referencia: recibo.referencia || "",
          municipio_uf: munUf,
          data_extenso: recibo.data_extenso || "",
        });
        enviados++;
      }
      res.json({ mensagem: enviados + " e-mail(s) enviado(s) com sucesso." });
    } catch (err) {
      console.error("Erro no batch email:", err);
      res.status(500).json({ erro: "Erro ao enviar e-mails em lote." });
    }
  });

  async function enviarReciboEmail(params) {
    const { email_cliente, nome, cpf, valor, num_recibo, data, emitido_por, complemento, referencia, municipio_uf, data_extenso } = params;
    const digits = (cpf || "").replace(/\D/g, "");
    const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
    const textoComplemento = complemento ? ` - ${complemento}` : "";
    const logoPath = deps.path.join(__dirname, "..", "public", "logo.png");
    const logoExists = deps.fs.existsSync(logoPath);
    const textoCorpo = `Recebemos do (a) senhor (a) ${nome}${municipio_uf ? `, residente e domiciliado(a) no Município de ${municipio_uf}` : ""}, a importância de R$ ${valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${textoComplemento}.`;
    const chunks = [];
    const pdf = new PDFDocument({ margin: 60, size: "A4" });
    pdf.on("data", c => chunks.push(c));
    await new Promise((resolve, reject) => {
      pdf.on("end", resolve);
      pdf.on("error", reject);
      if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
      pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
        .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
      pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);
      const lx = pdf.page.margins.left;
      const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);
      pdf.fontSize(12).fillColor("#000000").font("Helvetica")
        .text(`Recibo de Honorários Advocatícios nº ${num_recibo}`, { align: "center" }).moveDown(0.2)
        .fontSize(10).text(`Data: ${data}${data_extenso ? ` (${data_extenso})` : ""}`, { align: "center" }).moveDown(0.3);
      pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.5);
      const textWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      const textX = pdf.page.margins.left;
      let y = pdf.y;
      const drawLine = (label, value) => {
        pdf.fontSize(10).fillColor("#000000").text(`${label}: ${value}`, textX, y, { width: textWidth, align: "justify" });
        y = pdf.y + 8;
      };
      drawLine(labelDoc, cpf || "NÃO INFORMADO");
      drawLine("Cliente", nome);
      drawLine("Valor", `R$ ${valor}`);
      drawLine("Referência", referencia || "NÃO INFORMADO");
      drawLine("Emitido por", emitido_por || "NÃO INFORMADO");
      pdf.moveTo(lx, y + 4).lineTo(lx + lw, y + 4).stroke();
      y = pdf.y + 12;
      pdf.fontSize(9).fillColor("#333333").text(textoCorpo, textX, y, { width: textWidth, align: "justify" });
      y = pdf.y + 10;
      if (complemento) {
        pdf.fontSize(9).fillColor("#333333").text(`Complemento: ${complemento}`, textX, y, { width: textWidth, align: "justify" });
      }
      pdf.end();
    });
    const pdfBuffer = Buffer.concat(chunks);
    const mailOptions = {
      from: `"Araujo Prev" <${process.env.SMTP_USER}>`,
      to: email_cliente,
      subject: `Recibo de Honorários nº ${num_recibo} - Araujo Prev`,
      text: `Prezado(a) ${nome},\n\nSegue em anexo o Recibo de Honorários Advocatícios nº ${num_recibo}.\n\nAtenciosamente,\nAraujo Prev`,
      attachments: [{ filename: `Recibo_${num_recibo}.pdf`, content: pdfBuffer }],
    };
    await deps.transporter.sendMail(mailOptions);
  };
};
