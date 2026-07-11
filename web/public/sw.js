// Service Worker — Araujo Prev PWA
// IMPORTANTE: ao fazer deploy de mudanças no front, suba o número da versão
// abaixo (v4 -> v5...). Isso força o celular a limpar o cache antigo e baixar
// o código + o index.html novos (senão o app fica preso numa versão velha,
// com botões que não respondem e o CSP antigo bloqueando as imagens do S3).
const CACHE = "araujo-prev-v4";
const STATIC = ["/", "/index.html", "/manifest.json", "/logo.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  // Só cuidamos de GET do próprio site. API, imagens do S3 (presigned, expiram)
  // e qualquer outra origem passam direto pra rede — nada de cache.
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  // Network-first: sempre tenta o servidor (pega a versão nova); cai no cache só offline.
  e.respondWith(
    fetch(req)
      .then(res => {
        // Só cacheia respostas válidas do próprio site (evita guardar erro/404).
        if (res && res.ok && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
