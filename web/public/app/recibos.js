// web/public/app/recibos.js — extracted from app.js
// â”€â”€ GERAR RECIBO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _campoPreviaRecibo(id) {
  return (document.getElementById(id)?.value || "").trim();
}

function abrirPreviaRecibo() {
  const valor = _campoPreviaRecibo("valor");
  const valorNumero = valorParaNumero(valor);
  const dia = _campoPreviaRecibo("dia").padStart(2, "0");
  const mes = _campoPreviaRecibo("mes");
  const ano = _campoPreviaRecibo("ano");
  const data = dia && mes && ano ? `${dia}/${mes}/${ano}` : "Preencha a data";
  const nome = _campoPreviaRecibo("nome") || "Nome do cliente";
  const municipio = _campoPreviaRecibo("municipio_uf") || "Município / UF";
  const cpf = _campoPreviaRecibo("cpf") || "CPF / CNPJ";
  const emitidoPor = _campoPreviaRecibo("emitido_por") || "Responsável pela emissão";
  const detalhes = [
    _campoPreviaRecibo("motivo_pagamento"),
    _campoPreviaRecibo("forma_pagamento"),
    _campoPreviaRecibo("referencia") && `Ref. ${_campoPreviaRecibo("referencia").toUpperCase()}`,
  ].filter(Boolean).join(" · ") || "Detalhes do pagamento";
  const complemento = _campoPreviaRecibo("complemento");
  const conteudo = document.getElementById("modal-previa-recibo-body");
  if (!conteudo) return;

  conteudo.innerHTML = `
    <article class="recibo-previa" aria-label="Prévia do recibo">
      <div class="recibo-previa-faixa"><span>ARAUJO PREV</span><span>CONFERÊNCIA ANTES DE GERAR</span></div>
      <div class="recibo-previa-corpo">
        <p class="recibo-previa-tipo">RECIBO</p>
        <p class="recibo-previa-valor">${valorNumero > 0 ? `R$ ${formatarValor(valorNumero)}` : "R$ —"}</p>
        <p class="recibo-previa-texto">Recebi de <strong>${esc(nome.toUpperCase())}</strong>, inscrito(a) sob <strong>${esc(cpf)}</strong>, o valor acima referente a <strong>${esc(detalhes)}</strong>.</p>
        ${complemento ? `<p class="recibo-previa-complemento">${esc(complemento)}</p>` : ""}
        <div class="recibo-previa-linha"></div>
        <div class="recibo-previa-assinatura">
          <span>${esc(municipio.toUpperCase())}, ${esc(data)}</span>
          <strong>${esc(emitidoPor.toUpperCase())}</strong>
          <small>Emitido por</small>
        </div>
      </div>
    </article>
    <p class="recibo-previa-aviso"><i class="bi bi-info-circle"></i> Esta é uma conferência visual. Nenhum recibo foi criado ainda.</p>`;
  document.getElementById("modal-previa-recibo")?.classList.add("active");
}

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
        const r = await Promise.race([
          fetch("/api/upload-comprovante", { method:"POST", credentials:"include", body:fd }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout upload comprovante")), 30000))
        ]);
        const ct = r.headers.get("content-type") || "";
        if(!ct.includes("application/json") && !ct.includes("text/json")){
          const txt = await r.text();
          throw new Error("Servidor retornou " + r.status + " (" + txt.slice(0,60) + "...)");
        }
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

  // O NÚMERO é reservado atomicamente pelo SERVIDOR ao gerar (à prova de corrida).
  // Não calculamos mais o número no navegador — pedimos a reserva e lemos a
  // resposta (header X-Recibo-Num) pra usar no nome do arquivo e ao salvar.
  dados.reservar_numero = true;
  let num = "";

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

  // Número que o servidor reservou de fato — sempre bate com o impresso no doc.
  num = res.headers.get("X-Recibo-Num") || dados.num_recibo || "";
  dados.num_recibo = num;

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
      const r = await Promise.race([
        fetch("/api/upload-comprovante", { method:"POST", credentials:"include", body:fd }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout upload comprovante")), 30000))
      ]);
      const ct = r.headers.get("content-type") || "";
      if(!ct.includes("application/json") && !ct.includes("text/json")){
        const txt = await r.text();
        throw new Error("Servidor retornou " + r.status + " (" + txt.slice(0,60) + "...)");
      }
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
      const ass = await mostrarTelaAssinatura(dados);
      if (ass) {
        const ok = await salvarAssinatura(_reciboGeradoId, ass.imagem, ass.nome_confirmado);
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

// Gera o link de assinatura remota e oferece WhatsApp + copiar.
async function enviarLinkAssinatura(recibo) {
  const rid = recibo.id || recibo._id;
  const res = await api("POST", `/api/recibos/${rid}/link-assinatura`);
  if (!res || !res.ok) {
    let msg = "Não foi possível gerar o link de assinatura.";
    if (res) { try { const d = await res.json(); if (d.erro) msg = d.erro; } catch (_) {} }
    mostrarToast(msg, null, "error");
    return;
  }
  const { url } = await res.json();
  // Copia o link para a área de transferência
  try { await navigator.clipboard.writeText(url); mostrarToast("Link de assinatura copiado!"); }
  catch (_) { mostrarToast("Link gerado. Copie no console se necessário."); console.log("Link de assinatura:", url); }
  // Se o cliente tiver telefone cadastrado, abre o WhatsApp já com a mensagem
  const cpfDigits = (recibo.cpf || "").replace(/\D/g, "");
  const cli = (typeof listaClientes !== "undefined")
    ? listaClientes.find(c => (c.cpf || "").replace(/\D/g, "") === cpfDigits) : null;
  const telDigits = (cli && cli.telefone ? cli.telefone : "").replace(/\D/g, "");
  if (telDigits.length >= 10) {
    const msg = `Olá ${recibo.nome}, para assinar seu recibo nº ${recibo.num} (R$ ${recibo.valor}), acesse o link: ${url}`;
    window.open(`https://wa.me/55${telDigits}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  } else {
    mostrarToast("Link copiado! Cole no WhatsApp do cliente.", null, "success");
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

// ── ATUALIZAÇÃO AUTOMÁTICA DO HISTÓRICO ────────────────────
// Enquanto a tela de histórico estiver aberta, revê os recibos a cada 20s e
// ao voltar o foco à aba (ex.: depois de enviar o link no WhatsApp).
// Só re-renderiza quando algo muda (status de assinatura ou nº de recibos),
// pra não atrapalhar quem está mexendo na tela.
let _atualizandoHistorico = false;

function _snapshotAssinaturas() {
  const assinados = historicoRecibos.filter(r => r.assinatura_govbr).map(r => r.id || r._id).sort().join(",");
  return assinados + "|" + historicoRecibos.length;
}

async function atualizarHistoricoAuto() {
  const tela = document.getElementById("screen-historico");
  if (!tela || !tela.classList.contains("active")) return;
  if (document.hidden || _atualizandoHistorico) return;
  _atualizandoHistorico = true;
  try {
    const antes = _snapshotAssinaturas();
    const assinadosAntes = antes.split("|")[0].split(",").filter(Boolean).length;
    await carregarRecibos();
    const depois = _snapshotAssinaturas();
    if (antes !== depois) {
      const assinadosDepois = depois.split("|")[0].split(",").filter(Boolean).length;
      renderHistorico(true); // preserva a paginação atual
      const novos = assinadosDepois - assinadosAntes;
      if (novos > 0) mostrarToast(novos === 1 ? "1 recibo foi assinado!" : `${novos} recibos foram assinados!`, null, "success");
    }
  } catch (e) {
    console.error("atualizarHistoricoAuto:", e);
  } finally {
    _atualizandoHistorico = false;
  }
}

setInterval(atualizarHistoricoAuto, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizarHistoricoAuto(); });
window.addEventListener("focus", atualizarHistoricoAuto);

let _listaFiltradaHistorico = [];

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
  _listaFiltradaHistorico = lista;
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
  // A seleção sobrevive a re-renders ("Carregar mais", auto-refresh, filtros) —
  // só descarta ids que não existem mais no histórico (ex.: recibo excluído)
  const idsExistentes = new Set(historicoRecibos.map(r => String(r.id || r._id)));
  for (const id of [..._selecionadosExport]) if (!idsExistentes.has(id)) _selecionadosExport.delete(id);
  atualizarBarraBatch();
  grid.innerHTML="";
  const listaVis = lista.slice(0, _historicoVisiveis);
  listaVis.forEach(recibo=>{
    const rid = recibo.id || recibo._id;
    const assinado = !!recibo.assinatura_govbr;
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
        ${assinado
          ? `<span style="display:inline-block;margin-top:5px;font-size:10px;font-weight:700;color:var(--success);background:rgba(61,122,94,.12);padding:2px 9px;border-radius:10px"><i class="bi bi-check-circle-fill"></i> Assinado</span>`
          : `<span style="display:inline-block;margin-top:5px;font-size:10px;font-weight:700;color:var(--muted);background:rgba(133,127,115,.12);padding:2px 9px;border-radius:10px"><i class="bi bi-clock"></i> Assinatura pendente</span>`}
      </div>
      <div class="recibo-actions">
        <button class="btn-secondary btn-sm" data-action="detalhe">Detalhes</button>
        <button class="btn-gold btn-sm" data-action="ver"><i class="bi bi-eye"></i> Ver</button>
        ${roleLogado!=="recepcao" && !assinado?`<button class="btn-secondary btn-sm" data-action="enviar-assinatura"><i class="bi bi-pen"></i> Enviar p/ assinar</button>`:""}
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
        if(btn.dataset.action==="enviar-assinatura") enviarLinkAssinatura(recibo);
        if(btn.dataset.action==="upload-comp") abrirModalUploadComprovante(recibo.id||recibo._id);
        if(btn.dataset.action==="excluir"){
          if(!confirm(`Excluir recibo ${recibo.num}?`)) return;
          await api("DELETE",`/api/recibos/${rid}`);
          await carregarRecibos();
          renderHistorico();
          mostrarToast(`Recibo ${recibo.num} excluído.`, () => desfazerExclusaoRecibos([rid]), "success", "Desfazer");
        }
      });
    });
    const chk = item.querySelector(".recibo-check");
    if (chk) {
      chk.checked = _selecionadosExport.has(String(rid));
      chk.addEventListener("change", () => {
        if (chk.checked) _selecionadosExport.add(chk.dataset.id);
        else _selecionadosExport.delete(chk.dataset.id);
        atualizarBarraBatch();
      });
    }
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
  const label = document.getElementById("batch-count-label");
  const count = _selecionadosExport.size;
  if (label) label.textContent = count + " selecionado(s)";
  const btnZip = document.getElementById("btn-exportar-zip");
  const btnXls = document.getElementById("btn-exportar-excel-sel");
  // não sobrescreve o rótulo enquanto o ZIP está sendo gerado ("Gerando...")
  if (btnZip && !btnZip.innerHTML.includes("hourglass")) btnZip.innerHTML = `<i class="bi bi-file-zip"></i> ZIP${count ? ` (${count})` : ""}`;
  if (btnXls) btnXls.innerHTML = `<i class="bi bi-file-earmark-spreadsheet"></i> Excel${count ? ` (${count})` : ""}`;
  ["btn-exportar-zip", "btn-exportar-excel-sel", "btn-batch-email", "btn-batch-delete"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = count === 0;
  });
  // Badge no sidebar — mostra a seleção mesmo navegando em outra tela
  const badgeSel = document.getElementById("badge-recibos-sel");
  if (badgeSel) {
    badgeSel.textContent = count;
    badgeSel.style.display = count > 0 ? "" : "none";
  }
}

// Marca/desmarca os checkboxes visíveis conforme o estado atual da seleção
function _sincronizarChecksVisiveis() {
  document.querySelectorAll(".recibo-check").forEach(c => { c.checked = _selecionadosExport.has(c.dataset.id); });
}

function selecionarTodosRecibos() {
  const chks = document.querySelectorAll(".recibo-check");
  const someUnchecked = Array.from(chks).some(c => !c.checked);
  chks.forEach(c => {
    c.checked = someUnchecked;
    if (someUnchecked) _selecionadosExport.add(c.dataset.id);
    else _selecionadosExport.delete(c.dataset.id);
  });
  atualizarBarraBatch();
}

// Seleção rápida: visíveis | todos os filtrados | deste mês | limpar
function selecionarPorCriterio(criterio) {
  if (!criterio) return;
  if (criterio === "visiveis") { selecionarTodosRecibos(); return; }
  if (criterio === "limpar") {
    _selecionadosExport.clear();
  } else {
    let alvo = _listaFiltradaHistorico;
    if (criterio === "mes") {
      const agora = new Date();
      const mes = String(agora.getMonth() + 1).padStart(2, "0");
      const ano = String(agora.getFullYear());
      alvo = alvo.filter(r => { const p = (r.data || "").split("/"); return p[1] === mes && p[2] === ano; });
    }
    if (!alvo.length) { mostrarToast("Nenhum recibo corresponde a esse critério.", null, "error"); return; }
    alvo.forEach(r => _selecionadosExport.add(String(r.id || r._id)));
  }
  _sincronizarChecksVisiveis();
  atualizarBarraBatch();
}

async function excluirSelecionados() {
  const total = _selecionadosExport.size;
  if (total === 0) return;
  if (!confirm("Excluir " + total + " recibo(s)? (dá pra desfazer em até 15 min)")) return;
  const idsExcluidos = [..._selecionadosExport];
  for (const id of idsExcluidos) {
    await api("DELETE", "/api/recibos/" + id);
  }
  _selecionadosExport.clear();
  await carregarRecibos();
  renderHistorico();
  mostrarToast(total + " recibo(s) excluídos.", () => desfazerExclusaoRecibos(idsExcluidos), "success", "Desfazer");
}

// Desfaz exclusões recentes (janela de 15 min no backend) — alimenta o toast "Desfazer"
async function desfazerExclusaoRecibos(ids) {
  let ok = 0, falhas = 0;
  for (const id of ids) {
    const res = await api("POST", `/api/recibos/${id}/desfazer-exclusao`);
    if (res && res.ok) ok++; else falhas++;
  }
  await carregarRecibos();
  renderHistorico();
  if (falhas === 0) mostrarToast(ok === 1 ? "Exclusão desfeita!" : `${ok} recibo(s) restaurados!`, null, "success");
  else mostrarToast(`${ok} restaurado(s), ${falhas} falha(s) — veja a Lixeira com o admin.`, null, "error");
}

// Excel consolidado dos selecionados — gerado no cliente com a lib XLSX local
async function exportarExcelSelecionados() {
  if (_selecionadosExport.size === 0) return;
  await garantirXLSX();
  const sel = historicoRecibos.filter(r => _selecionadosExport.has(String(r.id || r._id)));
  if (!sel.length) { mostrarToast("Nenhum recibo selecionado.", null, "error"); return; }
  const linhas = sel.map(r => ({
    "Nº Recibo": r.num, "Cliente": r.nome, "CPF/CNPJ": r.cpf, "Município": r.municipio_uf,
    "Valor": "R$ " + r.valor, "Data": r.data, "Forma de Pagamento": r.forma_pagamento || "",
    "Escritório": r.escritorio || "", "Responsável": r.emitido_por || "", "Referência": r.referencia || "",
  }));
  const total = sel.reduce((s, r) => s + valorParaNumero(r.valor), 0);
  linhas.push({
    "Nº Recibo": "", "Cliente": "TOTAL", "CPF/CNPJ": "", "Município": "",
    "Valor": "R$ " + formatarValor(total), "Data": "", "Forma de Pagamento": "",
    "Escritório": "", "Responsável": "", "Referência": `${sel.length} recibo(s)`,
  });
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recibos Selecionados");
  XLSX.writeFile(wb, `recibos_selecionados_${new Date().toISOString().slice(0, 10)}.xlsx`);
  mostrarToast(`${sel.length} recibo(s) exportado(s) para Excel!`, null, "success");
}

async function batchEnviarEmail() {
  if (_selecionadosExport.size === 0) return;
  const ids = [..._selecionadosExport];
  const res = await api("POST", "/api/recibos/batch-email", { ids });
  if (!res || !res.ok) { mostrarToast("Erro ao enviar e-mails.", null, "error"); return; }
  const data = await res.json();
  mostrarToast(data.mensagem || "E-mails enviados.", null, "success");
}

async function exportarZipSelecionados() {
  if (_selecionadosExport.size === 0) return;
  if (_selecionadosExport.size > 100) {
    mostrarToast("Máximo de 100 recibos por ZIP. Refine a seleção.", null, "error");
    return;
  }
  const btn = document.getElementById("btn-exportar-zip");
  const orig = btn.innerHTML;
  const total = _selecionadosExport.size;
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Gerando...';
  try {
    const res = await api("POST", "/api/recibos/exportar-zip", { ids: [..._selecionadosExport] });
    if (!res || res.status === 404) { mostrarToast("Exportação indisponível no momento.", null, "error"); return; }
    if (!res.ok && res.status !== 202) { mostrarToast("Erro ao iniciar a exportação.", null, "error"); return; }

    // Fallback (fila não configurada): o servidor devolveu o ZIP direto.
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/zip")) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `recibos_${new Date().toISOString().slice(0,10)}.zip`; a.click();
      URL.revokeObjectURL(url);
      mostrarToast(`${total} recibo(s) exportado(s)!`, null, "success");
      return;
    }

    // Caminho assíncrono: recebe um jobId e acompanha o progresso.
    const data = await res.json();
    const jobId = data && data.jobId;
    if (!jobId) { mostrarToast("Erro ao iniciar a exportação.", null, "error"); return; }
    mostrarToast("Gerando o ZIP em segundo plano…", null, "success");

    const inicio = Date.now();
    while (Date.now() - inicio < 5 * 60 * 1000) { // até 5 min
      await new Promise(r => setTimeout(r, 3000));
      const st = await api("GET", `/api/recibos/exportar-zip/status/${jobId}`);
      if (!st || !st.ok) continue;
      const j = await st.json();
      btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Gerando ${j.prontos || 0}/${j.total || total}...`;
      if (j.status === "pronto" && j.url) {
        const a = document.createElement("a"); a.href = j.url; a.target = "_blank"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        mostrarToast("ZIP pronto! O download começou.", null, "success");
        return;
      }
      if (j.status === "erro") { mostrarToast("Falha ao gerar o ZIP: " + (j.erro || ""), null, "error"); return; }
    }
    mostrarToast("A exportação está demorando mais que o normal. Tente de novo em instantes.", null, "error");
  } catch (e) {
    console.error("exportarZip:", e);
    mostrarToast("Erro na exportação.", null, "error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function abrirPDFRecibo(r, print=false){
  try {
    await _gerarPDFRecibo(r, print);
  } catch(e) {
    console.error("Erro ao gerar/abrir PDF do recibo:", e);
    mostrarToast("Não foi possível abrir o recibo. Tente novamente.", null, "error");
  }
}

async function _gerarPDFRecibo(r, print=false){
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
  // Espaço antes do bloco de assinatura (ancorado na linha, sem flutuar)
  y += 30;

  const assinatura = r.assinatura_govbr;
  const lineY = y; // posição da LINHA de assinatura
  // Assinatura (imagem) ancorada SOBRE a linha — a base do traço encosta nela.
  if (assinatura && assinatura.imagem) {
    try {
      const maxW = 75, maxH = 28; // mm — caixa máxima da assinatura
      let dw = maxW, dh = maxW / 2.6; // proporção padrão (caso não dê pra medir)
      try {
        const props = doc.getImageProperties(assinatura.imagem);
        if (props && props.width && props.height) {
          dh = (props.height / props.width) * maxW;
          if (dh > maxH) { dh = maxH; dw = (props.width / props.height) * maxH; }
        }
      } catch(_) { /* jsPDF sem getImageProperties — usa proporção padrão */ }
      doc.addImage(assinatura.imagem, "PNG", W/2 - dw/2, lineY - dh - 1, dw, dh);
    } catch(e) { console.error("assinatura PDF:", e); }
  }

  // Linha de assinatura do cliente — centralizada
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
  doc.line(ML+30, lineY, W-ML-30, lineY);
  y = lineY + 5;
  doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(0,0,0);
  doc.text(r.nome,W/2,y,{align:"center"});
  y += 5;
  doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`${labelDoc}: ${r.cpf}`,W/2,y,{align:"center"});

  // Selo de validação eletrônica (estilo ZapSign/Autentique)
  if (assinatura && assinatura.assinado_em) {
    y += 5;
    const selo = ["Assinado eletronicamente"];
    if (assinatura.nome_assinante) selo.push("por " + assinatura.nome_assinante);
    selo.push("em " + assinatura.assinado_em);
    if (assinatura.ip) selo.push("· IP " + assinatura.ip);
    doc.setFontSize(7); doc.setFont("helvetica","italic"); doc.setTextColor(120,120,120);
    const linhasSelo = doc.splitTextToSize(selo.join(" "), LW);
    doc.text(linhasSelo, W/2, y, {align:"center"});
    y += linhasSelo.length * 3.2;
    doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");
  }
  // Espaço pro final da página
  y += 28;

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
  // window.open costuma ser bloqueado no celular / WebView do Capacitor.
  // Se falhar, cai para download via <a> para o recibo nunca "sumir".
  const win=window.open(url,"_blank");
  if(!win){
    const a=document.createElement("a");
    a.href=url;
    a.target="_blank";
    a.rel="noopener";
    a.download=`recibo_${(r.num||"").replace("/","-")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
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
    assinatura: r.assinatura_govbr?.imagem || "",
    assinado_em: r.assinatura_govbr?.assinado_em || "",
    assinante: r.assinatura_govbr?.nome_assinante || "",
    assinatura_ip: r.assinatura_govbr?.ip || ""
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
    <div class="detail-row"><div class="detail-label">Comprovante</div><div class="detail-value">${r.link_comprovante ? `<a class="btn-gold btn-sm" href="${esc(r.link_comprovante)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px"><i class="bi bi-paperclip"></i> Ver comprovante</a>` : `<span style="color:var(--muted);font-size:13px;font-style:italic">Nenhum comprovante adicionado</span>`}</div></div>
    ${r.assinatura_govbr ? `<div class="detail-row"><div class="detail-label">Assinatura</div><div class="detail-value" style="color:var(--success)"><i class="bi bi-shield-check"></i> Assinado por ${esc(r.assinatura_govbr.nome_assinante)} em ${esc(r.assinatura_govbr.assinado_em)}${r.assinatura_govbr.imagem ? `<br><img src="${r.assinatura_govbr.imagem}" style="max-width:180px;max-height:50px;margin-top:6px;border:1px solid var(--border);border-radius:4px;background:#fff">` : ""}</div></div>` : ""}
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-gold" id="btn-ver-modal"><i class="bi bi-eye"></i> Ver PDF</button>
      <button class="btn-secondary" id="btn-imprimir-modal"><i class="bi bi-printer"></i> Imprimir</button>
      <button class="btn-primary" id="btn-reimprimir-modal"><i class="bi bi-download"></i> Baixar .docx</button>
      ${!r.assinatura_govbr?.imagem && window.innerWidth < 1024 ? `<button class="btn-gold" id="btn-assinar-canvas-modal"><i class="bi bi-pen"></i> Assinar Agora</button>` : ""}
      ${roleLogado!=="recepcao" && !r.assinatura_govbr ? `<button class="btn-secondary" id="btn-enviar-assinatura-modal"><i class="bi bi-send"></i> Enviar p/ assinar</button>` : ""}
      ${roleLogado!=="recepcao"?`<button class="btn-secondary" id="btn-recorrente-modal"><i class="bi bi-arrow-repeat"></i> Recorrente</button>`:""}
    </div>`;
  document.getElementById("btn-ver-modal").onclick=()=>{ abrirPDFRecibo(r); fecharModal("modal-detalhe"); };
  document.getElementById("btn-imprimir-modal").onclick=()=>{ abrirPDFRecibo(r, true); fecharModal("modal-detalhe"); };
  document.getElementById("btn-reimprimir-modal").onclick=()=>{ reimprimirRecibo(r); fecharModal("modal-detalhe"); };
  const btnRec = document.getElementById("btn-recorrente-modal");
  if (btnRec) btnRec.onclick = () => { fecharModal("modal-detalhe"); preencherReciboRecorrente(r); };
  const btnEnvAss = document.getElementById("btn-enviar-assinatura-modal");
  if (btnEnvAss) btnEnvAss.onclick = () => { fecharModal("modal-detalhe"); enviarLinkAssinatura(r); };
  // BotÃ£o de assinatura canvas â€” mobile e desktop
  const btnAssinarCanvas = document.getElementById("btn-assinar-canvas-modal");
  if(btnAssinarCanvas) {
    btnAssinarCanvas.onclick = async () => {
      fecharModal("modal-detalhe");
      const ass = await mostrarTelaAssinatura(r);
      if (ass) {
        const ok = await salvarAssinatura(r._id || r.id, ass.imagem, ass.nome_confirmado);
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


// ============================================================
// (conteúdo de recibos-extra.js unificado aqui na Fase 2 — Gov.br,
//  recorrente, calendário, busca global, auditoria, timeline)
// ============================================================
// â”€â”€ GOV.BR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _reciboGovBr = null;

async function abrirModalGovBr(r){
  _reciboGovBr = r;
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
  if(!_reciboGovBr) return;
  const btn = document.getElementById("btn-govbr-assinar");
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Aguarde...';
  const res = await api("GET", `/api/govbr/iniciar?recibo_id=${_reciboGovBr.id||_reciboGovBr._id}`);
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
