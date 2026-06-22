// web/public/app/recibos-extra.js — extracted from app.js
// â”€â”€ GOV.BR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let reciboParaAssinar = null;

async function abrirModalGovBr(r){
  reciboParaAssinar = r;
  const statusBox = document.getElementById("govbr-status-box");
  const btnAssinar = document.getElementById("btn-govbr-assinar");
  statusBox.style.display = "none";
  btnAssinar.disabled = false;
  btnAssinar.textContent = "";
  btnAssinar.innerHTML = '<i class="bi bi-shield-check"></i> Assinar com Gov.br';
  // Verifica status atual
  const res = await api("GET", `/api/govbr/status/${r.id||r._id}`);
  if(res && res.ok){
    const data = await res.json();
    if(data.assinado){
      statusBox.style.display = "block";
      statusBox.innerHTML = `<i class="bi bi-shield-fill-check"></i> <strong>JÃ¡ assinado!</strong><br>Por: ${esc(data.assinatura.nome_assinante)}<br>Em: ${esc(data.assinatura.assinado_em)}`;
      btnAssinar.disabled = true;
    }
    if(!data.configurado){
      btnAssinar.disabled = true;
      btnAssinar.innerHTML = '<i class="bi bi-shield-x"></i> Gov.br nÃ£o configurado ainda';
    }
  }
  fecharModal("modal-detalhe");
  document.getElementById("modal-govbr").classList.add("active");
}

async function iniciarAssinaturaGovBr(){
  if(!reciboParaAssinar) return;
  const btn = document.getElementById("btn-govbr-assinar");
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Aguarde...';
  const res = await api("GET", `/api/govbr/iniciar?recibo_id=${reciboParaAssinar.id||reciboParaAssinar._id}`);
  if(!res || !res.ok){
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-shield-check"></i> Assinar com Gov.br';
    mostrarToast("Erro ao iniciar assinatura. Gov.br pode nÃ£o estar configurado.");
    return;
  }
  const { url } = await res.json();
  // Abre Gov.br no navegador
  window.location.href = url;
}

// Verifica retorno do Gov.br apÃ³s callback
(function verificarRetornoGovBr(){
  const params = new URLSearchParams(window.location.search);
  if(params.get("govbr_ok")){
    mostrarToast("Recibo assinado com sucesso via Gov.br!");
    history.replaceState({}, "", "/");
    carregarRecibos();
  }
  if(params.get("govbr_erro")){
    mostrarToast("Erro na assinatura Gov.br: " + params.get("govbr_erro"));
    history.replaceState({}, "", "/");
  }
})();

// â”€â”€ RECIBO RECORRENTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function preencherReciboRecorrente(r) {
  const partes = (r.data || "").split("/");
  let dia = partes[0] || "01";
  let mes = parseInt(partes[1] || "1");
  let ano = parseInt(partes[2] || String(new Date().getFullYear()));
  mes += 1;
  if (mes > 12) { mes = 1; ano += 1; }
  const mesStr = String(mes).padStart(2, "0");
  const mesesNomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const refBase = (r.referencia || "").replace(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/\d{4}\b/i, `${mesesNomes[mes-1].toUpperCase()}/${ano}`);
  navegarPara("gerar");
  setTimeout(() => {
    document.getElementById("nome").value        = r.nome || "";
    document.getElementById("cpf").value         = r.cpf || "";
    document.getElementById("municipio_uf").value= r.municipio_uf || "";
    document.getElementById("valor").value       = r.valor || "";
    document.getElementById("emitido_por").value = r.emitido_por || "";
    document.getElementById("escritorio").value  = (r.escritorio || "").toUpperCase();
    document.getElementById("forma_pagamento").value = r.forma_pagamento || "";
    document.getElementById("motivo_pagamento").value = r.motivo_pagamento || "";
    document.getElementById("referencia").value  = refBase || r.referencia || "";
    document.getElementById("dia").value         = dia;
    document.getElementById("mes").value         = mesStr;
    document.getElementById("ano").value         = String(ano);
    mostrarToast(`Recibo recorrente prÃ©-preenchido para ${mesStr}/${ano}. Revise e clique em Gerar.`);
  }, 100);
}

// â”€â”€ CALENDÃRIO DE VENCIMENTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _CAL_DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","SÃ¡b"];
const _CAL_MESES = ["Janeiro","Fevereiro","MarÃ§o","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function carregarCalendario(ano, mes) {
  _calAno = ano; _calMes = mes;
  document.getElementById("cal-mes-label").textContent = `${_CAL_MESES[mes]} ${ano}`;
  const grid = document.getElementById("calendario-grid");
  const detalhe = document.getElementById("cal-detalhe");
  if (!grid) return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
  // Agrupa parcelas por data_vencimento no mÃªs/ano
  const porDia = {};
  listaClientes.forEach(c => {
    if (!Array.isArray(c.parcelas)) return;
    c.parcelas.forEach(p => {
      if (p.status === "pago" || !p.data_vencimento) return;
      const [ay, am, ad] = p.data_vencimento.split("-").map(Number);
      if (ay !== ano || am !== mes + 1) return;
      if (!porDia[ad]) porDia[ad] = [];
      porDia[ad].push({ cliente: c, parcela: p });
    });
  });
  // CabeÃ§alho dias
  let html = _CAL_DIAS_SEMANA.map(d=>`<div class="cal-header">${d}</div>`).join("");
  // Offset do 1Âº dia
  const primeiroDia = new Date(ano, mes, 1).getDay();
  for (let i=0; i<primeiroDia; i++) html += `<div class="cal-day vazio"></div>`;
  const diasNoMes = new Date(ano, mes+1, 0).getDate();
  for (let d=1; d<=diasNoMes; d++) {
    const dataAtual = new Date(ano, mes, d);
    const isHoje = dataAtual.getTime() === hoje.getTime();
    const itens = porDia[d] || [];
    let badgeClass = "cal-badge-futuro";
    if (itens.length) {
      const temAtrasado = itens.some(i => {
        const dv = new Date(i.parcela.data_vencimento+"T12:00:00");
        return dv < hoje;
      });
      const temHojeAmanha = itens.some(i => {
        const dv = new Date(i.parcela.data_vencimento+"T12:00:00");
        return dv <= amanha && dv >= hoje;
      });
      if (temAtrasado) badgeClass = "cal-badge-atrasado";
      else if (temHojeAmanha) badgeClass = "cal-badge-hoje";
    }
    html += `<div class="cal-day${isHoje?" today":""}" data-dia="${d}" data-count="${itens.length}">
      <div class="cal-day-num">${d}</div>
      ${itens.length ? `<div class="cal-badge ${badgeClass}">${itens.length}</div>` : ""}
    </div>`;
  }
  grid.innerHTML = html;
  detalhe.innerHTML = "";
  grid.querySelectorAll(".cal-day[data-count]").forEach(cell => {
    cell.addEventListener("click", () => {
      const dia = parseInt(cell.dataset.dia);
      const lista = porDia[dia] || [];
      if (!lista.length) { detalhe.innerHTML = ""; return; }
      detalhe.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:10px">${dia}/${String(mes+1).padStart(2,"0")}/${ano} â€” ${lista.length} parcela${lista.length!==1?"s":""}</div>` +
        lista.map(i => `<div style="padding:8px 12px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;font-size:12px">
          <span style="font-weight:600">${esc(i.cliente.nome)}</span> &nbsp;Â·&nbsp;
          Parcela ${i.parcela.num} &nbsp;Â·&nbsp; R$ ${formatarValor(i.parcela.valor||0)} &nbsp;Â·&nbsp;
          <span class="badge ${i.parcela.status==='atrasado'?'badge-atrasado':'badge-pendente'}">${i.parcela.status}</span>
        </div>`).join("");
    });
  });
}

// â”€â”€ BUSCA GLOBAL MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _buscaModalTimer = null;

function abrirModalBuscaGlobal() {
  const modal = document.getElementById("modal-busca-global");
  if (!modal) return;
  modal.classList.add("active");
  setTimeout(() => document.getElementById("busca-modal-input")?.focus(), 50);
}

function fecharModalBuscaGlobal() {
  const modal = document.getElementById("modal-busca-global");
  if (modal) modal.classList.remove("active");
  const inp = document.getElementById("busca-modal-input");
  if (inp) inp.value = "";
  const res = document.getElementById("busca-modal-resultados");
  if (res) res.innerHTML = `<div style="padding:20px 18px;color:var(--muted);font-size:12px;text-align:center">Digite para buscar clientes e recibos...</div>`;
}

function renderBuscaModal(termo) {
  const res = document.getElementById("busca-modal-resultados");
  if (!res) return;
  if (!termo || termo.length < 2) {
    res.innerHTML = `<div style="padding:20px 18px;color:var(--muted);font-size:12px;text-align:center">Digite ao menos 2 caracteres...</div>`;
    return;
  }
  const t = termo.toLowerCase();
  const td = t.replace(/\D/g,"");
  const recibos = historicoRecibos.filter(r =>
    (r.nome||"").toLowerCase().includes(t) || (r.num||"").toLowerCase().includes(t) ||
    (td.length>0 && (r.cpf||"").replace(/\D/g,"").includes(td))
  ).slice(0,5);
  const clientes = listaClientes.filter(c =>
    (c.nome||"").toLowerCase().includes(t) ||
    (td.length>0 && (c.cpf||"").replace(/\D/g,"").includes(td))
  ).slice(0,5);
  if (!recibos.length && !clientes.length) {
    res.innerHTML = `<div style="padding:20px 18px;color:var(--muted);font-size:12px;text-align:center">Nenhum resultado encontrado.</div>`;
    return;
  }
  let html = "";
  if (clientes.length) {
    html += `<div class="busca-resultado-grupo"><i class="bi bi-people"></i> Clientes</div>`;
    html += clientes.map(c => `<div class="busca-resultado-item" data-type="cliente" data-id="${esc(c.id)}">
      <div class="busca-resultado-icone" style="background:var(--gold-pale);color:var(--gold)"><i class="bi bi-person"></i></div>
      <div><div style="font-weight:600">${esc(c.nome)}</div><div style="font-size:11px;color:var(--muted)">${esc(c.cpf||"")} Â· ${esc(c.municipio_uf||"")}</div></div>
    </div>`).join("");
  }
  if (recibos.length) {
    html += `<div class="busca-resultado-grupo"><i class="bi bi-receipt"></i> Recibos</div>`;
    html += recibos.map(r => `<div class="busca-resultado-item" data-type="recibo" data-id="${esc(r.id||r._id)}">
      <div class="busca-resultado-icone" style="background:var(--bg);color:var(--success)"><i class="bi bi-receipt"></i></div>
      <div><div style="font-weight:600">${esc(r.nome)}</div><div style="font-size:11px;color:var(--muted)">${esc(r.num)} Â· R$ ${esc(r.valor)} Â· ${esc(r.data)}</div></div>
    </div>`).join("");
  }
  res.innerHTML = html;
  // First item gets focused by default for keyboard nav
  const firstItem = res.querySelector(".busca-resultado-item");
  if (firstItem) firstItem.classList.add("focused");
  res.querySelectorAll(".busca-resultado-item").forEach(item => {
    item.addEventListener("click", () => {
      fecharModalBuscaGlobal();
      if (item.dataset.type === "cliente") {
        navegarPara("clientes");
        setTimeout(() => {
          const inp = document.getElementById("busca-clientes");
          const c = listaClientes.find(x => x.id === item.dataset.id);
          if (inp && c) { inp.value = c.nome; renderClientes(); }
        }, 100);
      } else {
        const r = historicoRecibos.find(x => (x.id||x._id) === item.dataset.id);
        navegarPara("historico");
        if (r) setTimeout(() => abrirDetalhe(r), 100);
      }
    });
  });
}

// â”€â”€ AUDITORIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function carregarAuditoria() {
  const status = document.getElementById("auditoria-status");
  const wrap   = document.getElementById("auditoria-wrap");
  if (!status || !wrap) return;
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/admin/audit-log");
  if (!res || res.status === 404) { status.textContent = "Em breve â€” auditoria em desenvolvimento."; return; }
  if (!res.ok) { status.textContent = "Erro ao carregar auditoria."; return; }
  _auditDados = await res.json();
  _renderAuditoria();
  status.style.display = "none"; wrap.style.display = "";
}

function _renderAuditoria() {
  const usuario = (document.getElementById("audit-filtro-usuario")?.value || "").toLowerCase();
  const acao    = (document.getElementById("audit-filtro-acao")?.value || "").toLowerCase();
  const lista = _auditDados.filter(e =>
    (!usuario || (e.usuario||"").toLowerCase().includes(usuario)) &&
    (!acao    || (e.acao||"").toLowerCase().includes(acao))
  );
  document.getElementById("auditoria-count").textContent = `${lista.length} registro${lista.length!==1?"s":""}`;
  document.getElementById("tabela-auditoria").innerHTML = lista.map(e => {
    const dt = e.ts ? new Date(e.ts).toLocaleString("pt-BR") : "â€”";
    const detalhe = e.dados_depois ? JSON.stringify(e.dados_depois).slice(0,80) : (e.entidade_id||"");
    return `<tr>
      <td style="white-space:nowrap;font-size:11px">${esc(dt)}</td>
      <td style="font-weight:600">${esc(e.usuario||"â€”")}</td>
      <td><span class="badge badge-pago" style="background:var(--mid)">${esc(e.acao||"â€”")}</span></td>
      <td style="font-size:11px;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(detalhe)}</td>
    </tr>`;
  }).join("");
}

function _buildTimeline(cadastro, recibos) {
  const eventos = [];
  recibos.forEach(r => {
    eventos.push({ tipo:"recibo", data: r.timestamp || dataParaISO(r.data) || "", label: `Recibo ${esc(r.num)} gerado â€” R$ ${esc(r.valor)}`, icon:"bi-receipt", cor:"var(--gold)" });
  });
  if (cadastro) {
    (cadastro.parcelas||[]).filter(p=>p.status==="pago"&&p.data_recebimento).forEach(p => {
      eventos.push({ tipo:"pagamento", data: dataParaISO(p.data_recebimento)||p.data_recebimento||"", label: `Parcela ${p.num} paga â€” R$ ${formatarValor(p.valor||0)}`, icon:"bi-check-circle-fill", cor:"var(--success)" });
    });
    (cadastro.observacoes||[]).forEach(o => {
      eventos.push({ tipo:"obs", data: o.criado_em||o.data||"", label: `ObservaÃ§Ã£o: ${esc(o.texto||"")}`, icon:"bi-chat-text", cor:"var(--muted)" });
    });
    (cadastro.parcelas||[]).filter(p=>p.lembrete_enviado_em).forEach(p => {
      eventos.push({ tipo:"lembrete", data: p.lembrete_enviado_em, label: `Lembrete enviado â€” parcela ${p.num}`, icon:"bi-bell", cor:"#c07a2a" });
    });
  }
  eventos.sort((a,b) => (b.data||"").localeCompare(a.data||""));
  if (!eventos.length) return `<div style="padding:16px 12px;color:var(--muted);font-size:12px;font-style:italic">Nenhum evento registrado.</div>`;
  return `<div class="timeline">${eventos.map(e => {
    const dt = e.data ? (e.data.includes("T") ? new Date(e.data).toLocaleString("pt-BR") : e.data) : "â€”";
    return `<div class="timeline-item">
      <div class="timeline-icone" style="background:${e.cor}22;color:${e.cor}"><i class="bi ${e.icon}"></i></div>
      <div class="timeline-corpo">${e.label}<div class="timeline-data">${dt}</div></div>
    </div>`;
  }).join("")}</div>`;
}

