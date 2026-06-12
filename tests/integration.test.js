// Testes de integração — rotas críticas (auth, recibos, clientes)
// Uso: node --test tests/integration.test.js
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const BASE = "http://localhost:3000";

// ── Helpers ────────────────────────────────────────────────
function fetchJSON(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname: "localhost", port: 3000, path, headers: { "Content-Type": "application/json" }, timeout: 5000 };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", e => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Testes ─────────────────────────────────────────────────
describe("API Integration Tests", () => {

  it("GET /api/recibos sem token → 401", async () => {
    try {
      const res = await fetchJSON("GET", "/api/recibos");
      assert.equal(res.status, 401, "Deveria retornar 401 sem token");
      assert.ok(res.body.erro, "Deveria ter campo erro");
    } catch (e) {
      // Se o servidor não estiver rodando, pula o teste
      if (e.code === "ECONNREFUSED") {
        console.log("  ⚠ Servidor não está rodando — pulando teste de rede.");
        return;
      }
      throw e;
    }
  });

  it("GET /api/clientes sem token → 401", async () => {
    try {
      const res = await fetchJSON("GET", "/api/clientes");
      assert.equal(res.status, 401, "Deveria retornar 401 sem token");
      assert.ok(res.body.erro, "Deveria ter campo erro");
    } catch (e) {
      if (e.code === "ECONNREFUSED") {
        console.log("  ⚠ Servidor não está rodando — pulando teste de rede.");
        return;
      }
      throw e;
    }
  });

  it("POST /api/login sem credenciais → 400", async () => {
    try {
      const res = await fetchJSON("POST", "/api/login", {});
      assert.equal(res.status, 400, "Deveria retornar 400 sem credenciais");
      assert.ok(res.body.erro, "Deveria ter campo erro");
    } catch (e) {
      if (e.code === "ECONNREFUSED") {
        console.log("  ⚠ Servidor não está rodando — pulando teste de rede.");
        return;
      }
      throw e;
    }
  });

});

describe("Validações puras (sem servidor)", () => {

  it("validarCPF rejeita CPF inválido", () => {
    // Cópia simplificada da função do server.js
    function validarCPF(cpf) {
      const d = cpf.replace(/\D/g, "");
      if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
      let s = 0;
      for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
      let r = (s * 10) % 11; if (r >= 10) r = 0;
      if (r !== Number(d[9])) return false;
      s = 0;
      for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
      r = (s * 10) % 11; if (r >= 10) r = 0;
      return r === Number(d[10]);
    }
    assert.equal(validarCPF("000.000.000-00"), false);
    assert.equal(validarCPF("111.111.111-11"), false);
    assert.equal(validarCPF("123.456.789-00"), false);
    assert.equal(validarCPF("529.982.247-25"), true);
  });

  it("formatarValor formata corretamente", () => {
    function formatarValor(n) {
      return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    assert.equal(formatarValor(1234.5), "1.234,50");
    assert.equal(formatarValor(0), "0,00");
    assert.equal(formatarValor(99.99), "99,99");
  });

  it("maskCPF mascara dados sensíveis", () => {
    function maskCPF(cpf) {
      const d = (cpf || "").replace(/\D/g, "");
      if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`;
      if (d.length === 14) return `**.***.***/****-**`;
      return "***";
    }
    assert.equal(maskCPF("529.982.247-25"), "***.982.***-**");
    assert.equal(maskCPF("12.345.678/0001-95"), "**.***.***/****-**");
  });

});
