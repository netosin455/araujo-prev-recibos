if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      // Checa por atualização a cada vez que o app volta ao foco (celular fica
      // dias aberto em background sem nunca recarregar).
      const checar = () => { reg.update().catch(() => {}); };
      document.addEventListener("visibilitychange", () => { if (!document.hidden) checar(); });
      reg.addEventListener("updatefound", () => {
        const novo = reg.installing;
        if (!novo) return;
        novo.addEventListener("statechange", () => {
          // Nova versão instalada e já havia um SW controlando = é update, não
          // primeira visita. O sw.js já faz skipWaiting() no install, então ele
          // assume sozinho e o controllerchange abaixo recarrega a página.
          if (novo.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA] Atualização encontrada, aplicando...");
          }
        });
      });
    }).catch(() => {});

    // Quando o SW novo assume o controle, recarrega a página UMA vez para
    // garantir que o celular rode o código e o CSP atualizados.
    let recarregando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recarregando) return;
      recarregando = true;
      window.location.reload();
    });
  });
}
