// assinar.js — página pública de assinatura remota de recibo.
// Sem dependências; carregado via <script src="/assinar.js"> (CSP script-src 'self').
(function () {
  "use strict";

  // Token vem do path: /assinar/<token>
  var token = (location.pathname.split("/").filter(Boolean).pop() || "");

  var el = function (id) { return document.getElementById(id); };
  function mostrar(estado) {
    ["estado-carregando", "estado-erro", "estado-assinado", "estado-sucesso", "estado-form"]
      .forEach(function (e) { el(e).classList.add("hide"); });
    el(estado).classList.remove("hide");
  }
  function mostrarErro(titulo, texto) {
    el("erro-titulo").textContent = titulo;
    el("erro-texto").textContent = texto;
    mostrar("estado-erro");
  }

  // Logo: esconde se não carregar (sem handler inline por causa da CSP)
  var logo = el("logo-img");
  if (logo) logo.addEventListener("error", function () { logo.style.display = "none"; });

  // ── Canvas de desenho ──────────────────────────────────────
  var canvas = el("pad");
  var ctx = canvas.getContext("2d");
  var desenhando = false, temTraco = false, ultimoX = 0, ultimoY = 0;

  function ajustarCanvas() {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function iniciar(e) {
    desenhando = true;
    var p = pos(e); ultimoX = p.x; ultimoY = p.y;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (!temTraco) { temTraco = true; el("pad-hint").style.display = "none"; }
    e.preventDefault();
  }
  function mover(e) {
    if (!desenhando) return;
    var p = pos(e);
    // Curva quadrática até o ponto médio = traço suave (sem cantos quebrados)
    var midX = (ultimoX + p.x) / 2, midY = (ultimoY + p.y) / 2;
    ctx.quadraticCurveTo(ultimoX, ultimoY, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ultimoX = p.x; ultimoY = p.y;
    e.preventDefault();
  }
  function parar(e) { desenhando = false; if (e) e.preventDefault(); }

  canvas.addEventListener("mousedown", iniciar);
  canvas.addEventListener("mousemove", mover);
  canvas.addEventListener("mouseup", parar);
  canvas.addEventListener("mouseleave", parar);
  canvas.addEventListener("touchstart", iniciar, { passive: false });
  canvas.addEventListener("touchmove", mover, { passive: false });
  canvas.addEventListener("touchend", parar, { passive: false });
  window.addEventListener("resize", ajustarCanvas);

  el("btn-limpar").addEventListener("click", function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    temTraco = false;
    el("pad-hint").style.display = "flex";
  });

  // Recorta a assinatura no traço real (tira o espaço vazio), mantém a proporção
  // e fundo transparente — fica limpa e sem distorção no documento.
  function capturarPNG() {
    var w = canvas.width, h = canvas.height;
    var d = ctx.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = 0, maxY = 0, achou = false;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 10) {
          achou = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!achou) return canvas.toDataURL("image/png");
    var pad = Math.round(Math.max(w, h) * 0.04);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    var cw = maxX - minX + 1, ch = maxY - minY + 1;
    var max = 1000, escala = Math.min(1, max / Math.max(cw, ch));
    var out = document.createElement("canvas");
    out.width = Math.round(cw * escala);
    out.height = Math.round(ch * escala);
    var octx = out.getContext("2d");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  // ── Envio ──────────────────────────────────────────────────
  var enviando = false;
  el("btn-confirmar").addEventListener("click", async function () {
    if (enviando) return;
    var erro = el("form-erro");
    erro.textContent = "";
    if (!temTraco) { erro.textContent = "Por favor, desenhe sua assinatura no quadro."; return; }
    if (!el("f-nome").value.trim()) { erro.textContent = "Confirme seu nome completo."; return; }
    if (!el("f-aceite").checked) { erro.textContent = "Marque a declaração para confirmar."; return; }

    enviando = true;
    el("btn-confirmar").disabled = true;
    el("btn-confirmar").textContent = "Enviando…";
    try {
      var resp = await fetch("/api/assinatura/" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assinatura: capturarPNG(),
          nome_confirmado: el("f-nome").value.trim(),
        }),
      });
      if (resp.ok) { mostrar("estado-sucesso"); return; }
      var data = {};
      try { data = await resp.json(); } catch (_) {}
      if (resp.status === 409) { mostrar("estado-assinado"); return; }
      if (resp.status === 410) { mostrarErro("Link expirado", data.erro || "Este link de assinatura expirou."); return; }
      erro.textContent = data.erro || "Não foi possível registrar a assinatura. Tente novamente.";
    } catch (e) {
      erro.textContent = "Falha de conexão. Verifique sua internet e tente novamente.";
    } finally {
      enviando = false;
      el("btn-confirmar").disabled = false;
      el("btn-confirmar").textContent = "Confirmar e assinar";
    }
  });

  // ── Carregamento inicial ───────────────────────────────────
  async function carregar() {
    if (!/^[a-f0-9]{48}$/.test(token)) {
      mostrarErro("Link inválido", "Este link de assinatura não é válido.");
      return;
    }
    try {
      var resp = await fetch("/api/assinatura/" + encodeURIComponent(token));
      if (resp.status === 410) { mostrarErro("Link expirado", "Este link de assinatura expirou. Solicite um novo."); return; }
      if (!resp.ok) { mostrarErro("Link inválido", "Este link não foi encontrado ou já não é válido."); return; }
      var r = await resp.json();
      if (r.ja_assinado) { mostrar("estado-assinado"); return; }
      el("f-num").textContent = r.num || "—";
      el("f-valor").textContent = "R$ " + (r.valor || "—");
      el("f-data").textContent = r.data || "—";
      el("f-cpf").textContent = r.cpf_mascarado || "—";
      el("f-nome").value = r.nome || "";
      mostrar("estado-form");
      ajustarCanvas();
    } catch (e) {
      mostrarErro("Erro ao carregar", "Não foi possível carregar o recibo. Tente novamente.");
    }
  }

  carregar();
})();
