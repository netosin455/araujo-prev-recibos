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
  escritorioLogado = (data.escritorio || "").toUpperCase();
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
let modoEdicao = null;
let idEdicao = null;
let referenciaPadrao = "";
let _clienteContexto = null; // cliente ativo ao clicar em "+ Recibo"

// ── INICIAR ────────────────────────────────────────────────
async function iniciarApp(){
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  document.getElementById("perfil-usuario").textContent = roleLogado === "recepcao" ? "Recepção" : "Financeiro";
  aplicarTema(localStorage.getItem("tema")||"light");
  // Mostra menu de usuários só para admin
  const res = await api("GET", "/api/users");
  if(res && res.ok) {
    document.getElementById("nav-usuarios").style.display = "";
    document.getElementById("bn-usuarios").style.display = "";
  }
  // Esconde ações e menus restritos para recepção
  if(roleLogado === "recepcao"){
    document.querySelectorAll(".somente-financeiro").forEach(el => el.style.display = "none");
    document.getElementById("nav-admin").style.display = "none";
    document.getElementById("bn-admin").style.display = "none";
  }
  await carregarRecibos();
  await atualizarNumRecibo();
  await carregarReferenciaPadrao();
  atualizarSugestoesNomes();
  preencherFiltrosAnos();
  verificarClientesInativos();
  carregarClientes().then(atualizarBadgeClientes);
}

async function carregarReferenciaPadrao() {
  const res = await api("GET", "/api/me");
  if (!res || !res.ok) return;
  const me = await res.json();
  referenciaPadrao = me.referencia_padrao || "";
  const el = document.getElementById("referencia");
  if (el && referenciaPadrao && !el.value) el.value = referenciaPadrao;
  // Garante que escritorioLogado está sempre atualizado (inclusive após reload com token salvo)
  if (me.escritorio) {
    escritorioLogado = me.escritorio.toUpperCase();
    localStorage.setItem("escritorioLogado", escritorioLogado);
  }
  if (roleLogado === "recepcao") {
    const elEsc = document.getElementById("escritorio");
    if (elEsc && !elEsc.value) elEsc.value = escritorioLogado;
  }
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
  const res = await api("GET","/api/recibos");
  if(!res) return;
  historicoRecibos = await res.json();
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

// ── NAVEGAÇÃO ──────────────────────────────────────────────
const telas=["gerar","historico","clientes","admin","usuarios"];
const titulos={gerar:"Gerar Recibo",historico:"Histórico de Recibos",clientes:"Clientes",admin:"Administrativo",usuarios:"Usuários"};

function navegarPara(tela){
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
  if(tela==="historico") renderHistorico();
  if(tela==="clientes") renderClientes();
  if(tela==="admin") atualizarDashboard();
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
document.getElementById("nome").addEventListener("change",function(){
  const nome=this.value.toUpperCase();
  const match=historicoRecibos.find(r=>r.nome===nome);
  if(match){
    if(!document.getElementById("cpf").value) document.getElementById("cpf").value=match.cpf||"";
    if(!document.getElementById("municipio_uf").value) document.getElementById("municipio_uf").value=match.municipio_uf||"";
    if(!document.getElementById("emitido_por").value) document.getElementById("emitido_por").value=match.emitido_por||"";
    if(!document.getElementById("referencia").value) document.getElementById("referencia").value=match.referencia||"";
    document.getElementById("valor").focus();
  }
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
  const res = await api("GET", `/api/clientes/cpf/${encodeURIComponent(cpf)}`);
  if(!res || !res.ok) return; // sem cadastro, mantém comportamento atual
  const c = await res.json();
  if(!document.getElementById("nome").value)         document.getElementById("nome").value = c.nome || "";
  if(!document.getElementById("municipio_uf").value) document.getElementById("municipio_uf").value = c.municipio_uf || "";
  if(!document.getElementById("referencia").value)   document.getElementById("referencia").value = c.referencia || "";
  if(c.valor_parcela > 0 && !document.getElementById("valor").value){
    const vf = c.valor_parcela.toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
    document.getElementById("valor").value = vf;
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
  document.getElementById("escritorio").value = roleLogado === "recepcao" ? escritorioLogado : "";
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
  for(const c of campos){
    const val=document.getElementById(c).value.trim();
    if(!val) return setStatus(`Preencha o campo: ${c}`,"error");
    dados[c]=val;
  }
  dados.complemento=document.getElementById("complemento").value.trim();
  dados.referencia=document.getElementById("referencia").value.trim().toUpperCase();
  dados.forma_pagamento=document.getElementById("forma_pagamento").value;
  dados.escritorio=document.getElementById("escritorio").value;
  dados.motivo_pagamento=document.getElementById("motivo_pagamento").value;
  const dia=document.getElementById("dia").value;
  const mes=document.getElementById("mes").value;
  const ano=document.getElementById("ano").value;
  if(!dia||!mes||!ano) return setStatus("Preencha a data completa.","error");
  dados.data=formatarData();
  dados.data_extenso=dataExtenso();
  dados.nome=dados.nome.toUpperCase();
  dados.municipio_uf=dados.municipio_uf.toUpperCase();
  dados.emitido_por=dados.emitido_por.toUpperCase();

  const btn=document.getElementById("btn-gerar");
  const btnTextoOriginal = btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split spin"></i> Gerando...';
  setStatus("Gerando recibo...","loading");

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
        else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; alert(j.erro || "Erro ao enviar comprovante."); }
      } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; alert("Erro ao enviar comprovante: " + e.message); }
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
      else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; alert(j.erro || "Erro ao enviar comprovante."); }
    } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; alert("Erro ao enviar comprovante: " + e.message); }
  }

  // Salvar no banco
  const salvarRes = await api("POST","/api/recibos",{
    num:dados.num_recibo,nome:dados.nome,cpf:dados.cpf,
    municipio_uf:dados.municipio_uf,valor:dados.valor,
    data:dados.data,emitido_por:dados.emitido_por,
    complemento:dados.complemento,referencia:dados.referencia,
    forma_pagamento:dados.forma_pagamento,escritorio:dados.escritorio,
    motivo_pagamento:dados.motivo_pagamento,link_comprovante,
    timestamp:new Date().toISOString()
  });
  if (salvarRes) {
    const salvarJson = await salvarRes.json();
    if (salvarJson.sheets_ok === false) {
      alert("⚠️ Recibo salvo, mas NÃO foi registrado na planilha.\nErro: " + (salvarJson.sheets_erro || "desconhecido"));
    }
  }

  await carregarRecibos();
  await atualizarNumRecibo();
  atualizarSugestoesNomes();
  verificarClientesInativos();
  setStatus("Recibo gerado com sucesso!","success");
  mostrarToast(`Recibo ${num} gerado! Baixando...`, null, "success");

  // Oferece vinculação com parcela se o recibo foi para um cliente cadastrado
  const ctx = _clienteContexto;
  limparCampos();
  btn.disabled=false; btn.innerHTML=btnTextoOriginal;
  if (ctx && ctx.id) {
    const parcelasPendentes = (ctx.parcelas || []).filter(p => p.status !== "pago");
    if (parcelasPendentes.length > 0 && confirm(`Deseja marcar a parcela ${parcelasPendentes[0].num} de "${ctx.nome}" como paga com o recibo ${num}?`)) {
      abrirModalPagamentoParcela(ctx.id, parcelasPendentes[0].num, parcelasPendentes[0].valor, num);
    }
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

function renderHistorico(){
  const busca=(document.getElementById("busca-historico").value||"").toLowerCase();
  const dataIni=document.getElementById("filtro-data-ini")?.value||"";
  const dataFim=document.getElementById("filtro-data-fim")?.value||"";
  const buscaDigitos=busca.replace(/\D/g,"");
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
  grid.innerHTML="";
  lista.forEach(recibo=>{
    const item=document.createElement("div");
    item.className="recibo-item";
    item.innerHTML=`
      <div class="recibo-info">
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
    grid.appendChild(item);
  });
}

async function abrirPDFRecibo(r){
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
      <button class="btn-primary" id="btn-reimprimir-modal">📄 Baixar .docx</button>
      ${!r.assinatura_govbr ? `<button class="btn-success" id="btn-assinar-modal" style="display:none"><i class="bi bi-shield-check"></i> Assinar Gov.br</button>` : ""}
    </div>`;
  if (r.link_comprovante) {
    const btnComp = document.getElementById("btn-ver-comprovante-modal");
    if (btnComp) btnComp.onclick = () => abrirComprovante(r.link_comprovante);
  }
  document.getElementById("btn-ver-modal").onclick=()=>{ abrirPDFRecibo(r); fecharModal("modal-detalhe"); };
  document.getElementById("btn-reimprimir-modal").onclick=()=>{ reimprimirRecibo(r); fecharModal("modal-detalhe"); };
  // Botão de assinatura Gov.br — só aparece no mobile/app
  const btnAssinar = document.getElementById("btn-assinar-modal");
  if(btnAssinar){
    if(window.innerWidth <= 768) btnAssinar.style.display = "";
    btnAssinar.onclick = () => abrirModalGovBr(r);
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
  if (!res || !res.ok) return;
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
        ${c.recibos.map(r => {
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
  const totalAReceber = pendentes.reduce((s, p) => s + p.valor, 0);
  const tabelaAReceber = pendentes.length === 0
    ? `<p style="color:var(--success);font-weight:600;padding:8px 0">✅ Nenhuma parcela pendente — contrato quitado!</p>`
    : `<table style="width:100%">
        <thead><tr><th>Nº Parcela</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${pendentes.map(p => `<tr>
            <td>${p.num}</td>
            <td style="font-weight:600">R$ ${formatarValor(p.valor)}</td>
            <td>${_badgeParcela(p.status)}</td>
            <td>${_btnPagarParcela(cadastroId, p)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="tab-total" style="color:var(--error)">Total a receber: R$ ${formatarValor(totalAReceber)}</div>`;

  const pagas = parcelas.filter(p => p.status === "pago");
  const totalRecebido = pagas.reduce((s, p) => s + p.valor, 0);
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
  await carregarClientes();
  const busca        = (document.getElementById("busca-clientes").value || "").toLowerCase();
  const buscaDigitos = busca.replace(/\D/g, "");
  const grid         = document.getElementById("clientes-grid");

  const mapa = {};
  historicoRecibos.forEach(r => {
    if (!r.nome) return;
    const key = r.cpf || r.nome;
    if (!mapa[key]) mapa[key] = { nome: r.nome, cpf: r.cpf || "", municipio_uf: r.municipio_uf || "", recibos: [], total: 0 };
    mapa[key].recibos.push(r);
    mapa[key].total += valorParaNumero(r.valor);
  });

  let clientes = Object.values(mapa).filter(c =>
    c.nome.toLowerCase().includes(busca) ||
    (buscaDigitos.length > 0 && c.cpf.replace(/\D/g, "").includes(buscaDigitos))
  );
  clientes.sort((a, b) => a.nome.localeCompare(b.nome));

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
    const cadastro = c.cpf ? listaClientes.find(l => l.cpf === c.cpf) : null;
    const ultimo   = c.recibos[0];
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
            <span>${c.recibos.length} recibo${c.recibos.length !== 1 ? "s" : ""}</span>
            <span>·</span><span>Último: ${esc(ultimo.data)}</span>
            ${cadastro && cadastro.firma ? `<span>·</span><span style="color:var(--gold);font-weight:600">${esc(cadastro.firma)}</span>` : ""}
            ${cadastro && cadastro.referencia ? `<span>·</span><span>Ref: ${esc(cadastro.referencia)}</span>` : (ultimo.referencia ? `<span>·</span><span>Ref: ${esc(ultimo.referencia)}</span>` : "")}
          </div>
          ${blocoContrato}
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;margin-left:12px;flex-shrink:0">
          <div style="text-align:right;margin-right:4px">
            <div class="cliente-total">R$ ${formatarValor(c.total)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">total pago</div>
          </div>
          ${roleLogado !== "recepcao" ? `<button class="btn-sm btn-secondary cadastro-btn">${cadastro ? "Editar cadastro" : "Cadastrar"}</button>` : ""}
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
        </div>
        <div id="${cardId}-parcelamento" class="tab-painel active">${tabelaParcelamento}</div>
        <div id="${cardId}-areceber" class="tab-painel">${tabelaAReceber}</div>
        <div id="${cardId}-recebidos" class="tab-painel">${tabelaRecebidos}</div>
        <div id="${cardId}-historico" class="tab-painel">${tabelaRecibos}</div>
        ` : tabelaRecibos}
      </div>`;

    card.querySelector(".cliente-header").addEventListener("click", () => toggleCliente(card.querySelector(".cliente-header")));

    card.addEventListener("click", e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "trocar-aba") trocarAbaCliente(btn, btn.dataset.cardId, btn.dataset.aba);
      else if (action === "pagar-parcela") abrirModalPagamentoParcela(btn.dataset.id, Number(btn.dataset.num), Number(btn.dataset.valor), "");
      else if (action === "detalhe-recibo") abrirDetalhe(JSON.parse(btn.dataset.recibo));
      else if (action === "pdf-recibo") abrirPDFRecibo(JSON.parse(btn.dataset.recibo));
      else if (action === "editar-recibo") editarRecibo(JSON.parse(btn.dataset.recibo));
      else if (action === "baixar-recibo") reimprimirRecibo(JSON.parse(btn.dataset.recibo));
      else if (action === "upload-comprovante") abrirModalUploadComprovante(btn.dataset.id);
      else if (action === "excluir-recibo") excluirReciboById(btn.dataset.id);
    });

    card.querySelector(".novo-recibo-btn").addEventListener("click", e => {
      e.stopPropagation();
      novoReciboParaCliente(c, cadastro);
    });
    if (roleLogado !== "recepcao") {
      card.querySelector(".cadastro-btn").addEventListener("click", e => {
        e.stopPropagation();
        cadastro ? editarCliente(cadastro.id) : abrirModalClientePreenchido(c);
      });
    }
    grid.appendChild(card);
  });
}

function novoReciboParaCliente(c, cadastro) {
  _clienteContexto = cadastro || null;
  navegarPara("gerar");
  setTimeout(() => {
    document.getElementById("cpf").value          = c.cpf || "";
    document.getElementById("nome").value         = c.nome || "";
    document.getElementById("municipio_uf").value = cadastro ? cadastro.municipio_uf : (c.municipio_uf || "");
    document.getElementById("referencia").value   = cadastro ? (cadastro.referencia || referenciaPadrao || "") : (c.recibos[0]?.referencia || referenciaPadrao || "");
    document.getElementById("escritorio").value   = (cadastro?.firma || c.recibos[0]?.escritorio || "").toUpperCase();
    const btn = document.getElementById("btn-ref-padrao-recibo");
    if (btn) btn.style.display = "none";
    if (cadastro && (cadastro.valor_parcela || 0) > 0) {
      const vf = cadastro.valor_parcela.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      document.getElementById("valor").value = vf;
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

  if (!dataRec || !dataDep) return alert("Preencha as datas de recebimento e depósito.");

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
    return alert(data.erro || "Erro ao registrar pagamento.");
  }
  fecharModal("modal-pagamento-parcela");
  mostrarToast("Parcela marcada como paga!", null, "success");
  renderClientes();
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
  const ref = c.recibos[0]?.referencia || referenciaPadrao || "";
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

  if (!nome || !cpf || !municipio_uf) return alert("Preencha Nome, CPF e Município.");
  if (valor_contrato <= 0) return alert("Informe o valor total do contrato.");
  if (num_parcelas <= 0)   return alert("Informe o número de parcelas.");

  const body = { nome, cpf, telefone, endereco, municipio_uf, firma, referencia, valor_beneficio, num_beneficios, valor_contrato, num_parcelas };
  const res  = id
    ? await api("PUT",  `/api/clientes/${id}`, body)
    : await api("POST", "/api/clientes", body);
  const data = await res.json();
  if (!res.ok) return alert(data.erro || "Erro ao salvar cliente.");

  fecharModal("modal-cliente");
  mostrarToast(id ? "Cliente atualizado!" : "Cliente cadastrado!");
  renderClientes();
}

async function excluirReciboById(id){
  const recibo = historicoRecibos.find(r=>(r.id||r._id)===id);
  if(!confirm(`Excluir recibo ${recibo?recibo.num:id}?`)) return;
  await api("DELETE",`/api/recibos/${id}`);
  await carregarRecibos();
  renderClientes();
}

// ── DASHBOARD ──────────────────────────────────────────────
function atualizarDashboard(){
  const agora=new Date();
  const mesAtual=String(agora.getMonth()+1).padStart(2,"0");
  const anoAtual=String(agora.getFullYear());
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
  const mesesLabels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const totaisMes=Array.from({length:12},(_,i)=>{
    const m=String(i+1).padStart(2,"0");
    return historicoRecibos.filter(r=>r.data?.split("/")[1]===m&&r.data?.split("/")[2]===anoAtual).reduce((s,r)=>s+valorParaNumero(r.valor),0);
  });
  if(graficoMensal) graficoMensal.destroy();
  const ctx=document.getElementById("grafico-mensal")?.getContext("2d");
  if(ctx) graficoMensal=new Chart(ctx,{type:"bar",data:{labels:mesesLabels,datasets:[{label:"Faturamento",data:totaisMes,backgroundColor:"rgba(184,151,58,0.7)",borderColor:"#b8973a",borderWidth:1,borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"R$ "+formatarValor(v)}}}}});
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

function abrirAdminTab(tab,el){
  document.querySelectorAll(".admin-panel").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".admin-tab").forEach(t=>t.classList.remove("active"));
  document.getElementById("admin-"+tab).classList.add("active");
  el.classList.add("active");
  if(tab==="dashboard") atualizarDashboard();
  if(tab==="financeiro"){preencherFiltrosAnos();aplicarFiltros();}
  if(tab==="relatorios") preencherFiltrosAnos();
}

function preencherFiltrosAnos(){
  const anos=[...new Set(historicoRecibos.map(r=>r.data?.split("/")[2]).filter(Boolean))];
  const anoAtual=String(new Date().getFullYear());
  if(!anos.includes(anoAtual)) anos.unshift(anoAtual);
  anos.sort((a,b)=>b-a);
  ["filtro-ano","rel-ano","rel-cliente-ano","rel-resp-ano","rel-exec-ano"].forEach(id=>{
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
  const nomes=[...new Set(historicoRecibos.map(r=>r.nome).filter(Boolean))];
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
  if(isNaN(n)||n<1) return alert("Valor inválido.");
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
  document.getElementById("edit-user-escritorio").value = escritorioAtual || "";
  toggleEscritorioEdit(roleAtual || "financeiro");
  document.getElementById("modal-editar-usuario").classList.add("active");
}

async function salvarEdicaoUsuario(){
  const id = document.getElementById("edit-user-id").value;
  const username = document.getElementById("edit-user-nome").value.trim();
  const password = document.getElementById("edit-user-senha").value;
  const role = document.getElementById("edit-user-role").value;
  const escritorio = document.getElementById("edit-user-escritorio").value.trim().toUpperCase();
  if(!username) return alert("Preencha o nome de usuário.");
  const body = { username, role, escritorio };
  if(password) body.password = password;
  const res = await api("PUT", `/api/users/${id}`, body);
  const data = await res.json();
  if(!res.ok) return alert(data.erro || "Erro ao editar usuário.");
  fecharModal("modal-editar-usuario");
  mostrarToast("Usuário atualizado!");
  renderUsuarios();
}

async function adicionarUsuario(){
  const username=document.getElementById("novo-usuario").value.trim();
  const password=document.getElementById("nova-senha").value;
  const role=document.getElementById("novo-role").value;
  const escritorio=document.getElementById("novo-escritorio").value.trim().toUpperCase();
  if(!username||!password) return alert("Preencha usuário e senha.");
  const res=await api("POST","/api/users",{username,password,role,escritorio});
  const data=await res.json();
  if(!res.ok) return alert(data.erro||"Erro ao criar usuário.");
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
    if(!Array.isArray(recibos)) return alert("Arquivo inválido.");
    if(!confirm(`Importar ${recibos.length} recibos? Os recibos existentes não serão apagados.`)) return;
    let importados=0;
    for(const r of recibos){
      if(!r.nome||!r.num) continue;
      await api("POST","/api/recibos",{
        num:r.num,nome:r.nome,cpf:r.cpf||"",municipio_uf:r.municipio_uf||"",
        valor:r.valor||"",data:r.data||"",emitido_por:r.emitido_por||"",
        complemento:r.complemento||"",referencia:r.referencia||"",
        timestamp:r.timestamp||new Date().toISOString()
      });
      importados++;
    }
    await carregarRecibos();
    atualizarSugestoesNomes();
    preencherFiltrosAnos();
    mostrarToast(`${importados} recibos importados com sucesso!`);
  }catch{
    alert("Erro ao ler o arquivo de backup.");
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
  if(!lista.length) return alert("Nenhum dado para exportar.");
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
  if(!lista.length) return alert("Nenhum dado.");
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
  if(!lista.length) return alert("Nenhum dado.");
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
  if(!lista.length) return alert("Nenhum dado.");
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
  if(!lista.length)return alert("Nenhum dado para exportar.");
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
  if(!lista.length)return alert("Nenhum dado.");
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
  if(!lista.length)return alert("Nenhum dado.");
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
      resultado.textContent=res?.erro||"Erro: "+JSON.stringify(res);
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

  // Clientes
  document.getElementById("busca-clientes").addEventListener("input", renderClientes);
  document.getElementById("btn-cadastrar-cliente").addEventListener("click", () => abrirModalCliente());

  // Admin tabs
  document.querySelectorAll(".admin-tab[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => abrirAdminTab(btn.dataset.tab, btn));
  });

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
}
