// web/public/app/clientes.js — extracted from app.js
// â”€â”€ CLIENTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const res = await api("GET", "/api/clientes?limit=500");
  if (!res || !res.ok) {
    if (!listaClientes.length) mostrarToast("Erro ao carregar clientes. Recarregue a pÃ¡gina.", null, "error");
    return;
  }
  const data = await res.json();
  listaClientes = data.clientes || data;
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
  const texto = `OlÃ¡ ${nomeCliente}, passando para lembrar sobre a parcela ${p.num} no valor de ${valor}${venc}. Em caso de dÃºvidas, entre em contato conosco. Att, Araujo Prev.`;
  const url = `https://wa.me/55${fone}?text=${encodeURIComponent(texto)}`;
  return `<a href="${url}" target="_blank" rel="noopener" class="btn-secondary btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">ðŸ’¬ WhatsApp</a>`;
}

function _buildBlocoContrato(cadastro) {
  if (!cadastro || cadastro.num_parcelas <= 0) return "";
  const pct      = Math.min(100, Math.round((cadastro.parcelas_pagas / cadastro.num_parcelas) * 100));
  const quitado  = cadastro.parcelas_restantes === 0;
  const corBarra = quitado ? "var(--success)" : "var(--gold)";
  return `
    <div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--muted)">${cadastro.parcelas_pagas}/${cadastro.num_parcelas} parcelas${quitado ? " Â· âœ… Quitado" : ""}</span>
        <span style="color:var(--muted)">R$ ${formatarValor(cadastro.valor_pago)} / R$ ${formatarValor(cadastro.valor_contrato)}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;background:${corBarra};height:100%;border-radius:4px;transition:width .3s"></div>
      </div>
      ${!quitado ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Faltam R$ ${formatarValor(cadastro.valor_restante)} Â· ${cadastro.parcelas_restantes} parcela${cadastro.parcelas_restantes !== 1 ? "s" : ""}</div>` : ""}
    </div>`;
}

function _buildTabelaRecibos(c) {
  return `
    <table style="width:100%">
      <thead><tr><th>NÂº</th><th>Data</th><th>Valor</th><th>ResponsÃ¡vel</th><th>Ref.</th><th>AÃ§Ãµes</th></tr></thead>
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
              <button class="btn-secondary btn-sm" data-action="baixar-recibo" data-recibo="${rd}">ðŸ“„ Baixar</button>
              ${roleLogado === "recepcao" ? `<button class="btn-secondary btn-sm" data-action="upload-comprovante" data-id="${rid}">ðŸ“Ž Comprovante</button>` : ""}
              ${roleLogado !== "recepcao" ? `<button class="btn-danger btn-sm" data-action="excluir-recibo" data-id="${rid}">ðŸ—‘</button>` : ""}
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
      <thead><tr><th>NÂº</th><th>Valor</th><th>Status</th><th>Recebimento</th><th>DepÃ³sito</th><th>Recibo</th><th>AÃ§Ãµes</th></tr></thead>
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
    ? `<p style="color:var(--success);font-weight:600;padding:8px 0">âœ… Nenhuma parcela pendente â€” contrato quitado!</p>`
    : `<table style="width:100%">
        <thead><tr><th>NÂº Parcela</th><th>Valor</th><th>Status</th><th>AÃ§Ãµes</th></tr></thead>
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
        <thead><tr><th>NÂº Parcela</th><th>Valor</th><th>Recebimento</th><th>DepÃ³sito</th><th>NÂº Recibo</th></tr></thead>
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

  // Chave = dÃ­gitos do CPF (se tiver) ou nome normalizado â€” evita duplicatas por formataÃ§Ã£o diferente
  const _cpfKey = cpf => cpf ? cpf.replace(/\D/g,"") : "";
  const _nomeKey = nome => "__n__" + (nome||"").normalize("NFC").trim().replace(/\s+/g," ").toUpperCase();
  const _mapaKey = (cpf, nome) => _cpfKey(cpf) || _nomeKey(nome);

  const mapa = {};
  // Primeiro: clientes cadastrados â€” sÃ£o a fonte de nome canÃ´nico
  listaClientes.forEach(c => {
    if (!c.nome) return;
    const key = _mapaKey(c.cpf, c.nome);
    if (!mapa[key]) mapa[key] = { nome: c.nome, cpf: c.cpf || "", municipio_uf: c.municipio_uf || "", recibos: [], total: 0 };
  });
  // Depois: recibos â€” casa por CPF (dÃ­gitos), cria entrada sÃ³ se nÃ£o existe ainda
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
    if (atrasados > 0) partes.push(`<span class="alerta">âš ï¸ ${atrasados} atrasado${atrasados !== 1 ? "s" : ""}</span>`);
    resumoEl.innerHTML = partes.join(" Â· ");
    resumoEl.style.display = "";
  }
  atualizarBadgeClientes();

  if (!clientes.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">ðŸ“‹</div><p>${busca ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}</p>${!busca ? '<button class="btn-gold" style="margin-top:12px" id="btn-empty-cadastrar">+ Cadastrar Cliente</button>' : ""}</div>`;
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
            <span>Â·</span><span>Ãšltimo: ${esc(ultimo?.data || "-")}</span>
            ${cadastro && cadastro.firma ? `<span>Â·</span><span style="color:var(--gold);font-weight:600">${esc(cadastro.firma)}</span>` : ""}
            ${cadastro && cadastro.auto_recibo ? `<span>·</span><span style="color:var(--success);font-size:11px"><i class="bi bi-arrow-repeat"></i> Auto</span>` : ""}
            ${cadastro && cadastro.referencia ? `<span>Â·</span><span>Ref: ${esc(cadastro.referencia)}</span>` : (ultimo?.referencia ? `<span>Â·</span><span>Ref: ${esc(ultimo.referencia)}</span>` : "")}
            ${cadastro && cadastro.telefone ? `<span>Â·</span><span><a href="https://wa.me/55${cadastro.telefone.replace(/\D/g,'')}" target="_blank" rel="noopener" class="wa-link" style="color:var(--success);text-decoration:none" title="Abrir WhatsApp"><i class="bi bi-whatsapp"></i> ${esc(cadastro.telefone)}</a></span>` : ""}
          </div>
          ${blocoContrato}
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;margin-left:12px;flex-shrink:0">
          <div style="text-align:right;margin-right:4px">
            <div class="cliente-total">R$ ${formatarValor(c.total)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">total pago</div>
          </div>
          <button class="btn-sm btn-secondary cadastro-btn">${cadastro ? "Editar cadastro" : "Cadastrar"}</button>
          ${roleLogado !== "recepcao" && cadastro ? `<button class="btn-danger btn-sm excluir-cliente-btn" title="Excluir cliente">ðŸ—‘</button>` : ""}
          <button class="btn-gold btn-sm novo-recibo-btn">+ Recibo</button>
        </div>
      </div>
      <div class="cliente-body">
        ${temParcelas ? `
        <div class="cliente-tabs">
          <button class="cliente-tab active" data-action="trocar-aba" data-card-id="${cardId}" data-aba="parcelamento">Parcelamento</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="areceber">A Receber</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="recebidos">Recebidos</button>
          <button class="cliente-tab" data-action="trocar-aba" data-card-id="${cardId}" data-aba="historico">HistÃ³rico</button>
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
    // recepcao: escritÃ³rio jÃ¡ estÃ¡ correto via limparCampos() â€” nÃ£o sobrescrever
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
    // Preenche forma/motivo do Ãºltimo recibo do cliente
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
  document.getElementById("modal-pagamento-titulo").textContent = `Registrar Pagamento â€” Parcela ${parcelaNum}`;
  const infoEl = document.getElementById("modal-pagamento-cliente-info");
  const cli = listaClientes.find(x => x.id === clienteId);
  if (cli && infoEl) {
    const total = cli.num_parcelas || 0;
    infoEl.textContent = `${esc(cli.nome)}${total ? ` Â· Parcela ${parcelaNum} de ${total}` : ""}`;
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

  if (!dataRec || !dataDep) { mostrarToast("Preencha as datas de recebimento e depÃ³sito.", null, "error"); return; }

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

// â”€â”€ CRUD CLIENTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

