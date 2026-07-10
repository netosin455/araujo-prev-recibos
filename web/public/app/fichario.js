// ── FICHÁRIO — seção principal de documentos por cliente ──
// Fluxo: busca cliente → grid com capa → abre galeria → upload/visualização

let _ficharioAberto = null; // { cpf, nome } da galeria aberta
let _ficharioTimer = null;

function renderFichario() {
  const el = document.getElementById("screen-fichario");
  if (!el) return;
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div class="search-box" style="max-width:480px">
        <i class="bi bi-search"></i>
        <input id="fichario-busca" type="text" placeholder="Buscar cliente por nome ou CPF..." autofocus>
      </div>
      <div id="fichario-status" style="font-size:12px;color:var(--muted);margin-top:6px">Digite para buscar ou deixe vazio para ver todos</div>
    </div>
    <div id="fichario-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px"></div>
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
  const grid = document.getElementById("fichario-grid");
  const status = document.getElementById("fichario-status");
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted)"><i class="bi bi-hourglass-split pulse"></i><p style="margin-top:8px">Buscando...</p></div>`;
  try {
    const r = await api("GET", `/api/fichario/busca?q=${encodeURIComponent(q)}`);
    const j = r ? await r.json() : { clientes: [] };
    const clientes = j.clientes || [];
    status.textContent = clientes.length === 0 ? "Nenhum cliente encontrado." : `${clientes.length} cliente(s) encontrado(s)`;
    renderGridFichario(clientes);
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--error)"><i class="bi bi-exclamation-triangle"></i><p style="margin-top:8px">Erro ao buscar.</p></div>`;
    status.textContent = "Erro ao buscar clientes.";
  }
}

function renderGridFichario(clientes) {
  const grid = document.getElementById("fichario-grid");
  if (!grid) return;
  grid.innerHTML = clientes.map(c => {
    const capa = c.cover_thumb_url
      ? `<img src="${c.cover_thumb_url}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy">`
      : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:28px;gap:6px"><i class="bi bi-person-badge"></i><span style="font-size:11px">${c.qtd_docs} doc(s)</span></div>`;
    return `
      <div class="fic-card" data-cpf="${esc(c.cpf)}" data-nome="${esc(c.nome)}" style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card);cursor:pointer;transition:box-shadow .15s">
        <div style="height:120px;background:#f0ebe1;overflow:hidden">${capa}</div>
        <div style="padding:10px 12px">
          <div style="font-size:13px;font-weight:700;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.nome)}">${esc(c.nome)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(c.cpf)}</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="fic-ver btn-sm btn-secondary" style="flex:1;cursor:pointer"><i class="bi bi-images"></i> Ver</button>
            <button class="fic-add btn-sm btn-gold" style="cursor:pointer"><i class="bi bi-plus-lg"></i></button>
          </div>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".fic-card").forEach(card => {
    const cpf = card.dataset.cpf;
    const nome = card.dataset.nome;
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
    <div style="margin-bottom:12px">
      <button class="btn-sm btn-secondary" id="fic-voltar" style="cursor:pointer"><i class="bi bi-arrow-left"></i> Voltar</button>
      <span style="font-weight:700;margin-left:10px;font-size:16px">${esc(nome)}</span>
      <span style="font-size:12px;color:var(--muted);margin-left:6px">${esc(cpf)}</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <select id="fic-gal-tipo" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12.5px;background:#fff;color:var(--dark)">
        ${["RG", "CPF", "Comprovante de residência", "Procuração", "Laudo médico", "CTPS", "Outro"].map(t => `<option value="${t}">${t}</option>`).join("")}
      </select>
      <button class="btn-gold btn-sm" id="fic-gal-cam" style="cursor:pointer"><i class="bi bi-camera"></i> Câmera</button>
      <button class="btn-secondary btn-sm" id="fic-gal-file" style="cursor:pointer"><i class="bi bi-upload"></i> Arquivo</button>
      <span id="fic-gal-status" style="font-size:11.5px;color:var(--muted)"></span>
      <input type="file" id="fic-gal-in-cam" accept="image/*" capture="environment" style="display:none">
      <input type="file" id="fic-gal-in-file" accept="image/*,application/pdf" style="display:none">
    </div>
    <div id="fic-gal-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;min-height:100px">
      <div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted)"><i class="bi bi-hourglass-split pulse"></i><p style="margin-top:8px">Carregando...</p></div>
    </div>
  `;

  document.getElementById("fic-voltar").addEventListener("click", () => fecharGaleriaFichario());
  document.getElementById("fic-gal-cam").addEventListener("click", () => document.getElementById("fic-gal-in-cam").click());
  document.getElementById("fic-gal-file").addEventListener("click", () => document.getElementById("fic-gal-in-file").click());

  const inCam = document.getElementById("fic-gal-in-cam");
  const inFile = document.getElementById("fic-gal-in-file");
  const pickGal = async (inp) => {
    if (inp.files && inp.files[0]) {
      await enviarDocumentoGaleria(cpf, inp.files[0]);
      inp.value = "";
    }
  };
  inCam.addEventListener("change", () => pickGal(inCam));
  inFile.addEventListener("change", () => pickGal(inFile));

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
}

async function carregarDocsGaleria(cpf) {
  const grid = document.getElementById("fic-gal-grid");
  if (!grid) return;
  try {
    const r = await api("GET", `/api/clientes/${cpf}/documentos`);
    const j = r ? await r.json() : { documentos: [] };
    const docs = j.documentos || [];
    if (docs.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:12px;padding:18px">Nenhum documento ainda. Envie o primeiro!</div>`;
      return;
    }
    const podeExcluir = roleLogado === "admin" || roleLogado === "financeiro";
    grid.innerHTML = docs.map(d => {
      const thumb = d.is_pdf
        ? `<div style="height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:#f0ebe1;color:var(--error)"><i class="bi bi-file-earmark-pdf" style="font-size:30px"></i><span style="font-size:10px;font-weight:800">PDF</span></div>`
        : `<div style="height:100px;background:#f0ebe1;overflow:hidden"><img loading="lazy" src="${d.thumb_url}" alt="" style="width:100%;height:100%;object-fit:cover"></div>`;
      const del = podeExcluir ? `<button class="fic-gal-del" data-doc-id="${d.id}" style="flex:0 0 auto;width:28px;border:1px solid #eccfcb;color:var(--error);background:#fff;border-radius:7px;cursor:pointer">✕</button>` : "";
      return `
        <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff">
          ${thumb}
          <div style="padding:7px 9px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--gold)">${esc(d.tipo || "Documento")}</div>
            <div style="font-size:12px;font-weight:600;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(d.nome || "")}">${esc(d.nome || "—")}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">${esc(d.criado_por || "")}</div>
            <div style="display:flex;gap:5px;margin-top:7px">
              <button class="fic-gal-open" data-url="${esc(d.url)}" style="flex:1;font-size:11px;font-weight:600;padding:5px;border:1px solid var(--border-strong);background:#fff;color:var(--mid);border-radius:7px;cursor:pointer">Ver</button>
              ${del}
            </div>
          </div>
        </div>`;
    }).join("");
    grid.querySelectorAll(".fic-gal-open").forEach(b => b.addEventListener("click", () => { if (b.dataset.url) window.open(b.dataset.url, "_blank", "noopener"); }));
    grid.querySelectorAll(".fic-gal-del").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Excluir este documento?")) return;
      try {
        const rr = await api("DELETE", `/api/documentos/${b.dataset.docId}`);
        if (rr && rr.ok) { await carregarDocsGaleria(cpf); }
      } catch (e) { mostrarToast("Erro ao excluir.", null, "error"); }
    }));
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--error)">Erro ao carregar documentos.</div>`;
  }
}

async function enviarDocumentoGaleria(cpf, file) {
  const status = document.getElementById("fic-gal-status");
  const tipo = document.getElementById("fic-gal-tipo");
  if (!status || !tipo) return;
  status.textContent = "Preparando…";
  const fd = new FormData();
  fd.append("tipo", tipo.value);
  fd.append("nome", file.name || "documento");
  try {
    if ((file.type || "").startsWith("image/")) {
      const [orig, thumb] = await Promise.all([
        _resizeImagem(file, 1600, 0.82),
        _resizeImagem(file, 300, 0.7),
      ]);
      fd.append("arquivo", orig, "foto.jpg");
      fd.append("thumb", thumb, "thumb.jpg");
    } else {
      fd.append("arquivo", file, file.name || "documento.pdf");
    }
    status.textContent = "Enviando…";
    const r = await fetch(`/api/clientes/${cpf}/documentos`, { method: "POST", credentials: "include", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = ""; mostrarToast(j.erro || "Erro ao enviar.", null, "error"); return; }
    status.textContent = "Enviado!";
    await carregarDocsGaleria(cpf);
  } catch (e) {
    status.textContent = "";
    mostrarToast("Falha ao enviar: " + (e.message || "erro"), null, "error");
  }
}

async function uploadDiretoFichario(cpf, nome) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.style.display = "none";
  input.addEventListener("change", async () => {
    if (input.files && input.files[0]) {
      await abrirGaleriaFichario(cpf, nome);
      const status = document.getElementById("fic-gal-status");
      const tipo = document.getElementById("fic-gal-tipo");
      if (status && tipo) {
        status.textContent = "Preparando…";
        const fd = new FormData();
        fd.append("tipo", tipo.value);
        fd.append("nome", input.files[0].name || "documento");
        try {
          if ((input.files[0].type || "").startsWith("image/")) {
            const [orig, thumb] = await Promise.all([
              _resizeImagem(input.files[0], 1600, 0.82),
              _resizeImagem(input.files[0], 300, 0.7),
            ]);
            fd.append("arquivo", orig, "foto.jpg");
            fd.append("thumb", thumb, "thumb.jpg");
          } else {
            fd.append("arquivo", input.files[0], input.files[0].name || "documento.pdf");
          }
          status.textContent = "Enviando…";
          const r = await fetch(`/api/clientes/${cpf}/documentos`, { method: "POST", credentials: "include", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { status.textContent = ""; mostrarToast(j.erro || "Erro ao enviar.", null, "error"); return; }
          status.textContent = "Enviado!";
          await carregarDocsGaleria(cpf);
        } catch (e) {
          status.textContent = "";
          mostrarToast("Falha ao enviar: " + (e.message || "erro"), null, "error");
        }
      }
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => document.body.removeChild(input), 1000);
}
