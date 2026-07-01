const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("filaConfigurada", () => {
  it("retorna false quando QUEUE_URL não está definida", () => {
    const filaConfigurada = () => !!process.env.EXPORT_QUEUE_URL;
    const prev = process.env.EXPORT_QUEUE_URL;
    delete process.env.EXPORT_QUEUE_URL;
    assert.equal(filaConfigurada(), false);
    if (prev) process.env.EXPORT_QUEUE_URL = prev;
  });
});

describe("exportar-zip validations (pure logic)", () => {
  const validarIds = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return "Informe ao menos um ID.";
    if (ids.length > 100) return "Máximo de 100 recibos por exportação.";
    return null;
  };

  it("aceita array com 1 ID", () => assert.equal(validarIds(["abc"]), null));

  it("aceita array com 100 IDs", () => {
    assert.equal(validarIds(Array.from({ length: 100 }, (_, i) => String(i))), null);
  });

  it("rejeita array vazio", () => {
    assert.equal(validarIds([]), "Informe ao menos um ID.");
  });

  it("rejeita null/undefined", () => {
    assert.equal(validarIds(null), "Informe ao menos um ID.");
    assert.equal(validarIds(undefined), "Informe ao menos um ID.");
  });

  it("rejeita mais de 100 IDs", () => {
    assert.equal(validarIds(Array.from({ length: 101 }, (_, i) => String(i))), "Máximo de 100 recibos por exportação.");
  });
});

describe("validarCPF (pure function copiada do server.js)", () => {
  function validarCPF(cpf) {
    const d = cpf.replace(/\D/g, "");
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let s = 0;
    for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
    let r = (s * 10) % 11; if (r >= 10) r = 0;
    if (r !== Number(d[9])) return false;
    s = 0;
    for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
    r = (s * 10) % 11; if (r >= 10) r = 0;
    return r === Number(d[10]);
  }

  it("rejeita CPF com digitos repetidos", () => {
    assert.equal(validarCPF("000.000.000-00"), false);
    assert.equal(validarCPF("111.111.111-11"), false);
  });

  it("rejeita CPF inválido", () => {
    assert.equal(validarCPF("123.456.789-00"), false);
  });

  it("aceita CPF válido", () => {
    assert.equal(validarCPF("529.982.247-25"), true);
  });

  it("rejeita string vazia", () => {
    assert.equal(validarCPF(""), false);
  });
});

describe("validarCNPJ (pure function copiada do server.js)", () => {
  function validarCNPJ(cnpj) {
    const d = cnpj.replace(/\D/g, "");
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const calc = (n) => {
      let s = 0, pos = n - 7;
      for (let i = 0; i < n; i++) { s += Number(d[i]) * pos--; if (pos < 2) pos = 9; }
      const rem = s % 11;
      return rem < 2 ? 0 : 11 - rem;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }

  it("rejeita CNPJ com digitos repetidos", () => {
    assert.equal(validarCNPJ("00.000.000/0000-00"), false);
    assert.equal(validarCNPJ("11.111.111/1111-11"), false);
  });

  it("rejeita CNPJ inválido", () => {
    assert.equal(validarCNPJ("12.345.678/0001-00"), false);
  });

  it("aceita CNPJ válido", () => {
    assert.equal(validarCNPJ("04.470.081/0001-44"), true);
  });

  it("rejeita string vazia", () => {
    assert.equal(validarCNPJ(""), false);
  });
});

describe("gerarParcelas com valorEntrada", () => {
  function gerarParcelas(numParcelas, valorContrato, valorEntrada = 0) {
    const base = valorContrato - valorEntrada;
    const valorParcela = numParcelas > 0 ? base / numParcelas : 0;
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

  it("divide valor liquido quando tem entrada", () => {
    const p = gerarParcelas(5, 6000, 1000);
    assert.equal(p.length, 5);
    p.forEach(parcela => assert.equal(parcela.valor, 1000));
  });

  it("comportamento normal quando entrada e zero", () => {
    const p = gerarParcelas(3, 900, 0);
    assert.equal(p.length, 3);
    p.forEach(parcela => assert.equal(parcela.valor, 300));
  });

  it("comportamento normal sem parametro de entrada", () => {
    const p = gerarParcelas(4, 2000);
    assert.equal(p.length, 4);
    p.forEach(parcela => assert.equal(parcela.valor, 500));
  });

  it("todas com status pendente mesmo com entrada", () => {
    const p = gerarParcelas(3, 3000, 600);
    p.forEach(parcela => assert.equal(parcela.status, "pendente"));
  });
});
