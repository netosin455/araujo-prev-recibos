// ============================================================
// middleware/async-wrap.js — Express 4 não captura erro de handler
// async: uma rejeição sem try/catch vira unhandledRejection e derruba
// o processo (Node 15+). Este patch embrulha TODO handler async
// registrado via app.get/post/put/patch/delete para que qualquer erro
// caia no error handler global (res 500) em vez de matar o servidor.
// ============================================================
module.exports = function aplicarAsyncWrap(app) {
  for (const metodo of ["get", "post", "put", "patch", "delete"]) {
    const original = app[metodo].bind(app);
    app[metodo] = function (path, ...handlers) {
      // app.get("chave") sem handlers é leitura de configuração do Express
      if (metodo === "get" && handlers.length === 0) return original(path);
      return original(path, ...handlers.map(h =>
        typeof h === "function" && h.constructor.name === "AsyncFunction"
          ? (req, res, next) => h(req, res, next).catch(next)
          : h
      ));
    };
  }
  return app;
};
