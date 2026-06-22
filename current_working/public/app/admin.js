// web/public/app/admin.js — extracted from app.js
// â”€â”€ OBSERVAÃ‡Ã•ES DO CLIENTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderObservacoes(obs) {
  const lista = document.getElementById("cliente-observacoes-lista");
  if (!lista) return;
  if (!Array.isArray(obs) || !obs.length) {
    lista.innerHTML = `<div style="color:var(--muted);font-size:12px;font-style:italic">Nenhuma observaÃ§Ã£o registrada.</div>`;
    return;
  }
  lista.innerHTML = obs.map(o => `
    <div style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
      <div style="font-size:12px;color:var(--text)">${esc(o.texto)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(o.autor||"â€”")} Â· ${esc(o.data ? new Date(o.data).toLocaleDateString("pt-BR") : "â€”")}</div>
    </div>`).join("");
}

async function adicionarObservacaoCliente() {
  const id = document.getElementById("cliente-id").value;
  if (!id) return;
  const textoEl = document.getElementById("cliente-obs-texto");
  const texto = (textoEl?.value || "").trim();
  if (!texto) return mostrarToast("Digite a observaÃ§Ã£o antes de adicionar.");
  const btn = document.getElementById("btn-confirmar-obs");
  const orig = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "Salvando..."; }
  try {
    const res = await api("POST", `/api/clientes/${id}/observacoes`, { texto });
    if (!res || res.status === 404) {
      mostrarToast("Em breve â€” observaÃ§Ãµes em desenvolvimento.");
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      mostrarToast(j.erro || "Erro ao salvar observaÃ§Ã£o.", null, "error");
      return;
    }
    const updated = await res.json();
    renderObservacoes(updated.observacoes || []);
    if (textoEl) textoEl.value = "";
    const addPanel = document.getElementById("cliente-obs-add");
    if (addPanel) addPanel.style.display = "none";
    const btnToggle = document.getElementById("btn-toggle-obs");
    if (btnToggle) btnToggle.innerHTML = '<i class="bi bi-plus-circle"></i> Adicionar observaÃ§Ã£o';
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
  if (btnToggleObs) { btnToggleObs.style.display = "none"; btnToggleObs.innerHTML = '<i class="bi bi-plus-circle"></i> Adicionar observaÃ§Ã£o'; }
  const obsTexto = document.getElementById("cliente-obs-texto");
  if (obsTexto) obsTexto.value = "";
  const auto = document.getElementById("cliente-auto-recibo");
  if (auto) auto.checked = false;
}

function abrirModalCliente() {
  limparModalCliente();
  document.getElementById("modal-cliente-titulo").textContent = "Cadastrar Cliente";
  document.getElementById("modal-cliente").classList.add("active");
}

// Abre o modal de cadastro prÃ©-preenchido com dados do histÃ³rico de recibos
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
  const autoEl = document.getElementById("cliente-auto-recibo");
  if (autoEl) autoEl.checked = c.auto_recibo === true;
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
    mostrarToast("Preencha Nome, CPF e MunicÃ­pio.", null, "error"); return;
  }
  const _cd=cpf.replace(/\D/g,"");
  if(_cd.length===11&&!validarCPF(cpf)) { marcarInvalido("cliente-cpf"); mostrarToast("CPF invÃ¡lido. Verifique os dÃ­gitos.", null, "error"); return; }
  if(_cd.length===14&&!validarCNPJ(cpf)) { marcarInvalido("cliente-cpf"); mostrarToast("CNPJ invÃ¡lido. Verifique os dÃ­gitos.", null, "error"); return; }
  if(_cd.length!==11&&_cd.length!==14) { marcarInvalido("cliente-cpf"); mostrarToast("CPF deve ter 11 dÃ­gitos ou CNPJ 14 dÃ­gitos.", null, "error"); return; }
  if (valor_contrato <= 0) { marcarInvalido("cliente-valor-contrato"); mostrarToast("Informe o valor total do contrato.", null, "error"); return; }
  if (num_parcelas <= 0)   { marcarInvalido("cliente-num-parcelas");   mostrarToast("Informe o nÃºmero de parcelas.", null, "error"); return; }

  const autoRecibo = document.getElementById("cliente-auto-recibo")?.checked || false;
  const body = { nome, cpf: cpf.replace(/\D/g,""), telefone, endereco, municipio_uf, firma, referencia, valor_beneficio, num_beneficios, valor_contrato, num_parcelas, auto_recibo: autoRecibo };
  const res  = id
    ? await api("PUT",  `/api/clientes/${id}`, body)
    : await api("POST", "/api/clientes", body);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.erro || "Erro ao salvar cliente.", null, "error"); return; }

  fecharModal("modal-cliente");
  mostrarToast(id ? "Cliente atualizado!" : "Cliente cadastrado!");
  // Busca pelo nome recÃ©m-salvo para o usuÃ¡rio vÃª-lo imediatamente
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
    : `Excluir o cliente "${cadastro.nome}"? Esta aÃ§Ã£o nÃ£o pode ser desfeita.`;
  if (!confirm(msg)) return;
  const res = await api("DELETE", `/api/clientes/${id}`);
  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) : {};
    mostrarToast(data.erro || "Erro ao excluir cliente.", null, "error"); return;
  }
  mostrarToast("Cliente excluÃ­do.", null, "success");
  await carregarClientes();
  renderClientes();
}

// â”€â”€ DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function atualizarDashboard(){
  const agora=new Date();
  const mesAtual=String(agora.getMonth()+1).padStart(2,"0");
  const anoSel=document.getElementById("dash-ano")?.value||String(agora.getFullYear());
  const anoAtual=anoSel||String(agora.getFullYear());
  const anoAnterior=String(parseInt(anoAtual)-1);
  const doMes=historicoRecibos.filter(r=>r.data?.split("/")[1]===mesAtual&&r.data?.split("/")[2]===anoAtual);
  const doAno=historicoRecibos.filter(r=>r.data?.split("/")[2]===anoAtual);
  const doAnoAnt=historicoRecibos.filter(r=>r.data?.split("/")[2]===anoAnterior);
  const recorrentes=doMes.filter(r=>r.auto_recibo||r.recorrente);
  const avulsos=doMes.filter(r=>!(r.auto_recibo||r.recorrente));
  const todos=historicoRecibos;
  const soma=arr=>arr.reduce((s,r)=>s+valorParaNumero(r.valor),0);
  document.getElementById("card-mes").textContent="R$ "+formatarValor(soma(doMes));
  document.getElementById("card-mes-qtd").textContent=doMes.length+" recibo"+(doMes.length!==1?"s":"");
  document.getElementById("card-ano").textContent="R$ "+formatarValor(soma(doAno));
  document.getElementById("card-ano-qtd").textContent=doAno.length+" recibos";
  document.getElementById("card-total").textContent="R$ "+formatarValor(soma(todos));
  document.getElementById("card-total-qtd").textContent=todos.length+" recibos";
  document.getElementById("card-ticket").textContent=todos.length?"R$ "+formatarValor(soma(todos)/todos.length):"R$ 0,00";
  // META DO MES
  const metaKey="meta_mes_"+anoAtual+"_"+mesAtual;
  const metaInput=document.getElementById("meta-input");
  const metaSalvar=document.getElementById("meta-salvar");
  const metaProgresso=document.getElementById("meta-progresso");
  const metaTexto=document.getElementById("meta-texto");
  const metaCard=document.getElementById("card-meta");
  let metaAtual=parseFloat(localStorage.getItem(metaKey))||0;
  if(metaInput&&!metaInput.value)metaInput.value=metaAtual||"";
  if(metaSalvar)metaSalvar.onclick=function(){
    var val=parseFloat((metaInput?.value||"").replace(/\./g,"").replace(",","."))||0;
    if(val>0){localStorage.setItem(metaKey,val);metaAtual=val;atualizarDashboard();}
  };
  if(metaAtual>0&&metaProgresso){
    var realizado=soma(doMes),pct=Math.min(100,(realizado/metaAtual)*100),restante=Math.max(0,metaAtual-realizado);
    metaProgresso.innerHTML="<div style=\"width:"+pct+"%;height:100%;background:linear-gradient(90deg,#b8973a,#d4a843);border-radius:6px;transition:width .6s ease\"></div>";
    if(metaTexto)metaTexto.textContent=pct.toFixed(0)+"% \u00b7 R$ "+formatarValor(realizado)+" de R$ "+formatarValor(metaAtual)+(restante>0?" \u00b7 faltam R$ "+formatarValor(restante):"");
    if(metaCard)metaCard.style.display="";
  }else if(metaCard){metaCard.style.display="";if(metaTexto)metaTexto.textContent="Defina uma meta para o mes.";}
  // RECEITA RECORRENTE VS AVULSA
  var somaRec=soma(recorrentes),somaAvu=soma(avulsos),totalMes=soma(doMes),recPct=totalMes>0?(somaRec/totalMes*100):0;
  document.getElementById("card-rec-corrente").textContent="R$ "+formatarValor(somaRec);
  document.getElementById("card-rec-avulsa").textContent="R$ "+formatarValor(somaAvu);
  var barraRec=document.getElementById("barra-rec-corrente");
  if(barraRec)barraRec.innerHTML="<div style=\"width:"+recPct+"%;height:100%;background:linear-gradient(90deg,#059669,#10b981);border-radius:4px\"></div>";
  // VARIACAO
  var mesAnt=agora.getMonth()===0?"12":String(agora.getMonth()).padStart(2,"0");
  var anoAntNum=agora.getMonth()===0?parseInt(anoAtual)-1:parseInt(anoAtual);
  var doMesAnt=historicoRecibos.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mesAnt&&p[2]===String(anoAntNum);});
  var somaAnt=soma(doMesAnt),somaMes=soma(doMes),varPct=somaAnt>0?((somaMes-somaAnt)/somaAnt*100):null;
  var cardVar=document.getElementById("card-variacao");
  var cardVarSub=document.getElementById("card-variacao-sub");
  var kpiCard=document.getElementById("kpi-variacao-card");
  if(varPct===null){cardVar.textContent="\u2014";cardVar.style.color="";}
  else{cardVar.textContent=(varPct>=0?"+":"")+varPct.toFixed(1)+"%";cardVar.style.color=varPct>=0?"var(--success)":"var(--error)";if(kpiCard)kpiCard.style.borderTopColor=varPct>=0?"var(--success)":"var(--error)";}
  if(cardVarSub)cardVarSub.textContent="vs "+mesAnt+"/"+anoAntNum;
  // CRESCIMENTO YOY
  var doMesYoyAnt=historicoRecibos.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mesAtual&&p[2]===anoAnterior;});
  var yoyPct=soma(doMesYoyAnt)>0?((somaMes-soma(doMesYoyAnt))/soma(doMesYoyAnt)*100):null;
  var cardYoy=document.getElementById("card-yoy");
  if(cardYoy){if(yoyPct===null){cardYoy.textContent="\u2014";cardYoy.style.color="";}else{cardYoy.textContent=(yoyPct>=0?"+":"")+yoyPct.toFixed(1)+"%";cardYoy.style.color=yoyPct>=0?"var(--success)":"var(--error)";}}
  // INADIMPLENTES
  var hoje=new Date().toISOString().slice(0,10),em7=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,10);
  var inadimplentes=listaClientes.filter(function(c){return Array.isArray(c.parcelas)&&c.parcelas.some(function(p){return p.status==="atrasado"});}).length;
  var vencendo=0,valorVencendo=0;
  listaClientes.forEach(function(c){(c.parcelas||[]).forEach(function(p){if(p.status!=="pago"&&p.data_vencimento&&p.data_vencimento>=hoje&&p.data_vencimento<=em7){vencendo++;valorVencendo+=p.valor_parcela||0;}});});
  var totalClientes=listaClientes.length||1;
  document.getElementById("card-inadimplentes").textContent=inadimplentes||"0";
  document.getElementById("card-inadimplentes-sub").textContent=(totalClientes>0?(inadimplentes/totalClientes*100).toFixed(1):"0")+"% dos clientes";
  document.getElementById("card-parcelas-vencendo").textContent=vencendo||"0";
  document.getElementById("card-parcelas-vencendo-sub").textContent=vencendo?"R$ "+formatarValor(valorVencendo)+" em recibos":"nenhuma";
  // CLIENTES NOVOS
  var cpfsMesAtual=new Set(doMes.map(function(r){return r.cpf||r.nome;}).filter(Boolean));
  var cpfsAnteriores=new Set(historicoRecibos.filter(function(r){var p=r.data?.split("/");return p&&!(p[1]===mesAtual&&p[2]===anoAtual);}).map(function(r){return r.cpf||r.nome;}).filter(Boolean));
  var novos=0;cpfsMesAtual.forEach(function(k){if(!cpfsAnteriores.has(k))novos++;});
  document.getElementById("card-clientes-novos").textContent=novos||"0";
  // FLUXO DE CAIXA
  var em30=new Date(Date.now()+30*24*60*60*1000).toISOString().slice(0,10);
  var em60=new Date(Date.now()+60*24*60*60*1000).toISOString().slice(0,10);
  var em90=new Date(Date.now()+90*24*60*60*1000).toISOString().slice(0,10);
  var fluxo30=0,fluxo60=0,fluxo90=0;
  listaClientes.forEach(function(c){(c.parcelas||[]).forEach(function(p){if(p.status!=="pago"&&p.data_vencimento){var v=p.valor_parcela||0;if(p.data_vencimento<=em30)fluxo30+=v;if(p.data_vencimento<=em60)fluxo60+=v;if(p.data_vencimento<=em90)fluxo90+=v;}});});
  document.getElementById("fluxo-30").textContent="R$ "+formatarValor(fluxo30);
  document.getElementById("fluxo-60").textContent="R$ "+formatarValor(fluxo60);
  document.getElementById("fluxo-90").textContent="R$ "+formatarValor(fluxo90);
  // TOP 5 CLIENTES
  var rank={};doAno.forEach(function(r){var n=r.cliente||r.nome||"\u2014";rank[n]=(rank[n]||0)+valorParaNumero(r.valor);});
  var top5=Object.entries(rank).sort(function(a,b){return b[1]-a[1];}).slice(0,5);
  var topEl=document.getElementById("top-clientes");
  if(topEl){
    if(!top5.length)topEl.innerHTML="<div style=\"color:var(--muted);font-size:12px;text-align:center;padding:20px\">Nenhum cliente no periodo</div>";
    else topEl.innerHTML=top5.map(function(item,i){
      var nome=item[0],val=item[1];
      var bg=i===0?"var(--gold)":i<3?"var(--success)":"var(--border)";
      var fg=i<3?"white":"var(--muted)";
      return "<div style=\"display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)\"><span style=\"width:18px;height:18px;border-radius:50%;background:"+bg+";color:"+fg+";font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center\">"+(i+1)+"</span><span style=\"flex:1;font-size:12px;font-weight:500\">"+esc(nome)+"</span><span style=\"font-size:12px;font-weight:700;color:var(--success)\">R$ "+formatarValor(val)+"</span></div>";
    }).join("");
  }
  // GRAFICO MENSAL COM YOY
  var mesesLabels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  var totaisMes=Array.from({length:12},function(_,i){var m=String(i+1).padStart(2,"0");return historicoRecibos.filter(function(r){var p=r.data?.split("/");return p&&p[1]===m&&p[2]===anoAtual;}).reduce(function(s,r){return s+valorParaNumero(r.valor);},0);});
  var totaisMesAnt=Array.from({length:12},function(_,i){var m=String(i+1).padStart(2,"0");return historicoRecibos.filter(function(r){var p=r.data?.split("/");return p&&p[1]===m&&p[2]===anoAnterior;}).reduce(function(s,r){return s+valorParaNumero(r.valor);},0);});
  if(graficoMensal){try{graficoMensal.destroy();}catch(e){}graficoMensal=null;}
  requestAnimationFrame(function(){
    try{
      var ctx=document.getElementById("grafico-mensal")?.getContext("2d");
      if(ctx)graficoMensal=new Chart(ctx,{type:"bar",data:{labels:mesesLabels,datasets:[{label:anoAtual,data:totaisMes,backgroundColor:"rgba(184,151,58,0.85)",borderColor:"#b8973a",borderWidth:1,borderRadius:4,order:2},{label:anoAnterior,data:totaisMesAnt,backgroundColor:"rgba(148,163,184,0.4)",borderColor:"#94a3b8",borderWidth:1,borderRadius:4,borderDash:[3,3],order:3}]},options:{responsive:true,plugins:{legend:{position:"top",labels:{boxWidth:12,font:{size:11},color:"var(--muted)"}},tooltip:{callbacks:{label:function(ctx){return ctx.dataset.label+": R$ "+formatarValor(ctx.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return"R$ "+formatarValor(v);}}},x:{grid:{display:false}}}}});
    }catch(e){console.error("Dashboard chart error:",e);}
  });
  // TABELA MENSAL
  var tbody=document.getElementById("tabela-mensal");
  if(tbody){
    tbody.innerHTML=mesesLabels.map(function(m,i){
      var mi=String(i+1).padStart(2,"0");
      var qtd=doAno.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mi;}).length;
      var tot=doAno.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mi;}).reduce(function(s,r){return s+valorParaNumero(r.valor);},0);
      var qtdAnt=doAnoAnt.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mi;}).length;
      var totAnt=doAnoAnt.filter(function(r){var p=r.data?.split("/");return p&&p[1]===mi;}).reduce(function(s,r){return s+valorParaNumero(r.valor);},0);
      if(!qtd&&!qtdAnt)return"";
      var yoy=totAnt>0?((tot-totAnt)/totAnt*100):null;
      var yoyStr=yoy!==null?"<span style=\"color:"+(yoy>=0?"var(--success)":"var(--error)")+";font-size:11px\">"+(yoy>=0?"+":"")+yoy.toFixed(1)+"%</span>":"";
      return"<tr><td>"+m+"</td><td>"+qtd+"</td><td style=\"color:var(--success);font-weight:700\">R$ "+formatarValor(tot)+"</td><td>R$ "+formatarValor(qtd?tot/qtd:0)+"</td><td>"+yoyStr+"</td></tr>";
    }).join("");
  }
}

// â”€â”€ FILTROS AVANÃ‡ADOS HISTÃ“RICO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ POR RESPONSÃVEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function carregarPorResponsavel() {
  const status = document.getElementById("responsaveis-status");
  const wrap   = document.getElementById("responsaveis-wrap");
  if (!status || !wrap) return;
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/por-responsavel");
  if (!res || res.status === 404) { status.textContent = "Em breve â€” relatÃ³rio por responsÃ¡vel em desenvolvimento."; return; }
  if (!res.ok) { status.textContent = "Erro ao carregar relatÃ³rio."; return; }
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

let _inadimplenciaDados = [];

const AGING_BUCKETS = [
  { key: "1_30",    label: "1 a 30 dias",     min: 1,  max: 30, color: "#F59E0B" },
  { key: "31_60",   label: "31 a 60 dias",    min: 31, max: 60, color: "#F97316" },
  { key: "61_90",   label: "61 a 90 dias",    min: 61, max: 90, color: "#EF4444" },
  { key: "90_mais", label: "Mais de 90 dias", min: 91, max: 999, color: "#B91C1C" },
];

async function carregarInadimplencia() {
  const status = document.getElementById("inadimplencia-status");
  const wrap   = document.getElementById("inadimplencia-wrap");
  status.style.display = ""; wrap.style.display = "none";
  status.textContent = "Carregando...";
  const res = await api("GET", "/api/relatorios/inadimplencia");
  if (!res || res.status === 404) {
    status.textContent = "Em breve - relatório de inadimplência em desenvolvimento.";
    return;
  }
  if (!res.ok) { status.textContent = "Erro ao carregar relatório."; return; }
  const body = await res.json();
  const dados = Array.isArray(body) ? body : (body.relatorio || []);
  _inadimplenciaDados = dados;
  if (!dados.length) {
    status.textContent = "Nenhum cliente inadimplente no momento.";
    return;
  }

  const buckets = AGING_BUCKETS.map(b => ({ ...b, clientes: [] }));
  dados.forEach((c, i) => {
    const maiorAtraso = c.parcelas?.reduce((mx, p) => Math.max(mx, p.dias_atraso || 0), 0) || 0;
    c._idx = i;
    c._maiorAtraso = maiorAtraso;
    const bucket = buckets.find(b => maiorAtraso >= b.min && maiorAtraso <= b.max) || buckets[buckets.length - 1];
    bucket.clientes.push(c);
  });

  const totalAberto = dados.reduce((s, c) => s + (c.valor_em_aberto || 0), 0);
  const container = document.getElementById("inadimplencia-aging-container");
  container.innerHTML = buckets.map((bucket, bi) => {
    if (!bucket.clientes.length) return "";
    const bucketTotal = bucket.clientes.reduce((s, c) => s + (c.valor_em_aberto || 0), 0);
    return `
      <div class="aging-section" style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
        <div class="aging-header" data-bucket="${bi}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${bucket.color};color:white;cursor:pointer;font-size:13px;font-weight:600">
          <i class="bi bi-chevron-down" style="transition:transform .2s"></i>
          <span style="flex:1">${bucket.label}</span>
          <span style="font-size:12px;opacity:.9">${bucket.clientes.length} cliente${bucket.clientes.length !== 1 ? "s" : ""}</span>
          <span style="font-size:13px">R$ ${formatarValor(bucketTotal)}</span>
        </div>
        <div class="aging-body" style="display:none">
          <table style="width:100%;font-size:12px">
            <thead><tr>
              <th style="width:32px;padding:6px 8px;text-align:center"><input type="checkbox" class="checkbox-aging-all" data-bucket="${bi}"></th>
              <th style="text-align:left;padding:6px 8px">Cliente</th>
              <th style="text-align:left;padding:6px 8px">CPF/CNPJ</th>
              <th style="text-align:center;padding:6px 8px">Parcelas</th>
              <th style="text-align:right;padding:6px 8px">Valor</th>
              <th style="text-align:center;padding:6px 8px">Maior Atraso</th>
            </tr></thead>
            <tbody>
              ${bucket.clientes.map(c => `
                <tr>
                  <td style="text-align:center;padding:4px 8px"><input type="checkbox" class="checkbox-inadimplencia" data-idx="${c._idx}"></td>
                  <td style="padding:4px 8px">${esc(c.nome)}</td>
                  <td style="padding:4px 8px">${esc(c.cpf || "-")}</td>
                  <td style="text-align:center;padding:4px 8px;color:var(--error);font-weight:600">${c.parcelas_atrasadas || 0}</td>
                  <td style="text-align:right;padding:4px 8px;color:var(--error);font-weight:700">R$ ${formatarValor(c.valor_em_aberto || 0)}</td>
                  <td style="text-align:center;padding:4px 8px">${c._maiorAtraso} dia${c._maiorAtraso !== 1 ? "s" : ""}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".aging-header").forEach(h => {
    h.addEventListener("click", () => {
      const body = h.nextElementSibling;
      const isOpen = body.style.display !== "none";
      body.style.display = isOpen ? "none" : "";
      h.querySelector(".bi-chevron-down").style.transform = isOpen ? "" : "rotate(180deg)";
    });
  });

  container.querySelectorAll(".checkbox-aging-all").forEach(cb => {
    cb.addEventListener("change", function() {
      const section = this.closest(".aging-section");
      section.querySelectorAll(".checkbox-inadimplencia").forEach(c => c.checked = this.checked);
      atualizarSelecaoInadimplencia();
    });
  });

  document.getElementById("inadimplencia-count").textContent = dados.length + " cliente" + (dados.length !== 1 ? "s" : "");
  document.getElementById("inadimplencia-total").textContent = "Total em aberto: R$ " + formatarValor(totalAberto);
  document.getElementById("inadimplencia-selecao-count").textContent = "0 selecionados";
  document.getElementById("btn-whatsapp-lote").disabled = true;
  document.getElementById("selecionar-todos-inadimplencia").checked = false;
  status.style.display = "none"; wrap.style.display = "";
}
function atualizarSelecaoInadimplencia() {
  const checks = document.querySelectorAll(".checkbox-inadimplencia");
  const selecionados = Array.from(checks).filter(c => c.checked).map(c => _inadimplenciaDados[parseInt(c.dataset.idx)]);
  document.getElementById("inadimplencia-selecao-count").textContent = selecionados.length + " selecionados";
  document.getElementById("btn-whatsapp-lote").disabled = selecionados.length === 0;
  return selecionados;
}

function abrirModalWhatsAppLote() {
  const selecionados = atualizarSelecaoInadimplencia();
  if (!selecionados.length) return;
  document.getElementById("whatsapp-lote-info").textContent = `${selecionados.length} cliente(s) selecionado(s)`;
  document.getElementById("whatsapp-lote-lista").innerHTML = selecionados.map(c => {
    const tel = c.telefone || "sem telefone";
    const valor = `R$ ${formatarValor(c.valor_em_aberto || 0)}`;
    return `<tr><td style="padding:4px 8px">${esc(c.nome)}</td><td style="padding:4px 8px">${esc(tel)}</td><td style="padding:4px 8px">${valor}</td></tr>`;
  }).join("");
  document.getElementById("whatsapp-lote-contagem").textContent = `${selecionados.length} cliente(s)`;
  usarMensagemPadraoWhatsApp();
  document.getElementById("modal-whatsapp-lote").classList.add("active");
}

function usarMensagemPadraoWhatsApp() {
  document.getElementById("whatsapp-lote-msg").value = "Ol\u00E1 {nome}, tudo bem? Passando para lembrar que h\u00E1 {parcelas} parcela(s) em aberto no valor total de R$ {valor}. Se puder regularizar, agradecemos! Qualquer d\u00FAvida, estamos \u00E0 disposi\u00E7\u00E3o.";
}

function usarMensagemCobrancaWhatsApp() {
  document.getElementById("whatsapp-lote-msg").value = "Ol\u00E1 {nome}, identificamos que sua(s) parcela(s) est\u00E1(\u00E3o) com {dias} dia(s) de atraso, totalizando R$ {valor} em aberto. Pedimos, por gentileza, que regularize o quanto antes para evitar contratempos. Atenciosamente, Araujo Prev.";
}

function usarMensagemAcordoWhatsApp() {
  document.getElementById("whatsapp-lote-msg").value = "Ol\u00E1 {nome}, tudo bem? Verificamos um saldo de R$ {valor} em aberto. Gostaria de oferecer uma proposta de acordo com condi\u00E7\u00F5es especiais. Podemos conversar? Estamos \u00E0 disposi\u00E7\u00E3o. Araujo Prev.";
}
