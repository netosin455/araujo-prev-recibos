// =============================================================
//  COMPORTAMENTO — web/public/app/core.js
//  Core: utilidades, auth, estado, navegação, máscaras
// =============================================================

// ── UTILITÁRIOS ────────────────────────────────────────────
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function valorParaNumero(v){
  // Aceita os dois formatos: BR "1.518,00" (ponto=milhar) e SQL "6000.00" (ponto=decimal).
  if(typeof v==="number") return isFinite(v)?v:0;
  const s=String(v??"0").trim();
  if(s.includes(",")) return parseFloat(s.replace(/\./g,"").replace(",","."))||0;
  return parseFloat(s)||0;
}
function formatarValor(n){ return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ── AUTH ───────────────────────────────────────────────────
let token = "";

let usuarioLogado = localStorage.getItem("usuarioLogado") || "";
let roleLogado = localStorage.getItem("roleLogado") || "financeiro";
let escritorioLogado = localStorage.getItem("escritorioLogado") || "";

async function api(method, path, body, timeoutMs = 30000){
  try {
    const opts = { method, headers: { "Content-Type":"application/json" }, credentials: "include" };
    if(body) opts.body = JSON.stringify(body);
    const res = await Promise.race([
      fetch(path, opts),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
    if(res.status===401){ fazerLogout(); return null; }
    return res;
  } catch(e){
    return null;
  }
}

async function fazerLogin(){
  const username = document.getElementById("login-usuario").value.trim();
  const password = document.getElementById("login-senha").value;
  const erroEl = document.getElementById("login-erro");
  erroEl.style.display="none";
  if(!username||!password){ erroEl.textContent="Preencha usuário e senha."; erroEl.style.display="block"; return; }
  const res = await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({username,password})});
  const data = await res.json();
  if(!res.ok){ erroEl.textContent=data.erro||"Erro ao entrar."; erroEl.style.display="block"; return; }
  token = "1";
  usuarioLogado = data.username;
  roleLogado = data.role || "financeiro";
  escritorioLogado = data.escritorio || "";
  localStorage.setItem("usuarioLogado", usuarioLogado);
  localStorage.setItem("roleLogado", roleLogado);
  localStorage.setItem("escritorioLogado", escritorioLogado);
  document.getElementById("tela-login").classList.add("hide");
  document.body.classList.remove("login-open");
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  iniciarApp();
}

function fazerLogout(){
  fetch("/api/logout",{method:"POST",credentials:"include"});
  localStorage.removeItem("usuarioLogado");
  localStorage.removeItem("roleLogado");
  localStorage.removeItem("escritorioLogado");
  token=""; usuarioLogado=""; roleLogado="financeiro"; escritorioLogado="";
  location.reload();
}

document.getElementById("login-senha").addEventListener("keydown", e=>{ if(e.key==="Enter") fazerLogin(); });
document.getElementById("login-usuario").addEventListener("keydown", e=>{ if(e.key==="Enter") document.getElementById("login-senha").focus(); });
document.getElementById("btn-login").addEventListener("click", fazerLogin);

// ── ESTADO ─────────────────────────────────────────────────
let historicoRecibos = [];
let graficoMensal = null;
let graficoProjecao = null;
let graficoAnalyticsMensal = null;
let graficoResponsavel = null;
let graficoFormasPag = null;
let graficoMultiAno = null;
let graficoDRE = null;
let modoEdicao = null;
let _buscaGlobalIdx = -1;
const _selecionadosZip = new Set();
let idEdicao = null;
let referenciaPadrao = "";
let _lastReciboGerado = null;
let _clienteContexto = null;
let _calAno = new Date().getFullYear();
let _calMes = new Date().getMonth();
let _historicoVisiveis = 50;
let _auditDados = [];

// ── SKELETON LOADING ───────────────────────────────────────
function mostrarSkeleton(containerId, rows = 4) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({length: rows}, () =>
    `<div class="skeleton-card">
       <div class="skeleton-line" style="width:38%;height:14px;margin-bottom:8px"></div>
       <div class="skeleton-line" style="width:65%;height:12px;margin-bottom:6px"></div>
       <div class="skeleton-line" style="width:50%;height:12px"></div>
     </div>`
  ).join("");
}

// ── INICIAR ────────────────────────────────────────────────
async function iniciarApp(){
  try {
    document.getElementById("nome-usuario").textContent = usuarioLogado;
    const labelPerfil = { recepcao: "Recepção", precatorios: "Precatórios" };
    document.getElementById("perfil-usuario").textContent = labelPerfil[roleLogado] || "Financeiro";
    aplicarTema(localStorage.getItem("tema")||"light");
    mostrarSkeleton("historico-grid");
    mostrarSkeleton("clientes-grid");
    const res = await api("GET", "/api/users");
    if(res && res.ok) {
      document.getElementById("nav-usuarios").style.display = "";
      document.getElementById("bn-usuarios").style.display = "";
      document.querySelectorAll(".admin-tab-auditoria").forEach(el => el.style.display = "");
    }
    if(roleLogado === "recepcao"){
      document.querySelectorAll(".somente-financeiro").forEach(el => el.style.display = "none");
      document.getElementById("nav-admin").style.display = "none";
      document.getElementById("bn-admin").style.display = "none";
    }
    if(roleLogado === "precatorios"){
      ["nav-gerar","nav-historico","nav-clientes","bn-gerar","bn-historico","bn-clientes"].forEach(id => {
        const el = document.getElementById(id); if(el) el.style.display = "none";
      });
      document.querySelectorAll(".somente-financeiro").forEach(el => el.style.display = "none");
    }
    await Promise.all([carregarRecibos(), carregarClientes()]);
    await atualizarNumRecibo();
    await carregarReferenciaPadrao();
    atualizarSugestoesNomes();
    preencherFiltrosAnos();
    verificarClientesInativos();
    atualizarBadgeClientes();
    verificarParcelasVencendo();
    initNotifPolling();
    if(roleLogado === "precatorios") navegarPara("admin");
  } catch(e) {
    console.error("iniciarApp:", e);
  }
}

async function carregarReferenciaPadrao() {
  const res = await api("GET", "/api/me");
  if (!res || !res.ok) { mostrarToast("Erro ao carregar dados do usuário. Recarregue a página.", null, "error"); return; }
  const me = await res.json();
  referenciaPadrao = me.referencia_padrao || "";
  const el = document.getElementById("referencia");
  if (el && referenciaPadrao && !el.value) el.value = referenciaPadrao;
  const elEmitido = document.getElementById("emitido_por");
  if (elEmitido && !elEmitido.value) elEmitido.value = me.nome_completo || me.username || usuarioLogado;
  // Garante que escritorioLogado está sempre atualizado (inclusive após reload com token salvo)
  if (me.escritorio) {
    escritorioLogado = me.escritorio;
    localStorage.setItem("escritorioLogado", escritorioLogado);
  }
  if (roleLogado === "recepcao") {
    const elEsc = document.getElementById("escritorio");
    if (elEsc) {
      elEsc.value = escritorioLogado;
      elEsc.disabled = true; // recepcao não pode alterar — escritório vem do perfil
    }
  }
}

function verificarParcelasVencendo() {
  const hoje = new Date().toISOString().slice(0, 10);
  const em7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let count = 0;
  listaClientes.forEach(c => {
    if (!Array.isArray(c.parcelas)) return;
    c.parcelas.forEach(p => {
      if (p.status !== "pago" && p.data_vencimento && p.data_vencimento >= hoje && p.data_vencimento <= em7) count++;
    });
  });
  if (count > 0) {
    mostrarToast(`${count} parcela${count!==1?"s":""} vencem nos próximos 7 dias.`, () => navegarPara("clientes"), "error");
  }
}

function validarCPF(cpf) {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== parseInt(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === parseInt(d[10]);
}

function validarCNPJ(cnpj) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (str, w) => {
    let s = 0;
    for (let i = 0; i < w.length; i++) s += parseInt(str[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(d,[5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(d[12]) &&
         calc(d,[6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(d[13]);
}

// Verifica sessão ao carregar (cookie httpOnly já enviado)
if (usuarioLogado) {
  fetch("/api/me", { credentials: "include" }).then(r => {
    if (r.ok) {
      token = "1";
      document.getElementById("tela-login").classList.add("hide");
      document.getElementById("nome-usuario").textContent = usuarioLogado;
      iniciarApp();
    } else {
      fazerLogout();
    }
  }).catch(() => fazerLogout());
}

// ── CARREGAR RECIBOS ───────────────────────────────────────

async function carregarRecibos(){
  try {
    const res = await api("GET","/api/recibos?limit=200");
    if(!res) return [];
    const data = await res.json();
    historicoRecibos = (data.recibos || data) || [];
    if(!Array.isArray(historicoRecibos)) historicoRecibos = [];
    try { preencherFiltrosAvancados(); } catch(e) { console.error("filtros avancados:", e); }
    try { preencherFiltrosSalvos(); } catch(e) { console.error("filtros salvos:", e); }
    const total = data.total || 0;
    if(total > 200) setTimeout(() => carregarRecibosRestantes(total), 100);
  } catch(e) {
    console.error("carregarRecibos:", e);
    if(!Array.isArray(historicoRecibos)) historicoRecibos = [];
  }
  return historicoRecibos;
}

async function carregarRecibosRestantes(total){
  try {
    const res = await api("GET","/api/recibos?limit=50000");
    if(!res) return;
    const data = await res.json();
    const todos = (data.recibos || data) || [];
    historicoRecibos = Array.isArray(todos) ? todos : [];
    const resumoHist = document.getElementById("resumo-historico");
    if(resumoHist && historicoRecibos.length){
      const totalGeral = historicoRecibos.reduce((s, r) => s + valorParaNumero(r.valor), 0);
      resumoHist.textContent = `${historicoRecibos.length} recibos \u00B7 R$ ${formatarValor(totalGeral)} total`;
    }
    try { preencherFiltrosAvancados(); } catch(e) { console.error("filtros avancados rest:", e); }
    if(document.getElementById("screen-historico")?.classList.contains("active")) renderHistorico();
    if(document.getElementById("screen-admin")?.classList.contains("active")){
      atualizarDashboard();
      if(document.getElementById("admin-analytics")?.classList.contains("active")) carregarAnalytics();
    }
  } catch(e) {
    console.error("carregarRecibosRestantes:", e);
  }
}

// ── TEMA ───────────────────────────────────────────────────
function aplicarTema(t){
  document.documentElement.setAttribute("data-theme",t);
  const icon=document.getElementById("icon-tema");
  if(icon){ icon.className=t==="dark"?"bi bi-sun-fill":"bi bi-moon-stars"; }
  localStorage.setItem("tema",t);
}
function alternarTema(){ aplicarTema(localStorage.getItem("tema")==="dark"?"light":"dark"); }

// ── TOAST ──────────────────────────────────────────────────
let _toastQueue = [];
let _toastShowing = false;

function _showNextToast() {
  if (_toastQueue.length === 0) { _toastShowing = false; return; }
  _toastShowing = true;
  const { msg, onAbrir, tipo } = _toastQueue.shift();
  const el = document.getElementById("toast");
  const btnAbrir = document.getElementById("toast-btn-abrir");
  document.getElementById("toast-msg").textContent = msg;
  if (onAbrir) {
    btnAbrir.style.display = "block";
    btnAbrir.onclick = () => { onAbrir(); _toastQueue = []; fecharToast(); };
  } else {
    btnAbrir.style.display = "none";
  }
  el.classList.remove("success", "error");
  if (tipo === "success") el.classList.add("success");
  else if (tipo === "error") el.classList.add("error");
  el.classList.add("show");
  setTimeout(() => fecharToast(), 6000);
}

function mostrarToast(msg, onAbrir = null, tipo = "default") {
  _toastQueue.push({ msg, onAbrir, tipo });
  if (!_toastShowing) _showNextToast();
}

function fecharToast() {
  document.getElementById("toast").classList.remove("show");
  _toastShowing = false;
  _showNextToast();
}

// ── STATUS ─────────────────────────────────────────────────
function setStatus(msg,tipo){
  const el=document.getElementById("status");
  el.textContent=msg;el.className="status "+tipo;
  if(tipo!=="loading") setTimeout(()=>{el.className="status";},4000);
}
function marcarInvalido(...ids){
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.classList.add("input-error");
    el.addEventListener("input",()=>el.classList.remove("input-error"),{once:true});
  });
}

// ── NAVEGAÇÃO ──────────────────────────────────────────────
const telas=["gerar","historico","clientes","fichario","admin","usuarios"];
const titulos={gerar:"Gerar Recibo",historico:"Histórico de Recibos",clientes:"Clientes",fichario:"Fichário",admin:"Administrativo",usuarios:"Usuários"};

async function navegarPara(tela){
  try {
    telas.forEach(t=>document.getElementById("screen-"+t)?.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
    document.getElementById("screen-"+tela)?.classList.add("active");
    const navEl=document.getElementById("nav-"+tela);
    if(navEl) navEl.classList.add("active");
    document.querySelectorAll(".bn-item").forEach(n=>n.classList.remove("active"));
    const bn=document.getElementById("bn-"+tela);
    if(bn) bn.classList.add("active");
    document.getElementById("topbar-title").textContent=titulos[tela]||tela;
    if(tela==="historico"){
      var _gridH = document.getElementById("historico-grid");
      if(_gridH) _gridH.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><i class="bi bi-hourglass-split pulse"></i><p style="margin-top:8px">Carregando...</p></div>';
      try {
        if(!historicoRecibos.length) await carregarRecibos();
        renderHistorico();
      } catch(e) {
        console.error("renderHistorico:", e);
        var _m = "Erro: " + (typeof e==="object"?(e.message||e.name||JSON.stringify(e)):String(e));
        if(_gridH) _gridH.innerHTML = '<div style="text-align:center;padding:30px;color:var(--error)"><i class="bi bi-exclamation-triangle"></i><p style="margin-top:8px">Erro ao carregar hist\u00F3rico.</p><p style="font-size:12px;margin-top:6px;color:var(--muted)">'+_m+'</p></div>';
      }
    }
    if(tela==="clientes"){
      const buscaCli = document.getElementById("busca-clientes");
      if(buscaCli) buscaCli.value = "";
      renderClientes();
    }
    if(tela==="fichario") renderFichario();
    if(tela==="admin"){
      await carregarRecibos();
      atualizarDashboard();
      if(document.getElementById("admin-financeiro")?.classList.contains("active")){preencherFiltrosAnos();aplicarFiltros();}
      if(document.getElementById("admin-inadimplencia")?.classList.contains("active")) carregarInadimplencia();
      if(document.getElementById("admin-analytics")?.classList.contains("active")) carregarAnalytics();
      if(document.getElementById("admin-projecao")?.classList.contains("active")) carregarProjecao();
      if(document.getElementById("admin-escritorios")?.classList.contains("active")) carregarPorEscritorio();
      if(document.getElementById("admin-responsaveis")?.classList.contains("active")) carregarPorResponsavel();
      if(document.getElementById("admin-calendario")?.classList.contains("active")) carregarCalendario(_calAno, _calMes);
      if(document.getElementById("admin-auditoria")?.classList.contains("active")) carregarAuditoria();
    }
    if(tela==="usuarios") renderUsuarios();
  } catch(e) {
    console.error("navegarPara:", tela, e);
  }
}

// ── NÚMERO RECIBO ──────────────────────────────────────────
async function atualizarNumRecibo(){
  const res = await api("GET","/api/proximo-num");
  if(!res) return;
  const {num} = await res.json();
  document.getElementById("num-recibo").textContent=`Nº ${num}`;
  return num;
}

// ── MÁSCARAS ───────────────────────────────────────────────
function _normNome(s){ return (s||"").normalize("NFC").trim().replace(/\s+/g," ").toUpperCase(); }
function _normEsc(raw){
  const v=(raw||"").trim().toUpperCase().replace(/[-/,]+/g," ").replace(/\s+/g," ");
  if(v.includes("TERRA RICA"))   return "Terra Rica - PR";
  if(v.includes("TEODORO"))      return "Teodoro Sampaio - SP";
  if(v.includes("PRESIDENTE VENCESLAU")||v.includes("PRES VENCESLAU")) return "Presidente Venceslau - SP";
  if(v.includes("PRIMAVERA"))    return "Primavera - SP";
  if(v.includes("IVINHEMA"))     return "Ivinhema - MS";
  return raw;
}

document.getElementById("nome").addEventListener("input",function(){
  const nome = _normNome(this.value);
  if(!nome) return;
  const match    = historicoRecibos.find(r => _normNome(r.nome) === nome);
  const cadastro = listaClientes.find(c => _normNome(c.nome) === nome);
  if(!match && !cadastro) return;
  const cpf = cadastro?.cpf || match?.cpf || "";
  if(!document.getElementById("cpf").value && cpf)
    document.getElementById("cpf").value = cpf;
  if(cpf) preencherDadosCliente(cpf);
});

document.getElementById("cpf").addEventListener("input",function(){
  let v=this.value.replace(/\D/g,"").slice(0,14);
  if(v.length<=11){v=v.replace(/(\d{3})(\d)/,"$1.$2");v=v.replace(/(\d{3})(\d)/,"$1.$2");v=v.replace(/(\d{3})(\d{1,2})$/,"$1-$2");}
  else{v=v.replace(/(\d{2})(\d)/,"$1.$2");v=v.replace(/(\d{3})(\d)/,"$1.$2");v=v.replace(/(\d{3})(\d{4})/,"$1/$2");v=v.replace(/(\d{4})(\d{1,2})$/,"$1-$2");}
  document.getElementById("label-cpf").textContent=this.value.replace(/\D/g,"").length>11?"CNPJ":"CPF / CNPJ";
  this.value=v;
  // Quando CPF estiver completo, busca cliente cadastrado e preenche campos
  const digits = v.replace(/\D/g,"");
  if(digits.length===11||digits.length===14) preencherDadosCliente(v);
});

async function preencherDadosCliente(cpf){
  const set = (id, val) => { const el=document.getElementById(id); if(el&&!el.value&&val) el.value=val; };
  const digs = (cpf||"").replace(/\D/g,"");
  if(!digs) return;

  // Todos os recibos desse CPF, do mais novo ao mais antigo
  const porCpf = historicoRecibos
    .filter(r => (r.cpf||"").replace(/\D/g,"") === digs)
    .sort((a,b) => (b.timestamp||0) - (a.timestamp||0));

  // Para cada campo, usa o primeiro valor não-vazio encontrado
  const primeiro = campo => (porCpf.find(r => r[campo]) || {})[campo] || "";

  if(porCpf.length){
    set("nome",            porCpf[0].nome);
    set("municipio_uf",    primeiro("municipio_uf"));
    set("referencia",      primeiro("referencia"));
    set("emitido_por",     primeiro("emitido_por"));
    set("forma_pagamento", primeiro("forma_pagamento"));
    set("motivo_pagamento",primeiro("motivo_pagamento"));
    if(roleLogado !== "recepcao") set("escritorio", _normEsc(primeiro("escritorio")));
  }

  // Cadastro formal via API — sobrescreve com dados mais completos
  const res = await api("GET", `/api/clientes/cpf/${encodeURIComponent(cpf)}`);
  if(res && res.ok){
    const c = await res.json();
    set("nome",         c.nome);
    set("municipio_uf", c.municipio_uf);
    set("referencia",   c.referencia);
    if((c.valor_parcela||0) > 0 && !document.getElementById("valor").value){
      const vf = Number(c.valor_parcela).toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
      document.getElementById("valor").value = vf;
    }
  }
}

document.getElementById("valor").addEventListener("input",function(){
  let v=this.value.replace(/\D/g,"");
  if(!v){this.value="";return;}
  v=(parseInt(v)/100).toFixed(2);
  this.value=v.replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
});

document.getElementById("dia").addEventListener("input",function(){
  if(this.value.length===2) document.getElementById("mes").focus();
});

document.getElementById("dia").addEventListener("focus",function(){
  if(!this.value){
    const hoje=new Date();
    this.value=hoje.getDate();
    document.getElementById("mes").value=String(hoje.getMonth()+1).padStart(2,"0");
    document.getElementById("ano").value=hoje.getFullYear();
  }
});

// ── LIMPAR ─────────────────────────────────────────────────
function limparCampos(){
  ["nome","cpf","municipio_uf","valor","complemento","referencia","dia","ano","emitido_por"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value="";
  });
  document.getElementById("mes").value="";
  document.getElementById("forma_pagamento").value="";
  const elEsc = document.getElementById("escritorio");
  if (elEsc) {
    elEsc.value = roleLogado === "recepcao" ? escritorioLogado : "";
    elEsc.disabled = roleLogado === "recepcao";
  }
  document.getElementById("motivo_pagamento").value="";
  const comp = document.getElementById("comprovante");
  if(comp) comp.value="";
  const compStatus = document.getElementById("comprovante-status");
  if(compStatus) compStatus.textContent="";
  const label = document.getElementById("comprovante-label");
  const labelText = document.getElementById("comprovante-label-text");
  if(label) label.classList.remove("has-file");
  if(labelText) labelText.textContent = "Escolher arquivo (imagem ou PDF)";
  // Restaura referência padrão do usuário
  const refEl = document.getElementById("referencia");
  if(refEl && referenciaPadrao) refEl.value = referenciaPadrao;
  const btnRef = document.getElementById("btn-ref-padrao-recibo");
  if(btnRef) btnRef.style.display = "none";
  _clienteContexto = null;
  const emailEl = document.getElementById("email-cliente");
  if(emailEl) emailEl.value="";
  const areaEmailClear = document.getElementById("area-enviar-email");
  if(areaEmailClear) areaEmailClear.style.display="none";
  setStatus("","");
}

function onReferenciaInput() {
  const val = (document.getElementById("referencia").value || "").trim().toUpperCase();
  const btn = document.getElementById("btn-ref-padrao-recibo");
  if (btn) btn.style.display = (val && val !== referenciaPadrao) ? "" : "none";
}

async function salvarReferenciaPadraoRecibo() {
  const val = (document.getElementById("referencia").value || "").trim().toUpperCase();
  if (!val) return mostrarToast("Preencha o campo de referência primeiro.");
  const res = await api("PUT", "/api/me/referencia", { referencia_padrao: val });
  if (!res || !res.ok) return mostrarToast("Erro ao salvar referência padrão.");
  referenciaPadrao = val;
  document.getElementById("btn-ref-padrao-recibo").style.display = "none";
  mostrarToast("Referência padrão salva!");
}

async function salvarReferenciaPadrao() {
  const val = (document.getElementById("cliente-referencia").value || "").trim().toUpperCase();
  if (!val) return mostrarToast("Preencha o campo de referência primeiro.");
  const res = await api("PUT", "/api/me/referencia", { referencia_padrao: val });
  if (!res || !res.ok) return mostrarToast("Erro ao salvar referência padrão.");
  referenciaPadrao = val;
  mostrarToast("Referência padrão salva!");
}

function fecharModal(id){document.getElementById(id).classList.remove("active");}

function atualizarLabelComprovante(input){
  const label = document.getElementById("comprovante-label");
  const labelText = document.getElementById("comprovante-label-text");
  if(input.files[0]){
    label.classList.add("has-file");
    labelText.textContent = input.files[0].name;
  } else {
    label.classList.remove("has-file");
    labelText.textContent = "Escolher arquivo (imagem ou PDF)";
  }
}

function abrirComprovante(link) {
  try {
    const body = document.getElementById("modal-comprovante-body");
    if (!body) { alert("Erro interno: modal-comprovante-body não encontrado."); return; }
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Carregando...</div>`;
    const modal = document.getElementById("modal-comprovante");
    if (!modal) { alert("Erro interno: modal-comprovante não encontrado."); return; }
    modal.classList.add("active");

  // Drive: qualquer formato (/d/ID/, ?id=ID, open?id=ID) → preview nativo do Drive
  const driveId = (link && (link.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || []))[1];
  if (driveId) {
    body.innerHTML = `<iframe src="https://drive.google.com/file/d/${driveId}/preview" width="100%" height="600" style="border:none;border-radius:8px"></iframe>`;
    return;
  }

  // Links autenticados (S3 proxy ou arquivo local) → fetch com JWT → blob
  const isLocal = link.startsWith("/api/comprovante");
  if (isLocal) {
    fetch(link, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const isImg = /^image\//.test(blob.type);
        body.innerHTML = isImg
          ? `<img src="${url}" style="max-width:100%;border-radius:8px" />`
          : `<iframe src="${url}" width="100%" height="600" style="border:none;border-radius:8px"></iframe>`;
      })
      .catch(e => { body.innerHTML = `<p style="color:red;text-align:center;padding:20px">Erro ao carregar comprovante (${e.message}).</p>`; });
    return;
  }

  // Presigned URL S3 expirada → mostra mensagem amigável
  if (link.includes("amazonaws.com") && link.includes("X-Amz-")) {
    body.innerHTML = `<p style="text-align:center;padding:30px;color:var(--muted)">Link do comprovante expirado.<br>Clique em "Limpar e reescrever do zero" no painel Admin para renovar.</p>`;
    return;
  }

  // Fallback: abre direto (ex: URL pública externa) — só permite https
  if (!link.startsWith("https://")) {
    body.innerHTML = `<p style="color:red;text-align:center;padding:20px">Link de comprovante inválido.</p>`;
    return;
  }
  body.innerHTML = `<iframe src="${esc(link)}" width="100%" height="600" style="border:none;border-radius:8px"></iframe>`;
  } catch (e) {
    console.error("abrirComprovante error:", e);
    const modal = document.getElementById("modal-comprovante");
    if (modal) modal.classList.add("active");
    const body = document.getElementById("modal-comprovante-body");
    if (body) body.innerHTML = `<p style="color:red;text-align:center;padding:20px">Erro ao abrir comprovante: ${e.message}</p>`;
  }
}

// ── FORMATAÇÃO ─────────────────────────────────────────────
function formatarData(){
  const dia=String(document.getElementById("dia").value).padStart(2,"0");
  const mes=String(document.getElementById("mes").value).padStart(2,"0");
  const ano=document.getElementById("ano").value;
  return `${dia}/${mes}/${ano}`;
}

function dataExtenso(){
  const meses=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const dia=document.getElementById("dia").value;
  const mes=parseInt(document.getElementById("mes").value);
  const ano=document.getElementById("ano").value;
  return `${parseInt(dia)} de ${meses[mes-1]} de ${ano}`;
}

// ── EDITAR / DUPLICAR ──────────────────────────────────────
function editarRecibo(r){
  modoEdicao=true;
  idEdicao=r.id;
  document.getElementById("nome").value=r.nome;
  document.getElementById("cpf").value=r.cpf;
  document.getElementById("municipio_uf").value=r.municipio_uf;
  document.getElementById("valor").value=r.valor;
  document.getElementById("complemento").value=r.complemento||"";
  document.getElementById("referencia").value=r.referencia||"";
  document.getElementById("emitido_por").value=r.emitido_por||"";
  document.getElementById("forma_pagamento").value=r.forma_pagamento||"";
  document.getElementById("escritorio").value=r.escritorio||"";
  document.getElementById("motivo_pagamento").value=r.motivo_pagamento||"";
  const [dia,mes,ano]=(r.data||"").split("/");
  document.getElementById("dia").value=parseInt(dia)||"";
  document.getElementById("mes").value=mes||"";
  document.getElementById("ano").value=ano||"";
  document.getElementById("edit-mode-banner").style.display="flex";
  document.getElementById("edit-num-banner").textContent=r.num;
  document.getElementById("btn-gerar").textContent="Salvar Edição";
  navegarPara("gerar");
  document.getElementById("valor").focus();
}

function cancelarEdicao(){
  modoEdicao=null; idEdicao=null;
  document.getElementById("edit-mode-banner").style.display="none";
  document.getElementById("btn-gerar").textContent="Gerar Recibo";
  limparCampos();
}

function duplicarRecibo(r){
  limparCampos();
  document.getElementById("nome").value=r.nome;
  document.getElementById("cpf").value=r.cpf;
  document.getElementById("municipio_uf").value=r.municipio_uf;
  document.getElementById("emitido_por").value=r.emitido_por||"";
  document.getElementById("referencia").value=r.referencia||"";
  document.getElementById("complemento").value=r.complemento||"";
  navegarPara("gerar");
  document.getElementById("valor").focus();
  mostrarToast(`Formulário pré-preenchido com dados de ${r.nome}.`);
}
