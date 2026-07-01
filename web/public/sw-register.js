if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      reg.addEventListener("updatefound", () => {
        const novo = reg.installing;
        novo.addEventListener("statechange", () => {
          if (novo.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA] Nova versão disponível. Feche e abra o app para atualizar.");
          }
        });
      });
    }).catch(() => {});
  });
}
