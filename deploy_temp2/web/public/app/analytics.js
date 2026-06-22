// web/public/app/analytics.js — extracted from app.js
// ── ANALYTICS ─────────────────────────────────────────────
const CORES_GRAFICO = [
  "rgba(184,151,58,0.8)","rgba(61,122,94,0.8)","rgba(139,46,46,0.8)",
  "rgba(91,136,179,0.8)","rgba(168,98,168,0.8)","rgba(86,175,129,0.8)",
  "rgba(230,140,60,0.8)","rgba(80,80,180,0.8)","rgba(190,80,110,0.8)",
];

function _periodoMeses() {
  const meses = [...new Set(
    historicoRecibos.map(r => {
      const p = r.data?.split("/");
      return p && p.length === 3 ? `${p[2]}-${p[1]}` : null;
    }).filter(Boolean)
  )].sort();
  return meses;
}

function carregarAnalytics() {
  const meses = _periodoMeses();
  const anoAtual = String(new Date().getFullYear());
  const mesAtualStr = `${anoAtual}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const primeiroDoAno = `${anoAtual}-01`;

  const populaSel = (id, valorDefault) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">—</option>` + meses.map(m => {
      const [ano, mes] = m.split("-");
      const label = `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+mes-1]}/${ano}`;
      return `<option value="${m}">${label}</option>`;
    }).join("");
    if (prev && meses.includes(prev)) sel.value = prev;
    else if (meses.includes(valorDefault)) sel.value = valorDefault;
    else if (meses.length) sel.value = meses[meses.length - 1];
  };

  populaSel("analytics-de", primeiroDoAno);
  populaSel("analytics-ate", mesAtualStr);
  _renderAnalytics();
}

function _filtrarPorPeriodo() {
  const de  = document.getElementById("analytics-de")?.value  || "";
  const ate = document.getElementById("analytics-ate")?.value || "";
  return historicoRecibos.filter(r => {
    const p = r.data?.split("/");
    if (!p || p.length < 3) return false;
    const ym = `${p[2]}-${p[1]}`;
    if (de  && ym < de)  return false;
    if (ate && ym > ate) return false;
    return true;
  });
}

function _renderAnalytics() {
  const recibos = _filtrarPorPeriodo();
  const de  = document.getElementById("analytics-de")?.value  || "";
  const ate = document.getElementById("analytics-ate")?.value || "";

  const fmtMes = ym => {
    if (!ym) return "—";
    const [ano, m] = ym.split("-");
    return `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]}/${ano}`;
  };
  const label = document.getElementById("analytics-periodo-label");
  if (label) label.textContent = `${fmtMes(de)} → ${fmtMes(ate)} · ${recibos.length} recibo${recibos.length !== 1 ? "s" : ""}`;

  // ── Gráfico mensal (período)
  const mesesDoRange = [];
  if (de && ate) {
    let cur = de;
    while (cur <= ate) {
      mesesDoRange.push(cur);
      const [ano, mes] = cur.split("-").map(Number);
      const next = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
      cur = next;
      if (mesesDoRange.length > 60) break;
    }
  } else {
    const meses = _periodoMeses();
    mesesDoRange.push(...meses);
  }
  const labelsGraf = mesesDoRange.map(ym => {
    const [ano, m] = ym.split("-");
    return `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]}/${ano.slice(2)}`;
  });
  const valoresGraf = mesesDoRange.map(ym => {
    const [ano, m] = ym.split("-");
    return recibos.filter(r => {
      const p = r.data?.split("/");
      return p && p[2] === ano && p[1] === m;
    }).reduce((s, r) => s + valorParaNumero(r.valor), 0);
  });

  if (graficoAnalyticsMensal) { try { graficoAnalyticsMensal.destroy(); } catch(e){} graficoAnalyticsMensal = null; }
  requestAnimationFrame(() => {
    try {
      const ctx = document.getElementById("grafico-analytics-mensal")?.getContext("2d");
      if (ctx) graficoAnalyticsMensal = new Chart(ctx, {
        type: "bar",
        data: { labels: labelsGraf, datasets: [{ label: "Receita", data: valoresGraf, backgroundColor: "rgba(184,151,58,0.7)", borderColor: "#b8973a", borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => "R$ " + formatarValor(v) } } } }
      });
    } catch(e) { console.error("Analytics chart error:", e); }
  });

  // ── Ranking por cliente
  const porCliente = {};
  recibos.forEach(r => {
    if (!r.nome) return;
    if (!porCliente[r.nome]) porCliente[r.nome] = { total: 0, qtd: 0 };
    porCliente[r.nome].total += valorParaNumero(r.valor);
    porCliente[r.nome].qtd++;
  });
  const ranking = Object.entries(porCliente)
    .map(([nome, d]) => ({ nome, total: d.total, qtd: d.qtd, ticket: d.qtd ? d.total / d.qtd : 0 }))
    .sort((a, b) => b.total - a.total);

  const top5 = ranking.slice(0, 5);
  const maxVal = top5.length ? top5[0].total : 1;
  const top5el = document.getElementById("analytics-top5");
  if (top5el) {
    top5el.innerHTML = top5.length ? top5.map((c, i) => `
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-weight:600;font-size:13px">${i + 1}. ${esc(c.nome)}</span>
          <span style="color:var(--success);font-weight:700;font-size:13px">R$ ${formatarValor(c.total)}</span>
        </div>
        <div style="background:var(--border);border-radius:4px;height:7px">
          <div style="background:var(--gold,#b8973a);border-radius:4px;height:7px;width:${Math.round(c.total / maxVal * 100)}%;transition:width 0.4s"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${c.qtd} recibo${c.qtd !== 1 ? "s" : ""} · ticket R$ ${formatarValor(c.ticket)}</div>
      </div>`).join("")
      : '<p style="color:var(--muted);font-size:13px">Nenhum dado no período.</p>';
  }

  const totalGeral = ranking.reduce((s, c) => s + c.total, 0);
  const ticketGlobal = recibos.length ? totalGeral / recibos.length : 0;
  const resumoEl = document.getElementById("analytics-resumo");
  if (resumoEl) {
    resumoEl.innerHTML = [
      { label: "Clientes distintos",  value: ranking.length },
      { label: "Receita total",        value: `R$ ${formatarValor(totalGeral)}` },
      { label: "Ticket médio global",  value: `R$ ${formatarValor(ticketGlobal)}` },
      { label: "Maior cliente",        value: top5.length ? esc(top5[0].nome) : "—" },
    ].map(item => `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--muted)">${item.label}</span>
        <span style="font-weight:700;font-size:13px">${item.value}</span>
      </div>`).join("");
  }

  const ticketEl = document.getElementById("analytics-ticket-tbody");
  if (ticketEl) {
    ticketEl.innerHTML = ranking.length ? ranking.slice(0, 30).map((c, i) => `
      <tr>
        <td style="color:var(--muted);font-weight:600">${i + 1}</td>
        <td>${esc(c.nome)}</td><td>${c.qtd}</td>
        <td style="color:var(--success);font-weight:700">R$ ${formatarValor(c.total)}</td>
        <td style="font-weight:600">R$ ${formatarValor(c.ticket)}</td>
      </tr>`).join("")
      : '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">Nenhum dado.</td></tr>';
  }

  _renderPorResponsavel(recibos);
  _renderFormasPagamento(recibos);
  _renderGraficoMultiAno();
}

function _renderPorResponsavel(recibos) {
  const mapa = {};
  recibos.forEach(r => {
    const resp = (r.emitido_por || "").trim() || "(não informado)";
    if (!mapa[resp]) mapa[resp] = { total: 0, qtd: 0 };
    mapa[resp].total += valorParaNumero(r.valor);
    mapa[resp].qtd++;
  });
  const dados = Object.entries(mapa)
    .map(([nome, d]) => ({ nome, total: d.total, qtd: d.qtd, ticket: d.qtd ? d.total / d.qtd : 0 }))
    .sort((a, b) => b.total - a.total);

  const status = document.getElementById("responsavel-status");
  if (!dados.length) {
    if (status) { status.style.display = ""; status.textContent = "Nenhum dado no período."; }
    if (graficoResponsavel) { graficoResponsavel.destroy(); graficoResponsavel = null; }
    return;
  }
  if (status) status.style.display = "none";

  if (graficoResponsavel) { try { graficoResponsavel.destroy(); } catch(e){} graficoResponsavel = null; }
  requestAnimationFrame(() => {
    try {
      const ctx = document.getElementById("grafico-responsavel")?.getContext("2d");
      if (ctx) graficoResponsavel = new Chart(ctx, {
        type: "bar",
        data: {
          labels: dados.map(d => d.nome),
          datasets: [{
            label: "Receita",
            data: dados.map(d => d.total),
            backgroundColor: dados.map((_, i) => CORES_GRAFICO[i % CORES_GRAFICO.length]),
            borderRadius: 4,
          }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { callback: v => "R$ " + formatarValor(v) } } }
        }
      });
    } catch(e) { console.error("Responsavel chart error:", e); }
  });
}

function _renderFormasPagamento(recibos) {
  const mapa = {};
  let totalReceita = 0;
  recibos.forEach(r => {
    const forma = (r.forma_pagamento || "").trim() || "(não informado)";
    const val = valorParaNumero(r.valor);
    if (!mapa[forma]) mapa[forma] = { total: 0, qtd: 0 };
    mapa[forma].total += val;
    mapa[forma].qtd++;
    totalReceita += val;
  });
  const dados = Object.entries(mapa)
    .map(([forma, d]) => ({ forma, total: d.total, qtd: d.qtd, pct: totalReceita ? Math.round(d.total / totalReceita * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);

  const status = document.getElementById("formas-pag-status");
  if (!dados.length) {
    if (status) { status.style.display = ""; status.textContent = "Nenhum dado no período."; }
    if (graficoFormasPag) { graficoFormasPag.destroy(); graficoFormasPag = null; }
    return;
  }
  if (status) status.style.display = "none";

  if (graficoFormasPag) { try { graficoFormasPag.destroy(); } catch(e){} graficoFormasPag = null; }
  requestAnimationFrame(() => {
    try {
      const ctx = document.getElementById("grafico-formas-pag")?.getContext("2d");
      if (ctx) graficoFormasPag = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: dados.map(d => d.forma),
          datasets: [{ data: dados.map(d => d.total), backgroundColor: CORES_GRAFICO.slice(0, dados.length), borderWidth: 2 }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: R$ ${formatarValor(ctx.raw)} (${dados[ctx.dataIndex]?.pct}%)` } }
          }
        }
      });
    } catch(e) { console.error("FormasPag chart error:", e); }
  });

  const legenda = document.getElementById("formas-pag-legenda");
  if (legenda) {
    legenda.innerHTML = dados.map((d, i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px">
        <div style="width:12px;height:12px;border-radius:2px;background:${CORES_GRAFICO[i % CORES_GRAFICO.length]};flex-shrink:0"></div>
        <span style="flex:1">${esc(d.forma)}</span>
        <span style="color:var(--success);font-weight:700">R$ ${formatarValor(d.total)}</span>
        <span style="color:var(--muted)">${d.pct}%</span>
      </div>`).join("");
  }
}

// ── GRÁFICO MULTI-ANO ──────────────────────────────────────
function _renderGraficoMultiAno() {
  const anos = [...new Set(historicoRecibos.map(r => r.data?.split("/")[2]).filter(Boolean))].sort();
  const MESES_LABEL = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const COR_LINHA = [
    { border: "#b8973a", bg: "rgba(184,151,58,0.12)" },
    { border: "#3d7a5e", bg: "rgba(61,122,94,0.12)" },
    { border: "#5b88b3", bg: "rgba(91,136,179,0.12)" },
    { border: "#8b2e2e", bg: "rgba(139,46,46,0.12)" },
    { border: "#a862a8", bg: "rgba(168,98,168,0.12)" },
  ];

  const datasets = anos.map((ano, idx) => {
    const cor = COR_LINHA[idx % COR_LINHA.length];
    const data = Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, "0");
      return historicoRecibos
        .filter(r => { const p = r.data?.split("/"); return p && p[2] === ano && p[1] === m; })
        .reduce((s, r) => s + valorParaNumero(r.valor), 0);
    });
    return { label: ano, data, borderColor: cor.border, backgroundColor: cor.bg, borderWidth: 2, tension: 0.3, fill: true, pointRadius: 3 };
  });

  if (graficoMultiAno) { try { graficoMultiAno.destroy(); } catch(e){} graficoMultiAno = null; }
  const ctx = document.getElementById("grafico-multi-ano")?.getContext("2d");
  if (!ctx || !datasets.length) return;

  graficoMultiAno = new Chart(ctx, {
    type: "line",
    data: { labels: MESES_LABEL, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => "R$ " + formatarValor(v) } } }
    }
  });

  const legenda = document.getElementById("multi-ano-legenda");
  if (legenda) {
    legenda.innerHTML = anos.map((ano, i) => {
      const cor = COR_LINHA[i % COR_LINHA.length];
      const total = datasets[i].data.reduce((s, v) => s + v, 0);
      return `<span style="display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:14px;height:3px;background:${cor.border};border-radius:2px"></span>
        <strong>${ano}</strong> R$ ${formatarValor(total)}
      </span>`;
    }).join("");
  }
}

// ── DRE SIMPLIFICADO ───────────────────────────────────────
function carregarDRE() {
  const sel = document.getElementById("dre-ano");
  if (sel) {
    const anos = [...new Set(historicoRecibos.map(r => r.data?.split("/")[2]).filter(Boolean))].sort((a, b) => b - a);
    const anoAtual = String(new Date().getFullYear());
    const prev = sel.value;
    sel.innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join("");
    if (prev && anos.includes(prev)) sel.value = prev;
    else if (anos.includes(anoAtual)) sel.value = anoAtual;
    else if (anos.length) sel.value = anos[0];
  }
  _renderDRE();
}

function _renderDRE() {
  const ano = document.getElementById("dre-ano")?.value || String(new Date().getFullYear());
  const status = document.getElementById("dre-status");
  const wrap   = document.getElementById("dre-wrap");
  const titulo = document.getElementById("dre-titulo-ano");
  if (titulo) titulo.textContent = ano;

  const recibosAno = historicoRecibos.filter(r => r.data?.split("/")[2] === ano);
  if (!recibosAno.length) {
    if (status) { status.style.display = ""; status.textContent = `Nenhum recibo em ${ano}.`; }
    if (wrap) wrap.style.display = "none";
    return;
  }
  if (status) status.style.display = "none";
  if (wrap) wrap.style.display = "";

  const MESES_LABEL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  let acumulado = 0;
  const linhas = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const sub = recibosAno.filter(r => r.data?.split("/")[1] === m);
    const receita = sub.reduce((s, r) => s + valorParaNumero(r.valor), 0);
    acumulado += receita;
    return { mes: MESES_LABEL[i], abrev: MESES_ABREV[i], qtd: sub.length, receita, acumulado, ticket: sub.length ? receita / sub.length : 0 };
  }).filter(l => l.qtd > 0);

  const totalAno  = recibosAno.reduce((s, r) => s + valorParaNumero(r.valor), 0);
  const ticketMed = recibosAno.length ? totalAno / recibosAno.length : 0;
  const melhorMes = linhas.reduce((mx, l) => l.receita > (mx?.receita || 0) ? l : mx, null);

  const tbody = document.getElementById("dre-tbody");
  if (tbody) {
    tbody.innerHTML = linhas.map(l => `
      <tr>
        <td style="font-weight:600">${l.mes}</td>
        <td>${l.qtd}</td>
        <td style="color:var(--success);font-weight:700">R$ ${formatarValor(l.receita)}</td>
        <td style="color:var(--muted)">R$ ${formatarValor(l.acumulado)}</td>
        <td>R$ ${formatarValor(l.ticket)}</td>
      </tr>`).join("");
  }
  const tfoot = document.getElementById("dre-tfoot");
  if (tfoot) {
    tfoot.innerHTML = `<tr style="background:var(--dark);color:white">
      <td style="font-weight:700;color:var(--gold)">TOTAL ${ano}</td>
      <td style="font-weight:700">${recibosAno.length}</td>
      <td style="font-weight:700;color:#6ee7b7">R$ ${formatarValor(totalAno)}</td>
      <td>—</td>
      <td style="font-weight:700">R$ ${formatarValor(ticketMed)}</td>
    </tr>`;
  }

  // Resumo DRE
  const resumoEl = document.getElementById("dre-resumo");
  if (resumoEl) {
    resumoEl.innerHTML = [
      { label: "Receita Bruta",         value: `R$ ${formatarValor(totalAno)}`,    cor: "var(--success)" },
      { label: "Total de recibos",       value: recibosAno.length,                  cor: "" },
      { label: "Ticket médio",           value: `R$ ${formatarValor(ticketMed)}`,   cor: "" },
      { label: "Melhor mês",             value: melhorMes ? `${melhorMes.mes} — R$ ${formatarValor(melhorMes.receita)}` : "—", cor: "var(--gold)" },
      { label: "Meses com faturamento",  value: linhas.length,                       cor: "" },
      { label: "Média mensal",           value: `R$ ${formatarValor(linhas.length ? totalAno / linhas.length : 0)}`, cor: "" },
    ].map(item => `
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--muted)">${item.label}</span>
        <span style="font-weight:700;font-size:13px;color:${item.cor||"var(--dark)"}">${item.value}</span>
      </div>`).join("");
  }

  // Gráfico de barras DRE
  if (graficoDRE) { try { graficoDRE.destroy(); } catch(e){} graficoDRE = null; }
  const ctx = document.getElementById("grafico-dre")?.getContext("2d");
  if (ctx && linhas.length) {
    graficoDRE = new Chart(ctx, {
      type: "bar",
      data: {
        labels: linhas.map(l => l.abrev),
        datasets: [{ label: "Receita", data: linhas.map(l => l.receita), backgroundColor: "rgba(184,151,58,0.7)", borderColor: "#b8973a", borderWidth: 1, borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => "R$ " + formatarValor(v) } } } }
    });
  }
}

async function exportarDREPDF() {
  await garantirJSPDF();
  const { jsPDF } = window.jspdf;
  const ano = document.getElementById("dre-ano")?.value || String(new Date().getFullYear());
  const recibosAno = historicoRecibos.filter(r => r.data?.split("/")[2] === ano);
  if (!recibosAno.length) { mostrarToast(`Nenhum dado em ${ano}.`, null, "error"); return; }

  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  let acum = 0;
  const linhas = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const sub = recibosAno.filter(r => r.data?.split("/")[1] === m);
    const rec = sub.reduce((s, r) => s + valorParaNumero(r.valor), 0);
    acum += rec;
    return sub.length ? [MESES[i], sub.length, `R$ ${formatarValor(rec)}`, `R$ ${formatarValor(acum)}`, `R$ ${formatarValor(sub.length ? rec / sub.length : 0)}`] : null;
  }).filter(Boolean);

  const totalAno = recibosAno.reduce((s, r) => s + valorParaNumero(r.valor), 0);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(26, 26, 26); doc.rect(0, 0, W, 20, "F");
  doc.setTextColor(184, 151, 58); doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME", W / 2, 10, { align: "center" });
  doc.setFontSize(9); doc.setTextColor(200, 200, 200);
  doc.text("A ARAUJO PREV", W / 2, 16, { align: "center" });

  doc.setTextColor(26, 26, 26); doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(`DRE — Demonstração do Resultado — ${ano}`, W / 2, 32, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`, W / 2, 38, { align: "center" });

  doc.autoTable({
    startY: 44,
    head: [["Mês", "Recibos", "Receita Bruta", "Acumulado", "Ticket Médio"]],
    body: linhas,
    foot: [["TOTAL", recibosAno.length, `R$ ${formatarValor(totalAno)}`, "—", `R$ ${formatarValor(recibosAno.length ? totalAno / recibosAno.length : 0)}`]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [26, 26, 26], textColor: [184, 151, 58], fontStyle: "bold" },
    footStyles: { fillColor: [26, 26, 26], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    columnStyles: { 2: { textColor: [61, 122, 94], fontStyle: "bold" } },
  });

  doc.save(`dre_araujo_${ano}.pdf`);
}

// ── EXPORT ANALYTICS PDF ───────────────────────────────────
async function exportarAnalyticsPDF() {
  await garantirJSPDF();
  const { jsPDF } = window.jspdf;
  const recibos = _filtrarPorPeriodo();
  if (!recibos.length) { mostrarToast("Nenhum dado no período.", null, "error"); return; }

  const de  = document.getElementById("analytics-de")?.value  || "";
  const ate = document.getElementById("analytics-ate")?.value || "";
  const fmtMes = ym => { if (!ym) return "todos"; const [a, m] = ym.split("-"); return `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]}/${a}`; };
  const periodo = `${fmtMes(de)} → ${fmtMes(ate)}`;

  const porCliente = {};
  recibos.forEach(r => {
    if (!r.nome) return;
    if (!porCliente[r.nome]) porCliente[r.nome] = { total: 0, qtd: 0 };
    porCliente[r.nome].total += valorParaNumero(r.valor);
    porCliente[r.nome].qtd++;
  });
  const rankClientes = Object.entries(porCliente)
    .map(([n, d]) => ({ n, ...d, ticket: d.qtd ? d.total / d.qtd : 0 }))
    .sort((a, b) => b.total - a.total);

  const porResp = {};
  recibos.forEach(r => {
    const rp = (r.emitido_por || "").trim() || "(não informado)";
    if (!porResp[rp]) porResp[rp] = { total: 0, qtd: 0 };
    porResp[rp].total += valorParaNumero(r.valor);
    porResp[rp].qtd++;
  });
  const rankResp = Object.entries(porResp)
    .map(([n, d]) => ({ n, ...d, ticket: d.qtd ? d.total / d.qtd : 0 }))
    .sort((a, b) => b.total - a.total);

  const totalGeral = rankClientes.reduce((s, c) => s + c.total, 0);
  const ticketGlobal = recibos.length ? totalGeral / recibos.length : 0;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(26, 26, 26); doc.rect(0, 0, W, 20, "F");
  doc.setTextColor(184, 151, 58); doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME — ANALYTICS", W / 2, 10, { align: "center" });
  doc.setFontSize(9); doc.setTextColor(200, 200, 200);
  doc.text(`Período: ${periodo}  ·  Gerado em ${new Date().toLocaleDateString("pt-BR")}`, W / 2, 16, { align: "center" });

  // KPIs
  doc.setTextColor(26, 26, 26); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("RESUMO DO PERÍODO", 14, 30);
  const kpis = [
    ["Total de recibos", recibos.length],
    ["Receita total", `R$ ${formatarValor(totalGeral)}`],
    ["Ticket médio", `R$ ${formatarValor(ticketGlobal)}`],
    ["Clientes distintos", rankClientes.length],
  ];
  let x = 14;
  kpis.forEach(([l, v]) => {
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 120, 120);
    doc.text(l, x, 38);
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 26, 26);
    doc.text(String(v), x, 44);
    x += 68;
  });

  // Tabela top clientes
  doc.autoTable({
    startY: 52,
    head: [["#", "Cliente", "Qtd", "Total Pago", "Ticket Médio"]],
    body: rankClientes.slice(0, 25).map((c, i) => [i + 1, c.n, c.qtd, `R$ ${formatarValor(c.total)}`, `R$ ${formatarValor(c.ticket)}`]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [26, 26, 26], textColor: [184, 151, 58] },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    didDrawPage: (d) => {
      if (d.pageNumber > 1) {
        doc.setFontSize(7); doc.setTextColor(150, 150, 150);
        doc.text(`Araujo Prev — Analytics ${periodo}`, W / 2, doc.internal.pageSize.getHeight() - 5, { align: "center" });
      }
    }
  });

  // Tabela por responsável
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Responsável", "Qtd Recibos", "Receita", "Ticket Médio"]],
    body: rankResp.map(r => [r.n, r.qtd, `R$ ${formatarValor(r.total)}`, `R$ ${formatarValor(r.ticket)}`]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [61, 122, 94], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [245, 250, 247] },
    tableWidth: "wrap",
  });

  doc.save(`analytics_araujo_${de}_${ate}.pdf`);
}

function exportarAnalyticsExcel() {
  if (typeof XLSX === "undefined") { mostrarToast("Biblioteca XLSX não carregada.", null, "error"); return; }
  const recibos = _filtrarPorPeriodo();
  const de  = document.getElementById("analytics-de")?.value  || "todos";
  const ate = document.getElementById("analytics-ate")?.value || "todos";

  // Aba 1 — Resumo Mensal
  const mesesDoRange = _periodoMeses().filter(ym => {
    const d = document.getElementById("analytics-de")?.value  || "";
    const a = document.getElementById("analytics-ate")?.value || "";
    return (!d || ym >= d) && (!a || ym <= a);
  });
  const resumoMensal = mesesDoRange.map(ym => {
    const [ano, m] = ym.split("-");
    const label = `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]}/${ano}`;
    const sub = recibos.filter(r => { const p = r.data?.split("/"); return p && p[2] === ano && p[1] === m; });
    const total = sub.reduce((s, r) => s + valorParaNumero(r.valor), 0);
    return { Período: label, "Qtd Recibos": sub.length, "Receita (R$)": +total.toFixed(2), "Ticket Médio (R$)": sub.length ? +(total / sub.length).toFixed(2) : 0 };
  });

  // Aba 2 — Top Clientes
  const porCliente = {};
  recibos.forEach(r => {
    if (!r.nome) return;
    if (!porCliente[r.nome]) porCliente[r.nome] = { total: 0, qtd: 0 };
    porCliente[r.nome].total += valorParaNumero(r.valor);
    porCliente[r.nome].qtd++;
  });
  const topClientes = Object.entries(porCliente)
    .map(([nome, d]) => ({ "#": 0, Cliente: nome, "Qtd Recibos": d.qtd, "Total Pago (R$)": +d.total.toFixed(2), "Ticket Médio (R$)": +(d.total / d.qtd).toFixed(2) }))
    .sort((a, b) => b["Total Pago (R$)"] - a["Total Pago (R$)"])
    .map((r, i) => ({ ...r, "#": i + 1 }));

  // Aba 3 — Por Responsável
  const porResp = {};
  recibos.forEach(r => {
    const resp = (r.emitido_por || "").trim() || "(não informado)";
    if (!porResp[resp]) porResp[resp] = { total: 0, qtd: 0 };
    porResp[resp].total += valorParaNumero(r.valor);
    porResp[resp].qtd++;
  });
  const porResponsavel = Object.entries(porResp)
    .map(([nome, d]) => ({ Responsável: nome, "Qtd Recibos": d.qtd, "Receita (R$)": +d.total.toFixed(2), "Ticket Médio (R$)": +(d.total / d.qtd).toFixed(2) }))
    .sort((a, b) => b["Receita (R$)"] - a["Receita (R$)"]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoMensal),   "Resumo Mensal");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topClientes),    "Top Clientes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porResponsavel), "Por Responsável");

  const nomeArq = `analytics_${de}_${ate}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  XLSX.writeFile(wb, nomeArq);
  mostrarToast("Excel exportado com sucesso!", null, "success");
}

async function carregarProjecao() {
  const status = document.getElementById("projecao-status");
  const wrap   = document.getElementById("projecao-wrap");
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/projecao");
  if (!res || res.status === 404) { status.textContent = "Em breve — projeção de receita em desenvolvimento."; return; }
  if (!res.ok) { status.textContent = "Erro ao carregar projeção."; return; }
  const dados = await res.json();
  if (!Array.isArray(dados) || !dados.length) { status.textContent = "Nenhuma parcela futura encontrada."; return; }
  const labels = dados.map(d => d.mes);
  const valores = dados.map(d => d.valor || 0);
  const qtds    = dados.map(d => d.qtd || 0);
  const totalGeral = valores.reduce((s,v)=>s+v,0);
  if (totalGeral === 0) {
    status.textContent = "Nenhuma parcela com data de vencimento cadastrada. Defina datas de vencimento nos contratos de clientes para ver a projeção.";
    return;
  }
  if (graficoProjecao){ try{ graficoProjecao.destroy(); }catch(e){} graficoProjecao=null; }
  requestAnimationFrame(()=>{
    try{
      const ctx = document.getElementById("grafico-projecao")?.getContext("2d");
      if (ctx) graficoProjecao = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ label: "A Receber", data: valores, backgroundColor: "rgba(62,122,94,0.75)", borderColor: "#3e7a5e", borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => "R$ " + formatarValor(v) } } } }
      });
    }catch(e){ console.error("Projecao chart error:", e); }
  });
  const total = valores.reduce((s, v) => s + v, 0);
  document.getElementById("tabela-projecao").innerHTML = dados.map((d, i) =>
    `<tr><td>${esc(d.mes)}</td><td style="color:var(--success);font-weight:700">R$ ${formatarValor(d.valor || 0)}</td><td>${qtds[i]}</td></tr>`
  ).join("");
  document.getElementById("projecao-total").textContent = `Total projetado: R$ ${formatarValor(total)}`;
  status.style.display = "none"; wrap.style.display = "";
}

async function carregarPorEscritorio() {
  const status = document.getElementById("escritorios-status");
  const wrap   = document.getElementById("escritorios-wrap");
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/por-escritorio");
  if (!res || res.status === 404) { status.textContent = "Em breve — relatório por escritório em desenvolvimento."; return; }
  if (!res.ok) { status.textContent = "Erro ao carregar relatório."; return; }
  const dados = await res.json();
  if (!dados.length) { status.textContent = "Nenhum dado encontrado."; return; }
  let totalGeral = 0;
  document.getElementById("tabela-escritorios").innerHTML = dados.map(e => {
    totalGeral += e.receita || 0;
    const ticket = e.qtd_recibos > 0 ? (e.receita / e.qtd_recibos) : 0;
    return `<tr>
      <td style="font-weight:600">${esc(e.escritorio || "-")}</td>
      <td style="color:var(--success);font-weight:700">R$ ${formatarValor(e.receita || 0)}</td>
      <td>${e.qtd_recibos || 0}</td>
      <td>${e.qtd_clientes || 0}</td>
      <td>R$ ${formatarValor(ticket)}</td>
    </tr>`;
  }).join("");
  document.getElementById("escritorios-total").textContent = `Total: R$ ${formatarValor(totalGeral)}`;
  status.style.display = "none"; wrap.style.display = "";
}

async function normalizarEscritorios() {
  const btn = document.getElementById("btn-normalizar-escritorios");
  const statusEl = document.getElementById("normalizar-escritorios-status");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Normalizando...';
  statusEl.textContent = "";
  try {
    const res = await api("POST", "/api/admin/normalizar-escritorios");
    if (!res || !res.ok) { statusEl.textContent = "Erro ao normalizar."; return; }
    const data = await res.json();
    statusEl.textContent = `✅ ${data.atualizados} recibo(s) atualizados de ${data.total} total.`;
    if (data.atualizados > 0) { await carregarRecibos(); preencherFiltrosAnos(); }
  } catch(e) {
    statusEl.textContent = "Erro: " + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function importarClientesDosRecibos() {
  const btn = document.getElementById("btn-importar-clientes-recibos");
  const statusEl = document.getElementById("importar-clientes-status");
  if (!confirm("Isso vai cadastrar automaticamente todos os clientes que aparecem nos recibos mas ainda não têm cadastro. Continuar?")) return;
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Cadastrando...';
  statusEl.textContent = "";
  try {
    const res = await api("POST", "/api/admin/importar-clientes-dos-recibos");
    if (!res || !res.ok) { statusEl.textContent = "Erro ao importar."; return; }
    const data = await res.json();
    statusEl.textContent = `✅ ${data.importados} cliente(s) cadastrado(s). ${data.ignorados} já existiam.`;
    mostrarToast(`${data.importados} cliente(s) cadastrado(s)!`, null, "success");
    await carregarClientes();
    atualizarSugestoesNomes();
  } catch(e) {
    statusEl.textContent = "Erro: " + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function baixarBackupDB() {
  const btn = document.getElementById("btn-backup-db");
  const statusEl = document.getElementById("backup-db-status");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Gerando...';
  statusEl.textContent = "";
  try {
    const res = await api("GET", "/api/admin/backup-db");
    if (!res || res.status === 404) { statusEl.textContent = "Em breve — backup do banco em desenvolvimento."; return; }
    if (!res.ok) { statusEl.textContent = "Erro ao gerar backup."; return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `backup_db_${new Date().toISOString().slice(0,10)}.zip`; a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = "Backup baixado com sucesso!";
  } catch(e) {
    statusEl.textContent = "Erro: " + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

function preencherFiltrosAnos(){
  const anos=[...new Set(historicoRecibos.map(r=>r.data?.split("/")[2]).filter(Boolean))];
  const anoAtual=String(new Date().getFullYear());
  if(!anos.includes(anoAtual)) anos.unshift(anoAtual);
  anos.sort((a,b)=>b-a);
  ["filtro-ano","dash-ano","rel-ano","rel-cliente-ano","rel-resp-ano","rel-exec-ano"].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    sel.innerHTML=`<option value="">Todos</option>`+anos.map(a=>`<option value="${esc(a)}" ${a===anoAtual?"selected":""}>${esc(a)}</option>`).join("");
  });
  const resps=[...new Set(historicoRecibos.map(r=>r.emitido_por).filter(Boolean))];
  ["filtro-responsavel","rel-responsavel"].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    sel.innerHTML=`<option value="">Todos</option>`+resps.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("");
  });
}

function aplicarFiltros(){
  const mes=document.getElementById("filtro-mes").value;
  const ano=document.getElementById("filtro-ano").value;
  const resp=document.getElementById("filtro-responsavel").value;
  const lista=historicoRecibos.filter(r=>{
    const p=r.data?.split("/");
    if(!p) return false;
    if(mes&&p[1]!==mes) return false;
    if(ano&&p[2]!==ano) return false;
    if(resp&&r.emitido_por!==resp) return false;
    return true;
  });
  const tbody=document.getElementById("tabela-financeiro");
  const soma=lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  document.getElementById("financeiro-count").textContent=`${lista.length} recibo${lista.length!==1?"s":""}`;
  document.getElementById("financeiro-total").textContent=`Total: R$ ${formatarValor(soma)}`;
  tbody.innerHTML=lista.map(r=>`
    <tr>
      <td><span class="badge badge-gold">${esc(r.num)}</span></td>
      <td>${esc(r.nome)}</td>
      <td>${esc(r.data)}</td>
      <td style="color:var(--success);font-weight:700">R$ ${esc(r.valor)}</td>
      <td>${esc(r.emitido_por||"-")}</td>
      <td>${esc(r.referencia||"-")}</td>
    </tr>`).join("");
}
