// Logger estruturado — logs em JSON para melhor debugging em produção
// Uso: logger.info("mensagem", { usuario, acao }) ou logger.error("falhou", { err })
function now() { return new Date().toISOString(); }

function log(level, msg, meta) {
  const entry = { ts: now(), level, msg };
  if (meta && typeof meta === "object") {
    if (meta.err instanceof Error) {
      entry.error = { message: meta.err.message, stack: meta.err.stack?.split("\n").slice(0, 4).map(s => s.trim()) };
      delete meta.err;
    }
    Object.assign(entry, meta);
  }
  const output = JSON.stringify(entry);
  if (level === "ERROR" || level === "WARN") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

module.exports = {
  info: (msg, meta) => log("INFO", msg, meta),
  warn: (msg, meta) => log("WARN", msg, meta),
  error: (msg, meta) => log("ERROR", msg, meta),
  debug: (msg, meta) => { if (process.env.NODE_ENV !== "production") log("DEBUG", msg, meta); },
};
