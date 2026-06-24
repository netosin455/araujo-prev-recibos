// web/public/app/recibos.js — extracted from app.js
// â”€â”€ GERAR RECIBO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function gerarRecibo(){
  const campos=["nome","cpf","municipio_uf","valor","emitido_por","escritorio"];
  const dados={};
  const vazios=[];
  for(const c of campos){
    const val=document.getElementById(c).value.trim();
    if(!val) vazios.push(c);
    else dados[c]=val;
  }
  if(vazios.length){ marcarInvalido(...vazios); return setStatus("Preencha todos os campos obrigatÃ³rios.","error"); }
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
  if(_dataCheck.getMonth()!==parseInt(mes)-1){ marcarInvalido("dia","mes","ano"); return setStatus("Data invÃ¡lida (ex: 31/02 nÃ£o existe).","error"); }
  dados.data=formatarData();
  dados.data_extenso=dataExtenso();
  dados.nome=dados.nome.toUpperCase();
  dados.municipio_uf=dados.municipio_uf.toUpperCase();
  dados.emitido_por=dados.emitido_por.toUpperCase();
  const _cpfDigits=dados.cpf.replace(/\D/g,"");
  if(_cpfDigits.length===11&&!validarCPF(dados.cpf)){ marcarInvalido("cpf"); return setStatus("CPF invÃ¡lido. Verifique os dÃ­gitos.","error"); }
  if(_cpfDigits.length===14&&!validarCNPJ(dados.cpf)){ marcarInvalido("cpf"); return setStatus("CNPJ invÃ¡lido. Verifique os dÃ­gitos.","error"); }

  const btn=document.getElementById("btn-gerar");
  const btnTextoOriginal = btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='<i class="bi bi-hourglass-split spin"></i> Gerando...';
  setStatus("Gerando recibo...","loading");

  try {
  // Modo ediÃ§Ã£o
  if(modoEdicao && idEdicao){
    // Upload comprovante se selecionado
    let link_comprovante_edicao = "";
    const compInputEdicao = document.getElementById("comprovante");
    if(compInputEdicao && compInputEdicao.files[0]){
      const compStatus = document.getElementById("comprovante-status");
      if(compStatus) compStatus.textContent = "Enviando comprovante...";
      const fd = new FormData();
      fd.append("comprovante", compInputEdicao.files[0]);
      try {
        const _ac1 = new AbortController(); setTimeout(() => _ac1.abort(), 30000);
        const r = await fetch("/api/upload-comprovante", { method:"POST", credentials:"include", body:fd, signal: _ac1.signal });
        const j = await r.json();
        if(j.link){ link_comprovante_edicao = j.link; if(compStatus) compStatus.textContent = "Comprovante enviado!"; }
        else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; mostrarToast(j.erro || "Erro ao enviar comprovante.", null, "error"); }
      } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; mostrarToast("Erro ao enviar comprovante: " + e.message, null, "error"); }
    }
    const bodyEdicao = {
      nome:dados.nome,cpf:dados.cpf.replace(/\D/g,""),municipio_uf:dados.municipio_uf,
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

  // Buscar prÃ³ximo nÃºmero
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
    try {
      const _ac2 = new AbortController(); setTimeout(() => _ac2.abort(), 30000);
      const r = await fetch("/api/upload-comprovante", { method:"POST", credentials:"include", body:fd, signal: _ac2.signal });
      const j = await r.json();
      if(j.link){ link_comprovante = j.link; if(compStatus) compStatus.textContent = "Comprovante enviado!"; }
      else { if(compStatus) compStatus.textContent = j.erro || "Erro ao enviar comprovante."; mostrarToast(j.erro || "Erro ao enviar comprovante.", null, "error"); }
    } catch(e) { if(compStatus) compStatus.textContent = "Erro ao enviar comprovante."; mostrarToast("Erro ao enviar comprovante: " + e.message, null, "error"); }
  }

  // Salvar no banco
  let _reciboGeradoId = null;
  const salvarRes = await api("POST","/api/recibos",{
    num:dados.num_recibo,nome:dados.nome,cpf:dados.cpf.replace(/\D/g,""),
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
      if (!salvarRes.ok) {
        mostrarToast(salvarJson.erro || "Erro ao salvar recibo.", null, "error");
        return;
      }
      _reciboGeradoId = salvarJson.id;
    } catch (e) {
      mostrarToast("Erro ao processar resposta do servidor: " + e.message + ". Recarregue a página.", null, "error");
      console.error("Erro parse resposta /api/recibos:", e);
    }
  } else {
    mostrarToast("Falha ao salvar recibo no banco. Verifique o console.", null, "error");
  }

  // Assinatura digital
  if (_reciboGeradoId && window.innerWidth < 1024 && typeof mostrarTelaAssinatura === "function") {
    try {
      const assDataUrl = await mostrarTelaAssinatura(dados.nome);
      if (assDataUrl) {
        const ok = await salvarAssinatura(_reciboGeradoId, assDataUrl);
        console.log("Assinatura salva:", ok);
      }
    } catch(e) {
      console.error("Erro assinatura:", e);
    }
  } else {
    console.log("Assinatura ignorada desktop");
  }

  await carregarRecibos();
  await atualizarNumRecibo();
  atualizarSugestoesNomes();
  verificarClientesInativos();
  navegarPara("historico");
  setStatus("Recibo gerado com sucesso!","success");
  mostrarToast(`Recibo ${num} gerado! Baixando...`, null, "success");

  // Oferece vinculaÃ§Ã£o com parcela se o recibo foi para um cliente cadastrado
  const emailCliente = (document.getElementById("email-cliente")?.value || "").trim();
  const telCliente = (document.getElementById("tel-cliente")?.value || "").trim();
  _lastReciboGerado = { nome: dados.nome, num, valor: dados.valor, data: dados.data, cpf: dados.cpf, emitido_por: dados.emitido_por, email: emailCliente, tel: telCliente };
  const ctx = _clienteContexto;
  limparCampos();
  btn.disabled=false; btn.innerHTML=btnTextoOriginal;
  if (emailCliente) {
    const areaEmail = document.getElementById("area-enviar-email");
    if (areaEmail) areaEmail.style.display = "";
    const statusEmail = document.getElementById("email-envio-status");
    if (statusEmail) statusEmail.textContent = `Enviar para: ${emailCliente}`;
  }
  const telsDigits = telCliente.replace(/\D/g, "");
  if (telsDigits.length >= 10) {
    const areaWpp = document.getElementById("area-enviar-whatsapp");
    if (areaWpp) areaWpp.style.display = "";
    const statusWpp = document.getElementById("whatsapp-envio-status");
    if (statusWpp) statusWpp.textContent = `Enviar para: ${telCliente}`;
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
      if (statusEl) statusEl.textContent = "Em breve â€” envio por e-mail em desenvolvimento.";
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

function enviarWhatsAppRecibo() {
  if (!_lastReciboGerado) return;
  const tel = _lastReciboGerado.tel || "";
  const digits = tel.replace(/\D/g, "");
  if (digits.length < 10) return;
  const msg = `Ol\xE1 ${_lastReciboGerado.nome}, tudo bem? Segue o recibo n\xBA ${_lastReciboGerado.num} no valor de R$ ${_lastReciboGerado.valor}, gerado em ${_lastReciboGerado.data}. Qualquer d\xFAvida, estamos \xE0 disposi\xE7\xE3o. Att, Araujo Prev.`;
  const url = `https://wa.me/55${digits}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank", "noopener");
  const statusEl = document.getElementById("whatsapp-envio-status");
  if (statusEl) { statusEl.style.color = "var(--success)"; statusEl.textContent = "WhatsApp enviado!"; }
}

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
    html += recibos.map(r => `<div class="global-dropdown-item" data-type="recibo" data-id="${esc(r.id||r._id)}"><strong>${esc(r.num)}</strong> â€” ${esc(r.nome)} <span>R$ ${esc(r.valor)}</span></div>`).join("");
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

// ---- FILTROS SALVOS ------------------------------------------------
function salvarFiltroAtual() {
  const nome = prompt("Nome para este filtro:");
  if (!nome || !nome.trim()) return;
  const filtro = {
    nome: nome.trim(),
    busca: document.getElementById("busca-historico")?.value || "",
    dataIni: document.getElementById("filtro-data-ini")?.value || "",
    dataFim: document.getElementById("filtro-data-fim")?.value || "",
    escritorio: document.getElementById("filtro-avancado-escritorio")?.value || "",
    forma: document.getElementById("filtro-avancado-forma")?.value || "",
    responsavel: document.getElementById("filtro-avancado-responsavel")?.value || "",
    min: document.getElementById("filtro-avancado-min")?.value || "",
    max: document.getElementById("filtro-avancado-max")?.value || ""
  };
  let salvos = JSON.parse(localStorage.getItem("filtrosSalvos") || "[]");
  salvos.push(filtro);
  localStorage.setItem("filtrosSalvos", JSON.stringify(salvos));
  preencherFiltrosSalvos();
  mostrarToast(`Filtro "${filtro.nome}" salvo!`, null, "success");
}

function carregarFiltroSalvo(id) {
  const salvos = JSON.parse(localStorage.getItem("filtrosSalvos") || "[]");
  const filtro = salvos[id];
  if (!filtro) return;
  document.getElementById("busca-historico").value = filtro.busca || "";
  document.getElementById("filtro-data-ini").value = filtro.dataIni || "";
  document.getElementById("filtro-data-fim").value = filtro.dataFim || "";
  document.getElementById("filtro-avancado-escritorio").value = filtro.escritorio || "";
  document.getElementById("filtro-avancado-forma").value = filtro.forma || "";
  document.getElementById("filtro-avancado-responsavel").value = filtro.responsavel || "";
  document.getElementById("filtro-avancado-min").value = filtro.min || "";
  document.getElementById("filtro-avancado-max").value = filtro.max || "";
  renderHistorico();
}

function deletarFiltroSalvo(id) {
  let salvos = JSON.parse(localStorage.getItem("filtrosSalvos") || "[]");
  if (!salvos[id]) return;
  if (!confirm(`Excluir filtro "${salvos[id].nome}"?`)) return;
  salvos.splice(id, 1);
  localStorage.setItem("filtrosSalvos", JSON.stringify(salvos));
  preencherFiltrosSalvos();
}

function preencherFiltrosSalvos() {
  const sel = document.getElementById("filtros-salvos-select");
  if (!sel) return;
  const salvos = JSON.parse(localStorage.getItem("filtrosSalvos") || "[]");
  sel.innerHTML = '<option value="">Filtros salvos...</option>' + salvos.map((f, i) => `<option value="${i}">${esc(f.nome)}</option>`).join("");
  const btnDel = document.getElementById("btn-deletar-filtro-salvo");
  if (btnDel) btnDel.style.display = salvos.length ? "" : "none";
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
    resumoHist.textContent = `${historicoRecibos.length} recibo${historicoRecibos.length !== 1 ? "s" : ""} Â· R$ ${formatarValor(totalGeral)} total`;
    resumoHist.style.display = "";
  }
  if(!lista.length){
    grid.innerHTML=`<div class="empty-state"><i class="bi bi-file-earmark empty-state-icon"></i><p>${busca?"Nenhum recibo encontrado.":"Nenhum recibo gerado ainda."}</p><span>${busca?"Tente ajustar sua busca.":"Os recibos aparecer\u00E3o aqui ap\u00F3s serem gerados."}</span></div>`;
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
        <div class="recibo-meta">${esc(recibo.data)} Â· ${esc(recibo.municipio_uf)} Â· ${esc(recibo.emitido_por||"N/A")}${recibo.referencia?" Â· Ref: "+esc(recibo.referencia):""}</div>
      </div>
      <div class="recibo-actions">
        <button class="btn-secondary btn-sm" data-action="detalhe">Detalhes</button>
        <button class="btn-gold btn-sm" data-action="ver"><i class="bi bi-eye"></i> Ver</button>
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="editar">Editar</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="duplicar">Duplicar</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-secondary btn-sm" data-action="recorrente"><i class="bi bi-arrow-repeat"></i> Recorrente</button>`:""}
        <button class="btn-secondary btn-sm" data-action="reimprimir"><i class="bi bi-download"></i> Baixar</button>
        ${roleLogado==="recepcao"?`<button class="btn-secondary btn-sm" data-action="upload-comp"><i class="bi bi-paperclip"></i> Comprovante</button>`:""}
        ${roleLogado!=="recepcao"?`<button class="btn-danger btn-sm" data-action="excluir"><i class="bi bi-trash"></i></button>`:""}
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
  mostrarToast(_selecionadosZip.size + " recibo(s) excluÃ­dos.", null, "success");
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
      mostrarToast("Em breve â€” exportaÃ§Ã£o ZIP em desenvolvimento.", null, "error"); return;
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
  const ML=20, MR=20, LW=W-ML-MR;
  let y=20;

  // Tenta carregar logo
  let logoData = null;
  try {
    const lr = await fetch("/logo.png");
    if (lr.ok) {
      const lb = await lr.blob();
      logoData = await new Promise(res => { const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(lb); });
    }
  } catch(e) {}

  if (logoData) {
    doc.addImage(logoData, "PNG", W/2-80, y, 160, 61);
    y += 76;
  }

  // "A ARAUJO SERVIÇOS LTDA ME" azul escuro bold
  doc.setTextColor(30,64,175);
  doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.text("A ARAUJO SERVIÇOS LTDA ME",W/2,y,{align:"center"});
  y += 6;

  // "A ARAUJO PREV"
  doc.setTextColor(0,0,0);
  doc.setFontSize(12); doc.setFont("helvetica","bold");
  doc.text("A ARAUJO PREV",W/2,y,{align:"center"});
  y += 8;

  // Linha horizontal
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
  doc.line(ML, y, W-MR, y);
  y += 7;

  // Recibo Nº
  doc.setFontSize(12); doc.setFont("helvetica","bold"); doc.setTextColor(0,0,0);
  const numRef=r.referencia?`Recibo Nº ${r.num}   |   Ref: ${r.referencia}`:`Recibo Nº ${r.num}`;
  doc.text(numRef,W/2,y,{align:"center"});
  y += 6;

  // RECIBO DE HONORÁRIOS ADVOCATÍCIOS
  doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS",W/2,y,{align:"center"});
  y += 10;

  // Corpo do texto
  const digits=(r.cpf||"").replace(/\D/g,"");
  const labelDoc=digits.length>11?"CNPJ":"CPF";
  const compl=r.complemento?` - ${r.complemento}`:"";
  const corpo=`Recebemos do (a) senhor (a) ${r.nome}, residente e domiciliado(a) no Município de ${r.municipio_uf}, a importância de R$ ${r.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${compl}.`;
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  const linhas=doc.splitTextToSize(corpo,LW);
  doc.text(linhas,ML,y);
  y += linhas.length*5.5 + 4;

  // "Por ser verdade..."
  doc.text("Por ser verdade, firmo o presente que segue datado e assinado.",ML,y);
  y += 8;

  // Linha horizontal
  doc.line(ML, y, W-MR, y);
  y += 8;

  // Data por extenso
  const meses=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const [dia,mes,ano]=(r.data||"").split("/");
  const data_extenso=`${parseInt(dia)} de ${meses[parseInt(mes)-1]} de ${ano}`;
  doc.text(`${r.municipio_uf}, ${data_extenso}`,ML,y);
  // Espaço generoso pra centralizar a assinatura do cliente na folha
  y += 55;

  // Assinatura digital (imagem)
  const assinatura = r.assinatura_govbr;
  if (assinatura && assinatura.imagem) {
    try {
      doc.addImage(assinatura.imagem, "PNG", W/2-80, y-2, 160, 40);
      y += 42;
    } catch(e) {}
  }

  // Linha de assinatura do cliente — centralizada
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
  doc.line(ML+30, y, W-ML-30, y);
  y += 5;
  doc.setFontSize(10); doc.setFont("helvetica","bold");
  doc.text(r.nome,W/2,y,{align:"center"});
  y += 5;
  doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`${labelDoc}: ${r.cpf}`,W/2,y,{align:"center"});
  // Espaço pro final da página
  y += 45;

  // Linha de assinatura do responsável — esquerda no final
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
  doc.line(ML, y, ML+60, y);
  y += 5;
  doc.setFontSize(10); doc.setFont("helvetica","normal");
  doc.text(r.emitido_por||"A ARAUJO PREV",ML,y);
  y += 12;

  // Logo no rodapé
  if (logoData) {
    doc.addImage(logoData, "PNG", W/2-70, y, 140, 53);
  }

  if (print) doc.autoPrint();
  const blob=doc.output("blob");
  const url=URL.createObjectURL(blob);
  window.open(url,"_blank");
}

async function reimprimirRecibo(r){
  setStatus("Gerando documento...","loading");
  const meses=["janeiro","fevereiro","marÃ§o","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const [dia,mes,ano]=(r.data||"").split("/");
  const data_extenso=`${parseInt(dia)} de ${meses[parseInt(mes)-1]} de ${ano}`;
  const res=await api("POST","/api/gerar-recibo",{
    num_recibo:r.num,nome:r.nome,cpf:r.cpf,municipio_uf:r.municipio_uf,
    valor:r.valor,data:r.data,data_extenso,emitido_por:r.emitido_por||"",
    complemento:r.complemento||"",referencia:r.referencia||"",
    assinatura: r.assinatura_govbr?.imagem || ""
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
    <div class="detail-row"><div class="detail-label">NÂº Recibo</div><div class="detail-value"><span class="badge badge-gold">${esc(r.num)}</span></div></div>
    <div class="detail-row"><div class="detail-label">Cliente</div><div class="detail-value" style="font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:700">${esc(r.nome)}</div></div>
    <div class="detail-row"><div class="detail-label">CPF/CNPJ</div><div class="detail-value">${esc(r.cpf||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">MunicÃ­pio/UF</div><div class="detail-value">${esc(r.municipio_uf||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Valor</div><div class="detail-value" style="color:var(--success);font-weight:700;font-size:15px">R$ ${esc(r.valor)}</div></div>
    <div class="detail-row"><div class="detail-label">Data</div><div class="detail-value">${esc(r.data)}</div></div>
    <div class="detail-row"><div class="detail-label">ResponsÃ¡vel</div><div class="detail-value">${esc(r.emitido_por||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Complemento</div><div class="detail-value">${esc(r.complemento||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">ReferÃªncia</div><div class="detail-value">${esc(r.referencia||"-")}</div></div>
    <div class="detail-row"><div class="detail-label">Comprovante</div><div class="detail-value">${r.link_comprovante ? `<button class="btn-gold btn-sm" id="btn-ver-comprovante-modal"><i class="bi bi-paperclip"></i> Ver comprovante</button>` : `<span style="color:var(--muted);font-size:13px;font-style:italic">Nenhum comprovante adicionado</span>`}</div></div>
    ${r.assinatura_govbr ? `<div class="detail-row"><div class="detail-label">Assinatura</div><div class="detail-value" style="color:var(--success)"><i class="bi bi-shield-check"></i> Assinado por ${esc(r.assinatura_govbr.nome_assinante)} em ${esc(r.assinatura_govbr.assinado_em)}${r.assinatura_govbr.imagem ? `<br><img src="${r.assinatura_govbr.imagem}" style="max-width:180px;max-height:50px;margin-top:6px;border:1px solid var(--border);border-radius:4px;background:#fff">` : ""}</div></div>` : ""}
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-gold" id="btn-ver-modal"><i class="bi bi-eye"></i> Ver PDF</button>
      <button class="btn-secondary" id="btn-imprimir-modal"><i class="bi bi-printer"></i> Imprimir</button>
      <button class="btn-primary" id="btn-reimprimir-modal"><i class="bi bi-download"></i> Baixar .docx</button>
      ${!r.assinatura_govbr?.imagem && window.innerWidth < 1024 ? `<button class="btn-gold" id="btn-assinar-canvas-modal"><i class="bi bi-pen"></i> Assinar Agora</button>` : ""}
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
  // BotÃ£o de assinatura canvas â€” mobile e desktop
  const btnAssinarCanvas = document.getElementById("btn-assinar-canvas-modal");
  if(btnAssinarCanvas) {
    btnAssinarCanvas.onclick = async () => {
      fecharModal("modal-detalhe");
      const assDataUrl = await mostrarTelaAssinatura(r.nome);
      if (assDataUrl) {
        const ok = await salvarAssinatura(r._id || r.id, assDataUrl);
        if (ok) {
          mostrarToast("Recibo assinado com sucesso!");
          carregarRecibos();
        } else {
          mostrarToast("Erro ao salvar assinatura.", null, "error");
        }
      }
    };
  }
  if (Array.isArray(r.historico_edicoes) && r.historico_edicoes.length > 0) {
    const rows = r.historico_edicoes.map(h => {
      const campos = h.campos_alterados
        ? Object.entries(h.campos_alterados).map(([k,v]) => `<span style="color:var(--muted)">${esc(k)}</span>: ${esc(String(v))}`).join(" Â· ")
        : "-";
      return `<div style="font-size:12px;padding:6px 0;border-top:1px solid var(--border)">${esc(h.data||"")} â€” <strong>${esc(h.editado_por||"")}</strong> â€” ${campos}</div>`;
    }).join("");
    document.getElementById("modal-detalhe-body").innerHTML += `
      <div style="margin-top:20px;border-top:2px solid var(--border);padding-top:14px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px"><i class="bi bi-clock-history"></i> HistÃ³rico de EdiÃ§Ãµes</div>
        ${rows}
      </div>`;
  }
  document.getElementById("modal-detalhe").classList.add("active");
}

