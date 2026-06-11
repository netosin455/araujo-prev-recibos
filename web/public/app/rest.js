// web/public/app/rest.js — extracted from app.js
// â”€â”€ AUTOCOMPLETE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function atualizarSugestoesNomes(){
  const dl=document.getElementById("nome-sugestoes");
  if(!dl) return;
  const cpfKey=cpf=>cpf?cpf.replace(/\D/g,""):"";
  const nomeNorm=s=>(s||"").normalize("NFC").trim().replace(/\s+/g," ").toUpperCase();
  // Um nome por CPF Ãºnico (cadastro tem prioridade); sem CPF deduplica por nome
  const porCpf={};  // cpf_digits â†’ nome canÃ´nico
  const semCpf=new Set(); // nomes normalizados sem CPF
  // Prioridade 1: cadastro (nome canÃ´nico oficial)
  listaClientes.forEach(c=>{
    if(!c.nome) return;
    const k=cpfKey(c.cpf);
    if(k) porCpf[k]=nomeNorm(c.nome);
    else semCpf.add(nomeNorm(c.nome));
  });
  // Prioridade 2: recibos (sÃ³ adiciona se CPF ainda nÃ£o visto)
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

// â”€â”€ INATIVOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    inativos.slice(0,5).map(([nome,dt])=>`<span style="margin-right:16px">â€¢ ${esc(nome)} <span style="color:var(--muted)">(Ãºltimo: ${dt.toLocaleDateString("pt-BR")})</span></span>`).join("")+
    (inativos.length>5?`<span style="color:var(--muted)"> e mais ${inativos.length-5}...</span>`:"");
}
function configurarAlertaInativo(){
  const atual=localStorage.getItem("alertaInativoMeses")||"3";
  const val=prompt("Alertar clientes sem recibo hÃ¡ quantos meses?",atual);
  if(val===null) return;
  const n=parseInt(val);
  if(isNaN(n)||n<1) { mostrarToast("Valor invÃ¡lido.", null, "error"); return; }
  localStorage.setItem("alertaInativoMeses",String(n));
  verificarClientesInativos();
}

// â”€â”€ USUÃRIOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function renderUsuarios(){
  const res=await api("GET","/api/users");
  if(!res) return;
  const users=await res.json();
  const el=document.getElementById("lista-usuarios");
  el.innerHTML=users.map(u=>{
    const perfilLabel = u.role==="recepcao"
      ? `RecepÃ§Ã£o Â· EscritÃ³rio: ${esc(u.escritorio||"nÃ£o definido")}`
      : u.role==="precatorios" ? "PrecatÃ³rios (somente admin)"
      : "Financeiro";
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600">${esc(u.username)}</div>
        <div style="font-size:11px;color:var(--muted)">Perfil: ${perfilLabel} Â· Criado em ${new Date(u.created_at).toLocaleDateString("pt-BR")}</div>
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
  // Normaliza o escritÃ³rio para bater com os valores do select (case-insensitive)
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
  if(!username) { mostrarToast("Preencha o nome de usuÃ¡rio.", null, "error"); return; }
  const body = { username, role, escritorio };
  if(password) body.password = password;
  const res = await api("PUT", `/api/users/${id}`, body);
  const data = await res.json();
  if(!res.ok) { mostrarToast(data.erro || "Erro ao editar usuÃ¡rio.", null, "error"); return; }
  fecharModal("modal-editar-usuario");
  mostrarToast("UsuÃ¡rio atualizado!");
  renderUsuarios();
}

async function adicionarUsuario(){
  const username=document.getElementById("novo-usuario").value.trim();
  const password=document.getElementById("nova-senha").value;
  const role=document.getElementById("novo-role").value;
  const escritorio=document.getElementById("novo-escritorio").value.trim();
  if(!username||!password) { mostrarToast("Preencha usuÃ¡rio e senha.", null, "error"); return; }
  const res=await api("POST","/api/users",{username,password,role,escritorio});
  const data=await res.json();
  if(!res.ok) { mostrarToast(data.erro||"Erro ao criar usuÃ¡rio.", null, "error"); return; }
  document.getElementById("novo-usuario").value="";
  document.getElementById("nova-senha").value="";
  document.getElementById("novo-role").value="financeiro";
  document.getElementById("novo-escritorio").value="";
  toggleEscritorioNovo("financeiro");
  mostrarToast(`UsuÃ¡rio "${username}" criado com sucesso!`);
  renderUsuarios();
}

async function excluirUsuario(id){
  if(!confirm("Remover este usuÃ¡rio?")) return;
  await api("DELETE",`/api/users/${id}`);
  renderUsuarios();
}

// â”€â”€ BACKUP / RESTAURAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    if(!Array.isArray(recibos)) { mostrarToast("Arquivo invÃ¡lido.", null, "error"); return; }
    if(!confirm(`Importar ${recibos.length} recibos? Os recibos existentes nÃ£o serÃ£o apagados.`)) return;
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

// â”€â”€ LAZY LOAD LIBS PESADAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ EXPORTAR EXCEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    "NÂº Recibo":r.num,"Cliente":r.nome,"CPF/CNPJ":r.cpf,"MunicÃ­pio":r.municipio_uf,
    "Valor":"R$ "+r.valor,"Data":r.data,"ResponsÃ¡vel":r.emitido_por||"","ReferÃªncia":r.referencia||""
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
  doc.text("A ARAUJO SERVIÃ‡OS LTDA ME",W/2,11,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(9);doc.setFont("helvetica","normal");
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`,14,26);
  doc.autoTable({
    startY:30,
    head:[["NÂº","Cliente","Data","Valor","ResponsÃ¡vel","ReferÃªncia"]],
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
  doc.text("A ARAUJO SERVIÃ‡OS LTDA ME",W/2,11,{align:"center"});
  doc.autoTable({
    startY:26,
    head:[["Cliente","CPF/CNPJ","Qtd","Total"]],
    body:Object.values(mapa).map(c=>[c.nome,c.cpf,c.qtd,"R$ "+formatarValor(c.total)]),
    styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},
  });
  doc.save(`clientes_araujo_${new Date().toISOString().slice(0,10)}.pdf`);
}

// â”€â”€ RELATÃ“RIO POR RESPONSÃVEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const resp=r.emitido_por||"Sem responsÃ¡vel";
    if(!mapa[resp])mapa[resp]={responsavel:resp,qtd:0,total:0};
    mapa[resp].qtd++;
    mapa[resp].total+=valorParaNumero(r.valor);
  });
  const ws=XLSX.utils.json_to_sheet(Object.values(mapa).map(r=>({
    "ResponsÃ¡vel":r.responsavel,"Qtd Recibos":r.qtd,"Total":"R$ "+formatarValor(r.total)
  })));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"ResponsÃ¡veis");
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
    const resp=r.emitido_por||"Sem responsÃ¡vel";
    if(!mapa[resp])mapa[resp]={responsavel:resp,qtd:0,total:0};
    mapa[resp].qtd++;
    mapa[resp].total+=valorParaNumero(r.valor);
  });
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  doc.setFillColor(26,26,26);doc.rect(0,0,W,18,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÃ‡OS LTDA ME",W/2,11,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(11);
  doc.text("RelatÃ³rio por ResponsÃ¡vel",14,26);
  doc.autoTable({
    startY:32,
    head:[["ResponsÃ¡vel","Qtd Recibos","Total"]],
    body:Object.values(mapa).map(r=>[r.responsavel,r.qtd,"R$ "+formatarValor(r.total)]),
    styles:{fontSize:10},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},
  });
  doc.save(`responsaveis_araujo_${new Date().toISOString().slice(0,10)}.pdf`);
}

// â”€â”€ RESUMO EXECUTIVO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function exportarPDFExecutivo(){
  await garantirJSPDF();
  const ano=document.getElementById("rel-exec-ano").value;
  const lista=historicoRecibos.filter(r=>!ano||r.data?.split("/")[2]===ano);
  if(!lista.length){ mostrarToast("Nenhum dado para exportar.", null, "error"); return; }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  const W=doc.internal.pageSize.getWidth();
  // CabeÃ§alho
  doc.setFillColor(26,26,26);doc.rect(0,0,W,24,"F");
  doc.setTextColor(184,151,58);doc.setFontSize(14);doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÃ‡OS LTDA ME",W/2,11,{align:"center"});
  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(200,200,200);
  doc.text("A ARAUJO PREV",W/2,18,{align:"center"});
  doc.setTextColor(26,26,26);doc.setFontSize(13);doc.setFont("helvetica","bold");
  doc.text(`Resumo Executivo ${ano||"Geral"}`,W/2,34,{align:"center"});
  // Totais
  const totalGeral=lista.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  const ticketMedio=lista.length?totalGeral/lista.length:0;
  doc.setFontSize(10);doc.setFont("helvetica","normal");
  doc.text(`Total de recibos: ${lista.length}   |   Total faturado: R$ ${formatarValor(totalGeral)}   |   Ticket mÃ©dio: R$ ${formatarValor(ticketMedio)}`,W/2,42,{align:"center"});
  // Faturamento mensal
  const mesesNomes=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const porMes=mesesNomes.map((m,i)=>{
    const mm=String(i+1).padStart(2,"0");
    const sub=lista.filter(r=>r.data?.split("/")[1]===mm);
    return [m,sub.length,"R$ "+formatarValor(sub.reduce((s,r)=>s+valorParaNumero(r.valor),0))];
  }).filter(r=>r[1]>0);
  doc.autoTable({startY:50,head:[["MÃªs","Qtd","Total"]],body:porMes,styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]},tableWidth:80,margin:{left:14}});
  // Top clientes
  const mapaC={};
  lista.forEach(r=>{if(!mapaC[r.nome])mapaC[r.nome]={nome:r.nome,total:0,qtd:0};mapaC[r.nome].total+=valorParaNumero(r.valor);mapaC[r.nome].qtd++;});
  const topC=Object.values(mapaC).sort((a,b)=>b.total-a.total).slice(0,10);
  doc.autoTable({startY:50,head:[["Top Clientes","Qtd","Total"]],body:topC.map(c=>[c.nome,c.qtd,"R$ "+formatarValor(c.total)]),styles:{fontSize:9},headStyles:{fillColor:[62,122,94],textColor:"white"},tableWidth:90,margin:{left:110}});
  // ResponsÃ¡veis
  const mapaR={};
  lista.forEach(r=>{const k=r.emitido_por||"-";if(!mapaR[k])mapaR[k]={resp:k,total:0,qtd:0};mapaR[k].total+=valorParaNumero(r.valor);mapaR[k].qtd++;});
  doc.autoTable({startY:doc.lastAutoTable.finalY+14,head:[["ResponsÃ¡vel","Qtd","Total"]],body:Object.values(mapaR).sort((a,b)=>b.total-a.total).map(r=>[r.resp,r.qtd,"R$ "+formatarValor(r.total)]),styles:{fontSize:9},headStyles:{fillColor:[26,26,26],textColor:[184,151,58]}});
  doc.save(`executivo_araujo_${ano||"geral"}.pdf`);
}

// â”€â”€ UPLOAD COMPROVANTE (recepÃ§Ã£o) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const r1 = await fetch("/api/upload-comprovante", { method: "POST", credentials: "include", body: fd });
    const j1 = await r1.json();
    if (!j1.link) { status.textContent = j1.erro || "Erro ao enviar arquivo."; btn.disabled = false; return; }
    status.textContent = "Vinculando ao recibo...";
    const r2 = await fetch(`/api/recibos/${_uploadCompReciboId}/comprovante`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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

// â”€â”€ TECLADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    resultado.textContent="Erro de conexÃ£o.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-arrow-repeat"></i> Sincronizar agora';
  }
}

async function reescreverPlanilha(){
  if(!confirm("ATENÃ‡ÃƒO: isso vai APAGAR tudo da planilha e reescrever do zero com os dados do banco (datas corrigidas). Continuar?")) return;
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
      resultado.textContent=(res?.erro||"Erro")+(res?.detalhe?" â€” "+res.detalhe:"");
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexÃ£o.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-arrow-clockwise"></i> Limpar e reescrever do zero';
  }
}

async function importarDeSheets(){
  if(!confirm("Isso vai importar para o banco todos os recibos da planilha que ainda nÃ£o existem no banco (por nÃºmero). Recibos jÃ¡ existentes nÃ£o serÃ£o alterados. Continuar?")) return;
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
      resultado.textContent=res.mensagem||"ImportaÃ§Ã£o concluÃ­da.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Erro: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexÃ£o.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-cloud-download"></i> Importar planilha â†’ banco';
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
    resultado.textContent="Erro de conexÃ£o.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-calendar-check"></i> Corrigir datas';
  }
}

async function limparDuplicatas(){
  if(!confirm("Isso vai remover linhas duplicadas da planilha (mantÃ©m a primeira ocorrÃªncia de cada recibo). Continuar?")) return;
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
      resultado.textContent=res.mensagem||"Limpeza concluÃ­da.";
    }else{
      resultado.style.color="var(--danger,#ef4444)";
      resultado.textContent=res?.erro||"Erro inesperado: "+JSON.stringify(res);
    }
  }catch(e){
    resultado.style.display="block";
    resultado.style.color="var(--danger,#ef4444)";
    resultado.textContent="Erro de conexÃ£o.";
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="bi bi-trash"></i> Remover duplicatas';
  }
}

// â”€â”€ HANDLERS ESTÃTICOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Chamado uma vez ao carregar o mÃ³dulo (script defer). Substitui todos os
// onclick/oninput/onchange inline que foram removidos do HTML para permitir
// um CSP script-src sem 'unsafe-inline'.
/* â”€â”€ Central de NotificaÃ§Ãµes â”€â”€ */
let _notifList = [];
let _notifUnreadCount = 0;
let _notifPoller = null;

function carregarNotificacoes() {
  // Tenta buscar do servidor; se falhar, gera localmente
  fetch("/api/notificacoes", { credentials: "include" })
    .then(r => { if (!r.ok) throw new Error("server"); return r.json(); })
    .then(data => {
      _notifList = data.notificacoes || [];
      _notifUnreadCount = data.naoLidas ?? 0;
      renderNotificacoes();
    })
    .catch(() => gerarNotificacoesLocais());
}

function gerarNotificacoesLocais() {
  // Gera notificaÃ§Ãµes a partir das parcelas vencendo nos prÃ³ximos 7 dias
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
          texto: c.nome + " â€” Parcela " + (idx+1) + " venceu hÃ¡ " + Math.abs(diff) + " dia(s)",
          lido: false,
          gravidade: "danger",
          data: venc.toISOString(),
          ref: { clienteId: c.id, parcelaIdx: idx }
        });
      } else if (diff >= 0 && diff <= 7) {
        notifs.push({
          id: "loc-" + c.id + "-" + idx,
          tipo: "vencimento",
          titulo: "Parcela prÃ³xima do vencimento",
          texto: c.nome + " â€” Parcela " + (idx+1) + " vence em " + diff + " dia(s)",
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

  // Remove itens antigos (mantÃ©m o empty)
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
    headers: { "Content-Type": "application/json" },
    credentials: "include"
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

  // Central de NotificaÃ§Ãµes
  document.getElementById("btn-notificacoes").addEventListener("click", toggleNotifDropdown);
  document.getElementById("btn-marcar-lidas").addEventListener("click", marcarNotificacoesLidas);

  // Tema
  document.getElementById("btn-tema").addEventListener("click", alternarTema);

  // Modal inativo
  document.getElementById("btn-configurar-inativo").addEventListener("click", () => navegarPara("admin"));
  document.getElementById("btn-fechar-inativo").addEventListener("click", () => fecharModal("modal-inativo"));

  // EdiÃ§Ã£o
  document.getElementById("btn-cancelar-edicao").addEventListener("click", cancelarEdicao);

  // FormulÃ¡rio de recibo
  document.getElementById("btn-gerar").addEventListener("click", gerarRecibo);
  document.getElementById("btn-limpar-recibo").addEventListener("click", limparCampos);
  document.getElementById("referencia").addEventListener("input", onReferenciaInput);
  document.getElementById("btn-ref-padrao-recibo").addEventListener("click", salvarReferenciaPadraoRecibo);
  document.getElementById("comprovante").addEventListener("change", function() { atualizarLabelComprovante(this); });

  // HistÃ³rico
  document.getElementById("busca-historico").addEventListener("input", renderHistorico);
  document.getElementById("filtro-data-ini").addEventListener("input", renderHistorico);
  document.getElementById("filtro-data-fim").addEventListener("input", renderHistorico);
  document.getElementById("btn-limpar-data").addEventListener("click", limparFiltroData);
  document.getElementById("btn-exportar-zip").addEventListener("click", exportarZipSelecionados);
  document.getElementById("btn-select-all").addEventListener("click", selecionarTodosRecibos);
  document.getElementById("btn-batch-delete").addEventListener("click", excluirSelecionados);
  document.getElementById("btn-batch-email").addEventListener("click", batchEnviarEmail);

  // Filtros avanÃ§ados
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

  // Dashboard â€” filtro de ano
  document.getElementById("dash-ano")?.addEventListener("change", atualizarDashboard);

  // Analytics â€” filtro de perÃ­odo e exportar
  document.getElementById("analytics-de")?.addEventListener("change", _renderAnalytics);
  document.getElementById("analytics-ate")?.addEventListener("change", _renderAnalytics);
  document.getElementById("btn-exportar-analytics-excel")?.addEventListener("click", exportarAnalyticsExcel);
  document.getElementById("btn-exportar-analytics-pdf")?.addEventListener("click", exportarAnalyticsPDF);
  document.getElementById("dre-ano")?.addEventListener("change", _renderDRE);
  document.getElementById("btn-exportar-dre-pdf")?.addEventListener("click", exportarDREPDF);

  // RelatÃ³rios / exportaÃ§Ãµes
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

  // UsuÃ¡rios
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

  // ObservaÃ§Ãµes do cliente
  document.getElementById("btn-toggle-obs")?.addEventListener("click", () => {
    const addPanel = document.getElementById("cliente-obs-add");
    const btn      = document.getElementById("btn-toggle-obs");
    if (!addPanel) return;
    const open = addPanel.style.display !== "none";
    addPanel.style.display = open ? "none" : "";
    if (btn) btn.innerHTML = open ? '<i class="bi bi-plus-circle"></i> Adicionar observaÃ§Ã£o' : '<i class="bi bi-dash-circle"></i> Cancelar';
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

  // CalendÃ¡rio
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

  // Busca global (sidebar) â€” mantida para compatibilidade
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
