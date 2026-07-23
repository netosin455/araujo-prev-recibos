// web/public/app/assinatura.js — assinatura digital no celular (mesma cara do link remoto)
let _assinaturaResolve = null;
let _assTemTraco = false;
let _redimensionarAssinaturaCanvas = null;

// Recorta a assinatura no traço real (remove o espaço vazio em volta),
// mantém a proporção natural e o fundo transparente. Retorna PNG base64.
function recortarAssinatura(srcCanvas, srcCtx) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const d = srcCtx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0, achou = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) {
        achou = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!achou) return srcCanvas.toDataURL("image/png");
  const pad = Math.round(Math.max(w, h) * 0.04);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const max = 1000, escala = Math.min(1, max / Math.max(cw, ch));
  const out = document.createElement("canvas");
  out.width = Math.round(cw * escala);
  out.height = Math.round(ch * escala);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(srcCanvas, minX, minY, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

function _maskCPFlocal(cpf) {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`;
  if (d.length === 14) return `**.***.***/****-**`;
  return cpf || "—";
}

function initAssinaturaCanvas() {
  const canvas = document.getElementById("assinatura-canvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  let desenhando = false, ultimoX = 0, ultimoY = 0;

  function redim() {
    const desenhoAnterior = _assTemTraco && canvas.width && canvas.height
      ? (() => {
          const copia = document.createElement("canvas");
          copia.width = canvas.width;
          copia.height = canvas.height;
          copia.getContext("2d").drawImage(canvas, 0, 0);
          return copia;
        })()
      : null;
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (desenhoAnterior) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(desenhoAnterior, 0, 0, desenhoAnterior.width, desenhoAnterior.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    desenhando = false;
  }
  redim();
  _redimensionarAssinaturaCanvas = redim;
  let redimTimer = null;
  function reagendarRedim() {
    window.clearTimeout(redimTimer);
    redimTimer = window.setTimeout(redim, 120);
  }
  window.addEventListener("resize", reagendarRedim);
  window.addEventListener("orientationchange", reagendarRedim);

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function iniciar(e) {
    desenhando = true;
    const p = getPos(e);
    ultimoX = p.x; ultimoY = p.y;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (!_assTemTraco) {
      _assTemTraco = true;
      const hint = document.getElementById("assinatura-hint");
      if (hint) hint.style.display = "none";
    }
    e.preventDefault();
  }

  function mover(e) {
    if (!desenhando) return;
    const p = getPos(e);
    // Curva quadrática até o ponto médio = traço suave (sem cantos quebrados)
    const midX = (ultimoX + p.x) / 2, midY = (ultimoY + p.y) / 2;
    ctx.quadraticCurveTo(ultimoX, ultimoY, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ultimoX = p.x; ultimoY = p.y;
    e.preventDefault();
  }

  function parar(e) { desenhando = false; e.preventDefault(); }

  canvas.addEventListener("mousedown", iniciar);
  canvas.addEventListener("mousemove", mover);
  canvas.addEventListener("mouseup", parar);
  canvas.addEventListener("mouseleave", parar);
  canvas.addEventListener("touchstart", iniciar, { passive: false });
  canvas.addEventListener("touchmove", mover, { passive: false });
  canvas.addEventListener("touchend", parar, { passive: false });

  function fecharTela() {
    const tela = document.getElementById("tela-assinatura");
    tela.classList.remove("active");
    tela.style.display = "none";
  }

  document.getElementById("btn-assinatura-limpar").onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _assTemTraco = false;
    const hint = document.getElementById("assinatura-hint");
    if (hint) hint.style.display = "flex";
  };

  // "Não assinar agora" — adia a assinatura; o recibo fica pendente.
  const btnPular = document.getElementById("btn-assinatura-pular");
  if (btnPular) btnPular.onclick = () => {
    fecharTela();
    if (_assinaturaResolve) _assinaturaResolve(null);
    _assinaturaResolve = null;
  };

  document.getElementById("btn-assinatura-confirmar").onclick = () => {
    const erro = document.getElementById("assinatura-erro");
    if (erro) erro.textContent = "";
    const nomeInp = document.getElementById("ass-nome");
    const aceite = document.getElementById("ass-aceite");
    if (!_assTemTraco) { if (erro) erro.textContent = "Desenhe sua assinatura no quadro."; return; }
    if (nomeInp && !nomeInp.value.trim()) { if (erro) erro.textContent = "Confirme seu nome completo."; return; }
    if (aceite && !aceite.checked) { if (erro) erro.textContent = "Marque a declaração para confirmar."; return; }
    const dataUrl = recortarAssinatura(canvas, ctx);
    fecharTela();
    if (_assinaturaResolve) _assinaturaResolve({ imagem: dataUrl, nome_confirmado: nomeInp ? nomeInp.value.trim() : "" });
    _assinaturaResolve = null;
  };
}

// Mostra a tela de assinatura preenchida com os dados do recibo.
// info: { num/num_recibo, valor, data, cpf, nome }
// Resolve { imagem, nome_confirmado } se assinar, ou null se adiar.
async function mostrarTelaAssinatura(info) {
  info = info || {};
  return new Promise((resolve) => {
    _assinaturaResolve = resolve;
    _assTemTraco = false;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("ass-num", info.num_recibo || info.num || "—");
    set("ass-valor", "R$ " + (info.valor || "—"));
    set("ass-data", info.data || "—");
    set("ass-cpf", _maskCPFlocal(info.cpf));
    const nomeInp = document.getElementById("ass-nome");
    if (nomeInp) nomeInp.value = info.nome || "";
    const aceite = document.getElementById("ass-aceite");
    if (aceite) aceite.checked = false;
    const erro = document.getElementById("assinatura-erro");
    if (erro) erro.textContent = "";
    const hint = document.getElementById("assinatura-hint");
    if (hint) hint.style.display = "flex";

    const tela = document.getElementById("tela-assinatura");
    tela.style.display = "flex";
    tela.classList.add("active");
    setTimeout(() => {
      if (_redimensionarAssinaturaCanvas) _redimensionarAssinaturaCanvas();
    }, 100);
  });
}

async function salvarAssinatura(reciboId, dataUrl, nome) {
  const res = await api("PUT", `/api/recibos/${reciboId}/assinatura`, { assinatura: dataUrl, nome_confirmado: nome || "" });
  return res && res.ok;
}

document.addEventListener("DOMContentLoaded", () => { initAssinaturaCanvas(); });
