module.exports = function registerClienteRoutes(app, deps) {
  // deps contains: { auth, adminOnly, financeiroOnly, semPrecatorios, semRecepcao, pgPool, dbClientes, NAO_DELETADO, find, findOne, insert, update, remove, count, enriquecerCliente, registrarAuditoria, maskCPF, validarCPF, validarCNPJ, gerarParcelas, recalcularResumo, inicializarParcelasLegado }

  app.get("/api/clientes/cpf/:cpf", deps.auth, async (req, res) => {
    const cliente = await deps.findOne(deps.dbClientes, { cpf: req.params.cpf });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    res.json(await deps.enriquecerCliente(cliente));
  });

  app.get("/api/clientes/:id", deps.auth, async (req, res) => {
    const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id, ...deps.NAO_DELETADO });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    res.json(await deps.enriquecerCliente(cliente));
  });

  app.post("/api/clientes", deps.auth, deps.semPrecatorios, async (req, res) => {
    const {
      nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
      valor_beneficio, num_beneficios, valor_contrato, num_parcelas,
    } = req.body;
    if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
    if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
    const digsCliente = (cpf || "").replace(/\D/g, "");
    if (digsCliente.length === 11 && !deps.validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
    if (digsCliente.length === 14 && !deps.validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

    // Calcula valor_contrato: prefere o enviado, senão calcula a partir dos benefícios
    const vBeneficio  = Number(valor_beneficio) || 0;
    const nBeneficios = Number(num_beneficios) || 0;
    const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
    if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });

    const existente = await deps.findOne(deps.dbClientes, { cpf });
    if (existente) return res.status(400).json({ erro: "Já existe um cliente cadastrado com este CPF." });

    const nParcelas = Number(num_parcelas);
    const parcelas  = deps.gerarParcelas(nParcelas, vContrato);
    const resumo    = deps.recalcularResumo(parcelas);

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
      num_parcelas: nParcelas,
      valor_parcela: nParcelas > 0 ? vContrato / nParcelas : 0,
      parcelas,
      ...resumo,
      created_at: new Date().toISOString(),
    });
    res.json(await deps.enriquecerCliente(doc));
  });

  app.put("/api/clientes/:id", deps.auth, deps.semPrecatorios, async (req, res) => {
    const {
      nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
      valor_beneficio, num_beneficios, valor_contrato, num_parcelas, parcelas,
    } = req.body;
    if (!nome || !cpf || !municipio_uf) return res.status(400).json({ erro: "Nome, CPF e Município são obrigatórios." });
    if (!num_parcelas || Number(num_parcelas) <= 0) return res.status(400).json({ erro: "Número de parcelas deve ser maior que zero." });
    const digsEdit = (cpf || "").replace(/\D/g, "");
    if (digsEdit.length === 11 && !deps.validarCPF(cpf)) return res.status(400).json({ erro: "CPF inválido." });
    if (digsEdit.length === 14 && !deps.validarCNPJ(cpf)) return res.status(400).json({ erro: "CNPJ inválido." });

    const vBeneficio  = Number(valor_beneficio) || 0;
    const nBeneficios = Number(num_beneficios) || 0;
    const vContrato   = Number(valor_contrato) || (vBeneficio * nBeneficios) || 0;
    if (vContrato <= 0) return res.status(400).json({ erro: "Valor do contrato deve ser maior que zero." });

    const { rows: dupl } = await deps.pgPool.query(
      "SELECT id FROM clientes WHERE cpf = $1 AND id != $2 AND deletado_em IS NULL LIMIT 1",
      [cpf, req.params.id]
    );
    if (dupl.length > 0) return res.status(400).json({ erro: "CPF já cadastrado em outro cliente." });

    const nParcelas = Number(num_parcelas);
    const atual     = await deps.findOne(deps.dbClientes, { _id: req.params.id });
    if (!atual) return res.status(404).json({ erro: "Cliente não encontrado." });

    // Usa o array de parcelas enviado pelo front; se não veio, mantém o existente ou regenera
    let novasParcelas;
    if (Array.isArray(parcelas) && parcelas.length > 0) {
      novasParcelas = parcelas;
    } else if (atual && Array.isArray(atual.parcelas) && atual.parcelas.length === nParcelas) {
      novasParcelas = atual.parcelas;
    } else {
      // Número de parcelas mudou: regenera preservando as pagas
      const parcelasAntigas = (atual && Array.isArray(atual.parcelas)) ? atual.parcelas : [];
      novasParcelas = deps.gerarParcelas(nParcelas, vContrato).map((p, i) => {
        const antiga = parcelasAntigas[i];
        return antiga ? { ...p, ...antiga, num: p.num, valor: p.valor } : p;
      });
    }

    const resumo = deps.recalcularResumo(novasParcelas);

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
      num_parcelas: nParcelas,
      valor_parcela: nParcelas > 0 ? vContrato / nParcelas : 0,
      parcelas: novasParcelas,
      ...resumo,
    });
    const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
    res.json(await deps.enriquecerCliente(atualizado));
  });

  app.delete("/api/clientes/:id", deps.auth, deps.financeiroOnly, async (req, res) => {
    const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    await deps.update(deps.dbClientes, { _id: req.params.id }, {
      deletado_em: new Date().toISOString(),
      deletado_por: req.user.username,
    });
    deps.registrarAuditoria(req, "excluir_cliente", req.params.id, { nome: cliente.nome, cpf: deps.maskCPF(cliente.cpf) });
    res.json({ ok: true });
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
      const resumo = deps.recalcularResumo(parcelas);
      await deps.update(deps.dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
      const atualizado = await deps.findOne(deps.dbClientes, { _id: req.params.id });
      res.json(await deps.enriquecerCliente(atualizado));
    } catch (e) {
      console.error("Erro ao registrar lembrete:", e.message);
      res.status(500).json({ erro: "Erro ao registrar lembrete." });
    }
  });

  app.patch("/api/clientes/:id/parcela/:num", deps.auth, deps.financeiroOnly, async (req, res) => {
    const cliente = await deps.findOne(deps.dbClientes, { _id: req.params.id });
    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
    const num = Number(req.params.num);
    if (!num || num < 1) return res.status(400).json({ erro: "Número de parcela inválido." });

    // Whitelist de campos aceitos — evita sobrescrever num/valor por engano
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
    const resumo = deps.recalcularResumo(parcelas);
    await deps.update(deps.dbClientes, { _id: req.params.id }, { parcelas, ...resumo });
    if (status !== undefined) {
      deps.registrarAuditoria(req, "atualizar_parcela", req.params.id, { num_parcela: num, status_novo: status });
    }
    const salvo = await deps.findOne(deps.dbClientes, { _id: req.params.id });
    res.json(await deps.enriquecerCliente(salvo));
  });
};
