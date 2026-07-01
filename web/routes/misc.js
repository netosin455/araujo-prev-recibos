// ============================================================
// routes/misc.js — Upload, relatórios, notificações, Gov.br, email
// ============================================================
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle } = require("docx");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

// Additional deps beyond the main list: PutObjectCommand, GetObjectCommand, Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle, PDFDocument, nodemailer

module.exports = function registerMiscRoutes(app, deps) {
  // deps: auth, adminOnly, financeiroOnly, semPrecatorios, semRecepcao, pgPool, dbClientes, dbRecibos, dbAuditoria, dbNotificacoes, dbConfig, NAO_DELETADO, find, findOne, insert, update, remove, count, findLimited, enriquecerCliente, registrarAuditoria, maskCPF, formatDateToBR, validarCPF, validarCNPJ, gerarParcelas, recalcularResumo, inicializarParcelasLegado, getSheetsClient, sincronizarUsuariosParaSheets, bcrypt, ADMIN_USER, s3Client, withTimeout, fetchWithTimeout, transporter, JWT_SECRET, jwt, upload, loginLimiter, crypto, fs, path, sharp

  const dbDir = process.env.DATA_DIR || deps.path.join(__dirname, "data");
  const uploadsDir = deps.path.join(dbDir, "uploads");

  // Converte "DD/MM/YYYY" → "YYYY-MM" para filtros de mês
  function mesDeData(dataStr) {
    if (!dataStr) return null;
    const parts = String(dataStr).split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}`;
    if (/^\d{4}-\d{2}/.test(dataStr)) return dataStr.slice(0, 7);
    return null;
  }

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

  // ── UPLOAD COMPROVANTE ─────────────────────────────────────
  app.post("/api/upload-comprovante", deps.auth, deps.upload.single("comprovante"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });

      // Validação de magic bytes — rejeita arquivos com assinatura desconhecida
      const sig = req.file.buffer.slice(0, 8);
      const isPDF  = sig.slice(0, 4).toString("ascii") === "%PDF";
      const isJPEG = sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF;
      const isPNG  = sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47;
      if (!isPDF && !isJPEG && !isPNG) {
        return res.status(400).json({ erro: "Tipo de arquivo não permitido. Envie PDF, JPEG ou PNG." });
      }

      const ext = deps.path.extname(req.file.originalname) || "";
      const nomeArquivo = `comprovante_${deps.crypto.randomBytes(8).toString("hex")}${ext}`;

      // S3 quando bucket configurado
      const bucket = process.env.BUCKET_NAME;
      if (bucket) {
        const key = `comprovantes/${nomeArquivo}`;
        await deps.withTimeout(deps.s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })), 15000);
        return res.json({ link: `/api/comprovante-s3/${key}` });
      }

      // Fallback: arquivo local
      deps.fs.writeFileSync(deps.path.join(uploadsDir, nomeArquivo), req.file.buffer);
      res.json({ link: `/api/comprovante/${nomeArquivo}` });
    } catch (e) {
      console.error("Erro upload comprovante:", e);
      res.status(500).json({ erro: "Erro ao salvar comprovante: " + e.message });
    }
  });

  // ── PROXY S3: serve arquivo do bucket privado ──────────────────────────────
  app.get("/api/comprovante-s3/*", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const key = req.params[0];
      const bucket = process.env.BUCKET_NAME;
      if (!bucket) return res.status(404).json({ erro: "Bucket não configurado." });
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const obj = await deps.withTimeout(deps.s3Client.send(cmd), 15000);
      res.setHeader("Content-Type", obj.ContentType || "application/octet-stream");
      obj.Body.pipe(res);
    } catch (e) {
      console.error("Erro ao servir comprovante S3:", e);
      res.status(404).json({ erro: "Arquivo não encontrado." });
    }
  });

  // ── VER COMPROVANTE (disco local — fallback sem S3) ────────
  app.get("/api/comprovante/:filename", deps.auth, (req, res) => {
    const safe = deps.path.basename(req.params.filename);
    const filePath = deps.path.join(uploadsDir, safe);
    if (!deps.fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
    res.sendFile(filePath);
  });

  // ── RELATÓRIO DE INADIMPLÊNCIA ─────────────────────────────
  app.get("/api/relatorios/inadimplencia", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const clientes = await deps.find(deps.dbClientes, deps.NAO_DELETADO);
      const hoje = new Date().toISOString().slice(0, 10);
      const relatorio = [];
      for (const c of clientes) {
        const enriquecido = await deps.enriquecerCliente(c);
        const atrasadas = (enriquecido.parcelas || []).filter(p => p.status === "atrasado");
        if (atrasadas.length === 0) continue;
        relatorio.push({
          id: enriquecido._id,
          nome: enriquecido.nome,
          cpf: enriquecido.cpf,
          telefone: enriquecido.telefone || "",
          parcelas_atrasadas: atrasadas.length,
          valor_em_aberto: atrasadas.reduce((s, p) => s + (p.valor || 0), 0),
          parcelas: atrasadas.map(p => ({
            num: p.num,
            valor: p.valor,
            data_vencimento: p.data_vencimento,
            dias_atraso: p.data_vencimento
              ? Math.floor((new Date(hoje) - new Date(p.data_vencimento)) / 86400000)
              : null,
          })),
        });
      }
      relatorio.sort((a, b) => b.valor_em_aberto - a.valor_em_aberto);
      res.json({ total_inadimplentes: relatorio.length, relatorio });
    } catch (e) {
      console.error("Erro ao gerar relatório de inadimplência:", e.message);
      res.status(500).json({ erro: "Erro ao gerar relatório." });
    }
  });

  // ── RELATÓRIO: PROJEÇÃO DE RECEBIMENTOS (6 MESES) ──────────
  app.get("/api/relatorios/projecao", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const clientes = await deps.find(deps.dbClientes, deps.NAO_DELETADO);
      const hoje = new Date();
      // Mapa mes-chave → valor acumulado para os próximos 6 meses
      const mesesPT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const limite = new Date(hoje.getFullYear(), hoje.getMonth() + 6, 1);
      const mapa = {};
      for (let i = 0; i < 6; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
        const chave = `${mesesPT[d.getMonth()]}/${d.getFullYear()}`;
        mapa[chave] = 0;
      }
      for (const c of clientes) {
        const enriquecido = await deps.enriquecerCliente(c);
        for (const p of (enriquecido.parcelas || [])) {
          if (p.status === "pago") continue;
          if (!p.data_vencimento) continue;
          const [aaaa, mm] = p.data_vencimento.split("-");
          if (!aaaa || !mm) continue;
          const venc = new Date(parseInt(aaaa), parseInt(mm) - 1, 1);
          if (venc < new Date(hoje.getFullYear(), hoje.getMonth(), 1) || venc >= limite) continue;
          const chave = `${mesesPT[venc.getMonth()]}/${venc.getFullYear()}`;
          if (chave in mapa) mapa[chave] += p.valor || 0;
        }
      }
      const resultado = Object.entries(mapa).map(([mes, valor]) => ({ mes, valor: Math.round(valor * 100) / 100 }));
      res.json(resultado);
    } catch (e) {
      console.error("Erro ao gerar projeção:", e.message);
      res.status(500).json({ erro: "Erro ao gerar projeção." });
    }
  });

  // ── RELATÓRIO: RECEITA POR ESCRITÓRIO ──────────────────────
  app.get("/api/relatorios/por-escritorio", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const recibos  = await deps.find(deps.dbRecibos,  deps.NAO_DELETADO);
      const clientes = await deps.find(deps.dbClientes, deps.NAO_DELETADO);
      const escritorios = {};
      for (const r of recibos) {
        const esc = (r.escritorio || "").trim() || "(sem escritório)";
        if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
        const val = parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
        escritorios[esc].receita      += val;
        escritorios[esc].qtd_recibos  += 1;
      }
      for (const c of clientes) {
        const esc = (c.escritorio || "").trim() || "(sem escritório)";
        if (!escritorios[esc]) escritorios[esc] = { escritorio: esc, receita: 0, qtd_recibos: 0, qtd_clientes: 0 };
        escritorios[esc].qtd_clientes += 1;
      }
      const resultado = Object.values(escritorios)
        .map(e => ({ ...e, receita: Math.round(e.receita * 100) / 100 }))
        .sort((a, b) => b.receita - a.receita);
      res.json(resultado);
    } catch (e) {
      console.error("Erro ao gerar relatório por escritório:", e.message);
      res.status(500).json({ erro: "Erro ao gerar relatório." });
    }
  });

  // ── RESUMO MENSAL COM KPIs COMPARATIVOS ─────────────────────
  app.get("/api/relatorios/resumo-mes", deps.auth, async (req, res) => {
    try {
      const hoje = new Date();
      const mes = req.query.mes || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

      const [ano, mNum] = mes.split("-").map(Number);
      const dataMesAnterior = new Date(ano, mNum - 2, 1);
      const mesAnterior = `${dataMesAnterior.getFullYear()}-${String(dataMesAnterior.getMonth() + 1).padStart(2, "0")}`;

      const [recibos, clientes] = await Promise.all([
        deps.find(deps.dbRecibos, deps.NAO_DELETADO),
        deps.find(deps.dbClientes, deps.NAO_DELETADO),
      ]);

      const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      const delta = (base, atual) => base === 0 ? null : Math.round(((atual - base) / base) * 1000) / 10;

      const doMes      = recibos.filter(r => mesDeData(r.data) === mes);
      const doAnterior = recibos.filter(r => mesDeData(r.data) === mesAnterior);

      const receitaMes      = doMes.reduce((s, r) => s + parseValor(r), 0);
      const receitaAnterior = doAnterior.reduce((s, r) => s + parseValor(r), 0);
      const ticketMes       = doMes.length ? receitaMes / doMes.length : 0;
      const ticketAnterior  = doAnterior.length ? receitaAnterior / doAnterior.length : 0;
      const clientesMes      = clientes.filter(c => c.created_at && c.created_at.slice(0, 7) === mes).length;
      const clientesAnterior = clientes.filter(c => c.created_at && c.created_at.slice(0, 7) === mesAnterior).length;

      res.json({
        mes,
        mes_anterior: mesAnterior,
        receita_mes:             Math.round(receitaMes * 100) / 100,
        receita_anterior:        Math.round(receitaAnterior * 100) / 100,
        delta_receita:           delta(receitaAnterior, receitaMes),
        recibos_mes:             doMes.length,
        recibos_anterior:        doAnterior.length,
        delta_recibos:           delta(doAnterior.length, doMes.length),
        ticket_medio:            Math.round(ticketMes * 100) / 100,
        ticket_anterior:         Math.round(ticketAnterior * 100) / 100,
        delta_ticket:            delta(ticketAnterior, ticketMes),
        clientes_novos:          clientesMes,
        clientes_novos_anterior: clientesAnterior,
        delta_clientes:          delta(clientesAnterior, clientesMes),
      });
    } catch (e) {
      console.error("Erro ao gerar resumo-mes:", e.message);
      res.status(500).json({ erro: "Erro ao gerar resumo do mês." });
    }
  });

  // ── RECEITA POR RESPONSÁVEL ──────────────────────────────────
  app.get("/api/relatorios/por-responsavel", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const recibos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO);
      const filtrados = req.query.mes
        ? recibos.filter(r => mesDeData(r.data) === req.query.mes)
        : recibos;
      const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      const mapa = {};
      for (const r of filtrados) {
        const resp = (r.emitido_por || "").trim() || "(não informado)";
        if (!mapa[resp]) mapa[resp] = { responsavel: resp, total_recibos: 0, receita_total: 0 };
        mapa[resp].total_recibos += 1;
        mapa[resp].receita_total += parseValor(r);
      }
      const resultado = Object.values(mapa)
        .map(r => ({
          responsavel:   r.responsavel,
          total_recibos: r.total_recibos,
          receita_total: Math.round(r.receita_total * 100) / 100,
          ticket_medio:  r.total_recibos ? Math.round((r.receita_total / r.total_recibos) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.receita_total - a.receita_total);
      res.json(resultado);
    } catch (e) {
      console.error("Erro ao gerar relatório por responsável:", e.message);
      res.status(500).json({ erro: "Erro ao gerar relatório." });
    }
  });

  // ── RECEITA POR FORMA DE PAGAMENTO ──────────────────────────
  app.get("/api/relatorios/formas-pagamento", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const recibos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO);
      const filtrados = req.query.mes
        ? recibos.filter(r => mesDeData(r.data) === req.query.mes)
        : recibos;
      const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      const mapa = {};
      let totalReceita = 0;
      for (const r of filtrados) {
        const forma = (r.forma_pagamento || "").trim() || "(não informado)";
        if (!mapa[forma]) mapa[forma] = { forma, recibos: 0, receita: 0 };
        const val = parseValor(r);
        mapa[forma].recibos += 1;
        mapa[forma].receita += val;
        totalReceita += val;
      }
      const resultado = Object.values(mapa)
        .map(f => ({
          ...f,
          receita:    Math.round(f.receita * 100) / 100,
          percentual: totalReceita ? Math.round((f.receita / totalReceita) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.receita - a.receita);
      res.json(resultado);
    } catch (e) {
      console.error("Erro ao gerar relatório de formas de pagamento:", e.message);
      res.status(500).json({ erro: "Erro ao gerar relatório." });
    }
  });

  // ── COMPARATIVO DE ANOS ─────────────────────────────────────
  app.get("/api/relatorios/comparativo-anos", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const recibos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO);
      const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      const mapa = {};
      for (const r of recibos) {
        const mesAno = mesDeData(r.data);
        if (!mesAno) continue;
        const [ano, mes] = mesAno.split("-").map(Number);
        if (!mapa[ano]) mapa[ano] = {};
        if (!mapa[ano][mes]) mapa[ano][mes] = { receita: 0, qtd: 0 };
        mapa[ano][mes].receita += parseValor(r);
        mapa[ano][mes].qtd += 1;
      }
      const resultado = Object.entries(mapa)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([ano, mesesObj]) => ({
          ano: Number(ano),
          meses: Array.from({ length: 12 }, (_, i) => ({
            mes: i + 1,
            receita: Math.round((mesesObj[i + 1]?.receita || 0) * 100) / 100,
            qtd: mesesObj[i + 1]?.qtd || 0,
          })),
        }));
      res.json(resultado);
    } catch (e) {
      console.error("Erro ao gerar comparativo-anos:", e.message);
      res.status(500).json({ erro: "Erro ao gerar comparativo de anos." });
    }
  });

  // ── DRE SIMPLIFICADO ─────────────────────────────────────────
  app.get("/api/relatorios/dre", deps.auth, deps.semRecepcao, async (req, res) => {
    try {
      const ano = parseInt(req.query.ano || new Date().getFullYear(), 10);
      const recibos = await deps.find(deps.dbRecibos, deps.NAO_DELETADO);
      const parseValor = (r) => parseFloat(String(r.valor || "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
      const MESES_NOME = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      const porMes = Array.from({ length: 12 }, () => ({ receita: 0, qtd: 0 }));
      for (const r of recibos) {
        const mesAno = mesDeData(r.data);
        if (!mesAno) continue;
        const [anoR, mesR] = mesAno.split("-").map(Number);
        if (anoR !== ano) continue;
        porMes[mesR - 1].receita += parseValor(r);
        porMes[mesR - 1].qtd += 1;
      }
      let acumulado = 0;
      const meses = porMes.map((m, i) => {
        const receitaBruta = Math.round(m.receita * 100) / 100;
        const ticketMedio  = m.qtd ? Math.round((m.receita / m.qtd) * 100) / 100 : 0;
        const anterior     = i > 0 ? porMes[i - 1].receita : null;
        const variacaoMom  = anterior !== null && anterior > 0
          ? Math.round(((m.receita - anterior) / anterior) * 1000) / 10
          : null;
        acumulado += m.receita;
        return {
          mes: MESES_NOME[i],
          mes_num: i + 1,
          receita_bruta: receitaBruta,
          qtd_recibos: m.qtd,
          ticket_medio: ticketMedio,
          variacao_mom: variacaoMom,
          acumulado: Math.round(acumulado * 100) / 100,
        };
      });
      res.json({ ano, meses, total_ano: Math.round(acumulado * 100) / 100 });
    } catch (e) {
      console.error("Erro ao gerar DRE:", e.message);
      res.status(500).json({ erro: "Erro ao gerar DRE." });
    }
  });


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
      console.error("Erro ao iniciar Gov.br:", e.message);
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
      console.warn(`[${agora}] Gov.br callback — erro retornado pelo provedor: ${mensagem}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent(mensagem)}`);
    }

    const { rows: stateRows } = await deps.pgPool.query(
      `DELETE FROM govbr_states WHERE state = $1 RETURNING recibo_id, username, expira_em`,
      [state]
    );
    const stateData = stateRows[0] ? { recibo_id: stateRows[0].recibo_id, user: stateRows[0].username, expires: new Date(stateRows[0].expira_em).getTime() } : null;
    if (!stateData) {
      console.warn(`[${agora}] Gov.br callback — state desconhecido ou já utilizado: ${state}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão expirada ou inválida. Inicie o processo novamente.")}`);
    }
    if (Date.now() > stateData.expires) {
      console.warn(`[${agora}] Gov.br callback — state expirado para usuário ${stateData.user}`);
      return res.redirect(`/govbr-erro.html?msg=${encodeURIComponent("Sessão Gov.br expirada (limite de 10 minutos). Tente novamente.")}`);
    }

    console.log(`[${agora}] Gov.br callback — iniciando troca de code por token para recibo ${stateData.recibo_id} (usuário: ${stateData.user})`);

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
        console.error(`[${agora}] Gov.br callback — token não recebido. Resposta: ${JSON.stringify(tokenData)}`);
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
      console.log(`[${new Date().toISOString()}] ✅ Recibo ${stateData.recibo_id} assinado via Gov.br por ${assinatura.nome_assinante} (CPF: ${assinatura.cpf_assinante || "n/d"}) — usuário do sistema: ${stateData.user}`);

      res.redirect(`/?govbr_ok=1&recibo_id=${stateData.recibo_id}`);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] ❌ Erro no callback Gov.br para recibo ${stateData?.recibo_id}: ${e.message}`);
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
};
