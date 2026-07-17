module.exports = function registerClienteRoutes(app, deps) {
  // deps contains: { auth, adminOnly, financeiroOnly, semPrecatorios, semRecepcao, pgPool, dbClientes, NAO_DELETADO, find, findOne, insert, update, remove, count, enriquecerCliente, registrarAuditoria, maskCPF, validarCPF, validarCNPJ, gerarParcelas, recalcularResumo, inicializarParcelasLegado }

  // ── LISTAGEM PAGINADA (movida de server.js na Fase 1) ──────
  app.get("/api/clientes", deps.auth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await deps.pgPool.query(
      `SELECT * FROM ${deps.dbClientes} WHERE deletado_em IS NULL ORDER BY nome ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await deps.count(deps.dbClientes, deps.NAO_DELETADO);
    const enriquecidos = await Promise.all(rows.map(r => ({ ...r, _id: r.id })).map(deps.enriquecerCliente));
    res.json({ clientes: enriquecidos, total, limit, offset });
  });

  app.get("/api/clientes/cpf/:cpf", deps.auth, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { cpf: req.params.cpf });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      res.json(await deps.enriquecerCliente(cliente));
    } catch (e) {
      console.error("Erro ao buscar cliente por CPF:", e.message);
      res.status(500).json({ erro: "Erro ao buscar cliente." });
    }
  });

  /**
   * @openapi
   * /api/clientes/{id}:
   *   get:
   *     tags: [Clientes]
   *     summary: Busca cliente por ID
   *     security: [{ cookieAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Dados do cliente
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Cliente'
   *       404:
   *         description: Cliente não encontrado
   */
  app.get("/api/clientes/:id", deps.auth, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id, ...deps.NAO_DELETADO });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      res.json(await deps.enriquecerCliente(cliente));
    } catch (e) {
      console.error("Erro ao buscar cliente:", e.message);
      res.status(500).json({ erro: "Erro ao buscar cliente." });
    }
  });

  /**
   * @openapi
   * /api/clientes:
   *   post:
   *     tags: [Clientes]
   *     summary: Cria novo cliente
   *     security: [{ cookieAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [nome, cpf, municipio_uf, num_parcelas]
   *             properties:
   *               nome: { type: string }
   *               cpf: { type: string }
   *               telefone: { type: string }
   *               municipio_uf: { type: string }
   *               firma: { type: string }
   *               referencia: { type: string }
   *               valor_beneficio: { type: number }
   *               num_beneficios: { type: integer }
   *               valor_contrato: { type: number }
   *               num_parcelas: { type: integer }
   *               valor_entrada: { type: number }
   *     responses:
   *       201:
   *         description: Cliente criado
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Cliente'
   *       400:
   *         description: Dados inválidos
   */
  app.post("/api/clientes", deps.auth, deps.semPrecatorios, async (req, res) => {
    try {
      const {
        nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
        valor_beneficio, num_beneficios, valor_contrato, num_parcelas, valor_entrada,
      } = req.body;
      const vEntrada = Math.max(0, Number(valor_entrada) || 0);
    if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
    if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
    const digsCliente = (cpf || "").replace(/\D/g, "");
    if (digsCliente.length === 11 && !deps.validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
    if (digsCliente.length === 14 && !deps.validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

    const vBeneficio  = Number(valor_beneficio) || 0;
    const nBeneficios = Number(num_beneficios) || 0;
    const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
    if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });
    if (vEntrada >= vContrato) return res.status(400).json({ erro: "Valor de entrada não pode ser igual ou maior que o valor do contrato." });

    const existente = await deps.findOne(deps.dbClientes, { cpf });
    if (existente) return res.status(400).json({ erro: "Já existe um cliente cadastrado com este CPF." });

    const nParcelas = Number(num_parcelas);
    const parcelas  = deps.gerarParcelas(nParcelas, vContrato, vEntrada);
    const vParcela  = nParcelas > 0 ? (vContrato - vEntrada) / nParcelas : 0;
    const resumo    = deps.recalcularResumo(parcelas, vContrato - vEntrada);

    const doc = await deps.insert(deps.dbClientes, {
      nome, cpf,
      telefone: telefone || "",
      endereco: endereco || "",
      municipio_uf,
      firma: firma || "",
      referencia: referencia || "",
      valor_beneficio: vBeneficio,
      num_beneficios: nBeneficios,
      valor_contrato: vContrato,
      valor_entrada: vEntrada,
      num_parcelas: nParcelas,
      valor_parcela: vParcela,
      parcelas,
      ...resumo,
      auto_recibo: false,
      created_at: new Date().toISOString(),
    });
    res.json(await deps.enriquecerCliente(doc));
    } catch (e) {
      console.error("Erro ao criar cliente:", e.message);
      res.status(500).json({ erro: "Erro ao criar cliente." });
    }
  });

  app.put("/api/clientes/:id", deps.auth, deps.semPrecatorios, async (req, res) => {
    try {
      const {
        nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
        valor_beneficio, num_beneficios, valor_contrato, num_parcelas, parcelas, auto_recibo, valor_entrada,
      } = req.body;
      const vEntrada = Math.max(0, Number(valor_entrada) || 0);
      if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
      if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
      const digsEdit = (cpf || "").replace(/\D/g, "");
      if (digsEdit.length === 11 && !deps.validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
      if (digsEdit.length === 14 && !deps.validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

      const vBeneficio  = Number(valor_beneficio) || 0;
      const nBeneficios = Number(num_beneficios) || 0;
      const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
      if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });
      if (vEntrada >= vContrato) return res.status(400).json({ erro: "Valor de entrada não pode ser igual ou maior que o valor do contrato." });

      const { rows: dupl } = await deps.pgPool.query(
        "SELECT id FROM clientes WHERE cpf = $1 AND id != $2 AND deletado_em IS NULL LIMIT 1",
        [cpf, req.params.id]
      );
      if (dupl.length > 0) return res.status(400).json({ erro: "CPF já cadastrado em outro cliente." });

      const nParcelas = Number(num_parcelas);
      const atual     = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      if (!atual) return res.status(404).json({ erro: "Cliente não encontrado." });
      const antigasParcelas = (atual && Array.isArray(atual.parcelas)) ? atual.parcelas : [];

      let novasParcelas;
      if (Array.isArray(parcelas) && parcelas.length > 0) {
        novasParcelas = parcelas;
      } else if (antigasParcelas.length === nParcelas) {
        novasParcelas = antigasParcelas;
      } else {
        novasParcelas = deps.gerarParcelas(nParcelas, vContrato, vEntrada).map((p, i) => {
          const antiga = antigasParcelas[i];
          return antiga ? { ...p, ...antiga, num: p.num, valor: p.valor } : p;
        });
      }

      // Audita mudanças de status em cada parcela
      for (const nova of novasParcelas) {
        const velha = antigasParcelas.find(p => p.num === nova.num);
        if (velha && velha.status !== nova.status) {
          deps.registrarAuditoria(req, "atualizar_parcela", req.params.id, { num_parcela: nova.num, status_anterior: velha.status, status_novo: nova.status });
        }
      }

      const resumo = deps.recalcularResumo(novasParcelas, vContrato - vEntrada);

      await deps.update(deps.dbClientes, { _id: req.params.id }, {
        nome, cpf,
        telefone: telefone || "",
        endereco: endereco || "",
        municipio_uf,
        firma: firma || "",
        referencia: referencia || "",
        valor_beneficio: vBeneficio,
        num_beneficios: nBeneficios,
        valor_contrato: vContrato,
        valor_entrada: vEntrada,
        num_parcelas: nParcelas,
        valor_parcela: nParcelas > 0 ? (vContrato - vEntrada) / nParcelas : 0,
        parcelas: novasParcelas,
        ...resumo,
        auto_recibo: auto_recibo === true,
      });
      const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(atualizado));
    } catch (e) {
      console.error("Erro ao atualizar cliente:", e.message);
      res.status(500).json({ erro: "Erro ao atualizar cliente." });
    }
  });

  app.patch("/api/clientes/:id/auto-recibo", deps.auth, async (req, res) => {
    try {
      const { auto_recibo } = req.body;
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      if (!cliente) return res.status(404).json({ erro: "Cliente n\u00E3o encontrado." });
      await deps.update(deps.dbClientes, { _id: req.params.id }, { auto_recibo: auto_recibo === true });
      res.json({ auto_recibo: auto_recibo === true });
    } catch (e) {
      console.error("Erro ao atualizar auto-recibo:", e.message);
      res.status(500).json({ erro: "Erro ao atualizar auto-recibo." });
    }
  });

  app.delete("/api/clientes/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      await deps.update(deps.dbClientes, { _id: req.params.id }, {
        deletado_em: new Date().toISOString(),
        deletado_por: req.user.username,
      });
      deps.registrarAuditoria(req, "excluir_cliente", req.params.id, { nome: cliente.nome, cpf: deps.maskCPF(cliente.cpf) });
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao excluir cliente:", e.message);
      res.status(500).json({ erro: "Erro ao excluir cliente." });
    }
  });

  // ── OBSERVAÇÕES DE CLIENTE ─────────────────────────────────
  app.post("/api/clientes/:id/observacoes", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id, ...deps.NAO_DELETADO });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      const { texto } = req.body;
      if (!texto || typeof texto !== "string" || !texto.trim()) {
        return res.status(400).json({ erro: "Texto da observação é obrigatório." });
      }
      if (texto.trim().length > 500) {
        return res.status(400).json({ erro: "Observação muito longa (máx. 500 caracteres)." });
      }
      const novaObs = { texto: texto.trim(), autor: req.user.username, criado_em: new Date().toISOString() };
      const observacoes = [...(cliente.observacoes || []), novaObs];
      await deps.update(deps.dbClientes, { _id: req.params.id }, { observacoes });
      const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(atualizado));
    } catch (e) {
      console.error("Erro ao salvar observação:", e.message);
      res.status(500).json({ erro: "Erro ao salvar observação." });
    }
  });

  app.delete("/api/clientes/:id/observacoes/:idx", deps.auth, deps.adminOnly, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id, ...deps.NAO_DELETADO });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      const idx = parseInt(req.params.idx, 10);
      const observacoes = [...(cliente.observacoes || [])];
      if (isNaN(idx) || idx < 0 || idx >= observacoes.length) {
        return res.status(400).json({ erro: "Índice de observação inválido." });
      }
      observacoes.splice(idx, 1);
      await deps.update(deps.dbClientes, { _id: req.params.id }, { observacoes });
      const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(atualizado));
    } catch (e) {
      console.error("Erro ao remover observação:", e.message);
      res.status(500).json({ erro: "Erro ao remover observação." });
    }
  });

  // ── LEMBRETE ENVIADO — PARCELA ─────────────────────────────
  // Registra que um lembrete de cobrança foi enviado ao cliente para a parcela N
  app.post("/api/clientes/:id/parcela/:num/lembrete", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id, ...deps.NAO_DELETADO });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      const num = parseInt(req.params.num, 10);
      if (!num || num < 1) return res.status(400).json({ erro: "Número de parcela inválido." });
      const parcelasAtual = deps.inicializarParcelasLegado(cliente).parcelas;
      const parcela = parcelasAtual.find(p => p.num === num);
      if (!parcela) return res.status(404).json({ erro: "Parcela não encontrada." });
      const parcelas = parcelasAtual.map(p =>
        p.num === num
          ? { ...p, lembrete_enviado_em: new Date().toISOString(), lembrete_enviado_por: req.user.username }
          : p
      );
      const baseContrato = deps.numeroSeguro(cliente.valor_contrato) - deps.numeroSeguro(cliente.valor_entrada);
      const resumo = deps.recalcularResumo(parcelas, baseContrato);
      await deps.update(deps.dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
      const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(atualizado));
    } catch (e) {
      console.error("Erro ao registrar lembrete:", e.message);
      res.status(500).json({ erro: "Erro ao registrar lembrete." });
    }
  });

  app.patch("/api/clientes/:id/parcela/:num", deps.auth, deps.financeiroOnly, async (req, res) => {
    try {
      const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
      const num = Number(req.params.num);
      if (!num || num < 1) return res.status(400).json({ erro: "Número de parcela inválido." });

      const { status, data_recebimento, data_deposito, recibo_id, recibo_num, observacao, data_vencimento } = req.body;
      const STATUS_VALIDOS = ["pendente", "pago", "atrasado"];
      if (status !== undefined && !STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ erro: "Status inválido. Use: pendente, pago ou atrasado." });
      }
      const atualizacao = {};
      if (status           !== undefined) atualizacao.status           = status;
      if (data_recebimento !== undefined) atualizacao.data_recebimento = data_recebimento;
      if (data_deposito    !== undefined) atualizacao.data_deposito    = data_deposito;
      if (recibo_id        !== undefined) atualizacao.recibo_id        = recibo_id;
      if (recibo_num       !== undefined) atualizacao.recibo_num       = recibo_num;
      if (observacao       !== undefined) atualizacao.observacao       = observacao;
      if (data_vencimento  !== undefined) atualizacao.data_vencimento  = data_vencimento;

      const parcelasAtuais = deps.inicializarParcelasLegado(cliente).parcelas;
      const parcelas = parcelasAtuais.map(p =>
        p.num === num ? { ...p, ...atualizacao } : p
      );
      const baseContrato = deps.numeroSeguro(cliente.valor_contrato) - deps.numeroSeguro(cliente.valor_entrada);
      const resumo = deps.recalcularResumo(parcelas, baseContrato);
      await deps.update(deps.dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
      if (status !== undefined) {
        deps.registrarAuditoria(req, "atualizar_parcela", req.params.id, { num_parcela: num, status_novo: status });
      }
      const salvo = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(salvo));
    } catch (e) {
      console.error("Erro ao atualizar parcela:", e.message);
      res.status(500).json({ erro: "Erro ao atualizar parcela." });
    }
  });
};
