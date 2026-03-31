const { ipcRenderer, shell } = require("electron");
const XLSX = require("xlsx");
const { jsPDF } = require("jspdf");
const { applyPlugin: _applyAutoTable } = require("jspdf-autotable");
_applyAutoTable(jsPDF);
const { Chart, registerables } = require("chart.js");
Chart.register(...registerables);
const path = require("path");
const os   = require("os");
const fs   = require("fs");

let graficoMensal = null;
let graficoComparativo = null;

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

// ── TEMA ───────────────────────────────────────────────────
function aplicarTema(t){
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("btn-tema");
  if(btn) btn.textContent = t==="dark" ? "☀" : "☾";
  localStorage.setItem("tema", t);
  if(graficoMensal) atualizarDashboard();
}
function alternarTema(){
  aplicarTema(localStorage.getItem("tema")==="dark" ? "light" : "dark");
}

// ── TOAST ──────────────────────────────────────────────────
let _toastTimer = null;
function mostrarToast(msg, onAbrir=null){
  const el=document.getElementById("toast");
  const btnAbrir=document.getElementById("toast-btn-abrir");
  document.getElementById("toast-msg").textContent=msg;
  if(onAbrir){ btnAbrir.style.display="block"; btnAbrir.onclick=()=>{ onAbrir(); fecharToast(); }; }
  else { btnAbrir.style.display="none"; }
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(fecharToast, 6000);
}
function fecharToast(){ document.getElementById("toast").classList.remove("show"); }

const EMPRESA = {
  nome:"A ARAUJO SERVIÇOS LTDA ME", cnpj:"00.000.000/0000-00",
  ie:"ISENTO", endereco:"", cidade:"", telefone:"", email:""
};

let anoAtualApp = new Date().getFullYear();
let numRecibo = (() => {
  const salvo = JSON.parse(localStorage.getItem("numReciboData") || "{}");
  if (salvo.ano === anoAtualApp) return salvo.num || 1;
  return 1; // novo ano, reinicia
})();
let historicoRecibos = JSON.parse(localStorage.getItem("historicoRecibos") || "[]");
let ultimoArquivo = localStorage.getItem("ultimoArquivo") || null;
let modoEdicao = null;

// Logo na sidebar
(function(){
  const prod = path.join(process.resourcesPath, "Logo par forms.png");
  const dev  = path.join(__dirname, "Logo par forms.png");
  const src  = fs.existsSync(prod) ? prod : (fs.existsSync(dev) ? dev : null);
  if (src) document.getElementById("sidebar-logo-img").src = src;
})();

atualizarNumRecibo();
preencherFiltrosAnos();
aplicarTema(localStorage.getItem("tema") || "light");
atualizarSugestoesNomes();
carregarConfigBackupAuto();
verificarClientesInativos();
verificarBackupAuto();

// ── NAVEGAÇÃO ──────────────────────────────────────────────
const telas = ["gerar","historico","clientes","admin"];
const titulos = { gerar:"Gerar Recibo", historico:"Histórico de Recibos", clientes:"Clientes", admin:"Administrativo" };

function navegarPara(tela) {
  telas.forEach(t => {
    document.getElementById("screen-"+t).classList.remove("active");
  });
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("screen-"+tela).classList.add("active");
  document.querySelectorAll(".nav-item")[telas.indexOf(tela)].classList.add("active");
  document.getElementById("topbar-title").textContent = titulos[tela];
  if (tela === "historico") renderHistorico();
  if (tela === "clientes")  renderClientes();
  if (tela === "admin")     atualizarDashboard();
}

// ── NÚMERO SEQUENCIAL ──────────────────────────────────────
function atualizarNumRecibo() {
  const ano = document.getElementById("ano")?.value || new Date().getFullYear();
  document.getElementById("num-recibo").textContent = `Nº ${String(numRecibo).padStart(4,"0")}/${ano}`;
}

// ── MÁSCARAS ───────────────────────────────────────────────
document.getElementById("nome").addEventListener("change", function(){
  const nome=this.value.toUpperCase();
  const match=historicoRecibos.find(r=>r.nome===nome);
  if(match){
    if(!document.getElementById("cpf").value) document.getElementById("cpf").value=match.cpf;
    if(!document.getElementById("municipio_uf").value) document.getElementById("municipio_uf").value=match.municipio_uf;
    if(!document.getElementById("emitido_por").value) document.getElementById("emitido_por").value=match.emitido_por||"";
    if(!document.getElementById("referencia").value) document.getElementById("referencia").value=match.referencia||"";
    document.getElementById("valor").focus();
  }
});

document.getElementById("busca-historico").addEventListener("input", function(){ renderHistorico(); });
document.getElementById("busca-clientes").addEventListener("input", function(){ renderClientes(); });

document.getElementById("cpf").addEventListener("input", function(){
  let v = this.value.replace(/\D/g,"").slice(0,14);
  if(v.length<=11){
    v=v.replace(/(\d{3})(\d)/,"$1.$2");
    v=v.replace(/(\d{3})(\d)/,"$1.$2");
    v=v.replace(/(\d{3})(\d{1,2})$/,"$1-$2");
  } else {
    v=v.replace(/(\d{2})(\d)/,"$1.$2");
    v=v.replace(/(\d{3})(\d)/,"$1.$2");
    v=v.replace(/(\d{3})(\d{4})/,"$1/$2");
    v=v.replace(/(\d{4})(\d{1,2})$/,"$1-$2");
  }
  document.getElementById("label-cpf").textContent = this.value.replace(/\D/g,"").length>11?"CNPJ":"CPF / CNPJ";
  this.value = v;
});

document.getElementById("valor").addEventListener("input", function(){
  let v = this.value.replace(/\D/g,"");
  if(!v){this.value="";return;}
  v=(parseInt(v)/100).toFixed(2);
  this.value=v.replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
});

document.getElementById("dia").addEventListener("input", function(){
  if(this.value.length===2) document.getElementById("mes").focus();
});
document.getElementById("mes").addEventListener("change", function(){
  if(this.value) document.getElementById("ano").focus();
});
document.getElementById("ano").addEventListener("input", atualizarNumRecibo);

// Preenche data de hoje automaticamente ao focar no campo dia
document.getElementById("dia").addEventListener("focus", function(){
  if(!this.value){
    const hoje = new Date();
    this.value = hoje.getDate();
    document.getElementById("mes").value = String(hoje.getMonth()+1).padStart(2,"0");
    document.getElementById("ano").value = hoje.getFullYear();
    atualizarNumRecibo();
  }
});

// Atalhos de teclado globais
document.addEventListener("keydown", function(e){
  // Alt+G = Gerar Recibo
  if(e.altKey && e.key==="g"){ e.preventDefault(); navegarPara("gerar"); document.getElementById("nome").focus(); }
  // Alt+H = Historico
  if(e.altKey && e.key==="h"){ e.preventDefault(); navegarPara("historico"); }
  // Alt+C = Clientes
  if(e.altKey && e.key==="c"){ e.preventDefault(); navegarPara("clientes"); }
  // Alt+A = Administrativo
  if(e.altKey && e.key==="a"){ e.preventDefault(); navegarPara("admin"); }
  // Alt+L = Limpar campos
  if(e.altKey && e.key==="l"){ e.preventDefault(); limparCampos(); }
  // Enter na tela de gerar = gerar recibo (se todos os campos preenchidos)
  if(e.key==="Enter" && document.getElementById("screen-gerar").classList.contains("active")){
    const ativo = document.activeElement;
    if(ativo && ["nome","cpf","municipio_uf","valor","complemento","emitido_por","dia","ano"].includes(ativo.id)){
      e.preventDefault(); gerarRecibo();
    }
  }
  // Alt+R = reabrir último recibo
  if(e.altKey && e.key==="r"){ e.preventDefault(); if(ultimoArquivo) ipcRenderer.invoke("abrir-arquivo",ultimoArquivo); else mostrarToast("Nenhum recibo gerado ainda."); }
  // Escape = fechar modal
  if(e.key==="Escape") fecharModal("modal-detalhe");
});

// ── UTILITÁRIOS ────────────────────────────────────────────
function setStatus(msg,tipo){
  const el=document.getElementById("status");
  el.textContent=msg; el.className="status "+tipo;
  if(tipo!=="loading") setTimeout(()=>{el.className="status";},4000);
}

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

function valorParaNumero(v){
  return parseFloat((v||"0").replace(/\./g,"").replace(",","."))||0;
}

function formatarValor(n){
  return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}

function limparCampos(){
  ["nome","cpf","municipio_uf","valor","complemento","referencia","dia","ano","emitido_por"].forEach(id=>{
    document.getElementById(id).value="";
  });
  document.getElementById("mes").value="";
  setStatus("","");
}

function fecharModal(id){ document.getElementById(id).classList.remove("active"); }

// ── EDITAR / DUPLICAR ──────────────────────────────────────
function editarRecibo(idx){
  const r=historicoRecibos[idx];
  modoEdicao=idx;
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
  modoEdicao=null;
  document.getElementById("edit-mode-banner").style.display="none";
  document.getElementById("btn-gerar").textContent="Gerar Recibo";
  limparCampos();
}

function duplicarRecibo(idx){
  const r=historicoRecibos[idx];
  limparCampos();
  document.getElementById("nome").value=r.nome;
  document.getElementById("cpf").value=r.cpf;
  document.getElementById("municipio_uf").value=r.municipio_uf;
  document.getElementById("emitido_por").value=r.emitido_por||"";
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
  dados.empresa=EMPRESA;

  const btn=document.getElementById("btn-gerar");
  btn.disabled=true;
  setStatus("Gerando recibo...","loading");

  // Modo edição
  if(modoEdicao!==null){
    const r=historicoRecibos[modoEdicao];
    const regenerar=document.getElementById("chk-regenerar").checked;
    Object.assign(r,{nome:dados.nome,cpf:dados.cpf,municipio_uf:dados.municipio_uf,
      valor:dados.valor,complemento:dados.complemento,emitido_por:dados.emitido_por,
      data:dados.data,data_extenso:dados.data_extenso});
    if(regenerar){
      dados.num_recibo=r.num;
      const result=await ipcRenderer.invoke("gerar-recibo",dados);
      if(result.ok) r.arquivo=result.arquivo;
    }
    localStorage.setItem("historicoRecibos",JSON.stringify(historicoRecibos));
    mostrarToast(`Recibo ${r.num} atualizado.`, regenerar ? ()=>ipcRenderer.invoke("abrir-arquivo",r.arquivo) : null);
    setStatus("Recibo atualizado!","success");
    cancelarEdicao();
    btn.disabled=false;
    return;
  }

  dados.num_recibo=`${String(numRecibo).padStart(4,"0")}/${new Date().getFullYear()}`;
  const result=await ipcRenderer.invoke("gerar-recibo",dados);

  if(result.ok){
    setStatus("Recibo gerado com sucesso!","success");
    ultimoArquivo=result.arquivo;
    localStorage.setItem("ultimoArquivo",ultimoArquivo);
    historicoRecibos.unshift({
      num:dados.num_recibo, nome:dados.nome, cpf:dados.cpf,
      municipio_uf:dados.municipio_uf, valor:dados.valor,
      data:dados.data, emitido_por:dados.emitido_por,
      complemento:dados.complemento, referencia:dados.referencia, arquivo:result.arquivo,
      timestamp:new Date().toISOString()
    });
    localStorage.setItem("historicoRecibos",JSON.stringify(historicoRecibos.slice(0,500)));
    numRecibo++;
    localStorage.setItem("numReciboData", JSON.stringify({ ano: anoAtualApp, num: numRecibo }));
    atualizarNumRecibo();
    atualizarSugestoesNomes();
    mostrarToast("Recibo gerado com sucesso!", ()=>ipcRenderer.invoke("abrir-arquivo",result.arquivo));
    verificarClientesInativos();
    verificarBackupAuto();
    limparCampos();
  } else {
    setStatus(`Erro: ${result.erro}`,"error");
  }
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
    const cpfOk=buscaDigitos.length>0 && (r.cpf||"").replace(/\D/g,"").includes(buscaDigitos);
    if(!nomeOk && !cpfOk) return false;
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
    const realIdx=historicoRecibos.indexOf(recibo);
    const item=document.createElement("div");
    item.className="recibo-item";
    item.innerHTML=`
      <div class="recibo-info">
        <div class="recibo-num">${esc(recibo.num)}</div>
        <div class="recibo-nome">${esc(recibo.nome)}</div>
        <div class="recibo-valor">R$ ${esc(recibo.valor)}</div>
        <div class="recibo-meta">${esc(recibo.data)} · ${esc(recibo.municipio_uf)} · ${esc(recibo.emitido_por||"N/A")}</div>
      </div>
      <div class="recibo-actions">
        <button class="btn-secondary btn-sm" data-action="detalhe">Ver</button>
        <button class="btn-secondary btn-sm" data-action="editar">Editar</button>
        <button class="btn-secondary btn-sm" data-action="duplicar">Duplicar</button>
        <button class="btn-secondary btn-sm" data-action="abrir">Abrir</button>
        <button class="btn-secondary btn-sm" data-action="pdf">PDF</button>
        <button class="btn-secondary btn-sm" data-action="pasta">📁</button>
        <button class="btn-danger btn-sm" data-action="excluir">🗑</button>
      </div>`;
    item.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const r=historicoRecibos[realIdx];
        if(btn.dataset.action==="abrir")    await ipcRenderer.invoke("abrir-arquivo",r.arquivo);
        if(btn.dataset.action==="pasta")    await ipcRenderer.invoke("abrir-pasta",r.arquivo);
        if(btn.dataset.action==="detalhe")  abrirDetalhe(r);
        if(btn.dataset.action==="editar")   editarRecibo(realIdx);
        if(btn.dataset.action==="duplicar") duplicarRecibo(realIdx);
        if(btn.dataset.action==="pdf")      exportarReciboPDF(r);
        if(btn.dataset.action==="excluir"){
          historicoRecibos.splice(realIdx,1);
          localStorage.setItem("historicoRecibos",JSON.stringify(historicoRecibos));
          renderHistorico();
        }
      });
    });
    grid.appendChild(item);
  });
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
    <div class="detail-row"><div class="detail-label">Gerado em</div><div class="detail-value">${esc(new Date(r.timestamp).toLocaleString("pt-BR"))}</div></div>
    <div style="margin-top:20px;display:flex;gap:10px">
      <button class="btn-primary" id="btn-abrir-modal">Abrir Arquivo</button>
      <button class="btn-secondary" id="btn-pdf-modal">📄 PDF</button>
      <button class="btn-secondary" id="btn-pasta-modal">📁 Pasta</button>
    </div>`;
  document.getElementById("btn-abrir-modal").onclick=()=>ipcRenderer.invoke("abrir-arquivo",r.arquivo);
  document.getElementById("btn-pdf-modal").onclick=()=>exportarReciboPDF(r);
  document.getElementById("btn-pasta-modal").onclick=()=>ipcRenderer.invoke("abrir-pasta",r.arquivo);
  document.getElementById("modal-detalhe").classList.add("active");
}

// ── CLIENTES ───────────────────────────────────────────────
function renderClientes(){
  const busca=(document.getElementById("busca-clientes").value||"").toLowerCase();
  const grid=document.getElementById("clientes-grid");

  // Agrupar por nome
  const mapa={};
  historicoRecibos.forEach(r=>{
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,recibos:[],total:0};
    mapa[r.nome].recibos.push(r);
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });

  const buscaDigitosC=busca.replace(/\D/g,"");
  let clientes=Object.values(mapa).filter(c=>
    c.nome.toLowerCase().includes(busca) ||
    (buscaDigitosC.length>0 && (c.recibos[0]?.cpf||"").replace(/\D/g,"").includes(buscaDigitosC))
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
    const idxNovoRecibo = historicoRecibos.indexOf(c.recibos[0]);
    card.innerHTML=`
      <div class="cliente-header" onclick="toggleCliente(this)">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-stats">
            <span>${c.recibos.length} recibo${c.recibos.length!==1?"s":""}</span>
            <span>·</span>
            <span>Último: ${esc(c.recibos[0].data)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="text-align:right">
            <div class="cliente-total">R$ ${formatarValor(c.total)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">total pago</div>
          </div>
          <button class="btn-gold btn-sm" data-action="novo" data-recibo-idx="${idxNovoRecibo}" style="white-space:nowrap">+ Novo Recibo</button>
        </div>
      </div>
      <div class="cliente-body">
        <table style="width:100%">
          <thead><tr><th>Nº</th><th>Data</th><th>Valor</th><th>Responsável</th><th></th></tr></thead>
          <tbody>
            ${c.recibos.map(r=>`
              <tr>
                <td><span class="badge badge-gold">${esc(r.num)}</span></td>
                <td>${esc(r.data)}</td>
                <td style="color:var(--success);font-weight:700">R$ ${esc(r.valor)}</td>
                <td>${esc(r.emitido_por||"-")}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-secondary btn-sm" data-action="editar" data-recibo-idx="${historicoRecibos.indexOf(r)}">Editar</button>
                  <button class="btn-secondary btn-sm" data-action="pdf" data-recibo-idx="${historicoRecibos.indexOf(r)}">PDF</button>
                  <button class="btn-secondary btn-sm" data-action="abrir" data-recibo-idx="${historicoRecibos.indexOf(r)}">Abrir</button>
                  <button class="btn-secondary btn-sm" data-action="pasta" data-recibo-idx="${historicoRecibos.indexOf(r)}">📁</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    card.querySelectorAll("button[data-recibo-idx]").forEach(btn=>{
      btn.addEventListener("click",async e=>{
        e.stopPropagation();
        const idx=parseInt(btn.dataset.reciboIdx);
        const rec=historicoRecibos[idx];
        if(!rec) return;
        if(btn.dataset.action==="novo")   duplicarRecibo(idx);
        if(btn.dataset.action==="editar") editarRecibo(idx);
        if(btn.dataset.action==="pdf")    exportarReciboPDF(rec);
        if(btn.dataset.action==="abrir")  await ipcRenderer.invoke("abrir-arquivo",rec.arquivo);
        if(btn.dataset.action==="pasta")  await ipcRenderer.invoke("abrir-pasta",rec.arquivo);
      });
    });
    grid.appendChild(card);
  });
}

function toggleCliente(header){
  const body=header.nextElementSibling;
  body.classList.toggle("open");
}

// ── ADMINISTRATIVO ─────────────────────────────────────────
function abrirAdminTab(tab,el){
  document.querySelectorAll(".admin-tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".admin-panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("admin-"+tab).classList.add("active");
  el.classList.add("active");
  if(tab==="dashboard") atualizarDashboard();
  if(tab==="financeiro"){ preencherFiltrosAnos(); aplicarFiltros(); }
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

  ["comp-ano-a","comp-ano-b"].forEach((id,i)=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    sel.innerHTML=anos.map((a,j)=>`<option value="${esc(a)}" ${(i===0&&j===0)||(i===1&&j===1)?"selected":""}>${esc(a)}</option>`).join("");
  });

  const resps=[...new Set(historicoRecibos.map(r=>r.emitido_por).filter(Boolean))];
  ["filtro-responsavel","rel-responsavel"].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    sel.innerHTML=`<option value="">Todos</option>`+resps.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("");
  });
}

function atualizarDashboard(){
  const agora=new Date();
  const mesAtual=String(agora.getMonth()+1).padStart(2,"0");
  const anoAtual=String(agora.getFullYear());

  const doMes=historicoRecibos.filter(r=>r.data?.split("/")[1]===mesAtual&&r.data?.split("/")[2]===anoAtual);
  const doAno=historicoRecibos.filter(r=>r.data?.split("/")[2]===anoAtual);
  const todos=historicoRecibos;
  const soma=arr=>arr.reduce((s,r)=>s+valorParaNumero(r.valor),0);

  document.getElementById("card-mes").textContent=`R$ ${formatarValor(soma(doMes))}`;
  document.getElementById("card-mes-qtd").textContent=`${doMes.length} recibos`;

  // Meta mensal
  const meta=parseFloat(localStorage.getItem("metaMensal")||"0");
  const totalMesNum=soma(doMes);
  if(meta>0){
    const pct=Math.min(100,(totalMesNum/meta)*100).toFixed(1);
    document.getElementById("meta-wrap").style.display="block";
    document.getElementById("meta-bar").style.width=pct+"%";
    document.getElementById("meta-pct").textContent=pct+"%";
    document.getElementById("meta-valor-label").textContent=`R$ ${formatarValor(totalMesNum)} / R$ ${formatarValor(meta)}`;
    document.getElementById("meta-bar").style.background=parseFloat(pct)>=100?"var(--success)":parseFloat(pct)>=70?"var(--gold)":"var(--error)";
  } else {
    document.getElementById("meta-wrap").style.display="none";
  }
  document.getElementById("card-ano").textContent=`R$ ${formatarValor(soma(doAno))}`;
  document.getElementById("card-ano-qtd").textContent=`${doAno.length} recibos`;
  document.getElementById("card-ticket").textContent=`R$ ${formatarValor(todos.length?soma(todos)/todos.length:0)}`;
  document.getElementById("card-total").textContent=`R$ ${formatarValor(soma(todos))}`;
  document.getElementById("card-total-qtd").textContent=`${todos.length} recibos`;

  const mesesNomes=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const porMes={};
  todos.forEach(r=>{
    const p=r.data?.split("/");
    if(!p||p.length<3) return;
    const key=`${p[2]}-${p[1]}`;
    if(!porMes[key]) porMes[key]={mes:p[1],ano:p[2],total:0,qtd:0};
    porMes[key].total+=valorParaNumero(r.valor);
    porMes[key].qtd++;
  });

  document.getElementById("tabela-mensal").innerHTML=
    Object.entries(porMes).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,v])=>`
      <tr>
        <td>${esc(mesesNomes[parseInt(v.mes)-1])}/${esc(v.ano)}</td>
        <td><span class="badge badge-gold">${v.qtd}</span></td>
        <td style="color:var(--success);font-weight:700">R$ ${formatarValor(v.total)}</td>
        <td>R$ ${formatarValor(v.total/v.qtd)}</td>
      </tr>`).join("")||`<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:30px">Nenhum dado disponível</td></tr>`;

  // Gráfico
  const entradasOrdenadas = Object.entries(porMes).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels = entradasOrdenadas.map(([k,v])=>`${mesesNomes[parseInt(v.mes)-1]}/${v.ano}`);
  const valores = entradasOrdenadas.map(([k,v])=>v.total);

  if (graficoMensal) graficoMensal.destroy();
  const ctx = document.getElementById("grafico-mensal").getContext("2d");
  graficoMensal = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Faturamento (R$)",
        data: valores,
        backgroundColor: "rgba(184,151,58,0.7)",
        borderColor: "rgba(184,151,58,1)",
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `R$ ${formatarValor(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => `R$ ${formatarValor(v)}`
          },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        x: { grid: { display: false } }
      }
    }
  });

  atualizarGraficoComparativo();
}

function atualizarGraficoComparativo(){
  const anoA=document.getElementById("comp-ano-a")?.value;
  const anoB=document.getElementById("comp-ano-b")?.value;
  const mL=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const totaisPorMes=ano=>Array.from({length:12},(_,i)=>{
    const m=String(i+1).padStart(2,"0");
    return historicoRecibos.filter(r=>r.data?.split("/")[1]===m&&r.data?.split("/")[2]===ano).reduce((s,r)=>s+valorParaNumero(r.valor),0);
  });
  if(graficoComparativo) graficoComparativo.destroy();
  const ctx=document.getElementById("grafico-comparativo")?.getContext("2d");
  if(!ctx) return;
  graficoComparativo=new Chart(ctx,{
    type:"bar",
    data:{
      labels:mL,
      datasets:[
        {label:anoA||"-",data:anoA?totaisPorMes(anoA):[],backgroundColor:"rgba(184,151,58,0.7)",borderColor:"rgba(184,151,58,1)",borderWidth:1,borderRadius:3},
        {label:anoB||"-",data:anoB?totaisPorMes(anoB):[],backgroundColor:"rgba(61,122,94,0.55)",borderColor:"rgba(61,122,94,1)",borderWidth:1,borderRadius:3}
      ]
    },
    options:{
      responsive:true,
      plugins:{legend:{display:true,position:"top"},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: R$ ${formatarValor(ctx.parsed.y)}`}}},
      scales:{y:{beginAtZero:true,ticks:{callback:v=>`R$ ${formatarValor(v)}`},grid:{color:"rgba(0,0,0,0.05)"}},x:{grid:{display:false}}}
    }
  });
}

function definirMetaMensal(){
  const atual=localStorage.getItem("metaMensal")||"";
  const val=prompt("Meta mensal (R$):",atual);
  if(val===null) return;
  const num=parseFloat(val.replace(/\./g,"").replace(",","."));
  if(isNaN(num)||num<=0) return alert("Valor inválido.");
  localStorage.setItem("metaMensal",String(num));
  atualizarDashboard();
}

// ── CLIENTES INATIVOS ──────────────────────────────────────
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
  if(!inativos.length){ el.style.display="none"; return; }
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

// ── AUTOCOMPLETE NOMES ─────────────────────────────────────
function atualizarSugestoesNomes(){
  const dl=document.getElementById("nome-sugestoes");
  if(!dl) return;
  const nomes=[...new Set(historicoRecibos.map(r=>r.nome))];
  dl.innerHTML=nomes.map(n=>`<option value="${esc(n)}">`).join("");
}

// ── BACKUP AUTOMÁTICO ──────────────────────────────────────
function carregarConfigBackupAuto(){
  const pasta=localStorage.getItem("backupAutoPasta")||"";
  const dias=localStorage.getItem("backupAutoIntervaloDias")||"1";
  const ultimo=localStorage.getItem("ultimoBackupAuto")||"";
  const elPasta=document.getElementById("backup-auto-pasta");
  const elDias=document.getElementById("backup-auto-dias");
  if(elPasta) elPasta.value=pasta;
  if(elDias) elDias.value=dias;
  const elStatus=document.getElementById("backup-auto-status");
  if(elStatus) elStatus.textContent=ultimo?`Último backup automático: ${new Date(ultimo).toLocaleString("pt-BR")}`:"Nenhum backup automático realizado ainda.";
}
async function escolherPastaBackup(){
  const pasta=await ipcRenderer.invoke("escolher-pasta");
  if(pasta){
    localStorage.setItem("backupAutoPasta",pasta);
    const el=document.getElementById("backup-auto-pasta");
    if(el) el.value=pasta;
    salvarConfigBackupAuto();
  }
}
function salvarConfigBackupAuto(){
  const dias=parseInt(document.getElementById("backup-auto-dias")?.value||"1");
  if(!isNaN(dias)&&dias>=1) localStorage.setItem("backupAutoIntervaloDias",String(dias));
}
async function verificarBackupAuto(){
  const pasta=localStorage.getItem("backupAutoPasta");
  if(!pasta) return;
  const dias=parseInt(localStorage.getItem("backupAutoIntervaloDias")||"1");
  const ultimo=localStorage.getItem("ultimoBackupAuto");
  const agora=new Date();
  if(ultimo&&(agora-new Date(ultimo))/(1000*60*60*24)<dias) return;
  const dados={versao:"1.0",data:agora.toISOString(),historicoRecibos,numReciboData:JSON.parse(localStorage.getItem("numReciboData")||"{}")};
  const result=await ipcRenderer.invoke("salvar-backup",{pasta,json:JSON.stringify(dados,null,2)});
  if(result.ok){
    localStorage.setItem("ultimoBackupAuto",agora.toISOString());
    carregarConfigBackupAuto();
  }
}

// ── EXPORTAR RECIBO PDF ────────────────────────────────────
function exportarReciboPDF(r){
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26); doc.rect(0,0,W,24,"F");
  doc.setTextColor(184,151,58); doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(200,200,200);
  doc.text("A ARAUJO PREV",W/2,18,{align:"center"});
  doc.setDrawColor(184,151,58); doc.setLineWidth(0.5);
  doc.line(20,28,W-20,28);
  doc.setTextColor(26,26,26); doc.setFontSize(11); doc.setFont("helvetica","bold");
  doc.text(`Recibo Nº ${r.num}`,W/2,36,{align:"center"});
  doc.setFontSize(13);
  doc.text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS",W/2,43,{align:"center"});
  doc.setDrawColor(220,220,220); doc.setLineWidth(0.3);
  doc.line(20,47,W-20,47);
  const digits=(r.cpf||"").replace(/\D/g,"");
  const labelDoc=digits.length>11?"CNPJ":"CPF";
  const compl=r.complemento?` - ${r.complemento}`:"";
  const corpo=`Recebemos do (a) senhor (a) ${r.nome}, residente e domiciliado(a) no Município de ${r.municipio_uf}, a importância de R$ ${r.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${compl}.`;
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(26,26,26);
  const linhas=doc.splitTextToSize(corpo,W-40);
  doc.text(linhas,20,57);
  const yApos=57+linhas.length*5+8;
  doc.text("Por ser verdade, firmo o presente que segue datado e assinado.",20,yApos);
  const yData=yApos+18;
  doc.text(`${r.municipio_uf}, ${r.data}`,20,yData);
  const yAssin=yData+28;
  doc.line(W/2-40,yAssin,W/2+40,yAssin);
  doc.setFontSize(9);
  doc.text(`${labelDoc}: ${r.cpf}`,W/2,yAssin+5,{align:"center"});
  if(r.emitido_por){ doc.text(`Responsável: ${r.emitido_por}`,W/2,yAssin+10,{align:"center"}); }
  const buf=Buffer.from(doc.output("arraybuffer"));
  const nomeArq=r.nome.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_").toLowerCase();
  const numSan=r.num.replace(/[\/\\]/g,"-");
  const file=path.join(os.homedir(),"Documents","Araujo Prev","Recibos",`recibo_${numSan}_${nomeArq}.pdf`);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,buf);
  mostrarToast("PDF gerado!",()=>ipcRenderer.invoke("abrir-arquivo",file));
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

  const total=lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  document.getElementById("financeiro-count").textContent=`${lista.length} recibos`;
  document.getElementById("financeiro-total").textContent=`Total: R$ ${formatarValor(total)}`;

  const tabelaFinanceiro = document.getElementById("tabela-financeiro");
  tabelaFinanceiro.innerHTML=lista.map(r=>`
    <tr>
      <td><span class="badge badge-gold">${esc(r.num)}</span></td>
      <td style="font-family:'Cormorant Garamond',serif;font-size:14px;font-weight:700">${esc(r.nome)}</td>
      <td>${esc(r.data)}</td>
      <td style="color:var(--success);font-weight:700">R$ ${esc(r.valor)}</td>
      <td>${esc(r.emitido_por||"-")}</td>
      <td><button class="btn-secondary btn-sm" data-action="detalhe" data-recibo-idx="${historicoRecibos.indexOf(r)}">Ver</button></td>
    </tr>`).join("")||`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">Nenhum recibo encontrado</td></tr>`;
  tabelaFinanceiro.querySelectorAll("button[data-action='detalhe']").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const idx=parseInt(btn.dataset.reciboIdx);
      const rec=historicoRecibos[idx];
      if(rec) abrirDetalhe(rec);
    });
  });
}

function getListaFiltrada(){
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
  const lista = getListaFiltrada();
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const total = lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  const mes   = document.getElementById("rel-mes").value;
  const ano   = document.getElementById("rel-ano").value;
  const resp  = document.getElementById("rel-responsavel").value;
  const mesesNomes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const periodoTxt = `${mes ? mesesNomes[parseInt(mes)-1] : "Todos os meses"} / ${ano || "Todos os anos"}`;

  const wb = XLSX.utils.book_new();

  // ── ABA 1: RECIBOS (detalhado) ──
  const ws1Rows = [
    ["A ARAUJO SERVIÇOS LTDA ME","","","","","","",""],
    ["RELATÓRIO DE RECIBOS","","","","","","",""],
    [`Período: ${periodoTxt}`,"","","",`Responsável: ${resp||"Todos"}`,"","",""],
    [`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`,"","","",`Total: ${lista.length} recibos`,"","",""],
    [],
    ["Nº Recibo","Cliente","CPF/CNPJ","Município/UF","Valor (R$)","Data","Responsável","Complemento"],
    ...lista.map(r=>[r.num, r.nome, r.cpf||"", r.municipio_uf||"", valorParaNumero(r.valor), r.data, r.emitido_por||"", r.complemento||""]),
    [],
    ["","TOTAL","","",total,"","",""],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(ws1Rows);
  ws1["!merges"] = [
    {s:{r:0,c:0},e:{r:0,c:7}},
    {s:{r:1,c:0},e:{r:1,c:7}},
    {s:{r:2,c:0},e:{r:2,c:3}}, {s:{r:2,c:4},e:{r:2,c:7}},
    {s:{r:3,c:0},e:{r:3,c:3}}, {s:{r:3,c:4},e:{r:3,c:7}},
  ];
  ws1["!cols"] = [12,32,16,20,14,12,20,24].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, "Recibos");

  // ── ABA 2: RESUMO POR MÊS ──
  const porMes = {};
  lista.forEach(r=>{
    const p=r.data?.split("/"); if(!p||p.length<3) return;
    const key=`${p[2]}-${p[1]}`;
    if(!porMes[key]) porMes[key]={label:`${mesesNomes[parseInt(p[1])-1]}/${p[2]}`,total:0,qtd:0};
    porMes[key].total+=valorParaNumero(r.valor); porMes[key].qtd++;
  });
  const ws2Rows = [
    ["A ARAUJO SERVIÇOS LTDA ME","","",""],
    ["RESUMO POR MÊS","","",""],
    [`Período: ${periodoTxt}`,"","",""],
    [],
    ["Mês / Ano","Qtd Recibos","Total (R$)","Ticket Médio (R$)"],
    ...Object.entries(porMes).sort((a,b)=>b[0].localeCompare(a[0])).map(([,v])=>[v.label, v.qtd, v.total, v.total/v.qtd]),
    [],
    ["TOTAL", lista.length, total, lista.length ? total/lista.length : 0],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(ws2Rows);
  ws2["!merges"] = [
    {s:{r:0,c:0},e:{r:0,c:3}},
    {s:{r:1,c:0},e:{r:1,c:3}},
    {s:{r:2,c:0},e:{r:2,c:3}},
  ];
  ws2["!cols"] = [22,14,16,18].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws2, "Resumo por Mês");

  // ── ABA 3: POR RESPONSÁVEL ──
  const porResp = {};
  lista.forEach(r=>{
    const k=r.emitido_por||"N/A";
    if(!porResp[k]) porResp[k]={total:0,qtd:0};
    porResp[k].total+=valorParaNumero(r.valor); porResp[k].qtd++;
  });
  const ws3Rows = [
    ["A ARAUJO SERVIÇOS LTDA ME","","",""],
    ["RESUMO POR RESPONSÁVEL","","",""],
    [`Período: ${periodoTxt}`,"","",""],
    [],
    ["Responsável","Qtd Recibos","Total Emitido (R$)","Ticket Médio (R$)"],
    ...Object.entries(porResp).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>[k, v.qtd, v.total, v.total/v.qtd]),
    [],
    ["TOTAL", lista.length, total, lista.length ? total/lista.length : 0],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(ws3Rows);
  ws3["!merges"] = [
    {s:{r:0,c:0},e:{r:0,c:3}},
    {s:{r:1,c:0},e:{r:1,c:3}},
    {s:{r:2,c:0},e:{r:2,c:3}},
  ];
  ws3["!cols"] = [24,14,18,18].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws3, "Por Responsável");

  const file = path.join(os.homedir(),"Documents",`relatorio_araujo_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, file);
  shell.openPath(file);
}

function exportarPDF(){
  const lista = getListaFiltrada();
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const total = lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  const mes   = document.getElementById("rel-mes").value;
  const ano   = document.getElementById("rel-ano").value;
  const resp  = document.getElementById("rel-responsavel").value;
  const mesesNomes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const doc = new jsPDF({ orientation:"landscape" });
  const W   = doc.internal.pageSize.getWidth();

  // Cabeçalho
  doc.setFillColor(26,26,26);
  doc.rect(0,0,W,28,"F");
  doc.setTextColor(184,151,58);
  doc.setFontSize(16); doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,11,{align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(200,200,200);
  doc.text("RELATÓRIO DE RECIBOS",W/2,18,{align:"center"});
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`,W/2,24,{align:"center"});

  // Filtros aplicados
  doc.setTextColor(80,80,80); doc.setFontSize(8); doc.setFont("helvetica","italic");
  const filtroTxt = `Período: ${mes?mesesNomes[parseInt(mes)-1]:"Todos"} / ${ano||"Todos"} • Responsável: ${resp||"Todos"} • Total de recibos: ${lista.length}`;
  doc.text(filtroTxt, 14, 34);

  // Tabela
  doc.autoTable({
    startY: 38,
    head: [["Nº","Cliente","CPF/CNPJ","Município/UF","Data","Valor","Responsável"]],
    body: lista.map(r=>[
      r.num, r.nome, r.cpf||"-", r.municipio_uf||"-",
      r.data, `R$ ${r.valor}`, r.emitido_por||"-"
    ]),
    foot: [["","TOTAL","","","",`R$ ${formatarValor(total)}`,""]],
    styles: { fontSize:8, cellPadding:3, font:"helvetica" },
    headStyles: { fillColor:[26,26,26], textColor:[184,151,58], fontStyle:"bold", halign:"center" },
    footStyles: { fillColor:[245,237,214], textColor:[26,26,26], fontStyle:"bold" },
    alternateRowStyles: { fillColor:[250,248,244] },
    columnStyles: {
      0: { cellWidth:22, halign:"center" },
      5: { halign:"right", fontStyle:"bold" },
    },
    didDrawPage: (data) => {
      // Rodapé
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(150,150,150); doc.setFont("helvetica","normal");
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, W-14, doc.internal.pageSize.getHeight()-6, {align:"right"});
      doc.text("A ARAUJO SERVIÇOS LTDA ME", 14, doc.internal.pageSize.getHeight()-6);
    }
  });

  // Salva via buffer (necessário no Electron)
  const buf  = Buffer.from(doc.output("arraybuffer"));
  const file = path.join(os.homedir(),"Documents",`relatorio_araujo_${Date.now()}.pdf`);
  fs.writeFileSync(file, buf);
  shell.openPath(file);
}

// ── BACKUP / RESTAURAR ───────────────────────────────────────
function fazerBackup(){
  const dados = {
    versao: "1.0",
    data: new Date().toISOString(),
    historicoRecibos,
    numReciboData: JSON.parse(localStorage.getItem("numReciboData")||"{}")
  };
  const json = JSON.stringify(dados, null, 2);
  const file = path.join(os.homedir(),"Documents",`backup_araujo_${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(file, json, "utf8");
  shell.openPath(path.join(os.homedir(),"Documents"));
  alert(`Backup salvo em:\n${file}`);
}

function restaurarBackup(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const dados = JSON.parse(e.target.result);
      if(!dados || typeof dados !== "object") return alert("Arquivo inválido.");
      if(!Array.isArray(dados.historicoRecibos)) return alert("Arquivo inválido: histórico ausente ou corrompido.");
      const camposObrigatorios = ["num","nome","cpf","valor","data"];
      const invalido = dados.historicoRecibos.some(r=>
        !r || typeof r !== "object" || camposObrigatorios.some(c=>typeof r[c] !== "string")
      );
      if(invalido) return alert("Arquivo inválido: registros com estrutura incorreta.");
      if(!confirm(`Restaurar ${dados.historicoRecibos.length} recibos?\nIsso substituirá os dados atuais.`)) return;
      historicoRecibos = dados.historicoRecibos;
      localStorage.setItem("historicoRecibos", JSON.stringify(historicoRecibos));
      if(dados.numReciboData && typeof dados.numReciboData === "object")
        localStorage.setItem("numReciboData", JSON.stringify(dados.numReciboData));
      alert("Backup restaurado com sucesso!");
      location.reload();
    } catch(err) {
      alert("Erro ao restaurar: " + err.message);
    }
  };
  reader.readAsText(file);
  input.value = "";
}

// ── HELPERS PDF ───────────────────────────────────────────
function cabecalhoPDF(doc, titulo, subtitulo){
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26); doc.rect(0,0,W,30,"F");
  doc.setTextColor(184,151,58); doc.setFontSize(15); doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME", W/2, 12, {align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(200,200,200);
  doc.text(titulo, W/2, 20, {align:"center"});
  if(subtitulo) doc.text(subtitulo, W/2, 26, {align:"center"});
}

function rodapePDF(doc){
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(150,150,150); doc.setFont("helvetica","normal");
    doc.text(`Página ${i} de ${pages}`, W-14, H-6, {align:"right"});
    doc.text("A ARAUJO SERVIÇOS LTDA ME", 14, H-6);
    doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`, W/2, H-6, {align:"center"});
  }
}

function salvarPDF(doc, nome){
  const buf = Buffer.from(doc.output("arraybuffer"));
  const file = path.join(os.homedir(),"Documents",`${nome}_${Date.now()}.pdf`);
  fs.writeFileSync(file, buf);
  shell.openPath(file);
}

function salvarExcel(wb, nome){
  const file = path.join(os.homedir(),"Documents",`${nome}_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, file);
  shell.openPath(file);
}

function exportarExcelClientes(){
  const ano = document.getElementById("rel-cliente-ano").value;
  const lista = historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const mapa = {};
  lista.forEach(r=>{
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,recibos:[],total:0,cpf:r.cpf||""};
    mapa[r.nome].recibos.push(r);
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });
  const clientes = Object.values(mapa).sort((a,b)=>b.total-a.total);

  const cab = [
    ["A ARAUJO SERVIÇOS LTDA ME"],
    ["Relatório por Cliente"],
    [`Gerado em: ${new Date().toLocaleDateString("pt-BR")}  |  Ano: ${ano||"Todos"}`],
    [],
    ["Cliente","CPF/CNPJ","Qtd Recibos","Total Pago (R$)","Ticket Médio (R$)","Primeiro Recibo","Último Recibo"]
  ];
  const linhas = clientes.map(c=>[
    c.nome, c.cpf, c.recibos.length,
    c.total,
    c.total/c.recibos.length,
    c.recibos[c.recibos.length-1].data,
    c.recibos[0].data
  ]);
  linhas.push(["TOTAL","",lista.length,clientes.reduce((s,c)=>s+c.total,0),"","",""]);

  const ws = XLSX.utils.aoa_to_sheet([...cab,...linhas]);
  ws["!cols"] = [32,16,12,16,16,14,14].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Por Cliente");
  salvarExcel(wb,"relatorio_clientes");
}

function exportarPDFClientes(){
  const ano = document.getElementById("rel-cliente-ano").value;
  const lista = historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const mapa = {};
  lista.forEach(r=>{
    if(!mapa[r.nome]) mapa[r.nome]={nome:r.nome,recibos:[],total:0,cpf:r.cpf||""};
    mapa[r.nome].recibos.push(r);
    mapa[r.nome].total+=valorParaNumero(r.valor);
  });
  const clientes = Object.values(mapa).sort((a,b)=>b.total-a.total);
  const totalGeral = clientes.reduce((s,c)=>s+c.total,0);

  const doc = new jsPDF({orientation:"landscape"});
  cabecalhoPDF(doc,"RELATÓRIO POR CLIENTE",`Ano: ${ano||"Todos"} • ${clientes.length} clientes • ${lista.length} recibos`);

  doc.autoTable({
    startY:36,
    head:[["Cliente","CPF/CNPJ","Qtd","Total Pago","Ticket Médio","1º Recibo","Últ. Recibo"]],
    body:clientes.map(c=>[
      c.nome, c.cpf||"--", c.recibos.length,
      `R$ ${formatarValor(c.total)}`,
      `R$ ${formatarValor(c.total/c.recibos.length)}`,
      c.recibos[c.recibos.length-1].data,
      c.recibos[0].data
    ]),
    foot:[[`TOTAL (${clientes.length} clientes)`,"",lista.length,`R$ ${formatarValor(totalGeral)}`,"","",""]],
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,26,26],textColor:[184,151,58],fontStyle:"bold"},
    footStyles:{fillColor:[245,237,214],textColor:[26,26,26],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[250,248,244]},
    columnStyles:{2:{halign:"center"},3:{halign:"right",fontStyle:"bold"},4:{halign:"right"}},
  });
  rodapePDF(doc);
  salvarPDF(doc,"relatorio_clientes");
}

// ── RELATÓRIO POR RESPONSÁVEL ─────────────────────────────
function exportarExcelResponsaveis(){
  const mes = document.getElementById("rel-resp-mes").value;
  const ano = document.getElementById("rel-resp-ano").value;
  const lista = historicoRecibos.filter(r=>{
    const p=r.data?.split("/"); if(!p) return false;
    if(mes&&p[1]!==mes) return false;
    if(ano&&p[2]!==ano) return false;
    return true;
  });
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const mapa = {};
  lista.forEach(r=>{
    const k = r.emitido_por||"N/A";
    if(!mapa[k]) mapa[k]={nome:k,recibos:[],total:0};
    mapa[k].recibos.push(r);
    mapa[k].total+=valorParaNumero(r.valor);
  });
  const resps = Object.values(mapa).sort((a,b)=>b.total-a.total);
  const totalGeral = resps.reduce((s,r)=>s+r.total,0);
  const mN=["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  const cab = [
    ["A ARAUJO SERVIÇOS LTDA ME"],
    ["Relatório por Responsável"],
    [`Gerado em: ${new Date().toLocaleDateString("pt-BR")}  |  Período: ${mes?mN[parseInt(mes)]:"Todos"} / ${ano||"Todos"}`],
    [],
    ["Responsável","Qtd Recibos","Total Emitido (R$)","Ticket Médio (R$)","% do Total"]
  ];
  const linhas = resps.map(r=>[
    r.nome, r.recibos.length, r.total,
    r.total/r.recibos.length,
    `${((r.total/totalGeral)*100).toFixed(1)}%`
  ]);
  linhas.push(["TOTAL",lista.length,totalGeral,"","100%"]);

  const ws = XLSX.utils.aoa_to_sheet([...cab,...linhas]);
  ws["!cols"] = [24,12,18,18,10].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Por Responsável");
  salvarExcel(wb,"relatorio_responsaveis");
}

function exportarPDFResponsaveis(){
  const mes = document.getElementById("rel-resp-mes").value;
  const ano = document.getElementById("rel-resp-ano").value;
  const lista = historicoRecibos.filter(r=>{
    const p=r.data?.split("/"); if(!p) return false;
    if(mes&&p[1]!==mes) return false;
    if(ano&&p[2]!==ano) return false;
    return true;
  });
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const mapa = {};
  lista.forEach(r=>{
    const k = r.emitido_por||"N/A";
    if(!mapa[k]) mapa[k]={nome:k,recibos:[],total:0};
    mapa[k].recibos.push(r);
    mapa[k].total+=valorParaNumero(r.valor);
  });
  const resps = Object.values(mapa).sort((a,b)=>b.total-a.total);
  const totalGeral = resps.reduce((s,r)=>s+r.total,0);
  const mN=["","Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const doc = new jsPDF();
  cabecalhoPDF(doc,"RELATÓRIO POR RESPONSÁVEL",`Período: ${mes?mN[parseInt(mes)]:"Todos"} / ${ano||"Todos"}`);

  doc.autoTable({
    startY:36,
    head:[["Responsável","Qtd Recibos","Total Emitido","Ticket Médio","% do Total"]],
    body:resps.map(r=>[
      r.nome, r.recibos.length,
      `R$ ${formatarValor(r.total)}`,
      `R$ ${formatarValor(r.total/r.recibos.length)}`,
      `${((r.total/totalGeral)*100).toFixed(1)}%`
    ]),
    foot:[["TOTAL",lista.length,`R$ ${formatarValor(totalGeral)}`,"","100%"]],
    styles:{fontSize:9,cellPadding:4},
    headStyles:{fillColor:[26,26,26],textColor:[184,151,58],fontStyle:"bold"},
    footStyles:{fillColor:[245,237,214],textColor:[26,26,26],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[250,248,244]},
    columnStyles:{1:{halign:"center"},2:{halign:"right",fontStyle:"bold"},3:{halign:"right"},4:{halign:"center"}},
  });
  rodapePDF(doc);
  salvarPDF(doc,"relatorio_responsaveis");
}

// ── RESUMO EXECUTIVO ───────────────────────────────────────
function exportarPDFExecutivo(){
  const ano = document.getElementById("rel-exec-ano").value;
  const lista = historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length) return alert("Nenhum dado para exportar.");

  const totalGeral = lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  const ticketMedio = totalGeral/lista.length;
  const mesesNomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  // Por mês
  const porMes = {};
  lista.forEach(r=>{
    const p=r.data?.split("/"); if(!p||p.length<3) return;
    const k=p[1]; if(!porMes[k]) porMes[k]={total:0,qtd:0};
    porMes[k].total+=valorParaNumero(r.valor); porMes[k].qtd++;
  });

  // Top 5 clientes
  const mapaC={};
  lista.forEach(r=>{
    if(!mapaC[r.nome]) mapaC[r.nome]={total:0,qtd:0};
    mapaC[r.nome].total+=valorParaNumero(r.valor); mapaC[r.nome].qtd++;
  });
  const topClientes = Object.entries(mapaC).sort((a,b)=>b[1].total-a[1].total).slice(0,5);

  // Por responsável
  const mapaR={};
  lista.forEach(r=>{
    const k=r.emitido_por||"N/A";
    if(!mapaR[k]) mapaR[k]={total:0,qtd:0};
    mapaR[k].total+=valorParaNumero(r.valor); mapaR[k].qtd++;
  });
  const porResp = Object.entries(mapaR).sort((a,b)=>b[1].total-a[1].total);

  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();
  cabecalhoPDF(doc,"RESUMO EXECUTIVO",`Ano: ${ano||"Todos os anos"}`);

  // Cards de resumo
  let y = 38;
  doc.setFillColor(245,237,214); doc.roundedRect(14,y,55,22,2,2,"F");
  doc.setFillColor(237,247,242); doc.roundedRect(76,y,55,22,2,2,"F");
  doc.setFillColor(240,240,240); doc.roundedRect(138,y,55,22,2,2,"F");

  doc.setFontSize(7); doc.setTextColor(100,100,100); doc.setFont("helvetica","normal");
  doc.text("FATURAMENTO TOTAL",41,y+6,{align:"center"});
  doc.text("TOTAL DE RECIBOS",103,y+6,{align:"center"});
  doc.text("TICKET MÉDIO",165,y+6,{align:"center"});

  doc.setFontSize(13); doc.setFont("helvetica","bold");
  doc.setTextColor(26,26,26);
  doc.text(`R$ ${formatarValor(totalGeral)}`,41,y+16,{align:"center"});
  doc.text(String(lista.length),103,y+16,{align:"center"});
  doc.text(`R$ ${formatarValor(ticketMedio)}`,165,y+16,{align:"center"});

  y += 30;

  // Faturamento por mês
  doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(26,26,26);
  doc.text("Faturamento por Mês", 14, y); y+=4;
  doc.autoTable({
    startY:y,
    head:[["Mês","Qtd Recibos","Total","Ticket Médio"]],
    body:Object.entries(porMes).sort((a,b)=>a[0].localeCompare(b[0])).map(([m,v])=>[
      mesesNomes[parseInt(m)-1], v.qtd,
      `R$ ${formatarValor(v.total)}`,
      `R$ ${formatarValor(v.total/v.qtd)}`
    ]),
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,26,26],textColor:[184,151,58],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[250,248,244]},
    columnStyles:{1:{halign:"center"},2:{halign:"right",fontStyle:"bold"},3:{halign:"right"}},
    margin:{left:14,right:14},
    tableWidth:"auto",
  });

  y = doc.lastAutoTable.finalY + 10;

  // Top clientes e por responsável lado a lado
  doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(26,26,26);
  doc.text("Top 5 Clientes", 14, y);
  doc.text("Por Responsável", W/2+4, y);
  y+=4;

  doc.autoTable({
    startY:y,
    head:[["Cliente","Qtd","Total"]],
    body:topClientes.map(([n,v])=>[n.length>25?n.slice(0,25)+"...":n, v.qtd, `R$ ${formatarValor(v.total)}`]),
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,26,26],textColor:[184,151,58],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[250,248,244]},
    columnStyles:{1:{halign:"center"},2:{halign:"right",fontStyle:"bold"}},
    margin:{left:14,right:W/2+2},
  });

  doc.autoTable({
    startY:y,
    head:[["Responsável","Qtd","Total"]],
    body:porResp.map(([n,v])=>[n, v.qtd, `R$ ${formatarValor(v.total)}`]),
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[26,26,26],textColor:[184,151,58],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[250,248,244]},
    columnStyles:{1:{halign:"center"},2:{halign:"right",fontStyle:"bold"}},
    margin:{left:W/2+4,right:14},
  });

  rodapePDF(doc);
  salvarPDF(doc,"resumo_executivo");
}

document.getElementById("modal-detalhe").addEventListener("click",function(e){
  if(e.target===this) fecharModal("modal-detalhe");
});
