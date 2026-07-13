// ── FICHÁRIO — seção principal de documentos por cliente ──
// Fluxo: busca cliente → grid com capa → galeria (agrupada por tipo) → lightbox.
// Envio em lote (vários de uma vez), visualizador com zoom/navegação.

let _ficharioAberto = null;
let _ficharioTimer = null;
let _ficharioQuery = "";
let _ficDocs = [];          // documentos da galeria aberta (pro lightbox navegar)
let _lbIndex = 0;           // índice atual no lightbox
let _lbKeyHandler = null;
let _ficPagina = 0;         // página atual da grade de clientes (paginação)
let _ficTemMais = false;    // servidor sinalizou que há mais clientes pra carregar
const _FIC_LIMIT = 60;      // clientes por página

const FIC_TIPOS = ["RG", "CPF", "Comprovante de residência", "Procuração", "Laudo médico", "CTPS", "Outro"];
const _ficPodeExcluir = () => roleLogado === "admin" || roleLogado === "financeiro";

// CSS injetado uma vez (hover, badges, agrupamento, lightbox)
function _ficInjetarCSS() {
  if (document.getElementById("fic-estilos")) return;
  const s = document.createElement("style");
  s.id = "fic-estilos";
  s.textContent = `
    .fic-titulo{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--dark);margin:0 0 2px}
    .fic-card{border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--card);cursor:pointer;transition:box-shadow .18s,transform .18s,border-color .18s}
    .fic-card:hover{box-shadow:0 12px 28px -14px rgba(60,44,10,.32);transform:translateY(-2px);border-color:var(--border-strong)}
    .fic-capa{height:118px;background:linear-gradient(135deg,#e6ddc9,#f3ecdc);position:relative;overflow:hidden}
    .fic-capa img{width:100%;height:100%;object-fit:cover}
    .fic-capa .fic-qtd{position:absolute;top:8px;right:8px;background:rgba(26,26,26,.72);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;display:flex;align-items:center;gap:4px}
    .fic-capa .fic-vazia{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#a89b83;gap:5px}
    .fic-grupo-tit{grid-column:1/-1;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin:6px 0 -2px;display:flex;align-items:center;gap:8px}
    .fic-grupo-tit::after{content:"";flex:1;height:1px;background:var(--gold-pale)}
    .fic-doc{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:#fff;transition:box-shadow .15s,transform .15s}
    .fic-doc:hover{box-shadow:0 8px 20px -12px rgba(60,44,10,.3);transform:translateY(-1px)}
    .fic-doc .fic-thumb{height:104px;background:#f0ebe1;overflow:hidden;cursor:zoom-in;position:relative}
    .fic-doc .fic-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .fic-lb{position:fixed;inset:0;z-index:9999;background:rgba(20,16,8,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fic-fade .15s ease}
    @keyframes fic-fade{from{opacity:0}to{opacity:1}}
    .fic-lb-img{max-width:92vw;max-height:78vh;object-fit:contain;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.5);cursor:zoom-in;transition:transform .2s}
    .fic-lb-frame{width:90vw;height:80vh;border:none;border-radius:8px;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.5)}
    .fic-lb-img.zoom{cursor:zoom-out;transform:scale(2)}
    .fic-lb-cap{color:#f3ecdc;font-size:13px;margin-top:14px;text-align:center;max-width:90vw}
    .fic-lb-cap b{color:var(--gold-light)}
    .fic-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .fic-lb-nav:hover{background:rgba(255,255,255,.28)}
    .fic-lb-prev{left:18px}.fic-lb-next{right:18px}
    .fic-lb-x{position:absolute;top:16px;right:18px;width:40px;height:40px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:20px;cursor:pointer}
    .fic-lb-x:hover{background:rgba(255,255,255,.28)}
    .fic-lb-count{position:absolute;top:20px;left:22px;color:#f3ecdc;font-size:13px;font-weight:600;background:rgba(0,0,0,.3);padding:4px 12px;border-radius:20px}
    .fic-lb-pdf{display:flex;flex-direction:column;align-items:center;gap:14px;color:#f3ecdc}
    .fic-lb-pdf i{font-size:64px;color:#e0b0a8}
  `;
  document.head.appendChild(s);
}

function renderFichario() {
  _ficInjetarCSS();
  const el = document.getElementById("screen-fichario");
  if (!el) return;
  el.innerHTML = `
    <div style="margin-bottom:18px">
      <h2 class="fic-titulo">Fichário</h2>
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Documentos de cada cliente — fotos e PDFs, seguros na nuvem.</p>
      <div class="search-box" style="max-width:480px">
        <i class="bi bi-search"></i>
        <input id="fichario-busca" type="text" placeholder="Buscar cliente por nome ou CPF..." autofocus>
      </div>
      <div id="fichario-status" style="font-size:12px;color:var(--muted);margin-top:6px">Digite para buscar ou deixe vazio para ver todos</div>
    </div>
    <div id="fichario-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(184px,1fr));gap:14px"></div>
    <div id="fichario-galeria" style="display:none"></div>
  `;
  const input = document.getElementById("fichario-busca");
  input.addEventListener("input", () => {
    clearTimeout(_ficharioTimer);
    _ficharioTimer = setTimeout(() => buscarFichario(input.value.trim()), 300);
  });
  buscarFichario("");
}

async function buscarFichario(q) {
  _ficharioQuery = q;
  const grid = document.getElementById("fichario-grid");
  const status = document.getElementById("fichario-status");
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted)"><i class="bi bi-hourglass-split"></i><p style="margin-top:8px">Buscando...</p></div>`;
  try {
    const r = await api("GET", `/api/fichario/busca?q=${encodeURIComponent(q)}`);
    const j = r ? await r.json() : { clientes: [] };
    const clientes = j.clientes || [];
    status.textContent = clientes.length === 0 ? "Nenhum cliente encontrado." : `${clientes.length} cliente(s)`;
    renderGridFichario(clientes);
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--error)"><i class="bi bi-exclamation-triangle"></i><p style="margin-top:8px">Erro ao buscar.</p></div>`;
    status.textContent = "Erro ao buscar clientes.";
  }
}

function renderGridFichario(clientes) {
  const grid = document.getElementById("fichario-grid");
  if (!grid) return;
  if (clientes.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:36px;color:var(--muted)"><i class="bi bi-folder2-open" style="font-size:30px;opacity:.5"></i><p style="margin-top:8px;font-size:13px">Nenhum cliente encontrado.</p></div>`;
    return;
  }
  grid.innerHTML = clientes.map(c => {
    const capa = c.cover_thumb_url
      ? `<img src="${c.cover_thumb_url}" alt="" loading="lazy">`
      : `<div class="fic-vazia"><i class="bi bi-person-badge" style="font-size:28px"></i></div>`;
    const badge = c.qtd_docs > 0
      ? `<span class="fic-qtd"><i class="bi bi-images"></i> ${c.qtd_docs}</span>`
      : `<span class="fic-qtd" style="background:rgba(139,46,46,.75)">vazio</span>`;
    return `
      <div class="fic-card" data-cpf="${esc(c.cpf)}" data-nome="${esc(c.nome)}">
        <div class="fic-capa">${capa}${badge}</div>
        <div style="padding:11px 13px">
          <div style="font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:600;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.nome)}">${esc(c.nome)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${esc(c.cpf)}</div>
          <div style="display:flex;gap:6px;margin-top:9px">
            <button class="fic-ver btn-sm btn-secondary" style="flex:1;cursor:pointer"><i class="bi bi-images"></i> Ver</button>
            <button class="fic-add btn-sm btn-gold" style="cursor:pointer" title="Adicionar documento"><i class="bi bi-plus-lg"></i></button>
          </div>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".fic-card").forEach(card => {
    const cpf = card.dataset.cpf, nome = card.dataset.nome;
    card.querySelector(".fic-capa").addEventListener("click", () => abrirGaleriaFichario(cpf, nome));
    card.querySelector(".fic-ver").addEventListener("click", e => { e.stopPropagation(); abrirGaleriaFichario(cpf, nome); });
    card.querySelector(".fic-add").addEventListener("click", e => { e.stopPropagation(); uploadDiretoFichario(cpf, nome); });
  });
}

async function abrirGaleriaFichario(cpf, nome) {
  _ficharioAberto = { cpf, nome };
  const galeria = document.getElementById("fichario-galeria");
  const grid = document.getElementById("fichario-grid");
  const busca = document.getElementById("fichario-busca");
  if (!galeria) return;
  grid.style.display = "none";
  galeria.style.display = "block";
  if (busca) busca.style.display = "none";
  document.getElementById("fichario-status").textContent = "";
  galeria.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn-sm btn-secondary" id="fic-voltar" style="cursor:pointer"><i class="bi bi-arrow-left"></i> Voltar</button>
      <div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:600;color:var(--dark)">${esc(nome)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(cpf)} · <span id="fic-gal-qtd">…</span></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:linear-gradient(180deg,#fffdf6,#fdf8ec);border:1px solid var(--gold-pale);border-radius:11px">
      <select id="fic-gal-tipo" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12.5px;background:#fff;color:var(--dark)">
        ${FIC_TIPOS.map(t => `<option value="${t}">${t}</option>`).join("")}
      </select>
      <button class="btn-gold btn-sm" id="fic-gal-cam" style="cursor:pointer"><i class="bi bi-camera"></i> Câmera</button>
      <button class="btn-secondary btn-sm" id="fic-gal-file" style="cursor:pointer"><i class="bi bi-upload"></i> Arquivos</button>
      <span style="font-size:11px;color:var(--muted)">pode enviar vários de uma vez</span>
      <span id="fic-gal-status" style="font-size:11.5px;color:var(--gold);font-weight:600;margin-left:auto"></span>
      <input type="file" id="fic-gal-in-cam" accept="image/*" capture="environment" multiple style="display:none">
      <input type="file" id="fic-gal-in-file" accept="image/*,application/pdf" multiple style="display:none">
    </div>
    <div id="fic-gal-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;min-height:100px">
      <div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted)"><i class="bi bi-hourglass-split"></i><p style="margin-top:8px">Carregando...</p></div>
    </div>
  `;

  document.getElementById("fic-voltar").addEventListener("click", () => fecharGaleriaFichario());
  document.getElementById("fic-gal-cam").addEventListener("click", () => document.getElementById("fic-gal-in-cam").click());
  document.getElementById("fic-gal-file").addEventListener("click", () => document.getElementById("fic-gal-in-file").click());
  const inCam = document.getElementById("fic-gal-in-cam");
  const inFile = document.getElementById("fic-gal-in-file");
  const pick = async (inp) => { if (inp.files && inp.files.length) { await enviarDocumentos(cpf, inp.files); inp.value = ""; } };
  inCam.addEventListener("change", () => pick(inCam));
  inFile.addEventListener("change", () => pick(inFile));

  await carregarDocsGaleria(cpf);
}

function fecharGaleriaFichario() {
  _ficharioAberto = null;
  const galeria = document.getElementById("fichario-galeria");
  const grid = document.getElementById("fichario-grid");
  const busca = document.getElementById("fichario-busca");
  if (galeria) { galeria.style.display = "none"; galeria.innerHTML = ""; }
  if (grid) grid.style.display = "grid";
  if (busca) busca.style.display = "";
  buscarFichario(_ficharioQuery);
}

async function carregarDocsGaleria(cpf) {
  const grid = document.getElementById("fic-gal-grid");
  if (!grid) return;
  try {
    const r = await api("GET", `/api/clientes/${cpf}/documentos`);
    const j = r ? await r.json() : { documentos: [] };
    _ficDocs = j.documentos || [];
    const qtdEl = document.getElementById("fic-gal-qtd");
    if (qtdEl) qtdEl.textContent = `${_ficDocs.length} documento${_ficDocs.length !== 1 ? "s" : ""}`;
    if (_ficDocs.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:12px;padding:22px">Nenhum documento ainda. Envie o primeiro! 📷</div>`;
      return;
    }
    // Agrupa por tipo, preservando o índice global (pro lightbox)
    const grupos = {};
    _ficDocs.forEach((d, i) => { const t = d.tipo || "Outro"; (grupos[t] = grupos[t] || []).push(i); });
    grid.innerHTML = Object.keys(grupos).map(tipo => {
      const cards = grupos[tipo].map(i => _cardDocGaleria(_ficDocs[i], i)).join("");
      return `<div class="fic-grupo-tit">${esc(tipo)} <span style="color:var(--muted);font-weight:600;letter-spacing:0">(${grupos[tipo].length})</span></div>${cards}`;
    }).join("");

    grid.querySelectorAll("[data-lb-idx]").forEach(b => b.addEventListener("click", () => abrirLightbox(parseInt(b.dataset.lbIdx, 10))));
    grid.querySelectorAll(".fic-gal-del").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Excluir este documento? (fica recuperável no sistema)")) return;
      try {
        const rr = await api("DELETE", `/api/documentos/${b.dataset.docId}`);
        if (rr && rr.ok) { await carregarDocsGaleria(cpf); }
        else mostrarToast("Erro ao excluir.", null, "error");
      } catch (e2) { mostrarToast("Erro ao excluir.", null, "error"); }
    }));
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--error)">Erro ao carregar documentos.</div>`;
  }
}

function _cardDocGaleria(d, idx) {
  const thumb = d.is_pdf
    ? `<div class="fic-thumb" data-lb-idx="${idx}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--error)"><i class="bi bi-file-earmark-pdf" style="font-size:30px"></i><span style="font-size:10px;font-weight:800">PDF</span></div>`
    : `<div class="fic-thumb" data-lb-idx="${idx}"><img loading="lazy" src="${d.thumb_url}" alt=""></div>`;
  const del = _ficPodeExcluir() ? `<button class="fic-gal-del" data-doc-id="${d.id}" title="Excluir" style="flex:0 0 auto;width:28px;border:1px solid #eccfcb;color:var(--error);background:#fff;border-radius:7px;cursor:pointer">✕</button>` : "";
  return `
    <div class="fic-doc">
      ${thumb}
      <div style="padding:7px 9px">
        <div style="font-size:12px;font-weight:600;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(d.nome || "")}">${esc(d.nome || "—")}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${esc(d.criado_por || "")}</div>
        <div style="display:flex;gap:5px;margin-top:7px">
          <button data-lb-idx="${idx}" style="flex:1;font-size:11px;font-weight:600;padding:5px;border:1px solid var(--border-strong);background:#fff;color:var(--mid);border-radius:7px;cursor:pointer">Ver</button>
          ${del}
        </div>
      </div>
    </div>`;
}

// ── LIGHTBOX (visualizador com zoom + navegação) ──
function abrirLightbox(idx) {
  _lbIndex = idx;
  let ov = document.getElementById("fic-lightbox");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "fic-lightbox";
    ov.className = "fic-lb";
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) fecharLightbox(); });
    _lbKeyHandler = (e) => {
      if (e.key === "Escape") fecharLightbox();
      else if (e.key === "ArrowLeft") _lbNav(-1);
      else if (e.key === "ArrowRight") _lbNav(1);
    };
    document.addEventListener("keydown", _lbKeyHandler);
  }
  _lbRender();
}

function _lbRender() {
  const ov = document.getElementById("fic-lightbox");
  if (!ov) return;
  const d = _ficDocs[_lbIndex];
  if (!d) return;
  const total = _ficDocs.length;
  // Imagem no <img> (com zoom); PDF inline no <iframe> — igual ao visualizador
  // dos comprovantes (não abre em nova aba).
  const miolo = d.is_pdf
    ? `<iframe class="fic-lb-frame" src="${d.url}" title="${esc(d.nome || "PDF")}"></iframe>`
    : `<img class="fic-lb-img" id="fic-lb-img" src="${d.url}" alt="">`;
  ov.innerHTML = `
    <div class="fic-lb-count">${_lbIndex + 1} / ${total}</div>
    <button class="fic-lb-x" id="fic-lb-x">✕</button>
    ${total > 1 ? `<button class="fic-lb-nav fic-lb-prev" id="fic-lb-prev">‹</button><button class="fic-lb-nav fic-lb-next" id="fic-lb-next">›</button>` : ""}
    ${miolo}
    <div class="fic-lb-cap"><b>${esc(d.tipo || "Documento")}</b> · ${esc(d.nome || "")}${d.criado_por ? " · " + esc(d.criado_por) : ""} · <a href="${d.url}" target="_blank" rel="noopener" style="color:var(--gold-light);text-decoration:underline">abrir em nova aba ↗</a></div>
  `;
  ov.querySelector("#fic-lb-x").addEventListener("click", fecharLightbox);
  const prev = ov.querySelector("#fic-lb-prev"), next = ov.querySelector("#fic-lb-next");
  if (prev) prev.addEventListener("click", () => _lbNav(-1));
  if (next) next.addEventListener("click", () => _lbNav(1));
  const img = ov.querySelector("#fic-lb-img");
  if (img) {
    img.addEventListener("click", () => img.classList.toggle("zoom"));
    // Se a imagem não carregar (link expirado, rede do celular, etc.), troca a
    // tela preta por um aviso com botão — em vez de deixar o usuário no escuro.
    img.addEventListener("error", () => {
      const box = document.createElement("div");
      box.className = "fic-lb-pdf";
      box.innerHTML = `<i class="bi bi-image"></i>
        <div style="font-size:15px;font-weight:600;text-align:center">Não foi possível carregar a imagem aqui</div>
        <a href="${d.url}" target="_blank" rel="noopener" class="btn-gold" style="cursor:pointer;text-decoration:none"><i class="bi bi-box-arrow-up-right"></i> Abrir imagem</a>`;
      img.replaceWith(box);
    });
  }
}

function _lbNav(dir) {
  if (!_ficDocs.length) return;
  _lbIndex = (_lbIndex + dir + _ficDocs.length) % _ficDocs.length;
  _lbRender();
}

function fecharLightbox() {
  const ov = document.getElementById("fic-lightbox");
  if (ov) ov.remove();
  if (_lbKeyHandler) { document.removeEventListener("keydown", _lbKeyHandler); _lbKeyHandler = null; }
}

// ── ENVIO EM LOTE (unifica câmera/arquivo e o "+" do card) ──
async function enviarDocumentos(cpf, fileList, tipoForcado) {
  const status = document.getElementById("fic-gal-status");
  const tipoEl = document.getElementById("fic-gal-tipo");
  const tipo = tipoForcado || (tipoEl ? tipoEl.value : "Outro");
  const files = Array.from(fileList);
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    if (status) status.textContent = files.length > 1 ? `Enviando ${i + 1} de ${files.length}…` : "Enviando…";
    try {
      const fd = new FormData();
      fd.append("tipo", tipo);
      fd.append("nome", files[i].name || "documento");
      if ((files[i].type || "").startsWith("image/")) {
        const [orig, thumb] = await Promise.all([
          _resizeImagem(files[i], 1600, 0.82),
          _resizeImagem(files[i], 300, 0.7),
        ]);
        fd.append("arquivo", orig, "foto.jpg");
        fd.append("thumb", thumb, "thumb.jpg");
      } else {
        fd.append("arquivo", files[i], files[i].name || "documento.pdf");
      }
      const r = await fetch(`/api/clientes/${cpf}/documentos`, { method: "POST", credentials: "include", body: fd });
      if (r.ok) ok++;
      else { const j = await r.json().catch(() => ({})); mostrarToast(j.erro || "Erro em um arquivo.", null, "error"); }
    } catch (e) {
      mostrarToast("Falha em um arquivo: " + (e.message || "erro"), null, "error");
    }
  }
  if (status) status.textContent = ok ? `${ok} enviado${ok !== 1 ? "s" : ""}!` : "";
  await carregarDocsGaleria(cpf);
  setTimeout(() => { if (status) status.textContent = ""; }, 2500);
}

// "+" no card: abre a galeria e já dispara o seletor de arquivos (multi)
async function uploadDiretoFichario(cpf, nome) {
  await abrirGaleriaFichario(cpf, nome);
  const inFile = document.getElementById("fic-gal-in-file");
  if (inFile) inFile.click();
}
