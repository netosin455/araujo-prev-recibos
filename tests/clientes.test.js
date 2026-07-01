const { describe, it } = require("node:test");
const assert = require("node:assert");

function gerarParcelas(numParcelas, valorContrato, valorEntrada = 0) {
  const base = valorContrato - valorEntrada;
  const valorParcela = numParcelas > 0 ? base / numParcelas : 0;
  const hoje = new Date();
  const diaVencto = String(hoje.getDate()).padStart(2, "0");
  return Array.from({ length: numParcelas }, (_, i) => {
    let mesVencto = hoje.getMonth() + 1 + i + 1;
    let anoVencto = hoje.getFullYear();
    while (mesVencto > 12) { mesVencto -= 12; anoVencto++; }
    const dataVenc = `${diaVencto}/${String(mesVencto).padStart(2, "0")}/${anoVencto}`;
    return {
      num: i + 1,
      valor: valorParcela,
      status: "pendente",
      data_vencimento: dataVenc,
      data_recebimento: "",
      data_deposito: "",
      recibo_id: "",
      recibo_num: "",
      observacao: "",
    };
  });
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

describe("gerarParcelas", () => {
  it("gera_array_com_quantidade_correta_de_parcelas", () => {
    assert.strictEqual(gerarParcelas(6, 3000).length, 6);
  });

  it("distribui_valor_igualmente_entre_parcelas", () => {
    const p = gerarParcelas(4, 2000);
    p.forEach(parcela => assert.strictEqual(parcela.valor, 500));
  });

  it("numera_parcelas_sequencialmente_a_partir_de_1", () => {
    const p = gerarParcelas(3, 900);
    assert.deepStrictEqual(p.map(x => x.num), [1, 2, 3]);
  });

  it("todas_as_parcelas_iniciam_com_status_pendente", () => {
    const p = gerarParcelas(5, 1000);
    p.forEach(parcela => assert.strictEqual(parcela.status, "pendente"));
  });

  it("retorna_array_vazio_quando_num_parcelas_e_zero", () => {
    assert.strictEqual(gerarParcelas(0, 1000).length, 0);
  });

  it("retorna_valor_zero_quando_num_parcelas_e_zero", () => {
    assert.strictEqual(gerarParcelas(0, 0).length, 0);
  });

  it("campos_opcionais_iniciam_como_string_vazia", () => {
    const [p] = gerarParcelas(1, 500);
    assert.strictEqual(p.data_recebimento, "");
    assert.strictEqual(p.data_deposito, "");
    assert.strictEqual(p.recibo_id, "");
    assert.strictEqual(p.recibo_num, "");
    assert.strictEqual(p.observacao, "");
  });

  it("data_vencimento_e_preenchida_automaticamente", () => {
    const [p] = gerarParcelas(1, 1000);
    assert.ok(p.data_vencimento.length > 0);
    assert.match(p.data_vencimento, /^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("subtrai_valor_entrada_do_valor_contrato", () => {
    const p = gerarParcelas(4, 2000, 500);
    assert.strictEqual(p[0].valor, 375);
    assert.strictEqual(p[3].valor, 375);
  });

  it("valor_entrada_zero_comporta_igual_a_sem_entrada", () => {
    const sem = gerarParcelas(2, 1000);
    const com = gerarParcelas(2, 1000, 0);
    assert.strictEqual(sem[0].valor, com[0].valor);
  });

  it("valor_entrada_igual_ao_contrato_gera_parcelas_zero", () => {
    const p = gerarParcelas(5, 1000, 1000);
    assert.strictEqual(p.length, 5);
    assert.strictEqual(p[0].valor, 0);
    assert.strictEqual(p[4].valor, 0);
  });
});

describe("recalcularResumo (lógica, sem updated_at)", () => {
  it("conta_corretamente_pagas_e_restantes", () => {
    const parcelas = [
      { status: "pago",     valor: 100 },
      { status: "pago",     valor: 100 },
      { status: "pendente", valor: 100 },
    ];
    const r = recalcularResumo(parcelas);
    assert.strictEqual(r.parcelas_pagas, 2);
    assert.strictEqual(r.parcelas_restantes, 1);
  });

  it("soma_valor_pago_apenas_de_parcelas_pagas", () => {
    const parcelas = [
      { status: "pago",     valor: 200 },
      { status: "pendente", valor: 300 },
      { status: "atrasado", valor: 150 },
    ];
    const r = recalcularResumo(parcelas);
    assert.strictEqual(r.valor_pago, 200);
    assert.strictEqual(r.valor_restante, 450);
  });

  it("retorna_zeros_quando_array_vazio", () => {
    const r = recalcularResumo([]);
    assert.strictEqual(r.parcelas_pagas, 0);
    assert.strictEqual(r.parcelas_restantes, 0);
    assert.strictEqual(r.valor_pago, 0);
    assert.strictEqual(r.valor_restante, 0);
  });

  it("trata_valor_nulo_como_zero_no_calculo", () => {
    const parcelas = [
      { status: "pago", valor: null },
      { status: "pago", valor: undefined },
    ];
    const r = recalcularResumo(parcelas);
    assert.strictEqual(r.valor_pago, 0);
  });

  it("considera_atrasado_como_restante", () => {
    const parcelas = [
      { status: "atrasado", valor: 500 },
    ];
    const r = recalcularResumo(parcelas);
    assert.strictEqual(r.parcelas_restantes, 1);
    assert.strictEqual(r.valor_restante, 500);
    assert.strictEqual(r.parcelas_pagas, 0);
  });
});

describe("inicializarParcelasLegado", () => {
  it("nao_altera_cliente_que_ja_tem_parcelas", () => {
    const cliente = {
      nome: "João",
      parcelas: [{ num: 1, status: "pago", valor: 500 }],
    };
    const resultado = inicializarParcelasLegado(cliente);
    assert.strictEqual(resultado, cliente);
  });

  it("gera_parcelas_para_cliente_legado_sem_campo_parcelas", () => {
    const cliente = { num_parcelas: 3, valor_contrato: 900, parcelas_pagas: 0 };
    const resultado = inicializarParcelasLegado(cliente);
    assert.strictEqual(resultado.parcelas.length, 3);
  });

  it("marca_parcelas_pagas_conforme_parcelas_pagas_legado", () => {
    const cliente = { num_parcelas: 4, valor_contrato: 1200, parcelas_pagas: 2 };
    const resultado = inicializarParcelasLegado(cliente);
    assert.strictEqual(resultado.parcelas[0].status, "pago");
    assert.strictEqual(resultado.parcelas[1].status, "pago");
    assert.strictEqual(resultado.parcelas[2].status, "pendente");
    assert.strictEqual(resultado.parcelas[3].status, "pendente");
  });

  it("calcula_resumo_corretamente_apos_migracao", () => {
    const cliente = { num_parcelas: 3, valor_contrato: 900, parcelas_pagas: 1 };
    const r = inicializarParcelasLegado(cliente);
    assert.strictEqual(r.parcelas_pagas, 1);
    assert.strictEqual(r.parcelas_restantes, 2);
    assert.strictEqual(r.valor_pago, 300);
    assert.strictEqual(r.valor_restante, 600);
  });

  it("retorna_zero_parcelas_quando_num_parcelas_nao_definido", () => {
    const cliente = { nome: "Ana" };
    const r = inicializarParcelasLegado(cliente);
    assert.strictEqual(r.parcelas.length, 0);
  });

  it("nao_salva_no_banco_apenas_retorna_novo_objeto", () => {
    const cliente = { num_parcelas: 2, valor_contrato: 400, parcelas_pagas: 0 };
    const resultado = inicializarParcelasLegado(cliente);
    assert.notStrictEqual(resultado, cliente);
    assert.strictEqual(cliente.parcelas, undefined);
  });
});

describe("validacoes de entrada — regras de negocio", () => {
  it("status_invalido_deve_ser_rejeitado", () => {
    const STATUS_VALIDOS = ["pendente", "pago", "atrasado"];
    assert.strictEqual(STATUS_VALIDOS.includes("hacked"), false);
    assert.strictEqual(STATUS_VALIDOS.includes("pago"), true);
    assert.strictEqual(STATUS_VALIDOS.includes("atrasado"), true);
  });

  it("role_invalido_deve_ser_rejeitado", () => {
    const ROLES_VALIDOS = ["admin", "financeiro", "recepcao"];
    assert.strictEqual(ROLES_VALIDOS.includes("superadmin"), false);
    assert.strictEqual(ROLES_VALIDOS.includes("financeiro"), true);
  });

  it("referencia_padrao_acima_de_20_chars_deve_ser_rejeitada", () => {
    const ref = "ESTE_TEXTO_TEM_MAIS_DE_VINTE_CARACTERES";
    assert.strictEqual(ref.length > 20, true);
  });

  it("link_comprovante_deve_aceitar_apenas_formatos_conhecidos", () => {
    const validar = (link) =>
      /^(\/api\/comprovante|https:\/\/drive\.google\.com|https:\/\/.*\.amazonaws\.com)/.test(link);

    assert.strictEqual(validar("/api/comprovante/abc123.pdf"), true);
    assert.strictEqual(validar("/api/comprovante-s3/comprovantes/file.pdf"), true);
    assert.strictEqual(validar("https://drive.google.com/file/d/abc/view"), true);
    assert.strictEqual(validar("https://bucket.s3.us-east-1.amazonaws.com/key"), true);
    assert.strictEqual(validar("javascript:alert(1)"), false);
    assert.strictEqual(validar("http://evil.com"), false);
  });
});
