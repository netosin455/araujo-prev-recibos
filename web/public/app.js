// =============================================================
//  COMPORTAMENTO — web/public/app.js
//  Roda no navegador do usuário.
//
//  O QUE ESSE ARQUIVO FAZ:
//  - Controla o que acontece quando o usuário clica em algo
//  - Envia e recebe dados do servidor
//  - Gera o PDF na tela
//  - Controla qual tela está visível
//
//  QUANDO MEXER AQUI:
//  - Mudar o que um botão faz
//  - Mudar como os dados são exibidos na tela
//  - Mudar o PDF gerado no navegador
//  - Adicionar comportamentos novos (filtros, cálculos, etc.)
// =============================================================

// ── UTILITÁRIOS ────────────────────────────────────────────
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function valorParaNumero(v){ return parseFloat((v||"0").replace(/\./g,"").replace(",","."))||0; }
function formatarValor(n){ return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── AUTH ───────────────────────────────────────────────────
let token = localStorage.getItem("token") || "";
let usuarioLogado = localStorage.getItem("usuarioLogado") || "";
let roleLogado = localStorage.getItem("roleLogado") || "financeiro";
let escritorioLogado = localStorage.getItem("escritorioLogado") || "";

async function api(method, path, body){
  const opts = { method, headers: { "Content-Type":"application/json", "Authorization":"Bearer "+token } };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if(res.status===401){ fazerLogout(); return null; }
  return res;
}

async function fazerLogin(){
  const username = document.getElementById("login-usuario").value.trim();
  const password = document.getElementById("login-senha").value;
  const erroEl = document.getElementById("login-erro");
  erroEl.style.display="none";
  if(!username||!password){ erroEl.textContent="Preencha usuário e senha."; erroEl.style.display="block"; return; }
  const res = await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
  const data = await res.json();
  if(!res.ok){ erroEl.textContent=data.erro||"Erro ao entrar."; erroEl.style.display="block"; return; }
  token = data.token;
  usuarioLogado = data.username;
  roleLogado = data.role || "financeiro";
  escritorioLogado = data.escritorio || "";
  localStorage.setItem("token", token);
  localStorage.setItem("usuarioLogado", usuarioLogado);
  localStorage.setItem("roleLogado", roleLogado);
  localStorage.setItem("escritorioLogado", escritorioLogado);
  document.getElementById("tela-login").classList.add("hide");
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  iniciarApp();
}

function fazerLogout(){
  localStorage.removeItem("token");
  localStorage.removeItem("usuarioLogado");
  localStorage.removeItem("roleLogado");
  localStorage.removeItem("escritorioLogado");
  token=""; usuarioLogado=""; roleLogado="financeiro"; escritorioLogado="";
  location.reload();
}

document.getElementById("login-senha").addEventListener("keydown", e=>{ if(e.key==="Enter") fazerLogin(); });
document.getElementById("login-usuario").addEventListener("keydown", e=>{ if(e.key==="Enter") document.getElementById("login-senha").focus(); });

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
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  const labelPerfil = { recepcao: "Recepção", precatorios: "Precatórios" };
  document.getElementById("perfil-usuario").textContent = labelPerfil[roleLogado] || "Financeiro";
  aplicarTema(localStorage.getItem("tema")||"light");
  mostrarSkeleton("historico-grid");
  mostrarSkeleton("clientes-grid");
  // Mostra menu de usuários só para admin
  const res = await api("GET", "/api/users");
  if(res && res.ok) {
    document.getElementById("nav-usuarios").style.display = "";
    document.getElementById("bn-usuarios").style.display = "";
    document.querySelectorAll(".admin-tab-auditoria").forEach(el => el.style.display = "");
  }
  // Esconde ações e menus restritos para recepção
  if(roleLogado === "recepcao"){
    document.querySelectorAll(".somente-financeiro").forEach(el => el.style.display = "none");
    document.getElementById("nav-admin").style.display = "none";
    document.getElementById("bn-admin").style.display = "none";
  }
  // Precatórios: só vê o painel administrativo (sem gerar recibo, histórico, clientes)
  if(roleLogado === "precatorios"){
    ["nav-gerar","nav-historico","nav-clientes","bn-gerar","bn-historico","bn-clientes"].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display = "none";
    });
    document.querySelectorAll(".somente-financeiro").forEach(el => el.style.display = "none");
  }
  await Promise.all([carregarRecibos(), carregarClientes()]);
  await atualizarNumRecibo();
  await carregarReferenciaPadrao();
  iniciarAvisoSessao();
  atualizarSugestoesNomes();
  preencherFiltrosAnos();
  verificarClientesInativos();
  atualizarBadgeClientes();
  verificarParcelasVencendo();
  initNotifPolling();
  if(roleLogado === "precatorios") navegarPara("admin");
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

function iniciarAvisoSessao() {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const avisarEm = payload.exp * 1000 - Date.now() - 15 * 60 * 1000;
    if (avisarEm > 0) {
      setTimeout(() => {
        mostrarToast("Sua sessão expira em 15 min. Salve o trabalho.", null, "error");
      }, avisarEm);
    }
  } catch(e) { /* token sem exp ou inválido */ }
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

// Verifica token ao carregar
if(token){
  document.getElementById("tela-login").classList.add("hide");
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  iniciarApp();
}

bindStaticHandlers();

// ── CARREGAR RECIBOS ───────────────────────────────────────
async function carregarRecibos(){
  const res = await api("GET","/api/recibos?limit=5000");
  if(!res) return;
  const data = await res.json();
  historicoRecibos = Array.isArray(data) ? data : (data.recibos || []);
  preencherFiltrosAvancados();
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
let _toastTimer=null;
function mostrarToast(msg,onAbrir=null,tipo="default"){
  const el=document.getElementById("toast");
  const btnAbrir=document.getElementById("toast-btn-abrir");
  document.getElementById("toast-msg").textContent=msg;
  if(onAbrir){btnAbrir.style.display="block";btnAbrir.onclick=()=>{onAbrir();fecharToast();};}
  else{btnAbrir.style.display="none";}
  el.classList.remove("success","error");
  if(tipo==="success") el.classList.add("success");
  else if(tipo==="error") el.classList.add("error");
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(fecharToast,6000);
}
function fecharToast(){document.getElementById("toast").classList.remove("show");}

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
const telas=["gerar","historico","clientes","admin","usuarios"];
const titulos={gerar:"Gerar Recibo",historico:"Histórico de Recibos",clientes:"Clientes",admin:"Administrativo",usuarios:"Usuários"};

async function navegarPara(tela){
  telas.forEach(t=>document.getElementById("screen-"+t)?.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  document.getElementById("screen-"+tela)?.classList.add("active");
  const idx=["gerar","historico","clientes","admin"].indexOf(tela);
  if(idx>=0) document.querySelectorAll(".nav-item")[idx]?.classList.add("active");
  // Atualiza bottom nav mobile
  document.querySelectorAll(".bn-item").forEach(n=>n.classList.remove("active"));
  const bn=document.getElementById("bn-"+tela);
  if(bn) bn.classList.add("active");
  document.getElementById("topbar-title").textContent=titulos[tela]||tela;
  if(tela==="historico"){
    await carregarRecibos();
    renderHistorico();
  }
  if(tela==="clientes"){
    const buscaCli = document.getElementById("busca-clientes");
    if(buscaCli) buscaCli.value = "";
    renderClientes();
  }
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
  const body = document.getElementById("modal-comprovante-body");
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Carregando...</div>`;
  document.getElementById("modal-comprovante").classList.add("active");

  // Drive: qualquer formato (/d/ID/, ?id=ID, open?id=ID) → preview nativo do Drive
  const driveId = (link.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || [])[1];
  if (driveId) {
    body.innerHTML = `<iframe src="https://drive.google.com/file/d/${driveId}/preview" width="100%" height="600" style="border:none;border-radius:8px"></iframe>`;
    return;
  }

  // Links autenticados (S3 proxy ou arquivo local) → fetch com JWT → blob
  const isLocal = link.startsWith("/api/comprovante");
  if (isLocal) {
    fetch(link, { headers: { Authorization: "Bearer " + localStorage.getItem("token") } })
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

// ── GERAR RECIBO ───────────────────────────────────────────
async function gerarRecibo(){
  const campos=["nome","cpf","municipio_uf","valor","emitido_por","escritorio"];
  const dados={};
  const vazios=[];
  for(const c of campos){
    const val=document.getElementById(c).value.trim();
    if(!val) vazios.push(c);
    else dados[c]=val;
  }
  if(vazios.length){ marcarInvalido(...vazios); return setStatus("Preencha todos os campos obrigatórios.","error"); }
  dados.complemento=document.getElementById("complemento").value.trim();
  dados.referencia=document.getElementById("referencia").value.trim().toUpperCase();
  dados.forma_pagamento=document.getElementById("forma_pagamento").value;
  dados.escritorio=document.getElementById("escritorio").value;
  dados.motivo_pagamento=document.getElementById("motivo_pagamento").value;
  const dia=document.getElementById("dia").value;
  const mes=document.getElementById("mes").value;
  const ano=document.getElementById("ano").value;
  if(!dia||!mes||!ano){ marcarInvalido(...["dia","mes","ano"].filter(id=>!document.getElementById(id).value)); return setStatus("Preencha a data completa.","error"); }
  const _dataCheck=new Date(parseInt(ano),parseInt(mes)-1,parseInt(dia));
  if(_dataCheck.getMonth()!==parseInt(mes)-1){ marcarInvalido("dia","mes","ano"); return setStatus("Data inválida (ex: 31/02 não existe).","error"); }
  dados.data=formatarData();
  dados.data_extenso=dataExtenso();
  dados.nome=dados.nome.toUpperCase();
  dados.municipio_uf=dados.municipio_uf.toUpperCase();
  dados.emitido_por=dados.emitido_por.toUpperCase();
  const _cpfDigits=dados.cpf.replace(/\D/g,"");
  if(_cpfDigits.length===11&&!validarCPF(dados.cpf)){ marcarInvalido("cpf"); return setStatus("CPF inválido. Verifique os dígitos.","error"); }
  if(_cpfDigits.length===14&&!validarCNPJ(dados.cpf)){ marcarInvalido("cpf"); return setStatus("CNPJ inválido. Verifique os dígitos.","error"); }

  const btn=document.getElementById("btn-gerar");
  const btnTextoOriginal = btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split spin"></i> Gerando...';
  setStatus("Gerando recibo...","loading");

  try {
  // Modo edição
  if(modoEdicao && idEdicao){
    // Upload comprovante se selecionado
    let link_comprovante_edicao = "";
    const compInputEdicao = document.getElementById("comprovante");
    if(compInputEdicao && compInputEdicao.files[0]){
      const compStatus = document.getElementById("comprovante-status");
      if(compStatus) compStatus.textContent = "Enviando comprovante...";
      const fd = new FormData();
      fd.append("comprovante", compInputEdicao.files[0]);
      const token = localStorage.getItem("token");
      try {
        const r = await fetch("/api/upload-comprovante", { method:"POST", headers:{"Authorization":"Bearer "+token}, body:fd });
        const j = await r.json();
        if(j.link){ link_comprovante_edicao = j.link; if(compStatus) compStatus.textContent = "Comprovante enviado!"; }
        else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; mostrarToast(j.erro || "Erro ao enviar comprovante.", null, "error"); }
      } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; mostrarToast("Erro ao enviar comprovante: " + e.message, null, "error"); }
    }
    const bodyEdicao = {
      nome:dados.nome,cpf:dados.cpf,municipio_uf:dados.municipio_uf,
      valor:dados.valor,data:dados.data,emitido_por:dados.emitido_por,
      complemento:dados.complemento,referencia:dados.referencia,
      forma_pagamento:dados.forma_pagamento,escritorio:dados.escritorio,
      motivo_pagamento:dados.motivo_pagamento
    };
    if(link_comprovante_edicao) bodyEdicao.link_comprovante = link_comprovante_edicao;
    const res=await api("PUT",`/api/recibos/${idEdicao}`, bodyEdicao);
    if(res&&res.ok){
      await carregarRecibos();
      atualizarSugestoesNomes();
      setStatus("Recibo atualizado!","success");
      mostrarToast("Recibo atualizado com sucesso!", null, "success");
      cancelarEdicao();
    } else {
      setStatus("Erro ao atualizar.","error");
      mostrarToast("Erro ao atualizar o recibo.", null, "error");
    }
    btn.disabled=false; btn.innerHTML=btnTextoOriginal;
    return;
  }

  // Buscar próximo número
  const numRes=await api("GET","/api/proximo-num");
  if(!numRes){btn.disabled=false;btn.innerHTML=btnTextoOriginal;return;}
  const {num}=await numRes.json();
  dados.num_recibo=num;

  // Formato escolhido
  const formatoSel = document.querySelector('input[name="formato"]:checked');
  dados.formato = formatoSel ? formatoSel.value : "docx";

  // Gerar documento
  const res=await api("POST","/api/gerar-recibo",dados);
  if(!res||!res.ok){
    setStatus("Erro ao gerar recibo.","error");
    mostrarToast("Erro ao gerar recibo.", null, "error");
    btn.disabled=false; btn.innerHTML=btnTextoOriginal;
    return;
  }

  // Download do arquivo
  const blob=await res.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  const ext = dados.formato === "pdf" ? "pdf" : "docx";
  a.download=`recibo_${num.replace("/","-")}_${dados.nome.replace(/\s+/g,"_").toLowerCase()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);

  // Upload comprovante se houver
  let link_comprovante = "";
  const compInput = document.getElementById("comprovante");
  if(compInput && compInput.files[0]){
    const compStatus = document.getElementById("comprovante-status");
    if(compStatus) compStatus.textContent = "Enviando comprovante...";
    const fd = new FormData();
    fd.append("comprovante", compInput.files[0]);
    const token = localStorage.getItem("token");
    try {
      const r = await fetch("/api/upload-comprovante", { method:"POST", headers:{"Authorization":"Bearer "+token}, body:fd });
      const j = await r.json();
      if(j.link){ link_comprovante = j.link; if(compStatus) compStatus.textContent = "Comprovante enviado!"; }
      else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; mostrarToast(j.erro || "Erro ao enviar comprovante.", null, "error"); }
    } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; mostrarToast("Erro ao enviar comprovante: " + e.message, null, "error"); }
  }

  // Salvar no banco
  const salvarRes = await api("POST","/api/recibos",{
    num:dados.num_recibo,nome:dados.nome,cpf:dados.cpf,
    municipio_uf:dados.municipio_uf,valor:dados.valor,
    data:dados.data,emitido_por:dados.emitido_por,
    complemento:dados.complemento,referencia:dados.referencia,
    forma_pagamento:dados.forma_pagamento,escritorio:dados.escritorio,
    motivo_pagamento:dados.motivo_pagamento,link_comprovante,
    timestamp:Date.now()
  });
  if (salvarRes) {
    try {
      const salvarJson = await salvarRes.json();
      if (salvarJson.sheets_ok === false) {
        mostrarToast("Recibo salvo! Aviso: Google Sheets fora de sincronia. Execute 'Reescrever planilha' no painel admin.", null, "error");
      }
    } catch (e) {
      mostrarToast("Erro ao processar resposta do servidor: " + e.message + ". Recarregue a página.", null, "error");
      console.error("Erro parse resposta /api/recibos:", e);
    }
  } else {
    mostrarToast("Falha ao salvar recibo no banco. Verifique o console.", null, "error");
  }

  await carregarRecibos();
  await atualizarNumRecibo();
  atualizarSugestoesNomes();
  verificarClientesInativos();
  setStatus("Recibo gerado com sucesso!","success");
  mostrarToast(`Recibo ${num} gerado! Baixando...`, null, "success");

  // Oferece vinculação com parcela se o recibo foi para um cliente cadastrado
  const emailCliente = (document.getElementById("email-cliente")?.value || "").trim();
  _lastReciboGerado = { nome: dados.nome, num, valor: dados.valor, data: dados.data, cpf: dados.cpf, emitido_por: dados.emitido_por, email: emailCliente };
  const ctx = _clienteContexto;
  limparCampos();
  btn.disabled=false; btn.innerHTML=btnTextoOriginal;
  if (emailCliente) {
    const areaEmail = document.getElementById("area-enviar-email");
    if (areaEmail) areaEmail.style.display = "";
    const statusEmail = document.getElementById("email-envio-status");
    if (statusEmail) statusEmail.textContent = `Enviar para: ${emailCliente}`;
  }
  if (ctx && ctx.id) {
    const parcelasPendentes = (ctx.parcelas || []).filter(p => p.status !== "pago");
    if (parcelasPendentes.length > 0 && confirm(`Deseja marcar a parcela ${parcelasPendentes[0].num} de "${ctx.nome}" como paga com o recibo ${num}?`)) {
      abrirModalPagamentoParcela(ctx.id, parcelasPendentes[0].num, parcelasPendentes[0].valor, num);
    }
  }
  } finally {
    btn.disabled=false; btn.innerHTML=btnTextoOriginal;
  }
}

async function enviarReciboEmail() {
  if (!_lastReciboGerado) return;
  const btn = document.getElementById("btn-enviar-email-recibo");
  const statusEl = document.getElementById("email-envio-status");
  const orig = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...'; }
  try {
    const res = await api("POST", "/api/notificacoes/enviar-recibo-email", {
      email: _lastReciboGerado.email,
      nome: _lastReciboGerado.nome,
      num: _lastReciboGerado.num,
      valor: _lastReciboGerado.valor,
      data: _lastReciboGerado.data
    });
    if (!res || res.status === 404) {
      if (statusEl) statusEl.textContent = "Em breve — envio por e-mail em desenvolvimento.";
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = j.erro || "Erro ao enviar e-mail.";
      return;
    }
    if (statusEl) { statusEl.style.color = "var(--success)"; statusEl.textContent = "E-mail enviado com sucesso!"; }
    if (btn) btn.disabled = true;
  } finally {
    if (btn && !btn.disabled) { btn.disabled = false; btn.innerHTML = orig; }
    else if (btn && btn.innerHTML !== orig && btn.disabled) { btn.innerHTML = '<i class="bi bi-envelope-check"></i> Enviado'; }
  }
}

// ── HISTÓRICO ──────────────────────────────────────────────
function dataParaISO(ddmmyyyy){
  if(!ddmmyyyy) return null;
  const [d,m,y]=ddmmyyyy.split("/");
  if(!d||!m||!y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

function limparFiltroData(){
  document.getElementById("filtro-data-ini").value="";
  document.getElementById("filtro-data-fim").value="";
  renderHistorico();
}

function renderBuscaGlobal(termo) {
  _buscaGlobalIdx = -1;
  const dropdown = document.getElementById("busca-global-dropdown");
  if (!termo || termo.length < 2) { dropdown.style.display = "none"; return; }
  const t = termo.toLowerCase();
  const recibos = historicoRecibos.filter(r =>
    (r.nome||"").toLowerCase().includes(t) || (r.num||"").toLowerCase().includes(t) || (r.cpf||"").replace(/\D/g,"").includes(t.replace(/\D/g,""))
  ).slice(0, 5);
  const clientes = listaClientes.filter(c =>
    (c.nome||"").toLowerCase().includes(t) || (c.cpf||"").replace(/\D/g,"").includes(t.replace(/\D/g,""))
  ).slice(0, 5);
  if (!recibos.length && !clientes.length) { dropdown.style.display = "none"; return; }
  let html = "";
  if (recibos.length) {
    html += `<div class="global-dropdown-group">Recibos</div>`;
    html += recibos.map(r => `<div class="global-dropdown-item" data-type="recibo" data-id="${esc(r.id||r._id)}"><strong>${esc(r.num)}</strong> — ${esc(r.nome)} <span>R$ ${esc(r.valor)}</span></div>`).join("");
  }
  if (clientes.length) {
    html += `<div class="global-dropdown-group">Clientes</div>`;
    html += clientes.map(c => `<div class="global-dropdown-item" data-type="cliente" data-id="${esc(c.id||c._id)}"><strong>${esc(c.nome)}</strong> <span>${esc(c.cpf||"")}</span></div>`).join("");
  }
  dropdown.innerHTML = html;
  dropdown.style.display = "";
  dropdown.querySelectorAll(".global-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const buscaGlobal = document.getElementById("busca-global");
      dropdown.style.display = "none";
      buscaGlobal.value = "";
      if (item.dataset.type === "recibo") {
        const r = historicoRecibos.find(x => (x.id||x._id) === item.dataset.id);
        navegarPara("historico");
        if (r) setTimeout(() => abrirDetalhe(r), 100);
      } else {
        navegarPara("clientes");
        setTimeout(() => {
          const inp = document.getElementById("busca-clientes");
          const c = listaClientes.find(x => (x.id||x._id) === item.dataset.id);
          if (inp && c) { inp.value = c.nome; renderClientes(); }
        }, 50);
      }
    });
  });
}

function renderHistorico(maisItens=false){
  if(!maisItens) _historicoVisiveis=50;
  const busca=(document.getElementById("busca-historico").value||"").toLowerCase();
  const dataIni=document.getElementById("filtro-data-ini")?.value||"";
  const dataFim=document.getElementById("filtro-data-fim")?.value||"";
  const buscaDigitos=busca.replace(/\D/g,"");
  const escritorioFiltro=(document.getElementById("filtro-avancado-escritorio")?.value||"") || (roleLogado==="recepcao" ? escritorioLogado : "");
  const formaFiltro=(document.getElementById("filtro-avancado-forma")?.value||"");
  const responsavelFiltro=(document.getElementById("filtro-avancado-responsavel")?.value||"");
  const minFiltroRaw=(document.getElementById("filtro-avancado-min")?.value||"").trim();
  const maxFiltroRaw=(document.getElementById("filtro-avancado-max")?.value||"").trim();
  const minFiltro=minFiltroRaw?valorParaNumero(minFiltroRaw):0;
  const maxFiltro=maxFiltroRaw?valorParaNumero(maxFiltroRaw):0;
  const lista=historicoRecibos.filter(r=>{
    const nomeOk=(r.nome||"").toLowerCase().includes(busca);
    const cpfOk=buscaDigitos.length>0&&(r.cpf||"").replace(/\D/g,"").includes(buscaDigitos);
    if(!nomeOk&&!cpfOk) return false;
    if(dataIni||dataFim){
      const iso=dataParaISO(r.data);
      if(!iso) return false;
      if(dataIni&&iso<dataIni) return false;
      if(dataFim&&iso>dataFim) return false;
    }
    if(escritorioFiltro&&(r.escritorio||"").toUpperCase()!==escritorioFiltro.toUpperCase()) return false;
    if(formaFiltro&&(r.forma_pagamento||"")!==formaFiltro) return false;
    if(responsavelFiltro&&(r.emitido_por||"")!==responsavelFiltro) return false;
    const val=valorParaNumero(r.valor);
    if(minFiltro>0&&val<minFiltro) return false;
    if(maxFiltro>0&&val>maxFiltro) return false;
    return true;
  });
  const grid=document.getElementById("historico-grid");
  const count=document.getElementById("historico-count");
  count.textContent=`${lista.length} recibo${lista.length!==1?"s":""}`;
  const resumoHist = document.getElementById("resumo-historico");
  if (resumoHist && historicoRecibos.length) {
    const totalGeral = historicoRecibos.reduce((s, r) => s + valorParaNumero(r.valor), 0);
    resumoHist.textContent = `${historicoRecibos.length} recibo${historicoRecibos.length !== 1 ? "s" : ""} · R$ ${formatarValor(totalGeral)} total`;
    resumoHist.style.display = "";
  }
  if(!lista.length){
    grid.innerHTML=`<div class="empty-state"><div class="icon">🧾</div><p>${busca?"Nenhum recibo encontrado.":"Nenhum recibo gerado ainda."}</p></div>`;
    return;
  }
  _selecionadosZip.clear();
  document.getElementById("batch-actions").style.display = "none";
  grid.innerHTML="";
  const listaVis = lista.slice(0, _historicoVisiveis);
  listaVis.forEach(recibo=>{
    const rid = recibo.id || recibo._id;
    const item=document.createElement("div");
    item.className="recibo-item";
    item.style.position="relative";
    item.innerHTML=`
      <label style="position:absolute;top:10px;left:10px;cursor:pointer;z-index:1" title="Selecionar para ZIP">
        <input type="checkbox" class="recibo-check" data-id="${esc(rid)}" style="width:15px;height:15px;cursor:pointer" />
      </label>
      <div class="recibo-info" style="padding-left:28px">
        <div class="recibo-num">${esc(recibo.num)}</div>
        <div class="recibo-nome">${esc(recibo.nome)}</div>
        <div class="recibo-valor">R$ ${esc(recibo.valor)}</div>
        <div class="recibo-meta">${esc(recibo.data)} · ${esc(recibo.municipio_uf)} · ${esc(recibo.emitido_por||"N/A")}${recibo.referencia?" · Ref: "+esc(recibo.referencia):""}</div>
      </div>
      <div class="recibo-actions">
        <button class="btn-secondary btn-sm" data-action="detalhe">Detalhes</button>
        <button class="btn-gold btn-sm" data-action="ver"><i class="bi bi-eye"></i> Ver</button>
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="editar">Editar</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="duplicar">Duplicar</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="recorrente"><i class="bi bi-arrow-repeat"></i> Recorrente</button>`:""}
        <button class="btn-secondary btn-sm" data-action="reimprimir">📄 Baixar</button>
        ${roleLogado==="recepcao"?`<button class="btn-secondary btn-sm" data-action="upload-comp">📎 Comprovante</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-danger btn-sm" data-action="excluir">🗑</button>`:""}
      </div>`;
    item.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        if(btn.dataset.action==="detalhe") abrirDetalhe(recibo);
        if(btn.dataset.action==="ver") abrirPDFRecibo(recibo);
        if(btn.dataset.action==="editar") editarRecibo(recibo);
        if(btn.dataset.action==="duplicar") duplicarRecibo(recibo);
        if(btn.dataset.action==="recorrente") preencherReciboRecorrente(recibo);
        if(btn.dataset.action==="reimprimir") reimprimirRecibo(recibo);
        if(btn.dataset.action==="upload-comp") abrirModalUploadComprovante(recibo.id||recibo._id);
        if(btn.dataset.action==="excluir"){
          if(!confirm(`Excluir recibo ${recibo.num}?`)) return;
          await api("DELETE",`/api/recibos/${recibo.id}`);
          await carregarRecibos();
          renderHistorico();
        }
      });
    });
    const chk = item.querySelector(".recibo-check");
    if (chk) chk.addEventListener("change", () => {
      if (chk.checked) _selecionadosZip.add(chk.dataset.id);
      else _selecionadosZip.delete(chk.dataset.id);
      atualizarBarraBatch();
    });
    grid.appendChild(item);
  });
  if (lista.length > _historicoVisiveis) {
    const btnWrap = document.createElement("div");
    btnWrap.style.textAlign = "center"; btnWrap.style.marginTop = "16px";
    btnWrap.innerHTML = `<button class="btn-secondary" id="btn-carregar-mais" style="min-width:200px"><i class="bi bi-arrow-down-circle"></i> Carregar mais (${lista.length - _historicoVisiveis} restantes)</button>`;
    btnWrap.querySelector("button").addEventListener("click", () => { _historicoVisiveis += 50; renderHistorico(true); });
    grid.appendChild(btnWrap);
  }
}

function atualizarBarraBatch() {
  const batchDiv = document.getElementById("batch-actions");
  const label = document.getElementById("batch-count-label");
  const count = _selecionadosZip.size;
  if (count > 0) {
    batchDiv.style.display = "flex";
    if (label) label.textContent = count + " selecionado(s)";
  } else {
    batchDiv.style.display = "none";
  }
}

function selecionarTodosRecibos() {
  const chks = document.querySelectorAll(".recibo-check");
  const someUnchecked = Array.from(chks).some(c => !c.checked);
  chks.forEach(c => { c.checked = someUnchecked; });
  _selecionadosZip.clear();
  if (someUnchecked) {
    chks.forEach(c => _selecionadosZip.add(c.dataset.id));
  }
  atualizarBarraBatch();
}

async function excluirSelecionados() {
  if (_selecionadosZip.size === 0) return;
  if (!confirm("Excluir " + _selecionadosZip.size + " recibo(s) permanentemente?")) return;
  for (const id of _selecionadosZip) {
    await api("DELETE", "/api/recibos/" + id);
  }
  _selecionadosZip.clear();
  await carregarRecibos();
  renderHistorico();
  mostrarToast(_selecionadosZip.size + " recibo(s) excluídos.", null, "success");
}

async function batchEnviarEmail() {
  if (_selecionadosZip.size === 0) return;
  const ids = [..._selecionadosZip];
  const res = await api("POST", "/api/recibos/batch-email", { ids });
  if (!res || !res.ok) { mostrarToast("Erro ao enviar e-mails.", null, "error"); return; }
  const data = await res.json();
  mostrarToast(data.mensagem || "E-mails enviados.", null, "success");
}

async function exportarZipSelecionados() {
  if (_selecionadosZip.size === 0) return;
  const btn = document.getElementById("btn-exportar-zip");
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Gerando...';
  try {
    const res = await api("POST", "/api/recibos/exportar-zip", { ids: [..._selecionadosZip] });
    if (!res || res.status === 404) {
      mostrarToast("Em breve — exportação ZIP em desenvolvimento.", null, "error"); return;
    }
    if (!res.ok) { mostrarToast("Erro ao gerar ZIP.", null, "error"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `recibos_${new Date().toISOString().slice(0,10)}.zip`; a.click();
    URL.revokeObjectURL(url);
    mostrarToast(`${_selecionadosZip.size} recibo(s) exportado(s) com sucesso!`, null, "success");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function abrirPDFRecibo(r, print=false){
  await garantirJSPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26);doc.rect(0,0,W,24,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(14);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(200,200,200);
  doc.text("A ARAUJO PREV",W/2,18,{align:"center"});
  doc.setDrawColor(184,151,58);doc.setLineWidth(0.5);
  doc.line(20,28,W-20,28);
  doc.setTextColor(26,26,26);doc.setFontSize(11);doc.setFont("helvetica","bold");
  const numRef=r.referencia?`Recibo Nº ${r.num}   |   Ref: ${r.referencia}`:`Recibo Nº ${r.num}`;
  doc.text(numRef,W/2,36,{align:"center"});
  doc.setFontSize(13);
  doc.text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS",W/2,43,{align:"center"});
  doc.setDrawColor(220,220,220);doc.setLineWidth(0.3);
  doc.line(20,47,W-20,47);
  const digits=(r.cpf||"").replace(/\D/g,"");
  const labelDoc=digits.length>11?"CNPJ":"CPF";
  const compl=r.complemento?` - ${r.complemento}`:"";
  const corpo=`Recebemos do (a) senhor (a) ${r.nome}, residente e domiciliado(a) no Município de ${r.municipio_uf}, a importância de R$ ${r.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${compl}.`;
  doc.setFontSize(10);doc.setFont("helvetica","normal");doc.setTextColor(26,26,26);
  const linhas=doc.splitTextToSize(corpo,W-40);
  doc.text(linhas,20,57);
  const yApos=57+linhas.length*5+8;
  doc.text("Por ser verdade, firmo o presente que segue datado e assinado.",20,yApos);
  const yData=yApos+18;
  doc.text(`${r.municipio_uf}, ${r.data}`,20,yData);
  const yAssin=yData+36;
  doc.line(20,yAssin,W/2-10,yAssin);
  doc.setFontSize(9);
  doc.text(`${labelDoc}: ${r.cpf}`,20,yAssin+5);
  const yAssin2=yAssin+28;
  doc.line(20,yAssin2,W/2-10,yAssin2);
  doc.text(r.emitido_por||"Responsável",20,yAssin2+5);
  if (print) doc.autoPrint();
  const blob=doc.output("blob");
  const url=URL.createObjectURL(blob);
  window.open(url,"_blank");
}

async function reimprimirRecibo(r){
  setStatus("Gerando documento...","loading");
  const meses=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const [dia,mes,ano]=(r.data||"").split("/");
  const data_extenso=`${parseInt(dia)} de ${meses[parseInt(mes)-1]} de ${ano}`;
  const res=await api("POST","/api/gerar-recibo",{
    num_recibo:r.num,nome:r.nome,cpf:r.cpf,municipio_uf:r.municipio_uf,
    valor:r.valor,data:r.data,data_extenso,emitido_por:r.emitido_por||"",
    complemento:r.complemento||"",referencia:r.referencia||""
  });
  if(!res||!res.ok){setStatus("Erro ao gerar.","error");return;}
  const blob=await res.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`recibo_${r.num.replace("/","-")}_${(r.nome||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_").toLowerCase()}.docx`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("","");
  mostrarToast("Documento baixado!");
}

function abrirDetalhe(r){
  document.getElementById("modal-detalhe-body").innerHTML=`
    <div class="detail-row"><div class="detail-label">Nº Recibo</div><div class="detail-value"><span class="badge badge-gold">${esc(r.num)}</span></div></div>
    <div class="detail-row"><div class="detail-label">Cliente</div><div class="detail-value" style="font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:700">${esc(r.nome)}</div></div>
    <div class="detail-row"><div class="detail-label">CPF/CNPJ</div><div class="detail-value">${esc(r.cpf||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Município/UF</div><div class="detail-value">${esc(r.municipio_uf||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Valor</div><div class="detail-value" style="color:var(--success);font-weight:700;font-size:15px">R$ ${esc(r.valor)}</div></div>
    <div class="detail-row"><div class="detail-label">Data</div><div class="detail-value">${esc(r.data)}</div></div>
    <div class="detail-row"><div class="detail-label">Responsável</div><div class="detail-value">${esc(r.emitido_por||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Complemento</div><div class="detail-value">${esc(r.complemento||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Referência</div><div class="detail-value">${esc(r.referencia||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Comprovante</div><div class="detail-value">${r.link_comprovante ? `<button class="btn-gold btn-sm" id="btn-ver-comprovante-modal"><i class="bi bi-paperclip"></i> Ver comprovante</button>` : `<span style="color:var(--muted);font-size:13px;font-style:italic">Nenhum comprovante adicionado</span>`}</div></div>
    ${r.assinatura_govbr ? `<div class="detail-row"><div class="detail-label">Assinatura</div><div class="detail-value" style="color:var(--success)"><i class="bi bi-shield-check"></i> Assinado por ${esc(r.assinatura_govbr.nome_assinante)} em ${esc(r.assinatura_govbr.assinado_em)}</div></div>` : ""}
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-gold" id="btn-ver-modal"><i class="bi bi-eye"></i> Ver PDF</button>
      <button class="btn-secondary" id="btn-imprimir-modal"><i class="bi bi-printer"></i> Imprimir</button>
      <button class="btn-primary" id="btn-reimprimir-modal">📄 Baixar .docx</button>
      ${!r.assinatura_govbr ? `<button class="btn-success" id="btn-assinar-modal" style="display:none"><i class="bi bi-shield-check"></i> Assinar Gov.br</button>` : ""}
      ${roleLogado!=="recepcao"?`<button class="btn-secondary" id="btn-recorrente-modal"><i class="bi bi-arrow-repeat"></i> Recorrente</button>`:""}
    </div>`;
  if (r.link_comprovante) {
    const btnComp = document.getElementById("btn-ver-comprovante-modal");
    if (btnComp) btnComp.onclick = () => abrirComprovante(r.link_comprovante);
  }
  document.getElementById("btn-ver-modal").onclick=()=>{ abrirPDFRecibo(r); fecharModal("modal-detalhe"); };
  document.getElementById("btn-imprimir-modal").onclick=()=>{ abrirPDFRecibo(r, true); fecharModal("modal-detalhe"); };
  document.getElementById("btn-reimprimir-modal").onclick=()=>{ reimprimirRecibo(r); fecharModal("modal-detalhe"); };
  const btnRec = document.getElementById("btn-recorrente-modal");
  if (btnRec) btnRec.onclick = () => { fecharModal("modal-detalhe"); preencherReciboRecorrente(r); };
  // Botão de assinatura Gov.br — só aparece no mobile/app
  const btnAssinar = document.getElementById("btn-assinar-modal");
  if(btnAssinar){
    if(window.innerWidth <= 768) btnAssinar.style.display = "";
    btnAssinar.onclick = () => abrirModalGovBr(r);
  }
  if (Array.isArray(r.historico_edicoes) && r.historico_edicoes.length > 0) {
    const rows = r.historico_edicoes.map(h => {
      const campos = h.campos_alterados
        ? Object.entries(h.campos_alterados).map(([k,v]) => `<span style="color:var(--muted)">${esc(k)}</span>: ${esc(String(v))}`).join(" · ")
        : "-";
      return `<div style="font-size:12px;padding:6px 0;border-top:1px solid var(--border)">${esc(h.data||"")} — <strong>${esc(h.editado_por||"")}</strong> — ${campos}</div>`;
    }).join("");
    document.getElementById("modal-detalhe-body").innerHTML += `
      <div style="margin-top:20px;border-top:2px solid var(--border);padding-top:14px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px"><i class="bi bi-clock-history"></i> Histórico de Edições</div>
        ${rows}
      </div>`;
  }
  document.getElementById("modal-detalhe").classList.add("active");
}

// ── GOV.BR ─────────────────────────────────────────────────
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
      statusBox.innerHTML = `<i class="bi bi-shield-fill-check"></i> <strong>Já assinado!</strong><br>Por: ${esc(data.assinatura.nome_assinante)}<br>Em: ${esc(data.assinatura.assinado_em)}`;
      btnAssinar.disabled = true;
    }
    if(!data.configurado){
      btnAssinar.disabled = true;
      btnAssinar.innerHTML = '<i class="bi bi-shield-x"></i> Gov.br não configurado ainda';
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
    mostrarToast("Erro ao iniciar assinatura. Gov.br pode não estar configurado.");
    return;
  }
  const { url } = await res.json();
  // Abre Gov.br no navegador
  window.location.href = url;
}

// Verifica retorno do Gov.br após callback
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

// ── RECIBO RECORRENTE ─────────────────────────────────────
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
    mostrarToast(`Recibo recorrente pré-preenchido para ${mesStr}/${ano}. Revise e clique em Gerar.`);
  }, 100);
}

// ── CALENDÁRIO DE VENCIMENTOS ─────────────────────────────
const _CAL_DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const _CAL_MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function carregarCalendario(ano, mes) {
  _calAno = ano; _calMes = mes;
  document.getElementById("cal-mes-label").textContent = `${_CAL_MESES[mes]} ${ano}`;
  const grid = document.getElementById("calendario-grid");
  const detalhe = document.getElementById("cal-detalhe");
  if (!grid) return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
  // Agrupa parcelas por data_vencimento no mês/ano
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
  // Cabeçalho dias
  let html = _CAL_DIAS_SEMANA.map(d=>`<div class="cal-header">${d}</div>`).join("");
  // Offset do 1º dia
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
      detalhe.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:10px">${dia}/${String(mes+1).padStart(2,"0")}/${ano} — ${lista.length} parcela${lista.length!==1?"s":""}</div>` +
        lista.map(i => `<div style="padding:8px 12px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;font-size:12px">
          <span style="font-weight:600">${esc(i.cliente.nome)}</span> &nbsp;·&nbsp;
          Parcela ${i.parcela.num} &nbsp;·&nbsp; R$ ${formatarValor(i.parcela.valor||0)} &nbsp;·&nbsp;
          <span class="badge ${i.parcela.status==='atrasado'?'badge-atrasado':'badge-pendente'}">${i.parcela.status}</span>
        </div>`).join("");
    });
  });
}

// ── BUSCA GLOBAL MODAL ────────────────────────────────────
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
      <div><div style="font-weight:600">${esc(c.nome)}</div><div style="font-size:11px;color:var(--muted)">${esc(c.cpf||"")} · ${esc(c.municipio_uf||"")}</div></div>
    </div>`).join("");
  }
  if (recibos.length) {
    html += `<div class="busca-resultado-grupo"><i class="bi bi-receipt"></i> Recibos</div>`;
    html += recibos.map(r => `<div class="busca-resultado-item" data-type="recibo" data-id="${esc(r.id||r._id)}">
      <div class="busca-resultado-icone" style="background:var(--bg);color:var(--success)"><i class="bi bi-receipt"></i></div>
      <div><div style="font-weight:600">${esc(r.nome)}</div><div style="font-size:11px;color:var(--muted)">${esc(r.num)} · R$ ${esc(r.valor)} · ${esc(r.data)}</div></div>
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

// ── AUDITORIA ─────────────────────────────────────────────
async function carregarAuditoria() {
  const status = document.getElementById("auditoria-status");
  const wrap   = document.getElementById("auditoria-wrap");
  if (!status || !wrap) return;
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/admin/audit-log");
  if (!res || res.status === 404) { status.textContent = "Em breve — auditoria em desenvolvimento."; return; }
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
    const dt = e.ts ? new Date(e.ts).toLocaleString("pt-BR") : "—";
    const detalhe = e.dados_depois ? JSON.stringify(e.dados_depois).slice(0,80) : (e.entidade_id||"");
    return `<tr>
      <td style="white-space:nowrap;font-size:11px">${esc(dt)}</td>
      <td style="font-weight:600">${esc(e.usuario||"—")}</td>
      <td><span class="badge badge-pago" style="background:var(--mid)">${esc(e.acao||"—")}</span></td>
      <td style="font-size:11px;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(detalhe)}</td>
    </tr>`;
  }).join("");
}

function _buildTimeline(cadastro, recibos) {
  const eventos = [];
  recibos.forEach(r => {
    eventos.push({ tipo:"recibo", data: r.timestamp || dataParaISO(r.data) || "", label: `Recibo ${esc(r.num)} gerado — R$ ${esc(r.valor)}`, icon:"bi-receipt", cor:"var(--gold)" });
  });
  if (cadastro) {
    (cadastro.parcelas||[]).filter(p=>p.status==="pago"&&p.data_recebimento).forEach(p => {
      eventos.push({ tipo:"pagamento", data: dataParaISO(p.data_recebimento)||p.data_recebimento||"", label: `Parcela ${p.num} paga — R$ ${formatarValor(p.valor||0)}`, icon:"bi-check-circle-fill", cor:"var(--success)" });
    });
    (cadastro.observacoes||[]).forEach(o => {
      eventos.push({ tipo:"obs", data: o.criado_em||o.data||"", label: `Observação: ${esc(o.texto||"")}`, icon:"bi-chat-text", cor:"var(--muted)" });
    });
    (cadastro.parcelas||[]).filter(p=>p.lembrete_enviado_em).forEach(p => {
      eventos.push({ tipo:"lembrete", data: p.lembrete_enviado_em, label: `Lembrete enviado — parcela ${p.num}`, icon:"bi-bell", cor:"#c07a2a" });
    });
  }
  eventos.sort((a,b) => (b.data||"").localeCompare(a.data||""));
  if (!eventos.length) return `<div style="padding:16px 12px;color:var(--muted);font-size:12px;font-style:italic">Nenhum evento registrado.</div>`;
  return `<div class="timeline">${eventos.map(e => {
    const dt = e.data ? (e.data.includes("T") ? new Date(e.data).toLocaleString("pt-BR") : e.data) : "—";
    return `<div class="timeline-item">
      <div class="timeline-icone" style="background:${e.cor}22;color:${e.cor}"><i class="bi ${e.icon}"></i></div>
      <div class="timeline-corpo">${e.label}<div class="timeline-data">${dt}</div></div>
    </div>`;
  }).join("")}</div>`;
}

// ── CLIENTES ───────────────────────────────────────────────
let listaClientes = [];

function atualizarBadgeClientes() {
  const atrasados = listaClientes.filter(c =>
    Array.isArray(c.parcelas) && c.parcelas.some(p => p.status === "atrasado")
  ).length;
  const badge = document.getElementById("badge-clientes-atraso");
  if (!badge) return;
  if (atrasados > 0) { badge.textContent = atrasados; badge.style.display = ""; }
  else { badge.style.display = "none"; }
}

async function carregarClientes() {
  const res = await api("GET", "/api/clientes");
  if (!res || !res.ok) {
    if (!listaClientes.length) mostrarToast("Erro ao carregar clientes. Recarregue a página.", null, "error");
    return;
  }
  listaClientes = await res.json();
}

function _badgeParcela(s) {
  if (s === "pago")     return `<span class="badge badge-pago">Pago</span>`;
  if (s === "atrasado") return `<span class="badge badge-atrasado">Atrasado</span>`;
  return `<span class="badge badge-pendente">Pendente</span>`;
}

function _btnPagarParcela(cadastroId, p) {
  if (roleLogado === "recepcao" || p.status === "pago") return "";
  return `<button class="btn-success btn-sm" data-action="pagar-parcela" data-id="${esc(cadastroId)}" data-num="${p.num}" data-valor="${p.valor}">Registrar Pgto</button>`;
}

function _btnWhatsApp(telefone, nomeCliente, p) {
  if (!telefone || p.status === "pago") return "";
  const fone = telefone.replace(/\D/g, "");
  if (fone.length < 10) return "";
  const venc = p.data_vencimento ? ` com vencimento em ${p.data_vencimento}` : "";
  const valor = `R$ ${parseFloat(p.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  const texto = `Olá ${nomeCliente}, passando para lembrar sobre a parcela ${p.num} no valor de ${valor}${venc}. Em caso de dúvidas, entre em contato conosco. Att, Araujo Prev.`;
  const url = `https://wa.me/55${fone}?text=${encodeURIComponent(texto)}`;
  return `<a href="${url}" target="_blank" rel="noopener" class="btn-secondary btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">💬 WhatsApp</a>`;
}

function _buildBlocoContrato(cadastro) {
  if (!cadastro || cadastro.num_parcelas <= 0) return "";
  const pct      = Math.min(100, Math.round((cadastro.parcelas_pagas / cadastro.num_parcelas) * 100));
  const quitado  = cadastro.parcelas_restantes === 0;
  const corBarra = quitado ? "var(--success)" : "var(--gold)";
  return `
    <div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--muted)">${cadastro.parcelas_pagas}/${cadastro.num_parcelas} parcelas${quitado ? " · ✅ Quitado" : ""}</span>
        <span style="color:var(--muted)">R$ ${formatarValor(cadastro.valor_pago)} / R$ ${formatarValor(cadastro.valor_contrato)}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;background:${corBarra};height:100%;border-radius:4px;transition:width .3s"></div>
      </div>
      ${!quitado ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Faltam R$ ${formatarValor(cadastro.valor_restante)} · ${cadastro.parcelas_restantes} parcela${cadastro.parcelas_restantes !== 1 ? "s" : ""}</div>` : ""}
    </div>`;
}

function _buildTabelaRecibos(c) {
  return `
    <table style="width:100%">
      <thead><tr><th>Nº</th><th>Data</th><th>Valor</th><th>Responsável</th><th>Ref.</th><th>Ações</th></tr></thead>
      <tbody>
        ${(c.recibos || []).map(r => {
          const rd  = esc(JSON.stringify(r));
          const rid = esc(r.id || r._id);
          return `<tr>
            <td><span class="badge badge-gold">${esc(r.num)}</span></td>
            <td>${esc(r.data)}</td>
            <td style="color:var(--success);font-weight:700">R$ ${esc(r.valor)}</td>
            <td>${esc(r.emitido_por || "-")}</td>
            <td>${esc(r.referencia || "-")}</td>
            <td style="white-space:nowrap;display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn-secondary btn-sm" data-action="detalhe-recibo" data-recibo="${rd}">Detalhes</button>
              <button class="btn-gold btn-sm" data-action="pdf-recibo" data-recibo="${rd}"><i class="bi bi-eye"></i> Ver</button>
              ${roleLogado !== "recepcao" ? `<button class="btn-secondary btn-sm" data-action="editar-recibo" data-recibo="${rd}">Editar</button>` : ""}
              <button class="btn-secondary btn-sm" data-action="baixar-recibo" data-recibo="${rd}">📄 Baixar</button>
              ${roleLogado === "recepcao" ? `<button class="btn-secondary btn-sm" data-action="upload-comprovante" data-id="${rid}">📎 Comprovante</button>` : ""}
              ${roleLogado !== "recepcao" ? `<button class="btn-danger btn-sm" data-action="excluir-recibo" data-id="${rid}">🗑</button>` : ""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function _buildTabelasParcelamento(cadastro) {
  if (!cadastro || !Array.isArray(cadastro.parcelas) || cadastro.parcelas.length === 0) {
    return { tabelaParcelamento: "", tabelaAReceber: "", tabelaRecebidos: "" };
  }
  const { parcelas, id: cadastroId } = cadastro;

  const tabelaParcelamento = `
    <table style="width:100%">
      <thead><tr><th>Nº</th><th>Valor</th><th>Status</th><th>Recebimento</th><th>Depósito</th><th>Recibo</th><th>Ações</th></tr></thead>
      <tbody>
        ${parcelas.map(p => `<tr>
          <td>${p.num}</td>
          <td style="font-weight:600">R$ ${formatarValor(p.valor)}</td>
          <td>${_badgeParcela(p.status)}</td>
          <td style="color:var(--muted)">${esc(p.data_recebimento || "-")}</td>
          <td style="color:var(--muted)">${esc(p.data_deposito || "-")}</td>
          <td>${p.recibo_num ? `<span class="badge badge-gold">${esc(p.recibo_num)}</span>` : "-"}</td>
          <td>${_btnPagarParcela(cadastroId, p)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const pendentes = parcelas.filter(p => p.status !== "pago");
  const totalAReceber = pendentes.reduce((s, p) => s + (p.valor || 0), 0);
  const tabelaAReceber = pendentes.length === 0
    ? `<p style="color:var(--success);font-weight:600;padding:8px 0">✅ Nenhuma parcela pendente — contrato quitado!</p>`
    : `<table style="width:100%">
        <thead><tr><th>Nº Parcela</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${pendentes.map(p => `<tr>
            <td>${p.num}</td>
            <td style="font-weight:600">R$ ${formatarValor(p.valor)}</td>
            <td>${_badgeParcela(p.status)}</td>
            <td style="display:flex;gap:4px;flex-wrap:wrap">${_btnPagarParcela(cadastroId, p)}${_btnWhatsApp(cadastro.telefone, cadastro.nome, p)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="tab-total" style="color:var(--error)">Total a receber: R$ ${formatarValor(totalAReceber)}</div>`;

  const pagas = parcelas.filter(p => p.status === "pago");
  const totalRecebido = pagas.reduce((s, p) => s + (p.valor || 0), 0);
  const tabelaRecebidos = pagas.length === 0
    ? `<p style="color:var(--muted);padding:8px 0">Nenhuma parcela paga ainda.</p>`
    : `<table style="width:100%">
        <thead><tr><th>Nº Parcela</th><th>Valor</th><th>Recebimento</th><th>Depósito</th><th>Nº Recibo</th></tr></thead>
        <tbody>
          ${pagas.map(p => `<tr>
            <td>${p.num}</td>
            <td style="color:var(--success);font-weight:600">R$ ${formatarValor(p.valor)}</td>
            <td>${esc(p.data_recebimento || "-")}</td>
            <td>${esc(p.data_deposito || "-")}</td>
            <td>${p.recibo_num ? `<span class="badge badge-gold">${esc(p.recibo_num)}</span>` : "-"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="tab-total" style="color:var(--success)">Total recebido: R$ ${formatarValor(totalRecebido)}</div>`;

  return { tabelaParcelamento, tabelaAReceber, tabelaRecebidos };
}

async function renderClientes() {
  mostrarSkeleton("clientes-grid");
  await Promise.all([carregarClientes(), carregarRecibos()]);
  const busca        = (document.getElementById("busca-clientes").value || "").toLowerCase();
  const buscaDigitos = busca.replace(/\D/g, "");
  const grid         = document.getElementById("clientes-grid");

  // Chave = dígitos do CPF (se tiver) ou nome normalizado — evita duplicatas por formatação diferente
  const _cpfKey = cpf => cpf ? cpf.replace(/\D/g,"") : "";
  const _nomeKey = nome => "__n__" + (nome||"").normalize("NFC").trim().replace(/\s+/g," ").toUpperCase();
  const _mapaKey = (cpf, nome) => _cpfKey(cpf) || _nomeKey(nome);

  const mapa = {};
  // Primeiro: clientes cadastrados — são a fonte de nome canônico
  listaClientes.forEach(c => {
    if (!c.nome) return;
    const key = _mapaKey(c.cpf, c.nome);
    if (!mapa[key]) mapa[key] = { nome: c.nome, cpf: c.cpf || "", municipio_uf: c.municipio_uf || "", recibos: [], total: 0 };
  });
  // Depois: recibos — casa por CPF (dígitos), cria entrada só se não existe ainda
  historicoRecibos.forEach(r => {
    if (!r.nome) return;
    const key = _mapaKey(r.cpf, r.nome);
    if (!mapa[key]) mapa[key] = { nome: r.nome, cpf: r.cpf || "", municipio_uf: r.municipio_uf || "", recibos: [], total: 0 };
    mapa[key].recibos.push(r);
    mapa[key].total += valorParaNumero(r.valor);
  });

  let clientes = Object.values(mapa).filter(c =>
    c.nome.toLowerCase().includes(busca) ||
    (buscaDigitos.length > 0 && c.cpf.replace(/\D/g, "").includes(buscaDigitos))
  );
  clientes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Resumo contextual
  const resumoEl = document.getElementById("resumo-clientes");
  if (resumoEl) {
    const totalAReceber = listaClientes.reduce((s, c) => s + (c.valor_restante || 0), 0);
    const atrasados = listaClientes.filter(c => Array.isArray(c.parcelas) && c.parcelas.some(p => p.status === "atrasado")).length;
    const partes = [`${clientes.length} cliente${clientes.length !== 1 ? "s" : ""}`];
    if (totalAReceber > 0) partes.push(`R$ ${formatarValor(totalAReceber)} a receber`);
    if (atrasados > 0) partes.push(`<span class="alerta">⚠️ ${atrasados} atrasado${atrasados !== 1 ? "s" : ""}</span>`);
    resumoEl.innerHTML = partes.join(" · ");
    resumoEl.style.display = "";
  }
  atualizarBadgeClientes();

  if (!clientes.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>${busca ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}</p>${!busca ? '<button class="btn-gold" style="margin-top:12px" id="btn-empty-cadastrar">+ Cadastrar Cliente</button>' : ""}</div>`;
    if (!busca) {
      const btnEmpty = document.getElementById("btn-empty-cadastrar");
      if (btnEmpty) btnEmpty.addEventListener("click", () => abrirModalCliente());
    }
    return;
  }

  grid.innerHTML = "";
  clientes.forEach(c => {
    const _cpfDigsC = (c.cpf || "").replace(/\D/g, "");
    const cadastro = _cpfDigsC ? listaClientes.find(l => (l.cpf || "").replace(/\D/g, "") === _cpfDigsC) : null;
    const ultimo   = (c.recibos || [])[0];
    const cardId   = `card-cli-${(c.cpf||c.nome).replace(/\W/g,"")}-${Math.random().toString(36).slice(2,6)}`;
    const temParcelas = cadastro && Array.isArray(cadastro.parcelas) && cadastro.parcelas.length > 0;

    const blocoContrato = _buildBlocoContrato(cadastro);
    const tabelaRecibos = _buildTabelaRecibos(c);
    const { tabelaParcelamento, tabelaAReceber, tabelaRecebidos } = _buildTabelasParcelamento(cadastro);

    const card = document.createElement("div");
    card.className = "cliente-card";
    card.innerHTML = `
      <div class="cliente-header">
        <div style="flex:1">
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-stats">
            <span>${(c.recibos||[]).length} recibo${(c.recibos||[]).length !== 1 ? "s" : ""}</span>
            <span>·</span><span>Último: ${esc(ultimo?.data || "-")}</span>
            ${cadastro && cadastro.firma ? `<span>·</span><span style="color:var(--gold);font-weight:600">${esc(cadastro.firma)}</span>` : ""}
            ${cadastro && cadastro.referencia ? `<span>·</span><span>Ref: ${esc(cadastro.referencia)}</span>` : (ultimo?.referencia ? `<span>·</span><span>Ref: ${esc(ultimo.referencia)}</span>` : "")}
            ${cadastro && cadastro.telefone ? `<span>·</span><span><a href="https://wa.me/55${cadastro.telefone.replace(/\D/g,'')}" target="_blank" rel="noopener" class="wa-link" style="color:var(--success);text-decoration:none" title="Abrir WhatsApp"><i class="bi bi-whatsapp"></i> ${esc(cadastro.telefone)}</a></span>` : ""}
          </div>
          ${blocoContrato}
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;margin-left:12px;flex-shrink:0">
          <div style="text-align:right;margin-right:4px">
            <div class="cliente-total">R$ ${formatarValor(c.total)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">total pago</div>
          </div>
          <button class="btn-sm btn-secondary cadastro-btn">${cadastro ? "Editar cadastro" : "Cadastrar"}</button>
          ${roleLogado !== "recepcao" && cadastro ? `<button class="btn-danger btn-sm excluir-cliente-btn" title="Excluir cliente">🗑</button>` : ""}
          <button class="btn-gold btn-sm novo-recibo-btn">+ Recibo</button>
        </div>
      </div>
      <div class="cliente-body">
        ${temParcelas ? `
        <div class="cliente-tabs">
          <button class="cliente-tab active" data-action="trocar-aba" data-card-id="${cardId}" data-aba="parcelamento">Parcelamento</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="areceber">A Receber</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="recebidos">Recebidos</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="historico">Histórico</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="timeline">Timeline</button>
        </div>
        <div id="${cardId}-parcelamento" class="tab-painel active">${tabelaParcelamento}</div>
        <div id="${cardId}-areceber" class="tab-painel">${tabelaAReceber}</div>
        <div id="${cardId}-recebidos" class="tab-painel">${tabelaRecebidos}</div>
        <div id="${cardId}-historico" class="tab-painel">${tabelaRecibos}</div>
        <div id="${cardId}-timeline" class="tab-painel">${_buildTimeline(cadastro, c.recibos)}</div>
        ` : tabelaRecibos}
      </div>`;

    card.querySelector(".cliente-header").addEventListener("click", () => toggleCliente(card.querySelector(".cliente-header")));
    card.querySelectorAll(".wa-link").forEach(a => a.addEventListener("click", e => e.stopPropagation()));

    card.addEventListener("click", e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "trocar-aba") trocarAbaCliente(btn, btn.dataset.cardId, btn.dataset.aba);
      else if (action === "pagar-parcela") abrirModalPagamentoParcela(btn.dataset.id, Number(btn.dataset.num), Number(btn.dataset.valor), "");
      else if (action === "detalhe-recibo") { try { abrirDetalhe(JSON.parse(btn.dataset.recibo)); } catch(e) { mostrarToast("Erro ao abrir recibo.", null, "error"); } }
      else if (action === "pdf-recibo") { try { abrirPDFRecibo(JSON.parse(btn.dataset.recibo)); } catch(e) { mostrarToast("Erro ao abrir recibo.", null, "error"); } }
      else if (action === "editar-recibo") { try { editarRecibo(JSON.parse(btn.dataset.recibo)); } catch(e) { mostrarToast("Erro ao abrir recibo.", null, "error"); } }
      else if (action === "baixar-recibo") { try { reimprimirRecibo(JSON.parse(btn.dataset.recibo)); } catch(e) { mostrarToast("Erro ao baixar recibo.", null, "error"); } }
      else if (action === "upload-comprovante") abrirModalUploadComprovante(btn.dataset.id);
      else if (action === "excluir-recibo") excluirReciboById(btn.dataset.id);
    });

    card.querySelector(".novo-recibo-btn").addEventListener("click", e => {
      e.stopPropagation();
      novoReciboParaCliente(c, cadastro);
    });
    card.querySelector(".cadastro-btn").addEventListener("click", e => {
      e.stopPropagation();
      cadastro ? editarCliente(cadastro.id) : abrirModalClientePreenchido(c);
    });
    if (roleLogado !== "recepcao" && cadastro) {
      const btnExcluirCli = card.querySelector(".excluir-cliente-btn");
      if (btnExcluirCli) btnExcluirCli.addEventListener("click", e => {
        e.stopPropagation();
        excluirCliente(cadastro.id, cadastro);
      });
    }
    grid.appendChild(card);
  });
}

function novoReciboParaCliente(c, cadastro) {
  _clienteContexto = cadastro || null;
  navegarPara("gerar");
  limparCampos();
  setTimeout(() => {
    document.getElementById("cpf").value          = c.cpf || "";
    document.getElementById("nome").value         = c.nome || "";
    document.getElementById("municipio_uf").value = cadastro ? cadastro.municipio_uf : (c.municipio_uf || "");
    document.getElementById("referencia").value   = cadastro ? (cadastro.referencia || referenciaPadrao || "") : ((c.recibos||[])[0]?.referencia || referenciaPadrao || "");
    // recepcao: escritório já está correto via limparCampos() — não sobrescrever
    if (roleLogado !== "recepcao") {
      document.getElementById("escritorio").value = ((c.recibos||[])[0]?.escritorio || "").toUpperCase();
    }
    const emEl = document.getElementById("emitido_por");
    if (emEl && !emEl.value) emEl.value = usuarioLogado || "";
    const btn = document.getElementById("btn-ref-padrao-recibo");
    if (btn) btn.style.display = "none";
    if (cadastro && (cadastro.valor_parcela || 0) > 0) {
      const vf = cadastro.valor_parcela.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      document.getElementById("valor").value = vf;
    }
    // Preenche forma/motivo do último recibo do cliente
    const digs = (c.cpf||"").replace(/\D/g,"");
    const ult = historicoRecibos.find(r => (r.cpf||"").replace(/\D/g,"") === digs);
    if(ult){
      const set = (id, val) => { const el = document.getElementById(id); if(el && !el.value && val) el.value = val; };
      set("forma_pagamento",  ult.forma_pagamento);
      set("motivo_pagamento", ult.motivo_pagamento);
      set("emitido_por",      ult.emitido_por);
    }
    document.getElementById("valor").focus();
  }, 100);
}

function toggleCliente(header) {
  header.nextElementSibling.classList.toggle("open");
}

function trocarAbaCliente(btn, cardId, aba) {
  const corpo = btn.closest(".cliente-body");
  corpo.querySelectorAll(".cliente-tab").forEach(t => t.classList.remove("active"));
  corpo.querySelectorAll(".tab-painel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  const painel = document.getElementById(`${cardId}-${aba}`);
  if (painel) painel.classList.add("active");
}

function abrirModalPagamentoParcela(clienteId, parcelaNum, valorParcela, reciboNumPreenchido) {
  document.getElementById("pag-cliente-id").value  = clienteId;
  document.getElementById("pag-parcela-num").value = parcelaNum;
  const vf = Number(valorParcela).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  document.getElementById("pag-valor").value = "R$ " + vf;
  document.getElementById("modal-pagamento-titulo").textContent = `Registrar Pagamento — Parcela ${parcelaNum}`;
  const infoEl = document.getElementById("modal-pagamento-cliente-info");
  const cli = listaClientes.find(x => x.id === clienteId);
  if (cli && infoEl) {
    const total = cli.num_parcelas || 0;
    infoEl.textContent = `${esc(cli.nome)}${total ? ` · Parcela ${parcelaNum} de ${total}` : ""}`;
    infoEl.style.display = "block";
  } else if (infoEl) {
    infoEl.style.display = "none";
  }
  const hoje = new Date().toISOString().split("T")[0];
  document.getElementById("pag-data-recebimento").value = hoje;
  document.getElementById("pag-data-deposito").value    = hoje;
  document.getElementById("pag-recibo-num").value       = reciboNumPreenchido || "";
  document.getElementById("pag-observacao").value       = "";
  document.getElementById("modal-pagamento-parcela").classList.add("active");
}

async function confirmarPagamentoParcela() {
  const clienteId  = document.getElementById("pag-cliente-id").value;
  const parcelaNum = parseInt(document.getElementById("pag-parcela-num").value);
  const dataRec    = document.getElementById("pag-data-recebimento").value;
  const dataDep    = document.getElementById("pag-data-deposito").value;
  const reciboNum  = (document.getElementById("pag-recibo-num").value || "").trim().toUpperCase();
  const observacao = (document.getElementById("pag-observacao").value || "").trim();

  if (!dataRec || !dataDep) { mostrarToast("Preencha as datas de recebimento e depósito.", null, "error"); return; }

  const fmt = d => d ? d.split("-").reverse().join("/") : "";
  const res = await api("PATCH", `/api/clientes/${clienteId}/parcela/${parcelaNum}`, {
    status: "pago",
    data_recebimento: fmt(dataRec),
    data_deposito: fmt(dataDep),
    recibo_num: reciboNum,
    observacao,
  });
  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) : {};
    mostrarToast(data.erro || "Erro ao registrar pagamento.", null, "error"); return;
  }
  fecharModal("modal-pagamento-parcela");
  mostrarToast("Parcela marcada como paga!", null, "success");
  renderClientes();
  atualizarBadgeClientes();
}

// ── CRUD CLIENTES ──────────────────────────────────────────
function mascaraCpfCliente(el) {
  let v = el.value.replace(/\D/g, "").slice(0, 14);
  if (v.length <= 11) {
    v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  } else {
    v = v.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{4})/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  el.value = v;
}

function mascaraValorCliente(el) {
  let v = el.value.replace(/\D/g, "");
  if (!v) { el.value = ""; return; }
  v = (parseInt(v) / 100).toFixed(2);
  el.value = v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function calcularContrato() {
  const beneficio = valorParaNumero(document.getElementById("cliente-valor-beneficio").value);
  const numBen    = parseInt(document.getElementById("cliente-num-beneficios").value) || 0;
  if (beneficio > 0 && numBen > 0) {
    const contrato = beneficio * numBen;
    const vf = contrato.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    document.getElementById("cliente-valor-contrato").value = vf;
    calcularParcela();
  }
}

function calcularParcela() {
  const contrato = valorParaNumero(document.getElementById("cliente-valor-contrato").value);
  const parcelas = parseInt(document.getElementById("cliente-num-parcelas").value) || 0;
  const preview  = document.getElementById("cliente-parcela-preview");
  if (contrato > 0 && parcelas > 0) {
    preview.textContent = `Valor de cada parcela: R$ ${formatarValor(contrato / parcelas)}`;
  } else {
    preview.textContent = "";
  }
}

// ── OBSERVAÇÕES DO CLIENTE ─────────────────────────────────
function renderObservacoes(obs) {
  const lista = document.getElementById("cliente-observacoes-lista");
  if (!lista) return;
  if (!Array.isArray(obs) || !obs.length) {
    lista.innerHTML = `<div style="color:var(--muted);font-size:12px;font-style:italic">Nenhuma observação registrada.</div>`;
    return;
  }
  lista.innerHTML = obs.map(o => `
    <div style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
      <div style="font-size:12px;color:var(--text)">${esc(o.texto)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(o.autor||"—")} · ${esc(o.data ? new Date(o.data).toLocaleDateString("pt-BR") : "—")}</div>
    </div>`).join("");
}

async function adicionarObservacaoCliente() {
  const id = document.getElementById("cliente-id").value;
  if (!id) return;
  const textoEl = document.getElementById("cliente-obs-texto");
  const texto = (textoEl?.value || "").trim();
  if (!texto) return mostrarToast("Digite a observação antes de adicionar.");
  const btn = document.getElementById("btn-confirmar-obs");
  const orig = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "Salvando..."; }
  try {
    const res = await api("POST", `/api/clientes/${id}/observacoes`, { texto });
    if (!res || res.status === 404) {
      mostrarToast("Em breve — observações em desenvolvimento.");
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      mostrarToast(j.erro || "Erro ao salvar observação.", null, "error");
      return;
    }
    const updated = await res.json();
    renderObservacoes(updated.observacoes || []);
    if (textoEl) textoEl.value = "";
    const addPanel = document.getElementById("cliente-obs-add");
    if (addPanel) addPanel.style.display = "none";
    const btnToggle = document.getElementById("btn-toggle-obs");
    if (btnToggle) btnToggle.innerHTML = '<i class="bi bi-plus-circle"></i> Adicionar observação';
    // Atualiza listaClientes local
    const idx = listaClientes.findIndex(x => x.id === id);
    if (idx >= 0 && updated.observacoes) listaClientes[idx].observacoes = updated.observacoes;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

function limparModalCliente() {
  ["cliente-nome","cliente-cpf","cliente-telefone","cliente-endereco","cliente-municipio",
   "cliente-firma","cliente-referencia","cliente-valor-beneficio","cliente-num-beneficios",
   "cliente-valor-contrato","cliente-num-parcelas"].forEach(campo => {
    const el = document.getElementById(campo);
    if (el) el.value = "";
  });
  document.getElementById("cliente-id").value = "";
  document.getElementById("cliente-parcela-preview").textContent = "";
  if (referenciaPadrao) document.getElementById("cliente-referencia").value = referenciaPadrao;
  renderObservacoes([]);
  const obsAdd = document.getElementById("cliente-obs-add");
  if (obsAdd) obsAdd.style.display = "none";
  const btnToggleObs = document.getElementById("btn-toggle-obs");
  if (btnToggleObs) { btnToggleObs.style.display = "none"; btnToggleObs.innerHTML = '<i class="bi bi-plus-circle"></i> Adicionar observação'; }
  const obsTexto = document.getElementById("cliente-obs-texto");
  if (obsTexto) obsTexto.value = "";
}

function abrirModalCliente() {
  limparModalCliente();
  document.getElementById("modal-cliente-titulo").textContent = "Cadastrar Cliente";
  document.getElementById("modal-cliente").classList.add("active");
}

// Abre o modal de cadastro pré-preenchido com dados do histórico de recibos
function abrirModalClientePreenchido(c) {
  limparModalCliente();
  document.getElementById("modal-cliente-titulo").textContent = "Cadastrar Cliente";
  document.getElementById("cliente-nome").value      = c.nome || "";
  document.getElementById("cliente-cpf").value       = c.cpf || "";
  document.getElementById("cliente-municipio").value = c.municipio_uf || "";
  const ref = (c.recibos||[])[0]?.referencia || referenciaPadrao || "";
  document.getElementById("cliente-referencia").value = ref;
  document.getElementById("modal-cliente").classList.add("active");
}

async function editarCliente(id) {
  const c = listaClientes.find(x => x.id === id);
  if (!c) return;
  limparModalCliente();
  document.getElementById("cliente-id").value = c.id;
  document.getElementById("modal-cliente-titulo").textContent = "Editar Cliente";
  document.getElementById("cliente-nome").value      = c.nome || "";
  document.getElementById("cliente-cpf").value       = c.cpf || "";
  document.getElementById("cliente-telefone").value  = c.telefone || "";
  document.getElementById("cliente-endereco").value  = c.endereco || "";
  document.getElementById("cliente-municipio").value = c.municipio_uf || "";
  document.getElementById("cliente-firma").value     = c.firma || "";
  document.getElementById("cliente-referencia").value = c.referencia || "";
  const vb = (c.valor_beneficio||0) > 0 ? (c.valor_beneficio).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
  document.getElementById("cliente-valor-beneficio").value = vb;
  document.getElementById("cliente-num-beneficios").value  = c.num_beneficios || "";
  const vf = (c.valor_contrato||0) > 0 ? (c.valor_contrato).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
  document.getElementById("cliente-valor-contrato").value = vf;
  document.getElementById("cliente-num-parcelas").value   = c.num_parcelas || "";
  calcularParcela();
  renderObservacoes(c.observacoes || []);
  const btnToggleObs = document.getElementById("btn-toggle-obs");
  if (btnToggleObs) btnToggleObs.style.display = "";
  document.getElementById("modal-cliente").classList.add("active");
}

async function salvarCliente() {
  const id              = document.getElementById("cliente-id").value;
  const nome            = document.getElementById("cliente-nome").value.trim().toUpperCase();
  const cpf             = document.getElementById("cliente-cpf").value.trim();
  const telefone        = document.getElementById("cliente-telefone").value.trim();
  const endereco        = document.getElementById("cliente-endereco").value.trim().toUpperCase();
  const municipio_uf    = document.getElementById("cliente-municipio").value.trim().toUpperCase();
  const firma           = document.getElementById("cliente-firma").value.trim().toUpperCase();
  const referencia      = document.getElementById("cliente-referencia").value.trim().toUpperCase();
  const valor_beneficio = valorParaNumero(document.getElementById("cliente-valor-beneficio").value);
  const num_beneficios  = parseInt(document.getElementById("cliente-num-beneficios").value) || 0;
  const valor_contrato  = valorParaNumero(document.getElementById("cliente-valor-contrato").value);
  const num_parcelas    = parseInt(document.getElementById("cliente-num-parcelas").value) || 0;

  if (!nome || !cpf || !municipio_uf) {
    const v=[];
    if(!nome) v.push("cliente-nome");
    if(!cpf)  v.push("cliente-cpf");
    if(!municipio_uf) v.push("cliente-municipio");
    marcarInvalido(...v);
    mostrarToast("Preencha Nome, CPF e Município.", null, "error"); return;
  }
  const _cd=cpf.replace(/\D/g,"");
  if(_cd.length===11&&!validarCPF(cpf)) { marcarInvalido("cliente-cpf"); mostrarToast("CPF inválido. Verifique os dígitos.", null, "error"); return; }
  if(_cd.length===14&&!validarCNPJ(cpf)) { marcarInvalido("cliente-cpf"); mostrarToast("CNPJ inválido. Verifique os dígitos.", null, "error"); return; }
  if(_cd.length!==11&&_cd.length!==14) { marcarInvalido("cliente-cpf"); mostrarToast("CPF deve ter 11 dígitos ou CNPJ 14 dígitos.", null, "error"); return; }
  if (valor_contrato <= 0) { marcarInvalido("cliente-valor-contrato"); mostrarToast("Informe o valor total do contrato.", null, "error"); return; }
  if (num_parcelas <= 0)   { marcarInvalido("cliente-num-parcelas");   mostrarToast("Informe o número de parcelas.", null, "error"); return; }

  const body = { nome, cpf, telefone, endereco, municipio_uf, firma, referencia, valor_beneficio, num_beneficios, valor_contrato, num_parcelas };
  const res  = id
    ? await api("PUT",  `/api/clientes/${id}`, body)
    : await api("POST", "/api/clientes", body);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.erro || "Erro ao salvar cliente.", null, "error"); return; }

  fecharModal("modal-cliente");
  mostrarToast(id ? "Cliente atualizado!" : "Cliente cadastrado!");
  // Busca pelo nome recém-salvo para o usuário vê-lo imediatamente
  const buscaInp = document.getElementById("busca-clientes");
  if(buscaInp) buscaInp.value = nome;
  await renderClientes();
  atualizarSugestoesNomes();
}

async function excluirReciboById(id){
  const recibo = historicoRecibos.find(r=>(r.id||r._id)===id);
  if(!confirm(`Excluir recibo ${recibo?recibo.num:id}?`)) return;
  await api("DELETE",`/api/recibos/${id}`);
  await carregarRecibos();
  renderClientes();
}

async function excluirCliente(id, cadastro) {
  const parcelas = Array.isArray(cadastro.parcelas) ? cadastro.parcelas : [];
  const ativas = parcelas.filter(p => p.status !== "pago").length;
  const msg = ativas > 0
    ? `Este cliente tem ${ativas} parcela${ativas!==1?"s":""} pendente${ativas!==1?"s":""}. Deseja excluir mesmo assim?`
    : `Excluir o cliente "${cadastro.nome}"? Esta ação não pode ser desfeita.`;
  if (!confirm(msg)) return;
  const res = await api("DELETE", `/api/clientes/${id}`);
  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) : {};
    mostrarToast(data.erro || "Erro ao excluir cliente.", null, "error"); return;
  }
  mostrarToast("Cliente excluído.", null, "success");
  await carregarClientes();
  renderClientes();
}

// ── DASHBOARD ──────────────────────────────────────────────
function atualizarDashboard(){
  const agora=new Date();
  const mesAtual=String(agora.getMonth()+1).padStart(2,"0");
  const anoSel=document.getElementById("dash-ano")?.value||String(agora.getFullYear());
  const anoAtual=anoSel||String(agora.getFullYear());
  const doMes=historicoRecibos.filter(r=>r.data?.split("/")[1]===mesAtual&&r.data?.split("/")[2]===anoAtual);
  const doAno=historicoRecibos.filter(r=>r.data?.split("/")[2]===anoAtual);
  const todos=historicoRecibos;
  const soma=arr=>arr.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  document.getElementById("card-mes").textContent=`R$ ${formatarValor(soma(doMes))}`;
  document.getElementById("card-mes-qtd").textContent=`${doMes.length} recibo${doMes.length!==1?"s":""}`;
  document.getElementById("card-ano").textContent=`R$ ${formatarValor(soma(doAno))}`;
  document.getElementById("card-ano-qtd").textContent=`${doAno.length} recibos`;
  document.getElementById("card-total").textContent=`R$ ${formatarValor(soma(todos))}`;
  document.getElementById("card-total-qtd").textContent=`${todos.length} recibos`;
  document.getElementById("card-ticket").textContent=todos.length?`R$ ${formatarValor(soma(todos)/todos.length)}`:"R$ 0,00";
  // KPI cards — calculados localmente, enriquecidos pela API se disponível
  const mesAnt = agora.getMonth()===0 ? "12" : String(agora.getMonth()).padStart(2,"0");
  const anoAnt = agora.getMonth()===0 ? String(agora.getFullYear()-1) : anoAtual;
  const doMesAnt = historicoRecibos.filter(r=>r.data?.split("/")[1]===mesAnt&&r.data?.split("/")[2]===anoAnt);
  const somaAnt = soma(doMesAnt);
  const somaMes = soma(doMes);
  const varPct = somaAnt>0 ? ((somaMes-somaAnt)/somaAnt*100) : null;
  const cardVar = document.getElementById("card-variacao");
  const cardVarSub = document.getElementById("card-variacao-sub");
  const kpiCard = document.getElementById("kpi-variacao-card");
  if (varPct===null) { cardVar.textContent="—"; cardVar.style.color=""; }
  else {
    cardVar.textContent=(varPct>=0?"+":"")+varPct.toFixed(1)+"%";
    cardVar.style.color = varPct>=0 ? "var(--success)" : "var(--error)";
    if(kpiCard){ kpiCard.style.borderTopColor = varPct>=0 ? "var(--success)" : "var(--error)"; }
  }
  if(cardVarSub) cardVarSub.textContent=`vs ${mesAnt}/${anoAnt}`;
  // inadimplentes e vencendo — de listaClientes (já carregado)
  const hoje=new Date().toISOString().slice(0,10);
  const em7=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,10);
  const inadimplentes=listaClientes.filter(c=>Array.isArray(c.parcelas)&&c.parcelas.some(p=>p.status==="atrasado")).length;
  let vencendo=0;
  listaClientes.forEach(c=>{(c.parcelas||[]).forEach(p=>{if(p.status!=="pago"&&p.data_vencimento&&p.data_vencimento>=hoje&&p.data_vencimento<=em7)vencendo++;});});
  document.getElementById("card-inadimplentes").textContent=inadimplentes||"0";
  document.getElementById("card-parcelas-vencendo").textContent=vencendo||"0";
  // clientes novos — cpfs que aparecem pela 1ª vez em recibos do mês atual
  const cpfsMesAtual=new Set(doMes.map(r=>r.cpf||r.nome).filter(Boolean));
  const cpfsAnteriores=new Set(historicoRecibos.filter(r=>{const p=r.data?.split("/");return p&&!(p[1]===mesAtual&&p[2]===anoAtual);}).map(r=>r.cpf||r.nome).filter(Boolean));
  const novos=[...cpfsMesAtual].filter(k=>!cpfsAnteriores.has(k)).length;
  document.getElementById("card-clientes-novos").textContent=novos||"0";
  const mesesLabels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const totaisMes=Array.from({length:12},(_,i)=>{
    const m=String(i+1).padStart(2,"0");
    return historicoRecibos.filter(r=>r.data?.split("/")[1]===m&&r.data?.split("/")[2]===anoAtual).reduce((s,r)=>s+valorParaNumero(r.valor),0);
  });
  if(graficoMensal){ try{ graficoMensal.destroy(); }catch(e){} graficoMensal=null; }
  requestAnimationFrame(()=>{
    try{
      const ctx=document.getElementById("grafico-mensal")?.getContext("2d");
      if(ctx) graficoMensal=new Chart(ctx,{type:"bar",data:{labels:mesesLabels,datasets:[{label:"Faturamento",data:totaisMes,backgroundColor:"rgba(184,151,58,0.7)",borderColor:"#b8973a",borderWidth:1,borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"R$ "+formatarValor(v)}}}}});
    }catch(e){ console.error("Dashboard chart error:", e); }
  });
  const tbody=document.getElementById("tabela-mensal");
  if(tbody){
    tbody.innerHTML=mesesLabels.map((m,i)=>{
      const qtd=doAno.filter(r=>r.data?.split("/")[1]===String(i+1).padStart(2,"0")).length;
      const tot=doAno.filter(r=>r.data?.split("/")[1]===String(i+1).padStart(2,"0")).reduce((s,r)=>s+valorParaNumero(r.valor),0);
      if(!qtd) return "";
      return `<tr><td>${m}/${anoAtual}</td><td>${qtd}</td><td style="color:var(--success);font-weight:700">R$ ${formatarValor(tot)}</td><td>R$ ${formatarValor(qtd?tot/qtd:0)}</td></tr>`;
    }).join("");
  }
}

// ── FILTROS AVANÇADOS HISTÓRICO ────────────────────────────
function preencherFiltrosAvancados() {
  const escritorios = [...new Set(historicoRecibos.map(r=>(r.escritorio||"").toUpperCase()).filter(Boolean))].sort();
  const sel1 = document.getElementById("filtro-avancado-escritorio");
  if (sel1) {
    const prev = sel1.value;
    sel1.innerHTML = `<option value="">Todos</option>` + escritorios.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join("");
    if (escritorios.includes(prev)) sel1.value = prev;
  }
  const responsaveis = [...new Set(historicoRecibos.map(r=>r.emitido_por).filter(Boolean))].sort();
  const sel2 = document.getElementById("filtro-avancado-responsavel");
  if (sel2) {
    const prev = sel2.value;
    sel2.innerHTML = `<option value="">Todos</option>` + responsaveis.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("");
    if (responsaveis.includes(prev)) sel2.value = prev;
  }
}

function toggleFiltrosAvancados() {
  const panel = document.getElementById("filtros-avancados");
  const icon  = document.getElementById("icon-filtros-avancados");
  if (!panel) return;
  const open = panel.style.display !== "none";
  panel.style.display = open ? "none" : "";
  if (icon) icon.className = open ? "bi bi-chevron-down" : "bi bi-chevron-up";
  if (!open) preencherFiltrosAvancados();
}

function limparFiltrosAvancados() {
  ["filtro-avancado-escritorio","filtro-avancado-forma","filtro-avancado-responsavel"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  ["filtro-avancado-min","filtro-avancado-max"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  renderHistorico();
}

// ── POR RESPONSÁVEL ────────────────────────────────────────
async function carregarPorResponsavel() {
  const status = document.getElementById("responsaveis-status");
  const wrap   = document.getElementById("responsaveis-wrap");
  if (!status || !wrap) return;
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/por-responsavel");
  if (!res || res.status === 404) { status.textContent = "Em breve — relatório por responsável em desenvolvimento."; return; }
  if (!res.ok) { status.textContent = "Erro ao carregar relatório."; return; }
  const dados = await res.json();
  if (!dados.length) { status.textContent = "Nenhum dado encontrado."; return; }
  const maxReceita = dados.reduce((mx, d) => Math.max(mx, d.receita_total || 0), 0);
  let totalGeral = 0;
  document.getElementById("tabela-responsaveis").innerHTML = dados.map((d, i) => {
    totalGeral += d.receita_total || 0;
    const pct    = maxReceita > 0 ? Math.round((d.receita_total / maxReceita) * 100) : 0;
    const ticket = d.ticket_medio || (d.total_recibos > 0 ? (d.receita_total / d.total_recibos) : 0);
    return `<tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td style="font-weight:600">${esc(d.responsavel || "-")}</td>
      <td>${d.total_recibos || 0}</td>
      <td style="color:var(--success);font-weight:700">R$ ${formatarValor(d.receita_total || 0)}</td>
      <td>R$ ${formatarValor(ticket)}</td>
      <td style="min-width:120px">
        <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden" title="${pct}%">
          <div style="width:${pct}%;background:var(--gold);height:100%;border-radius:4px"></div>
        </div>
      </td>
    </tr>`;
  }).join("");
  document.getElementById("responsaveis-total").textContent = `Total: R$ ${formatarValor(totalGeral)}`;
  status.style.display = "none"; wrap.style.display = "";
}

function abrirAdminTab(tab,el){
  document.querySelectorAll(".admin-panel").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".admin-tab").forEach(t=>t.classList.remove("active"));
  document.getElementById("admin-"+tab).classList.add("active");
  el.classList.add("active");
  if(tab==="dashboard") atualizarDashboard();
  if(tab==="financeiro"){preencherFiltrosAnos();aplicarFiltros();}
  if(tab==="relatorios") preencherFiltrosAnos();
  if(tab==="inadimplencia") carregarInadimplencia();
  if(tab==="analytics") carregarAnalytics();
  if(tab==="projecao") carregarProjecao();
  if(tab==="escritorios") carregarPorEscritorio();
  if(tab==="responsaveis") carregarPorResponsavel();
  if(tab==="dre") carregarDRE();
  if(tab==="calendario") carregarCalendario(_calAno, _calMes);
  if(tab==="auditoria") carregarAuditoria();
}

async function carregarInadimplencia() {
  const status = document.getElementById("inadimplencia-status");
  const wrap   = document.getElementById("inadimplencia-wrap");
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/inadimplencia");
  if (!res || res.status === 404) {
    status.textContent = "Em breve — relatório de inadimplência em desenvolvimento.";
    return;
  }
  if (!res.ok) { status.textContent = "Erro ao carregar relatório."; return; }
  const body = await res.json();
  const dados = Array.isArray(body) ? body : (body.relatorio || []);
  if (!dados.length) {
    status.textContent = "Nenhum cliente inadimplente no momento.";
    return;
  }
  let totalAberto = 0;
  document.getElementById("tabela-inadimplencia").innerHTML = dados.map(c => {
    totalAberto += c.valor_em_aberto || 0;
    const maiorAtraso = c.parcelas?.reduce((mx, p) => Math.max(mx, p.dias_atraso || 0), 0) || 0;
    return `<tr>
      <td>${esc(c.nome)}</td>
      <td>${esc(c.cpf||"-")}</td>
      <td style="color:var(--error);font-weight:600">${c.parcelas_atrasadas||0}</td>
      <td style="color:var(--error);font-weight:700">R$ ${formatarValor(c.valor_em_aberto||0)}</td>
      <td>${maiorAtraso} dia${maiorAtraso!==1?"s":""}</td>
    </tr>`;
  }).join("");
  document.getElementById("inadimplencia-count").textContent = `${dados.length} cliente${dados.length!==1?"s":""}`;
  document.getElementById("inadimplencia-total").textContent = `Total em aberto: R$ ${formatarValor(totalAberto)}`;
  status.style.display = "none"; wrap.style.display = "";
}

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
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => "R$ " + formatarValor(v) } } } }
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

// ── AUTOCOMPLETE ───────────────────────────────────────────
function atualizarSugestoesNomes(){
  const dl=document.getElementById("nome-sugestoes");
  if(!dl) return;
  const cpfKey=cpf=>cpf?cpf.replace(/\D/g,""):"";
  const nomeNorm=s=>(s||"").normalize("NFC").trim().replace(/\s+/g," ").toUpperCase();
  // Um nome por CPF único (cadastro tem prioridade); sem CPF deduplica por nome
  const porCpf={};  // cpf_digits → nome canônico
  const semCpf=new Set(); // nomes normalizados sem CPF
  // Prioridade 1: cadastro (nome canônico oficial)
  listaClientes.forEach(c=>{
    if(!c.nome) return;
    const k=cpfKey(c.cpf);
    if(k) porCpf[k]=nomeNorm(c.nome);
    else semCpf.add(nomeNorm(c.nome));
  });
  // Prioridade 2: recibos (só adiciona se CPF ainda não visto)
  historicoRecibos.forEach(r=>{
    if(!r.nome) return;
    const k=cpfKey(r.cpf);
    if(k){ if(!porCpf[k]) porCpf[k]=nomeNorm(r.nome); }
    else semCpf.add(nomeNorm(r.nome));
  });
  const nomes=[...Object.values(porCpf),...semCpf].filter(Boolean);
  nomes.sort((a,b)=>a.localeCompare(b,"pt-BR"));
  dl.innerHTML=nomes.map(n=>`<option value="${esc(n)}">`).join("");
}

// ── INATIVOS ───────────────────────────────────────────────
function verificarClientesInativos(){
  const meses=parseInt(localStorage.getItem("alertaInativoMeses")||"3");
  const limite=new Date();
  limite.setMonth(limite.getMonth()-meses);
  const ultimaData={};
  historicoRecibos.forEach(r=>{
    const [d,m,y]=(r.data||"").split("/");
    if(!d||!m||!y) return;
    const dt=new Date(`${y}-${m}-${d}`);
    if(!ultimaData[r.nome]||dt>ultimaData[r.nome]) ultimaData[r.nome]=dt;
  });
  const inativos=Object.entries(ultimaData).filter(([,dt])=>dt<limite).sort((a,b)=>a[1]-b[1]);
  const el=document.getElementById("alerta-inativos");
  if(!inativos.length){el.style.display="none";return;}
  el.style.display="flex";
  document.getElementById("alerta-inativos-lista").innerHTML=
    inativos.slice(0,5).map(([nome,dt])=>`<span style="margin-right:16px">• ${esc(nome)} <span style="color:var(--muted)">(último: ${dt.toLocaleDateString("pt-BR")})</span></span>`).join("")+
    (inativos.length>5?`<span style="color:var(--muted)"> e mais ${inativos.length-5}...</span>`:"");
}
function configurarAlertaInativo(){
  const atual=localStorage.getItem("alertaInativoMeses")||"3";
  const val=prompt("Alertar clientes sem recibo há quantos meses?",atual);
  if(val===null) return;
  const n=parseInt(val);
  if(isNaN(n)||n<1) { mostrarToast("Valor inválido.", null, "error"); return; }
  localStorage.setItem("alertaInativoMeses",String(n));
  verificarClientesInativos();
}

// ── USUÁRIOS ───────────────────────────────────────────────
async function renderUsuarios(){
  const res=await api("GET","/api/users");
  if(!res) return;
  const users=await res.json();
  const el=document.getElementById("lista-usuarios");
  el.innerHTML=users.map(u=>{
    const perfilLabel = u.role==="recepcao"
      ? `Recepção · Escritório: ${esc(u.escritorio||"não definido")}`
      : u.role==="precatorios" ? "Precatórios (somente admin)"
      : "Financeiro";
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600">${esc(u.username)}</div>
        <div style="font-size:11px;color:var(--muted)">Perfil: ${perfilLabel} · Criado em ${new Date(u.created_at).toLocaleDateString("pt-BR")}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-sm" data-action="editar-usuario" data-id="${esc(u.id)}" data-username="${esc(u.username)}" data-role="${esc(u.role||"financeiro")}" data-escritorio="${esc(u.escritorio||"")}">Editar</button>
        <button class="btn-danger btn-sm" data-action="excluir-usuario" data-id="${esc(u.id)}">Remover</button>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-action='editar-usuario']").forEach(btn => {
    btn.addEventListener("click", () => editarUsuario(btn.dataset.id, btn.dataset.username, btn.dataset.role, btn.dataset.escritorio));
  });
  el.querySelectorAll("[data-action='excluir-usuario']").forEach(btn => {
    btn.addEventListener("click", () => excluirUsuario(btn.dataset.id));
  });
}

function toggleEscritorioNovo(role){
  document.getElementById("novo-escritorio-group").style.display = role==="recepcao" ? "" : "none";
}

function toggleEscritorioEdit(role){
  document.getElementById("edit-escritorio-group").style.display = role==="recepcao" ? "" : "none";
}

function editarUsuario(id, usernameAtual, roleAtual, escritorioAtual){
  document.getElementById("edit-user-id").value = id;
  document.getElementById("edit-user-nome").value = usernameAtual;
  document.getElementById("edit-user-senha").value = "";
  document.getElementById("edit-user-role").value = roleAtual || "financeiro";
  // Normaliza o escritório para bater com os valores do select (case-insensitive)
  const sel = document.getElementById("edit-user-escritorio");
  const optMatch = [...sel.options].find(o => o.value.toUpperCase() === (escritorioAtual||"").toUpperCase());
  sel.value = optMatch ? optMatch.value : (escritorioAtual || "");
  toggleEscritorioEdit(roleAtual || "financeiro");
  document.getElementById("modal-editar-usuario").classList.add("active");
}

async function salvarEdicaoUsuario(){
  const id = document.getElementById("edit-user-id").value;
  const username = document.getElementById("edit-user-nome").value.trim();
  const password = document.getElementById("edit-user-senha").value;
  const role = document.getElementById("edit-user-role").value;
  const escritorio = document.getElementById("edit-user-escritorio").value.trim();
  if(!username) { mostrarToast("Preencha o nome de usuário.", null, "error"); return; }
  const body = { username, role, escritorio };
  if(password) body.password = password;
  const res = await api("PUT", `/api/users/${id}`, body);
  const data = await res.json();
  if(!res.ok) { mostrarToast(data.erro || "Erro ao editar usuário.", null, "error"); return; }
  fecharModal("modal-editar-usuario");
  mostrarToast("Usuário atualizado!");
  renderUsuarios();
}

async function adicionarUsuario(){
  const username=document.getElementById("novo-usuario").value.trim();
  const password=document.getElementById("nova-senha").value;
  const role=document.getElementById("novo-role").value;
  const escritorio=document.getElementById("novo-escritorio").value.trim();
  if(!username||!password) { mostrarToast("Preencha usuário e senha.", null, "error"); return; }
  const res=await api("POST","/api/users",{username,password,role,escritorio});
  const data=await res.json();
  if(!res.ok) { mostrarToast(data.erro||"Erro ao criar usuário.", null, "error"); return; }
  document.getElementById("novo-usuario").value="";
  document.getElementById("nova-senha").value="";
  document.getElementById("novo-role").value="financeiro";
  document.getElementById("novo-escritorio").value="";
  toggleEscritorioNovo("financeiro");
  mostrarToast(`Usuário "${username}" criado com sucesso!`);
  renderUsuarios();
}

async function excluirUsuario(id){
  if(!confirm("Remover este usuário?")) return;
  await api("DELETE",`/api/users/${id}`);
  renderUsuarios();
}

// ── BACKUP / RESTAURAR ─────────────────────────────────────
function fazerBackup(){
  const dados={versao:"2.0",data:new Date().toISOString(),historicoRecibos};
  const blob=new Blob([JSON.stringify(dados,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`backup_araujo_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast("Backup baixado!");
}

async function restaurarBackup(input){
  const file=input.files[0];
  if(!file) return;
  const text=await file.text();
  try{
    const dados=JSON.parse(text);
    const recibos=dados.historicoRecibos||dados;
    if(!Array.isArray(recibos)) { mostrarToast("Arquivo inválido.", null, "error"); return; }
    if(!confirm(`Importar ${recibos.length} recibos? Os recibos existentes não serão apagados.`)) return;
    let importados=0;
    for(const r of recibos){
      if(!r.nome||!r.num) continue;
      await api("POST","/api/recibos",{
        num:r.num,nome:r.nome,cpf:r.cpf||"",municipio_uf:r.municipio_uf||"",
        valor:r.valor||"",data:r.data||"",emitido_por:r.emitido_por||"",
        complemento:r.complemento||"",referencia:r.referencia||"",
        timestamp:typeof r.timestamp==="number"?r.timestamp:Date.now()
      });
      importados++;
    }
    await carregarRecibos();
    atualizarSugestoesNomes();
    preencherFiltrosAnos();
    mostrarToast(`${importados} recibos importados com sucesso!`);
  }catch{
    mostrarToast("Erro ao ler o arquivo de backup.", null, "error");
  }
  input.value="";
}

// ── LAZY LOAD LIBS PESADAS ─────────────────────────────────
function carregarLib(src){
  return new Promise((resolve,reject)=>{
    if(document.querySelector(`script[src="${src}"]`)){resolve();return;}
    const s=document.createElement("script");
    s.src=src;s.onload=resolve;s.onerror=reject;
    document.head.appendChild(s);
  });
}
async function garantirXLSX(){
  if(!window.XLSX) await carregarLib("libs/xlsx.min.js");
}
async function garantirJSPDF(){
  if(!window.jspdf){
    await carregarLib("libs/jspdf.min.js");
    await carregarLib("libs/jspdf.autotable.min.js");
  }
}

// ── EXPORTAR EXCEL ─────────────────────────────────────────
function filtrarRelatorio(){
  const mes=document.getElementById("rel-mes").value;
  const ano=document.getElementById("rel-ano").value;
  const resp=document.getElementById("rel-responsavel").value;
  return historicoRecibos.filter(r=>{
    const p=r.data?.split("/");
    if(!p) return false;
    if(mes&&p[1]!==mes) return false;
    if(ano&&p[2]!==ano) return false;
    if(resp&&r.emitido_por!==resp) return false;
    return true;
  });
}

async function exportarExcel(){
  await garantirXLSX();
  const lista=filtrarRelatorio();
  if(!lista.length) { mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const ws=XLSX.utils.json_to_sheet(lista.map(r=>({
    "Nº Recibo":r.num,"Cliente":r.nome,"CPF/CNPJ":r.cpf,"Município":r.municipio_uf,
    "Valor":"R$ "+r.valor,"Data":r.data,"Responsável":r.emitido_por||"","Referência":r.referencia||""
  })));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Recibos");
  XLSX.writeFile(wb,`relatorio_araujo_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function exportarExcelClientes(){
  await garantirXLSX();
  const ano=document.getElementById("rel-cliente-ano").value;
  const lista=historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length) { mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const mapa={};
  lista.forEach(r=>{
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,cpf:r.cpf,qtd:0,total:0};
    mapa[r.nome].qtd++;
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });
  const ws=XLSX.utils.json_to_sheet(Object.values(mapa).map(c=>({
    "Cliente":c.nome,"CPF/CNPJ":c.cpf,"Qtd Recibos":c.qtd,"Total Pago":"R$ "+formatarValor(c.total)
  })));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Clientes");
  XLSX.writeFile(wb,`clientes_araujo_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function exportarPDF(){
  await garantirJSPDF();
  const lista=filtrarRelatorio();
  if(!lista.length) { mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:"landscape"});
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26);doc.rect(0,0,W,18,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(9);doc.setFont("helvetica","normal");
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`,14,26);
  doc.autoTable({
    startY:30,
    head:[["Nº","Cliente","Data","Valor","Responsável","Referência"]],
    body:lista.map(r=>[r.num,r.nome,r.data,"R$ "+r.valor,r.emitido_por||"-",r.referencia||"-"]),
    styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},
    alternateRowStyles:{fillColor:[250,248,244]},
  });
  const soma=lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  doc.setFontSize(10);doc.setFont("helvetica","bold");
  doc.text(`Total: R$ ${formatarValor(soma)}`,W-14,doc.lastAutoTable.finalY+10,{align:"right"});
  doc.save(`relatorio_araujo_${new Date().toISOString().slice(0,10)}.pdf`);
}

async function exportarPDFClientes(){
  await garantirJSPDF();
  const ano=document.getElementById("rel-cliente-ano").value;
  const lista=historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length) { mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const mapa={};
  lista.forEach(r=>{
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,cpf:r.cpf,qtd:0,total:0};
    mapa[r.nome].qtd++;
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26);doc.rect(0,0,W,18,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.autoTable({
    startY:26,
    head:[["Cliente","CPF/CNPJ","Qtd","Total"]],
    body:Object.values(mapa).map(c=>[c.nome,c.cpf,c.qtd,"R$ "+formatarValor(c.total)]),
    styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},
  });
  doc.save(`clientes_araujo_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ── RELATÓRIO POR RESPONSÁVEL ──────────────────────────────
async function exportarExcelResponsaveis(){
  await garantirXLSX();
  const mes=document.getElementById("rel-resp-mes").value;
  const ano=document.getElementById("rel-resp-ano").value;
  const lista=historicoRecibos.filter(r=>{
    const p=r.data?.split("/");if(!p)return false;
    if(mes&&p[1]!==mes)return false;
    if(ano&&p[2]!==ano)return false;
    return true;
  });
  if(!lista.length){ mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const mapa={};
  lista.forEach(r=>{
    const resp=r.emitido_por||"Sem responsável";
    if(!mapa[resp])mapa[resp]={responsavel:resp,qtd:0,total:0};
    mapa[resp].qtd++;
    mapa[resp].total+=valorParaNumero(r.valor);
  });
  const ws=XLSX.utils.json_to_sheet(Object.values(mapa).map(r=>({
    "Responsável":r.responsavel,"Qtd Recibos":r.qtd,"Total":"R$ "+formatarValor(r.total)
  })));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Responsáveis");
  XLSX.writeFile(wb,`responsaveis_araujo_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function exportarPDFResponsaveis(){
  await garantirJSPDF();
  const mes=document.getElementById("rel-resp-mes").value;
  const ano=document.getElementById("rel-resp-ano").value;
  const lista=historicoRecibos.filter(r=>{
    const p=r.data?.split("/");if(!p)return false;
    if(mes&&p[1]!==mes)return false;
    if(ano&&p[2]!==ano)return false;
    return true;
  });
  if(!lista.length){ mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const mapa={};
  lista.forEach(r=>{
    const resp=r.emitido_por||"Sem responsável";
    if(!mapa[resp])mapa[resp]={responsavel:resp,qtd:0,total:0};
    mapa[resp].qtd++;
    mapa[resp].total+=valorParaNumero(r.valor);
  });
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26);doc.rect(0,0,W,18,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(11);
  doc.text("Relatório por Responsável",14,26);
  doc.autoTable({
    startY:32,
    head:[["Responsável","Qtd Recibos","Total"]],
    body:Object.values(mapa).map(r=>[r.responsavel,r.qtd,"R$ "+formatarValor(r.total)]),
    styles:{fontSize:10},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},
  });
  doc.save(`responsaveis_araujo_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ── RESUMO EXECUTIVO ───────────────────────────────────────
async function exportarPDFExecutivo(){
  await garantirJSPDF();
  const ano=document.getElementById("rel-exec-ano").value;
  const lista=historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length){ mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  // Cabeçalho
  doc.setFillColor(26,26,26);doc.rect(0,0,W,24,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(14);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(200,200,200);
  doc.text("A ARAUJO PREV",W/2,18,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text(`Resumo Executivo ${ano||"Geral"}`,W/2,34,{align:"center"});
  // Totais
  const totalGeral=lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  const ticketMedio=lista.length?totalGeral/lista.length:0;
  doc.setFontSize(10);doc.setFont("helvetica","normal");
  doc.text(`Total de recibos: ${lista.length}   |   Total faturado: R$ ${formatarValor(totalGeral)}   |   Ticket médio: R$ ${formatarValor(ticketMedio)}`,W/2,42,{align:"center"});
  // Faturamento mensal
  const mesesNomes=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const porMes=mesesNomes.map((m,i)=>{
    const mm=String(i+1).padStart(2,"0");
    const sub=lista.filter(r=>r.data?.split("/")[1]===mm);
    return [m,sub.length,"R$ "+formatarValor(sub.reduce((s,r)=>s+valorParaNumero(r.valor),0))];
  }).filter(r=>r[1]>0);
  doc.autoTable({startY:50,head:[["Mês","Qtd","Total"]],body:porMes,styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},tableWidth:80,margin:{left:14}});
  // Top clientes
  const mapaC={};
  lista.forEach(r=>{if(!mapaC[r.nome])mapaC[r.nome]={nome:r.nome,total:0,qtd:0};mapaC[r.nome].total+=valorParaNumero(r.valor);mapaC[r.nome].qtd++;});
  const topC=Object.values(mapaC).sort((a,b)=>b.total-a.total).slice(0,10);
  doc.autoTable({startY:50,head:[["Top Clientes","Qtd","Total"]],body:topC.map(c=>[c.nome,c.qtd,"R$ "+formatarValor(c.total)]),styles:{fontSize:9},headStyles:{fillColor:[62,122,94],textColor:"white"},tableWidth:90,margin:{left:110}});
  // Responsáveis
  const mapaR={};
  lista.forEach(r=>{const k=r.emitido_por||"-";if(!mapaR[k])mapaR[k]={resp:k,total:0,qtd:0};mapaR[k].total+=valorParaNumero(r.valor);mapaR[k].qtd++;});
  doc.autoTable({startY:doc.lastAutoTable.finalY+14,head:[["Responsável","Qtd","Total"]],body:Object.values(mapaR).sort((a,b)=>b.total-a.total).map(r=>[r.resp,r.qtd,"R$ "+formatarValor(r.total)]),styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]}});
  doc.save(`executivo_araujo_${ano||"geral"}.pdf`);
}

// ── UPLOAD COMPROVANTE (recepção) ─────────────────────────
let _uploadCompReciboId = null;

function abrirModalUploadComprovante(reciboId) {
  _uploadCompReciboId = reciboId;
  document.getElementById("upload-comp-input").value = "";
  document.getElementById("upload-comp-label-text").textContent = "Escolher arquivo (imagem ou PDF)";
  document.getElementById("upload-comp-status").textContent = "";
  document.getElementById("modal-upload-comprovante").classList.add("active");
}

function onUploadCompFileChange() {
  const input = document.getElementById("upload-comp-input");
  const labelText = document.getElementById("upload-comp-label-text");
  if (input.files && input.files[0]) {
    labelText.textContent = input.files[0].name;
  } else {
    labelText.textContent = "Escolher arquivo (imagem ou PDF)";
  }
}

async function enviarUploadComprovante() {
  const input = document.getElementById("upload-comp-input");
  const status = document.getElementById("upload-comp-status");
  const btn = document.getElementById("btn-upload-comp-enviar");
  if (!input.files || !input.files[0]) { status.textContent = "Selecione um arquivo primeiro."; return; }
  if (!_uploadCompReciboId) return;
  btn.disabled = true;
  status.textContent = "Enviando arquivo...";
  try {
    const fd = new FormData();
    fd.append("comprovante", input.files[0]);
    const r1 = await fetch("/api/upload-comprovante", { method: "POST", headers: { "Authorization": "Bearer " + token }, body: fd });
    const j1 = await r1.json();
    if (!j1.link) { status.textContent = j1.erro || "Erro ao enviar arquivo."; btn.disabled = false; return; }
    status.textContent = "Vinculando ao recibo...";
    const r2 = await fetch(`/api/recibos/${_uploadCompReciboId}/comprovante`, {
      method: "PATCH",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ link_comprovante: j1.link })
    });
    const j2 = await r2.json();
    if (j2.ok) {
      status.textContent = "Comprovante adicionado com sucesso!";
      setTimeout(() => { fecharModal("modal-upload-comprovante"); carregarRecibos().then(renderHistorico); }, 1200);
    } else {
      status.textContent = j2.erro || "Erro ao vincular comprovante.";
    }
  } catch(e) {
    status.textContent = "Erro: " + e.message;
  }
  btn.disabled = false;
}

// ── TECLADO ────────────────────────────────────────────────
document.addEventListener("keydown",function(e){
  if(e.altKey&&e.key==="g"){e.preventDefault();navegarPara("gerar");document.getElementById("nome").focus();}
  if(e.altKey&&e.key==="h"){e.preventDefault();navegarPara("historico");}
  if(e.altKey&&e.key==="c"){e.preventDefault();navegarPara("clientes");}
  if(e.altKey&&e.key==="a"){e.preventDefault();navegarPara("admin");}
  if(e.altKey&&e.key==="l"){e.preventDefault();limparCampos();}
  if(e.key==="Escape") fecharModal("modal-detalhe");
});

async function syncSheets(){
  const btn=document.getElementById("btn-sync-sheets");
  const resultado=document.getElementById("sync-sheets-resultado");
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split"></i> Enviando...';
  resultado.style.display="none";
  try{
    const response=await api("POST","/api/admin/sync-sheets");
    if(!response) return;
    const res=await response.json();
    resultado.style.display="block";
    if(res&&res.ok){
      resultado.style.color="var(--success,#22c55e)";
      resultado.textContent=res.mensagem||"Sincronizado com sucesso.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Resposta inesperada: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexão.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-arrow-repeat"></i> Sincronizar agora';
  }
}

async function reescreverPlanilha(){
  if(!confirm("ATENÇÃO: isso vai APAGAR tudo da planilha e reescrever do zero com os dados do banco (datas corrigidas). Continuar?")) return;
  const btn=document.getElementById("btn-reescrever-planilha");
  const resultado=document.getElementById("sync-sheets-resultado");
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split"></i> Reescrevendo...';
  resultado.style.display="none";
  try{
    const response=await api("POST","/api/admin/reescrever-planilha");
    if(!response) return;
    const res=await response.json();
    resultado.style.display="block";
    if(res&&res.ok){
      resultado.style.color="var(--success,#22c55e)";
      resultado.textContent=res.mensagem||"Planilha reescrita.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=(res?.erro||"Erro")+(res?.detalhe?" — "+res.detalhe:"");
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexão.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-arrow-clockwise"></i> Limpar e reescrever do zero';
  }
}

async function importarDeSheets(){
  if(!confirm("Isso vai importar para o banco todos os recibos da planilha que ainda não existem no banco (por número). Recibos já existentes não serão alterados. Continuar?")) return;
  const btn=document.getElementById("btn-importar-de-sheets");
  const resultado=document.getElementById("sync-sheets-resultado");
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split"></i> Importando...';
  resultado.style.display="none";
  try{
    const response=await api("POST","/api/admin/importar-de-sheets");
    if(!response) return;
    const res=await response.json();
    resultado.style.display="block";
    if(res&&res.ok){
      resultado.style.color="var(--success,#22c55e)";
      resultado.textContent=res.mensagem||"Importação concluída.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Erro: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexão.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-cloud-download"></i> Importar planilha → banco';
  }
}

async function corrigirDatas(){
  const btn=document.getElementById("btn-corrigir-datas");
  const resultado=document.getElementById("sync-sheets-resultado");
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split"></i> Corrigindo...';
  resultado.style.display="none";
  try{
    const response=await api("POST","/api/admin/corrigir-datas");
    if(!response) return;
    const res=await response.json();
    resultado.style.display="block";
    if(res&&res.ok){
      resultado.style.color="var(--success,#22c55e)";
      resultado.textContent=res.mensagem||"Datas corrigidas.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Erro: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexão.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-calendar-check"></i> Corrigir datas';
  }
}

async function limparDuplicatas(){
  if(!confirm("Isso vai remover linhas duplicadas da planilha (mantém a primeira ocorrência de cada recibo). Continuar?")) return;
  const btn=document.getElementById("btn-limpar-duplicatas");
  const resultado=document.getElementById("sync-sheets-resultado");
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split"></i> Limpando...';
  resultado.style.display="none";
  try{
    const response=await api("POST","/api/admin/limpar-duplicatas");
    if(!response) return;
    const res=await response.json();
    resultado.style.display="block";
    if(res&&res.ok){
      resultado.style.color="var(--success,#22c55e)";
      resultado.textContent=res.mensagem||"Limpeza concluída.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Erro inesperado: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexão.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-trash"></i> Remover duplicatas';
  }
}

// ── HANDLERS ESTÁTICOS ─────────────────────────────────────
// Chamado uma vez ao carregar o módulo (script defer). Substitui todos os
// onclick/oninput/onchange inline que foram removidos do HTML para permitir
// um CSP script-src sem 'unsafe-inline'.
/* ── Central de Notificações ── */
let _notifList = [];
let _notifUnreadCount = 0;
let _notifPoller = null;

function carregarNotificacoes() {
  if (!token) return;
  // Tenta buscar do servidor; se falhar, gera localmente
  fetch("/api/notificacoes", { headers: { Authorization: "Bearer " + token } })
    .then(r => { if (!r.ok) throw new Error("server"); return r.json(); })
    .then(data => {
      _notifList = data.notificacoes || [];
      _notifUnreadCount = data.naoLidas ?? 0;
      renderNotificacoes();
    })
    .catch(() => gerarNotificacoesLocais());
}

function gerarNotificacoesLocais() {
  // Gera notificações a partir das parcelas vencendo nos próximos 7 dias
  const notifs = [];
  const clientes = _clientes || [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  clientes.forEach(c => {
    if (!c.parcelas || !Array.isArray(c.parcelas)) return;
    c.parcelas.forEach((p, idx) => {
      if (p.pago) return;
      if (!p.data_vencimento) return;
      const venc = new Date(p.data_vencimento + "T00:00:00");
      if (isNaN(venc.getTime())) return;
      const diff = Math.floor((venc - hoje) / 86400000);
      if (diff < 0 && diff > -365) {
        notifs.push({
          id: "loc-" + c.id + "-" + idx,
          tipo: "vencimento",
          titulo: "Parcela vencida",
          texto: c.nome + " — Parcela " + (idx+1) + " venceu há " + Math.abs(diff) + " dia(s)",
          lido: false,
          gravidade: "danger",
          data: venc.toISOString(),
          ref: { clienteId: c.id, parcelaIdx: idx }
        });
      } else if (diff >= 0 && diff <= 7) {
        notifs.push({
          id: "loc-" + c.id + "-" + idx,
          tipo: "vencimento",
          titulo: "Parcela próxima do vencimento",
          texto: c.nome + " — Parcela " + (idx+1) + " vence em " + diff + " dia(s)",
          lido: false,
          gravidade: diff <= 2 ? "warning" : "info",
          data: venc.toISOString(),
          ref: { clienteId: c.id, parcelaIdx: idx }
        });
      }
    });
  });

  // Ordenar por data (mais urgente primeiro)
  notifs.sort((a, b) => new Date(a.data) - new Date(b.data));
  _notifList = notifs.slice(0, 50);
  _notifUnreadCount = notifs.filter(n => !n.lido).length;
  renderNotificacoes();
}

function renderNotificacoes() {
  const lista = document.getElementById("notif-lista");
  const badge = document.getElementById("notif-badge");
  const countText = document.getElementById("notif-count-text");
  const empty = document.getElementById("notif-empty");
  if (!lista) return;

  // Atualiza badge
  if (_notifUnreadCount > 0) {
    badge.textContent = _notifUnreadCount > 99 ? "99+" : String(_notifUnreadCount);
    badge.classList.add("has-count");
    document.getElementById("btn-notificacoes")?.classList.add("shake");
  } else {
    badge.classList.remove("has-count");
    document.getElementById("btn-notificacoes")?.classList.remove("shake");
  }
  if (countText) countText.textContent = _notifUnreadCount + " pendente(s)";

  // Remove itens antigos (mantém o empty)
  lista.querySelectorAll(".notif-item").forEach(el => el.remove());

  if (!_notifList.length) {
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";

  _notifList.forEach(n => {
    const item = document.createElement("div");
    item.className = "notif-item notif-" + (n.gravidade || "info");
    const icones = { danger: "exclamation-triangle-fill", warning: "clock-fill", success: "check-circle-fill", info: "info-circle-fill" };
    const icon = icones[n.gravidade] || "bell-fill";
    const dias = n.texto.match(/(\d+)\s*dia/);
    const displayData = dias ? "Vence em " + dias[1] + " dia(s)" : (n.data ? new Date(n.data).toLocaleDateString("pt-BR") : "");
    item.innerHTML =
      '<div class="notif-icon"><i class="bi bi-' + icon + '"></i></div>' +
      '<div class="notif-body">' +
        '<div class="notif-title">' + esc(n.titulo) + '</div>' +
        '<div class="notif-text">' + esc(n.texto) + '</div>' +
        '<div class="notif-time">' + esc(displayData) + '</div>' +
      '</div>';
    item.addEventListener("click", () => {
      if (n.ref && n.ref.clienteId) {
        fecharNotifDropdown();
        navegarPara("clientes");
        setTimeout(() => abrirModalCliente(n.ref.clienteId), 200);
      }
    });
    lista.appendChild(item);
  });
}

function toggleNotifDropdown() {
  const dd = document.getElementById("notif-dropdown");
  if (!dd) return;
  const open = dd.classList.toggle("open");
  if (open) carregarNotificacoes();
}

function fecharNotifDropdown() {
  const dd = document.getElementById("notif-dropdown");
  if (dd) dd.classList.remove("open");
}

function marcarNotificacoesLidas() {
  _notifList.forEach(n => n.lido = true);
  _notifUnreadCount = 0;
  renderNotificacoes();
  fetch("/api/notificacoes/marcar-lidas", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }
  }).catch(() => {});
}

function initNotifPolling() {
  if (_notifPoller) clearInterval(_notifPoller);
  carregarNotificacoes();
  _notifPoller = setInterval(carregarNotificacoes, 60000);
}

// Fechar dropdown ao clicar fora
document.addEventListener("click", function(e) {
  const dd = document.getElementById("notif-dropdown");
  const btn = document.getElementById("btn-notificacoes");
  if (dd && dd.classList.contains("open") && !dd.contains(e.target) && !btn?.contains(e.target)) {
    fecharNotifDropdown();
  }
});

function bindStaticHandlers() {
  // Login
  document.getElementById("btn-login").addEventListener("click", fazerLogin);

  // Sidebar
  document.getElementById("nav-gerar").addEventListener("click", () => navegarPara("gerar"));
  document.getElementById("nav-historico").addEventListener("click", () => navegarPara("historico"));
  document.getElementById("nav-clientes").addEventListener("click", () => navegarPara("clientes"));
  document.getElementById("nav-admin").addEventListener("click", () => navegarPara("admin"));
  document.getElementById("nav-usuarios").addEventListener("click", () => navegarPara("usuarios"));
  document.getElementById("nav-backup").addEventListener("click", fazerBackup);
  document.getElementById("nav-restaurar").addEventListener("click", () => document.getElementById("input-restaurar").click());
  document.getElementById("input-restaurar").addEventListener("change", function() { restaurarBackup(this); });
  document.getElementById("nav-sair").addEventListener("click", fazerLogout);

  // Bottom nav
  document.getElementById("bn-gerar").addEventListener("click", () => navegarPara("gerar"));
  document.getElementById("bn-historico").addEventListener("click", () => navegarPara("historico"));
  document.getElementById("bn-clientes").addEventListener("click", () => navegarPara("clientes"));
  document.getElementById("bn-admin").addEventListener("click", () => navegarPara("admin"));
  document.getElementById("bn-usuarios").addEventListener("click", () => navegarPara("usuarios"));

  // Central de Notificações
  document.getElementById("btn-notificacoes").addEventListener("click", toggleNotifDropdown);
  document.getElementById("btn-marcar-lidas").addEventListener("click", marcarNotificacoesLidas);

  // Tema
  document.getElementById("btn-tema").addEventListener("click", alternarTema);

  // Modal inativo
  document.getElementById("btn-configurar-inativo").addEventListener("click", () => navegarPara("admin"));
  document.getElementById("btn-fechar-inativo").addEventListener("click", () => fecharModal("modal-inativo"));

  // Edição
  document.getElementById("btn-cancelar-edicao").addEventListener("click", cancelarEdicao);

  // Formulário de recibo
  document.getElementById("btn-gerar").addEventListener("click", gerarRecibo);
  document.getElementById("btn-limpar-recibo").addEventListener("click", limparCampos);
  document.getElementById("referencia").addEventListener("input", onReferenciaInput);
  document.getElementById("btn-ref-padrao-recibo").addEventListener("click", salvarReferenciaPadraoRecibo);
  document.getElementById("comprovante").addEventListener("change", function() { atualizarLabelComprovante(this); });

  // Histórico
  document.getElementById("busca-historico").addEventListener("input", renderHistorico);
  document.getElementById("filtro-data-ini").addEventListener("input", renderHistorico);
  document.getElementById("filtro-data-fim").addEventListener("input", renderHistorico);
  document.getElementById("btn-limpar-data").addEventListener("click", limparFiltroData);
  document.getElementById("btn-exportar-zip").addEventListener("click", exportarZipSelecionados);
  document.getElementById("btn-select-all").addEventListener("click", selecionarTodosRecibos);
  document.getElementById("btn-batch-delete").addEventListener("click", excluirSelecionados);
  document.getElementById("btn-batch-email").addEventListener("click", batchEnviarEmail);

  // Filtros avançados
  document.getElementById("btn-toggle-filtros-avancados")?.addEventListener("click", toggleFiltrosAvancados);
  document.getElementById("btn-limpar-filtros-avancados")?.addEventListener("click", limparFiltrosAvancados);
  document.getElementById("filtro-avancado-escritorio")?.addEventListener("change", renderHistorico);
  document.getElementById("filtro-avancado-forma")?.addEventListener("change", renderHistorico);
  document.getElementById("filtro-avancado-responsavel")?.addEventListener("change", renderHistorico);
  document.getElementById("filtro-avancado-min")?.addEventListener("input", renderHistorico);
  document.getElementById("filtro-avancado-max")?.addEventListener("input", renderHistorico);

  // Email recibo
  document.getElementById("btn-enviar-email-recibo")?.addEventListener("click", enviarReciboEmail);
  document.getElementById("btn-fechar-area-email")?.addEventListener("click", () => {
    const area = document.getElementById("area-enviar-email");
    if (area) area.style.display = "none";
    _lastReciboGerado = null;
  });

  // Clientes
  document.getElementById("busca-clientes").addEventListener("input", renderClientes);
  document.getElementById("btn-cadastrar-cliente").addEventListener("click", () => abrirModalCliente());

  // Admin tabs
  document.querySelectorAll(".admin-tab[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => abrirAdminTab(btn.dataset.tab, btn));
  });

  // Dashboard — filtro de ano
  document.getElementById("dash-ano")?.addEventListener("change", atualizarDashboard);

  // Analytics — filtro de período e exportar
  document.getElementById("analytics-de")?.addEventListener("change", _renderAnalytics);
  document.getElementById("analytics-ate")?.addEventListener("change", _renderAnalytics);
  document.getElementById("btn-exportar-analytics-excel")?.addEventListener("click", exportarAnalyticsExcel);
  document.getElementById("btn-exportar-analytics-pdf")?.addEventListener("click", exportarAnalyticsPDF);
  document.getElementById("dre-ano")?.addEventListener("change", _renderDRE);
  document.getElementById("btn-exportar-dre-pdf")?.addEventListener("click", exportarDREPDF);

  // Relatórios / exportações
  document.getElementById("btn-aplicar-filtros").addEventListener("click", aplicarFiltros);
  document.getElementById("btn-exportar-excel").addEventListener("click", exportarExcel);
  document.getElementById("btn-exportar-pdf").addEventListener("click", exportarPDF);
  document.getElementById("btn-exportar-excel-clientes").addEventListener("click", exportarExcelClientes);
  document.getElementById("btn-exportar-pdf-clientes").addEventListener("click", exportarPDFClientes);
  document.getElementById("btn-exportar-excel-resp").addEventListener("click", exportarExcelResponsaveis);
  document.getElementById("btn-exportar-pdf-resp").addEventListener("click", exportarPDFResponsaveis);
  document.getElementById("btn-exportar-pdf-exec").addEventListener("click", exportarPDFExecutivo);
  document.getElementById("btn-sync-sheets").addEventListener("click", syncSheets);
  document.getElementById("btn-importar-de-sheets").addEventListener("click", importarDeSheets);
  document.getElementById("btn-reescrever-planilha").addEventListener("click", reescreverPlanilha);
  document.getElementById("btn-backup-db").addEventListener("click", baixarBackupDB);
  document.getElementById("btn-normalizar-escritorios").addEventListener("click", normalizarEscritorios);
  document.getElementById("btn-importar-clientes-recibos").addEventListener("click", importarClientesDosRecibos);

  // Usuários
  document.getElementById("novo-role").addEventListener("change", function() { toggleEscritorioNovo(this.value); });
  document.getElementById("btn-adicionar-usuario").addEventListener("click", adicionarUsuario);
  document.getElementById("btn-fechar-modal-usuario").addEventListener("click", () => fecharModal("modal-usuario"));
  document.getElementById("edit-user-role").addEventListener("change", function() { toggleEscritorioEdit(this.value); });
  document.getElementById("btn-salvar-edicao-usuario").addEventListener("click", salvarEdicaoUsuario);
  document.getElementById("btn-cancelar-modal-usuario").addEventListener("click", () => fecharModal("modal-usuario"));

  // Modal cliente
  document.getElementById("btn-fechar-modal-cliente").addEventListener("click", () => fecharModal("modal-cliente"));
  document.getElementById("cliente-cpf").addEventListener("input", function() { mascaraCpfCliente(this); preencherDadosCliente(this.value); });
  document.getElementById("btn-salvar-ref-padrao").addEventListener("click", salvarReferenciaPadrao);
  document.getElementById("cliente-valor-beneficio").addEventListener("input", function() { mascaraValorCliente(this); calcularContrato(); });
  document.getElementById("cliente-num-beneficios").addEventListener("input", calcularContrato);
  document.getElementById("cliente-valor-contrato").addEventListener("input", function() { mascaraValorCliente(this); calcularParcela(); });
  document.getElementById("cliente-num-parcelas").addEventListener("input", calcularParcela);
  document.getElementById("btn-salvar-cliente").addEventListener("click", salvarCliente);
  document.getElementById("btn-cancelar-modal-cliente").addEventListener("click", () => fecharModal("modal-cliente"));

  // Observações do cliente
  document.getElementById("btn-toggle-obs")?.addEventListener("click", () => {
    const addPanel = document.getElementById("cliente-obs-add");
    const btn      = document.getElementById("btn-toggle-obs");
    if (!addPanel) return;
    const open = addPanel.style.display !== "none";
    addPanel.style.display = open ? "none" : "";
    if (btn) btn.innerHTML = open ? '<i class="bi bi-plus-circle"></i> Adicionar observação' : '<i class="bi bi-dash-circle"></i> Cancelar';
    if (!open) document.getElementById("cliente-obs-texto")?.focus();
  });
  document.getElementById("btn-confirmar-obs")?.addEventListener("click", adicionarObservacaoCliente);

  // Modal pagamento parcela
  document.getElementById("btn-fechar-modal-pagamento").addEventListener("click", () => fecharModal("modal-pagamento-parcela"));
  document.getElementById("btn-confirmar-pagamento").addEventListener("click", confirmarPagamentoParcela);
  document.getElementById("btn-cancelar-pagamento").addEventListener("click", () => fecharModal("modal-pagamento-parcela"));

  // Modal detalhe
  document.getElementById("btn-fechar-modal-detalhe").addEventListener("click", () => fecharModal("modal-detalhe"));

  // Modal Gov.br
  document.getElementById("btn-fechar-modal-govbr").addEventListener("click", () => fecharModal("modal-govbr"));
  document.getElementById("btn-govbr-assinar").addEventListener("click", iniciarAssinaturaGovBr);

  // Modal upload comprovante
  document.getElementById("btn-fechar-modal-upload").addEventListener("click", () => fecharModal("modal-upload-comprovante"));
  document.getElementById("upload-comp-input").addEventListener("change", onUploadCompFileChange);
  document.getElementById("btn-upload-comp-enviar").addEventListener("click", enviarUploadComprovante);

  // Modal comprovante
  document.getElementById("btn-fechar-modal-comprovante").addEventListener("click", () => fecharModal("modal-comprovante"));

  // Toast
  document.getElementById("btn-fechar-toast").addEventListener("click", fecharToast);

  // Imagens com fallback (substitui onerror inline)
  document.getElementById("logo-sidebar").addEventListener("error", function() { this.style.display = "none"; });
  document.getElementById("img-govbr").addEventListener("error", function() { this.style.display = "none"; });

  // Calendário
  document.getElementById("btn-cal-prev")?.addEventListener("click", () => {
    let m = _calMes - 1, a = _calAno;
    if (m < 0) { m = 11; a--; }
    carregarCalendario(a, m);
  });
  document.getElementById("btn-cal-next")?.addEventListener("click", () => {
    let m = _calMes + 1, a = _calAno;
    if (m > 11) { m = 0; a++; }
    carregarCalendario(a, m);
  });

  // Auditoria
  document.getElementById("audit-filtro-usuario")?.addEventListener("input", _renderAuditoria);
  document.getElementById("audit-filtro-acao")?.addEventListener("input", _renderAuditoria);
  document.getElementById("btn-limpar-audit")?.addEventListener("click", () => {
    ["audit-filtro-usuario","audit-filtro-acao"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
    _renderAuditoria();
  });

  // Modal busca global
  const buscaModalInp = document.getElementById("busca-modal-input");
  const buscaModal    = document.getElementById("modal-busca-global");
  if (buscaModalInp) {
    buscaModalInp.addEventListener("input", () => {
      clearTimeout(_buscaModalTimer);
      _buscaModalTimer = setTimeout(() => renderBuscaModal(buscaModalInp.value.trim()), 200);
    });
    buscaModalInp.addEventListener("keydown", e => {
      const resultados = document.getElementById("busca-modal-resultados");
      const itens = resultados?.querySelectorAll(".busca-resultado-item") || [];
      if (e.key === "Escape") fecharModalBuscaGlobal();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const idx = Array.from(itens).findIndex(el => el.classList.contains("focused"));
        const next = Math.min(idx + 1, itens.length - 1);
        itens.forEach((el, i) => el.classList.toggle("focused", i === next));
        if (itens[next]) itens[next].scrollIntoView({ block: "nearest" });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const idx = Array.from(itens).findIndex(el => el.classList.contains("focused"));
        const prev = Math.max(idx - 1, 0);
        itens.forEach((el, i) => el.classList.toggle("focused", i === prev));
        if (itens[prev]) itens[prev].scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Enter") {
        const focused = Array.from(itens).find(el => el.classList.contains("focused"));
        if (focused) { e.preventDefault(); focused.click(); }
      }
    });
  }
  if (buscaModal) {
    buscaModal.addEventListener("click", e => { if (e.target === buscaModal) fecharModalBuscaGlobal(); });
    buscaModal.addEventListener("keydown", e => { if (e.key === "Escape") fecharModalBuscaGlobal(); });
  }

  // Fechar qualquer modal ao clicar no backdrop
  ["modal-editar-usuario","modal-cliente","modal-pagamento-parcela",
   "modal-detalhe","modal-govbr","modal-upload-comprovante","modal-comprovante"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", e => { if (e.target === el) fecharModal(id); });
  });

  // Busca global (sidebar) — mantida para compatibilidade
  const buscaGlobal = document.getElementById("busca-global");
  const dropdown = document.getElementById("busca-global-dropdown");
  if (buscaGlobal) {
    buscaGlobal.addEventListener("input", () => renderBuscaGlobal(buscaGlobal.value.trim()));
    buscaGlobal.addEventListener("keydown", e => {
      if (e.key === "Escape") { dropdown.style.display = "none"; buscaGlobal.blur(); _buscaGlobalIdx = -1; return; }
      const itens = dropdown.querySelectorAll(".global-dropdown-item");
      if (!itens.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        _buscaGlobalIdx = Math.min(_buscaGlobalIdx + 1, itens.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _buscaGlobalIdx = Math.max(_buscaGlobalIdx - 1, 0);
      } else if (e.key === "Enter" && _buscaGlobalIdx >= 0) {
        e.preventDefault();
        itens[_buscaGlobalIdx].click();
        return;
      } else { return; }
      itens.forEach((el, i) => el.classList.toggle("focused", i === _buscaGlobalIdx));
      itens[_buscaGlobalIdx].scrollIntoView({ block: "nearest" });
    });
    document.addEventListener("click", e => { if (!buscaGlobal.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = "none"; });
  }

  // Atalhos de teclado
  document.addEventListener("keydown", e => {
    if (!token) return;
    const activeTag = document.activeElement?.tagName;
    const isInput = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
    if (e.key === "Escape" && document.querySelector(".modal.active")) {
      const modals = document.querySelectorAll(".modal.active");
      const last = modals[modals.length - 1];
      if (last && last.id !== "modal-busca-global") { fecharModal(last.id); e.preventDefault(); return; }
    }
    if (e.ctrlKey && !e.shiftKey) {
      if (e.key === "n") { e.preventDefault(); navegarPara("gerar"); setTimeout(() => document.getElementById("nome")?.focus(), 50); }
      if (e.key === "h") { e.preventDefault(); navegarPara("historico"); }
      if (e.key === "k") { e.preventDefault(); abrirModalBuscaGlobal(); }
      if (e.key === "c" && roleLogado !== "precatorios") { e.preventDefault(); navegarPara("clientes"); }
      if (e.key === "a" && roleLogado !== "recepcao") { e.preventDefault(); navegarPara("admin"); }
      if (e.key === "l") { e.preventDefault(); limparCampos(); }
    }
    if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); alternarTema(); }
    if (e.key === "F5") { e.preventDefault(); e.stopImmediatePropagation(true); return false; }
  }, true);
  // Ctrl+S para salvar recibo de qualquer lugar
  document.addEventListener("keydown", e => {
    if (!token) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      const screen = document.querySelector(".screen.active");
      if (screen && screen.id === "screen-gerar") { e.preventDefault(); gerarRecibo(); }
    }
  });
}
