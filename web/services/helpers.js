// ============================================================
// services/helpers.js — Funções auxiliares puras (sem I/O)
// Extraídas de server.js na Fase 1 da refatoração.
// Código movido byte a byte — comportamento preservado.
// ============================================================

function maskCPF(cpf) {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`;
  if (d.length === 14) return `**.***.***/****-**`;
  return "***";
}

function parseBRL(str) {
  return parseFloat(String(str || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

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

function recalcularResumo(parcelas, baseContrato) {
  const temBase = baseContrato !== undefined && baseContrato !== null;
  const base = numeroSeguro(baseContrato);
  if (!Array.isArray(parcelas) || parcelas.length === 0) {
    return { parcelas_pagas: 0, parcelas_restantes: 0, valor_pago: 0, valor_restante: temBase ? base : 0, updated_at: new Date().toISOString() };
  }
  const pagas     = parcelas.filter(p => p.status === "pago");
  const restantes = parcelas.filter(p => p.status !== "pago");
  const valor_pago = pagas.reduce((s, p) => s + numeroSeguro(p.valor), 0);
  // Com o contrato base informado, "falta receber" = contrato - pago (reflete o
  // dinheiro REAL: se o cliente pagou menos numa parcela, o restante sobe). Sem
  // base, mantém o comportamento antigo (soma das parcelas não pagas).
  const valor_restante = temBase
    ? Math.max(0, base - valor_pago)
    : restantes.reduce((s, p) => s + numeroSeguro(p.valor), 0);
  return {
    parcelas_pagas:     pagas.length,
    parcelas_restantes: restantes.length,
    valor_pago,
    valor_restante,
    updated_at:         new Date().toISOString(),
  };
}

// (NAO_DELETADO declarado perto do topo â€” ver inÃ­cio do arquivo)

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

// Converte "DD/MM/YYYY" â†’ "YYYY-MM" para filtros de mÃªs
function mesDeData(dataStr) {
  if (!dataStr) return null;
  const parts = String(dataStr).split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}/.test(dataStr)) return dataStr.slice(0, 7);
  return null;
}

// MigraÃ§Ã£o on-the-fly: clientes sem campo parcelas recebem array inicializado
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
  const resumo = recalcularResumo(parcelas, valorContrato);
  return { ...c, parcelas, ...resumo };
}

// Converte valor para NÚMERO aceitando os dois formatos que circulam no sistema:
// SQL "6000.00" (ponto = decimal) e BR "1.518,00" (ponto = milhar, vírgula = decimal).
// Sem isso, somar valores de cliente concatenava texto e inflava os totais.
function numeroSeguro(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

// Converte "DD/MM/YYYY" -> "YYYY-MM-DD" para comparar datas de forma correta
// (comparar formatos diferentes marcava parcelas como atrasadas erradamente).
function vencimentoParaISO(dv) {
  const s = String(dv || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

async function enriquecerCliente(c) {
  const cliente = inicializarParcelasLegado(c);
  const vContrato = numeroSeguro(cliente.valor_contrato);
  const vEntrada = numeroSeguro(cliente.valor_entrada);
  const base = vContrato - vEntrada;
  const valorParcela = cliente.num_parcelas > 0 ? base / cliente.num_parcelas : 0;
  const hoje = new Date().toISOString().slice(0, 10);
  const parcelas = (cliente.parcelas || []).map(p => {
    const pn = { ...p, valor: numeroSeguro(p.valor) };
    const venc = vencimentoParaISO(pn.data_vencimento);
    if (pn.status === "pendente" && venc && venc < hoje) pn.status = "atrasado";
    return pn;
  });
  return {
    ...cliente,
    parcelas,
    id: cliente._id,
    valor_contrato: vContrato,
    valor_entrada: vEntrada,
    valor_beneficio: numeroSeguro(cliente.valor_beneficio),
    valor_pago: numeroSeguro(cliente.valor_pago),
    valor_restante: numeroSeguro(cliente.valor_restante),
    valor_parcela: valorParcela,
  };
}

// â”€â”€ NORMALIZAR CAMPOS LIVRES (escritÃ³rio + forma de pagamento) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizarEscritorio(raw) {
  const v = (raw || "").trim().toUpperCase().replace(/[-/,]+/g, " ").replace(/\s+/g, " ").trim();
  if (v.includes("TERRA RICA"))              return "Terra Rica - PR";
  if (v.includes("TEODORO"))                 return "Teodoro Sampaio - SP";
  if (v.includes("PRESIDENTE VENCESLAU") ||
      v.includes("PRES VENCESLAU"))          return "Presidente Venceslau - SP";
  if (v.includes("PRIMAVERA"))               return "Primavera - SP";
  if (v.includes("IVINHEMA"))                return "Ivinhema - MS";
  return raw;
}

function normalizarFormaPagamento(raw) {
  const v = (raw || "").trim().toUpperCase().replace(/[^A-ZÃÃ‰ÃÃ“ÃšÃƒÃ•Ã‚ÃŠÃ”Ã‡0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (v === "PIX" || v === "PÃŒX")            return "Pix";
  if (v.includes("LOTÃ‰RIC") ||
      v.includes("LOTERIC"))                 return "DepÃ³sito lotÃ©rica";
  if (v.includes("CAIXA"))                   return "DepÃ³sito caixa";
  if (v.includes("BB"))                      return "DepÃ³sito BB";
  if (v === "TED")                           return "TED";
  if (v.includes("TRANSFER"))               return "TransferÃªncia bancÃ¡ria";
  if (v.includes("DINHEIRO"))               return "Dinheiro";
  if (v.includes("CHEQUE"))                 return "Cheque";
  return raw;
}

// Validação leve de payload: os campos listados, quando presentes, precisam ser
// string ou número dentro do tamanho — barra objeto/array (dado sujo ou injeção)
// antes de chegar no banco. Retorna o nome do primeiro campo inválido, ou null.
function campoTextoInvalido(body, campos, maxLen = 300) {
  if (!body || typeof body !== "object") return "(payload)";
  for (const campo of campos) {
    const v = body[campo];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" && typeof v !== "number") return campo;
    if (typeof v === "string" && v.length > maxLen) return campo;
  }
  return null;
}

module.exports = {
  maskCPF,
  parseBRL,
  campoTextoInvalido,
  numeroSeguro,
  vencimentoParaISO,
  mesDeData,
  gerarParcelas,
  recalcularResumo,
  validarCPF,
  validarCNPJ,
  inicializarParcelasLegado,
  enriquecerCliente,
  normalizarEscritorio,
  normalizarFormaPagamento,
};
