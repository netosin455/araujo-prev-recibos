// ============================================================
const logger = require("../services/logger");
// routes/misc.js — Upload de comprovantes e relatórios
// (notificações → routes/notificacoes.js; Gov.br → routes/govbr.js)
// ============================================================
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

module.exports = function registerMiscRoutes(app, deps) {
  // deps: auth, adminOnly, financeiroOnly, semPrecatorios, semRecepcao, pgPool, dbClientes, dbRecibos, dbAuditoria, dbNotificacoes, dbConfig, NAO_DELETADO, find, findOne, insert, update, remove, count, findLimited, enriquecerCliente, registrarAuditoria, maskCPF, formatDateToBR, validarCPF, validarCNPJ, gerarParcelas, recalcularResumo, inicializarParcelasLegado, getSheetsClient, sincronizarUsuariosParaSheets, bcrypt, ADMIN_USER, s3Client, withTimeout, fetchWithTimeout, transporter, JWT_SECRET, jwt, upload, loginLimiter, crypto, fs, path, sharp

  // ".." — este arquivo vive em routes/; o diretório de dados fica em web/data
  const dbDir = process.env.DATA_DIR || deps.path.join(__dirname, "..", "data");
  const uploadsDir = deps.path.join(dbDir, "uploads");

  // Converte "DD/MM/YYYY" → "YYYY-MM" para filtros de mês
  function mesDeData(dataStr) {
    if (!dataStr) return null;
    const parts = String(dataStr).split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}`;
    if (/^\d{4}-\d{2}/.test(dataStr)) return dataStr.slice(0, 7);
    return null;
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
      logger.error("Erro upload comprovante:", e);
      res.status(500).json({ erro: "Erro ao salvar comprovante: " + e.message });
    }
  });

  // ── PROXY S3: serve arquivo do bucket privado ──────────────────────────────
  app.get("/api/comprovante-s3/*", deps.auth, async (req, res) => {
    try {
      const key = req.params[0];
      const bucket = process.env.BUCKET_NAME;
      if (!bucket) return res.status(404).json({ erro: "Bucket não configurado." });
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const obj = await deps.withTimeout(deps.s3Client.send(cmd), 15000);
      res.setHeader("Content-Type", obj.ContentType || "application/octet-stream");
      obj.Body.pipe(res);
    } catch (e) {
      logger.error("Erro ao servir comprovante S3:", e);
      res.status(404).json({ erro: "Arquivo não encontrado." });
    }
  });

  // ── VER COMPROVANTE (disco local com fallback S3) ────────
  app.get("/api/comprovante/:filename", deps.auth, async (req, res) => {
    const safe = deps.path.basename(req.params.filename);
    const filePath = deps.path.join(uploadsDir, safe);
    if (deps.fs.existsSync(filePath)) return res.sendFile(filePath);
    // Fallback: tenta buscar do S3 (legado migrado)
    const bucket = process.env.BUCKET_NAME;
    if (bucket) {
      try {
        const key = `comprovantes/${safe}`;
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const obj = await deps.s3Client.send(cmd);
        res.setHeader("Content-Type", obj.ContentType || "application/octet-stream");
        obj.Body.pipe(res);
        return;
      } catch (e) {
        // não achou no S3 também
      }
    }
    res.status(404).send("Arquivo não encontrado.");
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
      logger.error("Erro ao gerar relatório de inadimplência:", e.message);
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
      logger.error("Erro ao gerar projeção:", e.message);
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
      logger.error("Erro ao gerar relatório por escritório:", e.message);
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
      logger.error("Erro ao gerar resumo-mes:", e.message);
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
      logger.error("Erro ao gerar relatório por responsável:", e.message);
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
      logger.error("Erro ao gerar relatório de formas de pagamento:", e.message);
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
      logger.error("Erro ao gerar comparativo-anos:", e.message);
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
      logger.error("Erro ao gerar DRE:", e.message);
      res.status(500).json({ erro: "Erro ao gerar DRE." });
    }
  });


};
