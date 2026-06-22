// web/public/app/assinatura.js — assinatura digital no celular
let _assinaturaResolve = null;
let _reciboParaAssinar = null;
let _assinando = false;

function initAssinaturaCanvas() {
  const canvas = document.getElementById("assinatura-canvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  let desenhando = false;
  let ultimoX = 0, ultimoY = 0;

  function redim() {
    const r = wrap.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }
  redim();
  window.addEventListener("resize", redim);

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function iniciar(e) {
    desenhando = true;
    const p = getPos(e);
    ultimoX = p.x; ultimoY = p.y;
    e.preventDefault();
  }

  function mover(e) {
    if (!desenhando) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(ultimoX, ultimoY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimoX = p.x; ultimoY = p.y;
    e.preventDefault();
  }

  function parar(e) {
    desenhando = false;
    e.preventDefault();
  }

  canvas.addEventListener("mousedown", iniciar);
  canvas.addEventListener("mousemove", mover);
  canvas.addEventListener("mouseup", parar);
  canvas.addEventListener("mouseleave", parar);
  canvas.addEventListener("touchstart", iniciar, { passive: false });
  canvas.addEventListener("touchmove", mover, { passive: false });
  canvas.addEventListener("touchend", parar, { passive: false });

  document.getElementById("btn-assinatura-limpar").onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  document.getElementById("btn-assinatura-confirmar").onclick = () => {
    // Redimensiona pra no mÃ¡ximo 400x150 pra comprimir
    const maxW = 400, maxH = 150;
    const tmp = document.createElement("canvas");
    tmp.width = maxW; tmp.height = maxH;
    const tctx = tmp.getContext("2d");
    tctx.fillStyle = "#fff";
    tctx.fillRect(0, 0, maxW, maxH);
    tctx.drawImage(canvas, 0, 0, maxW, maxH);
    const dataUrl = tmp.toDataURL("image/png");
    document.getElementById("tela-assinatura").classList.remove("active");
    document.getElementById("tela-assinatura").style.display = "none";
    if (_assinaturaResolve) _assinaturaResolve(dataUrl);
    _assinaturaResolve = null;
    _reciboParaAssinar = null;
  };
}

async function mostrarTelaAssinatura(nomeCliente) {
  return new Promise((resolve) => {
    _assinaturaResolve = resolve;
    document.getElementById("assinatura-cliente-nome").textContent = nomeCliente || "";
    const tela = document.getElementById("tela-assinatura");
    tela.style.display = "flex";
    tela.classList.add("active");
    setTimeout(() => {
      const canvas = document.getElementById("assinatura-canvas");
      if (canvas) {
        const wrap = canvas.parentElement;
        const r = wrap.getBoundingClientRect();
        canvas.width = r.width * devicePixelRatio;
        canvas.height = r.height * devicePixelRatio;
        canvas.getContext("2d").scale(devicePixelRatio, devicePixelRatio);
      }
    }, 100);
  });
}

async function salvarAssinatura(reciboId, dataUrl) {
  const res = await api("PUT", `/api/recibos/${reciboId}/assinatura`, { assinatura: dataUrl });
  return res && res.ok;
}

document.addEventListener("DOMContentLoaded", () => { initAssinaturaCanvas(); });
