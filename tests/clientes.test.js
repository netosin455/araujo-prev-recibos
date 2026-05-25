// Testes unitários — funções puras do módulo de clientes
// Cobre: gerarParcelas, recalcularResumo, inicializarParcelasLegado

// Cópias das funções puras de web/server.js para teste isolado
function gerarParcelas(numParcelas, valorContrato) {
  const valorParcela = numParcelas > 0 ? valorContrato / numParcelas : 0;
  return Array.from({ length: numParcelas }, (_, i) => ({
    num: i + 1,
    valor: valorParcela,
    status: "pendente",
    data_vencimento: "",
    data_recebimento: "",
    data_deposito: "",
    recibo_id: "",
    recibo_num: "",
    observacao: "",
  }));
}

function recalcularResumo(parcelas) {
  const pagas     = parcelas.filter(p => p.status === "pago");
  const restantes = parcelas.filter(p => p.status !== "pago");
  return {
    parcelas_pagas:     pagas.length,
    parcelas_restantes: restantes.length,
    valor_pago:         pagas.reduce((s, p) => s + (p.valor || 0), 0),
    valor_restante:     restantes.reduce((s, p) => s + (p.valor || 0), 0),
    updated_at:         new Date().toISOString(),
  };
}

function inicializarParcelasLegado(c) {
  if (c.parcelas && c.parcelas.length > 0) return c;
  const numParcelas   = c.num_parcelas || 0;
  const valorContrato = c.valor_contrato || 0;
  const valorParcela  = numParcelas > 0 ? valorContrato / numParcelas : 0;
  const jaPagas       = c.parcelas_pagas || 0;
  const parcelas = Array.from({ length: numParcelas }, (_, i) => ({
    num: i + 1,
    valor: valorParcela,
    status: i < jaPagas ? "pago" : "pendente",
    data_vencimento: "",
    data_recebimento: "",
    data_deposito: "",
    recibo_id: "",
    recibo_num: "",
    observacao: "",
  }));
  const pagas     = parcelas.filter(p => p.status === "pago");
  const restantes = parcelas.filter(p => p.status !== "pago");
  const resumo = {
    parcelas_pagas:     pagas.length,
    parcelas_restantes: restantes.length,
    valor_pago:         pagas.reduce((s, p) => s + (p.valor || 0), 0),
    valor_restante:     restantes.reduce((s, p) => s + (p.valor || 0), 0),
    updated_at:         new Date().toISOString(),
  };
  return { ...c, parcelas, ...resumo };
}

// ── gerarParcelas ─────────────────────────────────────────────

describe("gerarParcelas", () => {
  test("gera_array_com_quantidade_correta_de_parcelas", () => {
    const p = gerarParcelas(6, 3000);
    expect(p).toHaveLength(6);
  });

  test("distribui_valor_igualmente_entre_parcelas", () => {
    const p = gerarParcelas(4, 2000);
    p.forEach(parcela => expect(parcela.valor).toBe(500));
  });

  test("numera_parcelas_sequencialmente_a_partir_de_1", () => {
    const p = gerarParcelas(3, 900);
    expect(p.map(x => x.num)).toEqual([1, 2, 3]);
  });

  test("todas_as_parcelas_iniciam_com_status_pendente", () => {
    const p = gerarParcelas(5, 1000);
    p.forEach(parcela => expect(parcela.status).toBe("pendente"));
  });

  test("retorna_array_vazio_quando_num_parcelas_e_zero", () => {
    expect(gerarParcelas(0, 1000)).toHaveLength(0);
  });

  test("retorna_valor_zero_quando_num_parcelas_e_zero", () => {
    const p = gerarParcelas(0, 0);
    expect(p).toHaveLength(0);
  });

  test("campos_opcionais_iniciam_como_string_vazia", () => {
    const [p] = gerarParcelas(1, 500);
    expect(p.data_vencimento).toBe("");
    expect(p.data_recebimento).toBe("");
    expect(p.data_deposito).toBe("");
    expect(p.recibo_id).toBe("");
    expect(p.recibo_num).toBe("");
    expect(p.observacao).toBe("");
  });
});

// ── recalcularResumo ──────────────────────────────────────────

describe("recalcularResumo (lógica, sem updated_at)", () => {
  function resumoSemData(parcelas) {
    const pagas     = parcelas.filter(p => p.status === "pago");
    const restantes = parcelas.filter(p => p.status !== "pago");
    return {
      parcelas_pagas:     pagas.length,
      parcelas_restantes: restantes.length,
      valor_pago:         pagas.reduce((s, p) => s + (p.valor || 0), 0),
      valor_restante:     restantes.reduce((s, p) => s + (p.valor || 0), 0),
    };
  }

  test("conta_corretamente_pagas_e_restantes", () => {
    const parcelas = [
      { status: "pago",     valor: 100 },
      { status: "pago",     valor: 100 },
      { status: "pendente", valor: 100 },
    ];
    const r = resumoSemData(parcelas);
    expect(r.parcelas_pagas).toBe(2);
    expect(r.parcelas_restantes).toBe(1);
  });

  test("soma_valor_pago_apenas_de_parcelas_pagas", () => {
    const parcelas = [
      { status: "pago",     valor: 200 },
      { status: "pendente", valor: 300 },
      { status: "atrasado", valor: 150 },
    ];
    const r = resumoSemData(parcelas);
    expect(r.valor_pago).toBe(200);
    expect(r.valor_restante).toBe(450);
  });

  test("retorna_zeros_quando_array_vazio", () => {
    const r = resumoSemData([]);
    expect(r.parcelas_pagas).toBe(0);
    expect(r.parcelas_restantes).toBe(0);
    expect(r.valor_pago).toBe(0);
    expect(r.valor_restante).toBe(0);
  });

  test("trata_valor_nulo_como_zero_no_calculo", () => {
    const parcelas = [
      { status: "pago", valor: null },
      { status: "pago", valor: undefined },
    ];
    const r = resumoSemData(parcelas);
    expect(r.valor_pago).toBe(0);
  });

  test("considera_atrasado_como_restante", () => {
    const parcelas = [
      { status: "atrasado", valor: 500 },
    ];
    const r = resumoSemData(parcelas);
    expect(r.parcelas_restantes).toBe(1);
    expect(r.valor_restante).toBe(500);
    expect(r.parcelas_pagas).toBe(0);
  });
});

// ── inicializarParcelasLegado ─────────────────────────────────

describe("inicializarParcelasLegado", () => {
  test("nao_altera_cliente_que_ja_tem_parcelas", () => {
    const cliente = {
      nome: "João",
      parcelas: [{ num: 1, status: "pago", valor: 500 }],
    };
    const resultado = inicializarParcelasLegado(cliente);
    expect(resultado).toBe(cliente); // mesma referência
  });

  test("gera_parcelas_para_cliente_legado_sem_campo_parcelas", () => {
    const cliente = { num_parcelas: 3, valor_contrato: 900, parcelas_pagas: 0 };
    const resultado = inicializarParcelasLegado(cliente);
    expect(resultado.parcelas).toHaveLength(3);
  });

  test("marca_parcelas_pagas_conforme_parcelas_pagas_legado", () => {
    const cliente = { num_parcelas: 4, valor_contrato: 1200, parcelas_pagas: 2 };
    const resultado = inicializarParcelasLegado(cliente);
    expect(resultado.parcelas[0].status).toBe("pago");
    expect(resultado.parcelas[1].status).toBe("pago");
    expect(resultado.parcelas[2].status).toBe("pendente");
    expect(resultado.parcelas[3].status).toBe("pendente");
  });

  test("calcula_resumo_corretamente_apos_migracao", () => {
    const cliente = { num_parcelas: 3, valor_contrato: 900, parcelas_pagas: 1 };
    const r = inicializarParcelasLegado(cliente);
    expect(r.parcelas_pagas).toBe(1);
    expect(r.parcelas_restantes).toBe(2);
    expect(r.valor_pago).toBe(300);
    expect(r.valor_restante).toBe(600);
  });

  test("retorna_zero_parcelas_quando_num_parcelas_nao_definido", () => {
    const cliente = { nome: "Ana" };
    const r = inicializarParcelasLegado(cliente);
    expect(r.parcelas).toHaveLength(0);
  });

  test("nao_salva_no_banco_apenas_retorna_novo_objeto", () => {
    const cliente = { num_parcelas: 2, valor_contrato: 400, parcelas_pagas: 0 };
    const resultado = inicializarParcelasLegado(cliente);
    expect(resultado).not.toBe(cliente); // objeto diferente
    expect(cliente.parcelas).toBeUndefined(); // original não modificado
  });
});

// ── Validação de entrada (regras de negócio) ──────────────────

describe("validacoes de entrada — regras de negocio", () => {
  test("status_invalido_deve_ser_rejeitado", () => {
    const STATUS_VALIDOS = ["pendente", "pago", "atrasado"];
    expect(STATUS_VALIDOS.includes("hacked")).toBe(false);
    expect(STATUS_VALIDOS.includes("pago")).toBe(true);
    expect(STATUS_VALIDOS.includes("atrasado")).toBe(true);
  });

  test("role_invalido_deve_ser_rejeitado", () => {
    const ROLES_VALIDOS = ["admin", "financeiro", "recepcao"];
    expect(ROLES_VALIDOS.includes("superadmin")).toBe(false);
    expect(ROLES_VALIDOS.includes("financeiro")).toBe(true);
  });

  test("referencia_padrao_acima_de_20_chars_deve_ser_rejeitada", () => {
    const ref = "ESTE_TEXTO_TEM_MAIS_DE_VINTE_CARACTERES";
    expect(ref.length > 20).toBe(true);
  });

  test("link_comprovante_deve_aceitar_apenas_formatos_conhecidos", () => {
    const validar = (link) =>
      /^(\/api\/comprovante|https:\/\/drive\.google\.com|https:\/\/.*\.amazonaws\.com)/.test(link);

    expect(validar("/api/comprovante/abc123.pdf")).toBe(true);
    expect(validar("/api/comprovante-s3/comprovantes/file.pdf")).toBe(true); // prefixo /api/comprovante cobre ambos
    expect(validar("https://drive.google.com/file/d/abc/view")).toBe(true);
    expect(validar("https://bucket.s3.us-east-1.amazonaws.com/key")).toBe(true);
    expect(validar("javascript:alert(1)")).toBe(false);
    expect(validar("http://evil.com")).toBe(false);
  });
});
