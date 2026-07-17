// ============================================================
// routes/notificacoes.js — Central de notificações + e-mails
// (configuração SMTP local + envio de recibo/inadimplência).
// Movido de routes/misc.js na Fase 1 da refatoração.
// ============================================================
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

module.exports = function registerNotificacoesRoutes(app, deps) {
  // deps: auth, financeiroOnly, find, dbClientes, NAO_DELETADO, fs, path

  // ── EMAIL SMTP ─────────────────────────────────────────────
  function smtpConfigurado() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  function criarTransporter() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  async function enviarEmail({ to, subject, html, attachments = [] }) {
    if (!smtpConfigurado()) {
      console.warn("⚠️  SMTP não configurado — e-mail não enviado.");
      return false;
    }
    const transporter = criarTransporter();
    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        html,
        attachments,
      });
      console.log(`✅ E-mail enviado para ${to} — messageId: ${info.messageId}`);
      return true;
    } catch (e) {
      console.error(`❌ Falha ao enviar e-mail para ${to}: ${e.message}`);
      return false;
    }
  }

  // Carrega template HTML de web/templates/ e substitui variáveis {{chave}} pelos valores.
  function carregarTemplate(nome, variaveis = {}) {
    try {
      const templatePath = deps.path.join(__dirname, "templates", nome);
      let html = deps.fs.readFileSync(templatePath, "utf8");
      for (const [chave, valor] of Object.entries(variaveis)) {
        html = html.replaceAll(`{{${chave}}}`, valor ?? "");
      }
      return html;
    } catch (e) {
      console.error(`❌ Erro ao carregar template ${nome}: ${e.message}`);
      return null;
    }
  }

  // ── NOTIFICAÇÕES ───────────────────────────────────────────
  // GET /api/notificacoes
  // Retorna notificações para a central de notificações (parcelas vencendo/vencidas)
  app.get("/api/notificacoes", deps.auth, async (req, res) => {
    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const notificacoes = [];
      const clientes = await deps.find(deps.dbClientes, deps.NAO_DELETADO);

      for (const c of clientes) {
        const parcelas = c.parcelas || [];
        parcelas.forEach((p, idx) => {
          if (p.status === "pago" || p.pago) return;
          if (!p.data_vencimento) return;
          const partes = p.data_vencimento.split("/");
          if (partes.length !== 3) return;
          const venc = new Date(parseInt(partes[2], 10), parseInt(partes[1], 10) - 1, parseInt(partes[0], 10));
          if (isNaN(venc.getTime())) return;
          const diff = Math.floor((venc - hoje) / 86400000);

          let gravidade = "info";
          let titulo = "";
          if (diff < 0) {
            gravidade = "danger";
            titulo = "Parcela vencida";
          } else if (diff <= 2) {
            gravidade = "warning";
            titulo = "Parcela próxima do vencimento";
          } else if (diff <= 7) {
            gravidade = "info";
            titulo = "Parcela a vencer";
          } else {
            return;
          }

          notificacoes.push({
            id: c._id + "-" + idx,
            tipo: "vencimento",
            titulo,
            texto: (c.nome || "Cliente") + " — Parcela " + (idx + 1) + (diff < 0 ? " venceu há " + Math.abs(diff) + " dia(s)" : " vence em " + diff + " dia(s)"),
            lido: false,
            gravidade,
            data: venc.toISOString(),
            ref: { clienteId: c._id, parcelaIdx: idx }
          });
        });
      }

      notificacoes.sort((a, b) => new Date(a.data) - new Date(b.data));
      const naoLidas = notificacoes.filter(n => !n.lido).length;
      res.json({ notificacoes: notificacoes.slice(0, 50), naoLidas });
    } catch (err) {
      console.error("Erro ao buscar notificações:", err);
      res.status(500).json({ erro: "Erro ao buscar notificações" });
    }
  });

  // POST /api/notificacoes/marcar-lidas
  app.post("/api/notificacoes/marcar-lidas", deps.auth, (req, res) => {
    // As notificações são voláteis (calculadas sob demanda), então "marcar como lido"
    // é apenas no front-end, mas aceitamos a requisição para compatibilidade.
    res.json({ ok: true });
  });

  // POST /api/notificacoes/email-inadimplencia
  // Envia e-mail ao admin com lista de clientes inadimplentes.
  // Requer role admin ou financeiro.
  app.post("/api/notificacoes/email-inadimplencia", deps.auth, deps.financeiroOnly, async (req, res) => {
    if (!smtpConfigurado()) {
      return res.status(503).json({ erro: "Integração de e-mail não configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
    }

    const adminEmail = process.env.SMTP_ADMIN || process.env.SMTP_USER;
    if (!adminEmail) {
      return res.status(503).json({ erro: "Defina SMTP_ADMIN com o e-mail do destinatário do alerta." });
    }

    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const clientes = await deps.find(deps.dbClientes, deps.NAO_DELETADO);
      const inadimplentes = [];

      for (const cliente of clientes) {
        const parcelas = cliente.parcelas || [];
        const atrasadas = parcelas.filter(p => {
          if (p.status === "pago") return false;
          if (!p.data_vencimento) return false;
          const [d, m, y] = p.data_vencimento.split("/");
          const venc = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
          return venc < hoje;
        });

        if (atrasadas.length === 0) continue;

        const valorAberto = atrasadas.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        const maisAntiga = atrasadas.reduce((min, p) => {
          const [d, m, y] = p.data_vencimento.split("/");
          const v = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
          return v < min ? v : min;
        }, new Date());
        const diasAtraso = Math.floor((hoje - maisAntiga) / (1000 * 60 * 60 * 24));

        inadimplentes.push({
          nome: cliente.nome,
          cpf: cliente.cpf || "",
          parcelasAtrasadas: atrasadas.length,
          valorAberto: valorAberto.toFixed(2),
          diasAtraso,
        });
      }

      inadimplentes.sort((a, b) => parseFloat(b.valorAberto) - parseFloat(a.valorAberto));

      const totalValor = inadimplentes.reduce((acc, c) => acc + parseFloat(c.valorAberto), 0);
      const dataRelatorio = hoje.toLocaleDateString("pt-BR");

      const linhasTabela = inadimplentes.length === 0
        ? `<p style="color:#16a34a">Nenhum cliente inadimplente no momento. ✅</p>`
        : `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">
            <thead><tr style="background:#1E40AF;color:#fff">
              <th style="padding:8px 10px;text-align:left">Cliente</th>
              <th style="padding:8px 10px">Parcelas</th>
              <th style="padding:8px 10px">Valor Aberto</th>
              <th style="padding:8px 10px">Atraso</th>
            </tr></thead>
            <tbody>${inadimplentes.map(c => `
              <tr>
                <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${c.nome}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${c.parcelasAtrasadas}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">R$ ${parseFloat(c.valorAberto).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${c.diasAtraso} dias</td>
              </tr>`).join("")}
            </tbody>
          </table>`;

      const html = carregarTemplate("email-inadimplencia.html", {
        data_relatorio: dataRelatorio,
        total_clientes: inadimplentes.length,
        total_valor: totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
        tabela_clientes: linhasTabela,
      }) || `<p>Inadimplência ${dataRelatorio}: ${inadimplentes.length} cliente(s) — R$ ${totalValor.toFixed(2)}</p>`;

      const ok = await enviarEmail({
        to: adminEmail,
        subject: `[Araujo Prev] Inadimplência — ${inadimplentes.length} cliente(s) — ${dataRelatorio}`,
        html,
      });

      if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configurações SMTP." });

      console.log(`[${new Date().toISOString()}] E-mail de inadimplência enviado por ${req.user.username} — ${inadimplentes.length} clientes`);
      res.json({ ok: true, inadimplentes: inadimplentes.length, destinatario: adminEmail });
    } catch (e) {
      console.error("❌ Erro ao gerar relatório de inadimplência por e-mail:", e.message);
      res.status(500).json({ erro: "Erro interno ao processar relatório." });
    }
  });

  // POST /api/notificacoes/enviar-recibo-email
  // Gera PDF do recibo em memória e envia como anexo para o e-mail do cliente.
  // Aceita email_cliente OU email (alias usado pelo frontend); num_recibo OU num (alias).
  // CPF, municipio_uf e data_extenso são opcionais — o PDF é gerado sem eles se ausentes.
  app.post("/api/notificacoes/enviar-recibo-email", deps.auth, deps.financeiroOnly, async (req, res) => {
    if (!smtpConfigurado()) {
      return res.status(503).json({ erro: "Integração de e-mail não configurada. Defina SMTP_HOST, SMTP_USER e SMTP_PASS no painel do EB." });
    }

    const body = req.body;
    // Aceita aliases usados pelo frontend (email → email_cliente, num → num_recibo)
    const emailDest = body.email_cliente || body.email || "";
    const numRecibo = body.num_recibo || body.num || "";
    const { nome, cpf = "", valor, data, emitido_por, complemento, referencia, municipio_uf = "", data_extenso = "" } = body;

    if (!emailDest || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDest)) {
      return res.status(400).json({ erro: "E-mail do destinatário inválido ou não informado." });
    }
    if (!nome || !valor) {
      return res.status(400).json({ erro: "Campos obrigatórios ausentes: nome, valor." });
    }

    try {
      const digits = cpf.replace(/\D/g, "");
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

        pdf.fontSize(12).font("Helvetica-Bold")
          .text(`Recibo Nº ${numRecibo}${referencia ? "   |   Ref: " + referencia : ""}`, { align: "center" }).moveDown(0.2);
        pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);
        pdf.fontSize(11).font("Helvetica").text(textoCorpo, { align: "justify" }).moveDown(0.6);
        pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);
        pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);
        if (municipio_uf || data_extenso) {
          pdf.text(`${municipio_uf}, ${data_extenso}`, { align: "left" }).moveDown(6);
        } else {
          pdf.moveDown(6);
        }
        pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
        pdf.fontSize(10).text(nome, { align: "center" }).moveDown(0.1);
        if (cpf) pdf.fontSize(9).text(`${labelDoc}: ${cpf}`, { align: "center" }).moveDown(5);
        else pdf.moveDown(5);
        pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
        pdf.fontSize(10).text(emitido_por || "A ARAUJO PREV", { align: "left" });
        if (logoExists) pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
        pdf.end();
      });

      const pdfBuf = Buffer.concat(chunks);
      const nomeArquivo = `recibo_${String(numRecibo).replace(/[\/\\]/g, "-")}.pdf`;

      const html = carregarTemplate("email-recibo.html", {
        nome,
        num_recibo: numRecibo,
        valor,
        data: data || "",
      }) || `<p>Olá ${nome}, segue em anexo o recibo Nº ${numRecibo} no valor de R$ ${valor}.</p>`;

      const ok = await enviarEmail({
        to: emailDest,
        subject: `Recibo de Honorários Nº ${numRecibo} — Araujo Prev`,
        html,
        attachments: [{ filename: nomeArquivo, content: pdfBuf, contentType: "application/pdf" }],
      });

      if (!ok) return res.status(502).json({ erro: "Falha ao enviar e-mail. Verifique as configurações SMTP." });

      console.log(`[${new Date().toISOString()}] Recibo ${numRecibo} enviado por e-mail para ${emailDest} por ${req.user.username}`);
      res.json({ ok: true, destinatario: emailDest });
    } catch (e) {
      console.error("❌ Erro ao enviar recibo por e-mail:", e.message);
      res.status(500).json({ erro: "Erro interno ao processar envio." });
    }
  });
};
