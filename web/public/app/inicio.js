// ── INÍCIO — painel-resumo. NÃO duplica o Administrativo: só resume os dados
// já carregados (historicoRecibos, listaClientes) e linka pras telas de detalhe.

function _dashCSS() {
  if (document.getElementById("dash-estilos")) return;
  const s = document.createElement("style");
  s.id = "dash-estilos";
  s.textContent = `
    .dash-topo{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px;flex-wrap:wrap}
    .dash-saud{font-family:'Cormorant Garamond',serif;font-size:27px;font-weight:600;line-height:1.1;margin:2px 0 0}
    .dash-data{font-size:12.5px;color:var(--muted);margin-top:2px}
    .dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin-bottom:14px}
    .dash-tile{background:var(--card);border:1px solid var(--border);border-radius:15px;padding:15px 16px;box-shadow:0 1px 3px rgba(60,44,10,.05)}
    .dash-tile .di{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;margin-bottom:10px}
    .dash-tile .di i{font-size:15px}
    .dt-g .di{background:var(--gold-pale);color:#8a6d1f}.dt-s .di{background:#e6f0ea;color:var(--success)}
    .dt-e .di{background:#f6e7e4;color:var(--error)}.dt-d .di{background:#eee9df;color:var(--mid)}
    .dash-tile .dl{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}
    .dash-tile .dv{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--dark);line-height:1.05;margin-top:2px;font-variant-numeric:tabular-nums}
    .dash-tile .dd{font-size:11px;font-weight:600;margin-top:4px}
    .dd.up{color:var(--success)}.dd.down{color:var(--error)}.dd.n{color:var(--muted)}
    .dash-cols{display:grid;grid-template-columns:1.5fr 1fr;gap:13px}
    .dash-panel{background:var(--card);border:1px solid var(--border);border-radius:15px;padding:16px 18px;box-shadow:0 1px 3px rgba(60,44,10,.05)}
    .dash-ph{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
    .dash-ph h3{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;margin:0}
    .dash-ph a{font-size:12px;color:#8a6d1f;font-weight:600;text-decoration:none;cursor:pointer}
    .dash-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)}
    .dash-row:first-child{border-top:none}
    .dash-av{width:31px;height:31px;border-radius:9px;background:var(--gold-pale);color:#8a6d1f;display:grid;place-items:center;font-size:13px;font-weight:700;font-family:'Cormorant Garamond',serif;flex:none}
    .dash-nome{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dash-sub{font-size:10.5px;color:var(--muted)}
    .dash-val{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--success);font-variant-numeric:tabular-nums;white-space:nowrap}
    .dash-pill{font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:20px;margin-left:6px}
    .dash-pill.v{background:#f6e7e4;color:var(--error)}
    .dash-empty{text-align:center;color:var(--muted);font-size:12px;padding:16px}
    @media(max-width:720px){.dash-stats{grid-template-columns:repeat(2,1fr)}.dash-cols{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function _dashMes(dataStr) {
  const p = String(dataStr || "").split("/");
  return p.length === 3 ? `${p[2]}-${p[1].padStart(2, "0")}` : "";
}
function _dashOrdemData(dataStr) { // "DD/MM/YYYY" -> "YYYYMMDD" pra ordenar
  const p = String(dataStr || "").split("/");
  return p.length === 3 ? p[2] + p[1].padStart(2, "0") + p[0].padStart(2, "0") : "0";
}

function _dashGrafico(recibos) {
  const now = new Date(), meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, lbl: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "") });
  }
  const somas = meses.map(m => recibos.filter(r => _dashMes(r.data) === m.key).reduce((s, r) => s + valorParaNumero(r.valor), 0));
  const max = Math.max(1, ...somas), W = 560, H = 150;
  const pts = somas.map((v, i) => [(somas.length > 1 ? i / (somas.length - 1) : 0) * W, H - (v / max) * (H - 22) - 11]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const leg = meses.map((m, i) => `<span${i === 5 ? ' style="color:#8a6d1f"' : ""}>${m.lbl} <b>R$ ${(somas[i] / 1000).toFixed(1)}k</b></span>`).join("");
  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
      <defs><linearGradient id="dga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b8973a" stop-opacity=".26"/><stop offset="100%" stop-color="#b8973a" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" y1="37" x2="${W}" y2="37" stroke="#e7e1d6"/><line x1="0" y1="93" x2="${W}" y2="93" stroke="#e7e1d6"/>
      <path d="${area}" fill="url(#dga)"/><path d="${line}" fill="none" stroke="#b8973a" stroke-width="2.5" stroke-linejoin="round"/>
      ${pts.length ? `<circle cx="${pts[5][0].toFixed(0)}" cy="${pts[5][1].toFixed(0)}" r="4.5" fill="#b8973a" stroke="#fff" stroke-width="2"/>` : ""}
    </svg>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums">${leg}</div>`;
}

function renderInicio() {
  _dashCSS();
  const el = document.getElementById("screen-inicio");
  if (!el) return;
  const recibos = Array.isArray(historicoRecibos) ? historicoRecibos : [];
  const clientes = Array.isArray(listaClientes) ? listaClientes : [];

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mesAnt = `${dAnt.getFullYear()}-${String(dAnt.getMonth() + 1).padStart(2, "0")}`;

  const doMes = recibos.filter(r => _dashMes(r.data) === mesAtual);
  const receitaMes = doMes.reduce((s, r) => s + valorParaNumero(r.valor), 0);
  const receitaAnt = recibos.filter(r => _dashMes(r.data) === mesAnt).reduce((s, r) => s + valorParaNumero(r.valor), 0);
  const varReceita = receitaAnt > 0 ? Math.round((receitaMes / receitaAnt - 1) * 100) : null;

  const aReceber = clientes.reduce((s, c) => s + (Number(c.valor_restante) || 0), 0);
  const atrasados = clientes.filter(c => Array.isArray(c.parcelas) && c.parcelas.some(p => p.status === "atrasado"));

  const recentes = recibos.slice().sort((a, b) => _dashOrdemData(b.data).localeCompare(_dashOrdemData(a.data))).slice(0, 5);

  const hora = now.getHours();
  const saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const primNome = (usuarioLogado || "").split(" ")[0] || "";
  const ini = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();

  const tile = (cls, ic, lbl, val, delta) => `
    <div class="dash-tile ${cls}"><div class="di"><i class="bi ${ic}"></i></div>
      <div class="dl">${lbl}</div><div class="dv">${val}</div>${delta || ""}</div>`;

  const deltaReceita = varReceita === null
    ? `<div class="dd n">—</div>`
    : `<div class="dd ${varReceita >= 0 ? "up" : "down"}">${varReceita >= 0 ? "▲" : "▼"} ${Math.abs(varReceita)}% vs mês passado</div>`;

  const linhasRecentes = recentes.length ? recentes.map(r => `
    <div class="dash-row"><div class="dash-av">${ini(r.nome)}</div>
      <div style="min-width:0"><div class="dash-nome">${esc(r.nome || "—")}</div><div class="dash-sub">Nº ${esc(r.num || "")} · ${esc(r.data || "")}</div></div>
      <div class="dash-val">R$ ${esc(r.valor || "0")}</div></div>`).join("") : `<div class="dash-empty">Nenhum recibo ainda.</div>`;

  const linhasVenc = atrasados.length ? atrasados.slice(0, 6).map(c => {
    const parc = (c.parcelas || []).find(p => p.status === "atrasado") || {};
    return `<div class="dash-row"><div class="dash-av" style="background:#f6e7e4;color:var(--error)">${ini(c.nome)}</div>
      <div style="min-width:0"><div class="dash-nome">${esc(c.nome || "—")}<span class="dash-pill v">atrasada</span></div>
      <div class="dash-sub">Falta R$ ${formatarValor(Number(c.valor_restante) || 0)}</div></div></div>`;
  }).join("") : `<div class="dash-empty">🎉 Nenhuma parcela atrasada!</div>`;

  el.innerHTML = `
    <div class="dash-topo">
      <div>
        <p style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--gold);margin:0">A Araujo Prev · Painel</p>
        <h1 class="dash-saud">${saud}${primNome ? ", " + esc(primNome) : ""}</h1>
        <div class="dash-data">${now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
    </div>
    <div class="dash-stats">
      ${tile("dt-g", "bi-cash-coin", "Receita do mês", "R$ " + formatarValor(receitaMes), deltaReceita)}
      ${tile("dt-s", "bi-receipt", "Recibos no mês", String(doMes.length), `<div class="dd n">${recibos.length} no total</div>`)}
      ${tile("dt-e", "bi-exclamation-triangle", "A receber", "R$ " + formatarValor(aReceber), `<div class="dd ${atrasados.length ? "down" : "n"}">${atrasados.length} cliente(s) atrasado(s)</div>`)}
      ${tile("dt-d", "bi-people-fill", "Clientes ativos", String(clientes.length), `<div class="dd n">cadastrados</div>`)}
    </div>
    <div class="dash-cols">
      <div class="dash-panel">
        <div class="dash-ph"><h3>Receita — últimos 6 meses</h3><a id="dash-ir-admin">Relatórios →</a></div>
        ${_dashGrafico(recibos)}
      </div>
      <div class="dash-panel">
        <div class="dash-ph"><h3>Recibos recentes</h3><a id="dash-ir-historico">Ver todos →</a></div>
        ${linhasRecentes}
      </div>
    </div>
    <div class="dash-panel" style="margin-top:13px">
      <div class="dash-ph"><h3>Parcelas atrasadas</h3><a id="dash-ir-clientes">Ver clientes →</a></div>
      ${linhasVenc}
    </div>`;

  const ir = (id, tela) => { const a = document.getElementById(id); if (a) a.addEventListener("click", () => navegarPara(tela)); };
  ir("dash-ir-admin", "admin");
  ir("dash-ir-historico", "historico");
  ir("dash-ir-clientes", "clientes");
}
