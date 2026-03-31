// ── UTILITÁRIOS ────────────────────────────────────────────
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function valorParaNumero(v){ return parseFloat((v||"0").replace(/\./g,"").replace(",","."))||0; }
function formatarValor(n){ return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── AUTH ───────────────────────────────────────────────────
let token = localStorage.getItem("token") || "";
let usuarioLogado = localStorage.getItem("usuarioLogado") || "";

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
  localStorage.setItem("token", token);
  localStorage.setItem("usuarioLogado", usuarioLogado);
  document.getElementById("tela-login").classList.add("hide");
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  iniciarApp();
}

function fazerLogout(){
  localStorage.removeItem("token");
  localStorage.removeItem("usuarioLogado");
  token=""; usuarioLogado="";
  location.reload();
}

document.getElementById("login-senha").addEventListener("keydown", e=>{ if(e.key==="Enter") fazerLogin(); });
document.getElementById("login-usuario").addEventListener("keydown", e=>{ if(e.key==="Enter") document.getElementById("login-senha").focus(); });

// ── ESTADO ─────────────────────────────────────────────────
let historicoRecibos = [];
let graficoMensal = null;
let modoEdicao = null;
let idEdicao = null;

// ── INICIAR ────────────────────────────────────────────────
async function iniciarApp(){
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  aplicarTema(localStorage.getItem("tema")||"light");
  // Mostra menu de usuários só para admin
  const res = await api("GET", "/api/users");
  if(res && res.ok) document.getElementById("nav-usuarios").style.display = "";
  await carregarRecibos();
  await atualizarNumRecibo();
  atualizarSugestoesNomes();
  preencherFiltrosAnos();
  verificarClientesInativos();
}

// Verifica token ao carregar
if(token){
  document.getElementById("tela-login").classList.add("hide");
  document.getElementById("nome-usuario").textContent = usuarioLogado;
  iniciarApp();
}

// ── CARREGAR RECIBOS ───────────────────────────────────────
async function carregarRecibos(){
  const res = await api("GET","/api/recibos");
  if(!res) return;
  historicoRecibos = await res.json();
}

// ── TEMA ───────────────────────────────────────────────────
function aplicarTema(t){
  document.documentElement.setAttribute("data-theme",t);
  const btn=document.getElementById("btn-tema");
  if(btn) btn.textContent=t==="dark"?"☀":"☾";
  localStorage.setItem("tema",t);
}
function alternarTema(){ aplicarTema(localStorage.getItem("tema")==="dark"?"light":"dark"); }

// ── TOAST ──────────────────────────────────────────────────
let _toastTimer=null;
function mostrarToast(msg,onAbrir=null){
  const el=document.getElementById("toast");
  const btnAbrir=document.getElementById("toast-btn-abrir");
  document.getElementById("toast-msg").textContent=msg;
  if(onAbrir){btnAbrir.style.display="block";btnAbrir.onclick=()=>{onAbrir();fecharToast();};}
  else{btnAbrir.style.display="none";}
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
});

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
  setStatus("","");
}

function fecharModal(id){document.getElementById(id).classList.remove("active");}

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
  const campos=["nome","cpf","municipio_uf","valor","emitido_por"];
  const dados={};
  for(const c of campos){
    const val=document.getElementById(c).value.trim();
    if(!val) return setStatus(`Preencha o campo: ${c}`,"error");
    dados[c]=val;
  }
  dados.complemento=document.getElementById("complemento").value.trim();
  dados.referencia=document.getElementById("referencia").value.trim().toUpperCase();
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
  btn.disabled=true;
  setStatus("Gerando recibo...","loading");

  // Modo edição
  if(modoEdicao && idEdicao){
    const res=await api("PUT",`/api/recibos/${idEdicao}`,{
      nome:dados.nome,cpf:dados.cpf,municipio_uf:dados.municipio_uf,
      valor:dados.valor,data:dados.data,emitido_por:dados.emitido_por,
      complemento:dados.complemento,referencia:dados.referencia
    });
    if(res&&res.ok){
      await carregarRecibos();
      atualizarSugestoesNomes();
      setStatus("Recibo atualizado!","success");
      mostrarToast("Recibo atualizado com sucesso!");
      cancelarEdicao();
    } else {
      setStatus("Erro ao atualizar.","error");
    }
    btn.disabled=false;
    return;
  }

  // Buscar próximo número
  const numRes=await api("GET","/api/proximo-num");
  if(!numRes){btn.disabled=false;return;}
  const {num}=await numRes.json();
  dados.num_recibo=num;

  // Gerar documento
  const res=await api("POST","/api/gerar-recibo",dados);
  if(!res||!res.ok){
    setStatus("Erro ao gerar recibo.","error");
    btn.disabled=false;
    return;
  }

  // Download do arquivo
  const blob=await res.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`recibo_${num.replace("/","-")}_${dados.nome.replace(/\s+/g,"_").toLowerCase()}.docx`;
  a.click();
  URL.revokeObjectURL(url);

  // Salvar no banco
  await api("POST","/api/recibos",{
    num:dados.num_recibo,nome:dados.nome,cpf:dados.cpf,
    municipio_uf:dados.municipio_uf,valor:dados.valor,
    data:dados.data,emitido_por:dados.emitido_por,
    complemento:dados.complemento,referencia:dados.referencia,
    timestamp:new Date().toISOString()
  });

  await carregarRecibos();
  await atualizarNumRecibo();
  atualizarSugestoesNomes();
  verificarClientesInativos();
  setStatus("Recibo gerado com sucesso!","success");
  mostrarToast(`Recibo ${num} gerado! Baixando...`);
  limparCampos();
  btn.disabled=false;
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
  if(!lista.length){
    grid.innerHTML=`<div class="empty-state"><div class="icon">◈</div><p>${busca?"Nenhum recibo encontrado.":"Nenhum recibo gerado ainda."}</p></div>`;
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
        <button class="btn-gold btn-sm" data-action="ver">👁 Ver</button>
        <button class="btn-secondary btn-sm" data-action="editar">Editar</button>
        <button class="btn-secondary btn-sm" data-action="duplicar">Duplicar</button>
        <button class="btn-secondary btn-sm" data-action="reimprimir">📄 Baixar</button>
        <button class="btn-danger btn-sm" data-action="excluir">🗑</button>
      </div>`;
    item.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        if(btn.dataset.action==="detalhe") abrirDetalhe(recibo);
        if(btn.dataset.action==="ver") abrirPDFRecibo(recibo);
        if(btn.dataset.action==="editar") editarRecibo(recibo);
        if(btn.dataset.action==="duplicar") duplicarRecibo(recibo);
        if(btn.dataset.action==="reimprimir") reimprimirRecibo(recibo);
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

function abrirPDFRecibo(r){
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
    <div style="margin-top:20px;display:flex;gap:10px">
      <button class="btn-gold" id="btn-ver-modal">👁 Ver PDF</button>
      <button class="btn-primary" id="btn-reimprimir-modal">📄 Baixar .docx</button>
    </div>`;
  document.getElementById("btn-ver-modal").onclick=()=>{ abrirPDFRecibo(r); fecharModal("modal-detalhe"); };
  document.getElementById("btn-reimprimir-modal").onclick=()=>{ reimprimirRecibo(r); fecharModal("modal-detalhe"); };
  document.getElementById("modal-detalhe").classList.add("active");
}

// ── CLIENTES ───────────────────────────────────────────────
function renderClientes(){
  const busca=(document.getElementById("busca-clientes").value||"").toLowerCase();
  const grid=document.getElementById("clientes-grid");
  const mapa={};
  historicoRecibos.forEach(r=>{
    if(!r.nome) return;
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,recibos:[],total:0};
    mapa[r.nome].recibos.push(r);
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });
  const buscaDigitos=busca.replace(/\D/g,"");
  let clientes=Object.values(mapa).filter(c=>
    c.nome.toLowerCase().includes(busca)||
    (buscaDigitos.length>0&&(c.recibos[0]?.cpf||"").replace(/\D/g,"").includes(buscaDigitos))
  );
  clientes.sort((a,b)=>a.nome.localeCompare(b.nome));
  if(!clientes.length){
    grid.innerHTML=`<div class="empty-state"><div class="icon">◉</div><p>${busca?"Nenhum cliente encontrado.":"Nenhum cliente cadastrado ainda."}</p></div>`;
    return;
  }
  grid.innerHTML="";
  clientes.forEach(c=>{
    const card=document.createElement("div");
    card.className="cliente-card";
    card.innerHTML=`
      <div class="cliente-header" onclick="toggleCliente(this)">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-stats">
            <span>${c.recibos.length} recibo${c.recibos.length!==1?"s":""}</span>
            <span>·</span><span>Último: ${esc(c.recibos[0].data)}</span>
            ${c.recibos[0].referencia?`<span>·</span><span>Ref: ${esc(c.recibos[0].referencia)}</span>`:""}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="text-align:right">
            <div class="cliente-total">R$ ${formatarValor(c.total)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">total pago</div>
          </div>
          <button class="btn-gold btn-sm" data-nome="${esc(c.nome)}">+ Novo Recibo</button>
        </div>
      </div>
      <div class="cliente-body">
        <table style="width:100%">
          <thead><tr><th>Nº</th><th>Data</th><th>Valor</th><th>Responsável</th><th>Ref.</th><th></th></tr></thead>
          <tbody>
            ${c.recibos.map(r=>`
              <tr>
                <td><span class="badge badge-gold">${esc(r.num)}</span></td>
                <td>${esc(r.data)}</td>
                <td style="color:var(--success);font-weight:700">R$ ${esc(r.valor)}</td>
                <td>${esc(r.emitido_por||"-")}</td>
                <td>${esc(r.referencia||"-")}</td>
                <td><button class="btn-secondary btn-sm" onclick="reimprimirRecibo(${JSON.stringify(r).replace(/"/g,"&quot;")})">📄</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    card.querySelector(".btn-gold").addEventListener("click",e=>{
      e.stopPropagation();
      duplicarRecibo(c.recibos[0]);
    });
    grid.appendChild(card);
  });
}

function toggleCliente(header){
  header.nextElementSibling.classList.toggle("open");
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
  el.innerHTML=users.map(u=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600">${esc(u.username)}</div>
        <div style="font-size:11px;color:var(--muted)">Criado em ${new Date(u.created_at).toLocaleDateString("pt-BR")}</div>
      </div>
      <div style="display:flex;gap:8px">
        ${u.id!==1?`<button class="btn-danger btn-sm" onclick="excluirUsuario(${u.id})">Remover</button>`:"<span style='font-size:11px;color:var(--muted)'>Admin</span>"}
      </div>
    </div>`).join("");
}

async function adicionarUsuario(){
  const username=document.getElementById("novo-usuario").value.trim();
  const password=document.getElementById("nova-senha").value;
  if(!username||!password) return alert("Preencha usuário e senha.");
  const res=await api("POST","/api/users",{username,password});
  const data=await res.json();
  if(!res.ok) return alert(data.erro||"Erro ao criar usuário.");
  document.getElementById("novo-usuario").value="";
  document.getElementById("nova-senha").value="";
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

function exportarExcel(){
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

function exportarExcelClientes(){
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

function exportarPDF(){
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

function exportarPDFClientes(){
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
function exportarExcelResponsaveis(){
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

function exportarPDFResponsaveis(){
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
function exportarPDFExecutivo(){
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

// ── TECLADO ────────────────────────────────────────────────
document.addEventListener("keydown",function(e){
  if(e.altKey&&e.key==="g"){e.preventDefault();navegarPara("gerar");document.getElementById("nome").focus();}
  if(e.altKey&&e.key==="h"){e.preventDefault();navegarPara("historico");}
  if(e.altKey&&e.key==="c"){e.preventDefault();navegarPara("clientes");}
  if(e.altKey&&e.key==="a"){e.preventDefault();navegarPara("admin");}
  if(e.altKey&&e.key==="l"){e.preventDefault();limparCampos();}
  if(e.key==="Escape") fecharModal("modal-detalhe");
});
