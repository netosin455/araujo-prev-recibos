// ============================================================
// services/cron.js — Jobs agendados (lembretes, backup S3,
// renovação de URLs, inadimplência, limpeza) + health check.
// Movido de server.js na Fase 1 da refatoração.
// ============================================================
const cron = require("node-cron");
const archiver = require("archiver");
const path = require("path");
const fs = require("fs");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const logger = require("./logger");
const { withTimeout } = require("./timeout");
const { renovarPresignedUrlsSheets } = require("./google-sheets");
const { smtpConfigurado, enviarEmail, carregarTemplate } = require("./email");
const { inicializarParcelasLegado, recalcularResumo } = require("./helpers");

// Registra os cron jobs e a rota de health check.
// Retorna funções usadas pelo entry point (verificação no startup).
module.exports = function iniciarCronEHealth({ app, pgPool, db, dbClientes, NAO_DELETADO, s3Client, s3SignerClient }) {
  const { find, update } = db;

// â”€â”€ WEBHOOK â€” RECIBO GERADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dispara um POST para WEBHOOK_URL (se configurado) a cada recibo salvo.
// â”€â”€ LEMBRETE AUTOMÃTICO DE PARCELAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa 30s apÃ³s startup para nÃ£o bloquear a inicializaÃ§Ã£o.
// Envia e-mail ao SMTP_ADMIN com parcelas que vencem nos prÃ³ximos 3 dias
// e ainda nÃ£o tiveram lembrete registrado (lembrete_enviado_em ausente).
async function verificarEEnviarLembretesParcelasProximas() {
  if (!smtpConfigurado()) return;

  const adminEmail = process.env.SMTP_ADMIN || process.env.SMTP_USER;
  if (!adminEmail) return;

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje);
    limite.setDate(hoje.getDate() + 3);

    const clientes = await find(dbClientes, NAO_DELETADO);
    const lembretes = [];

    for (const cliente of clientes) {
      const parcelasInicializadas = inicializarParcelasLegado(cliente).parcelas;
      for (const p of parcelasInicializadas) {
        if (p.status === "pago") continue;
        if (p.lembrete_enviado_em) continue;
        if (!p.data_vencimento) continue;

        const [d, m, y] = p.data_vencimento.split("/");
        const venc = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        if (venc >= hoje && venc <= limite) {
          lembretes.push({ cliente, parcela: p, venc });
        }
      }
    }

    if (lembretes.length === 0) {
      logger.info(`Lembrete automÃ¡tico: nenhuma parcela vencendo nos prÃ³ximos 3 dias.`);
      return;
    }

    const linhasLembrete = `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb">
        <thead><tr style="background:#d97706;color:#fff">
          <th style="padding:8px 10px;text-align:left">Cliente</th>
          <th style="padding:8px 10px">Parcela</th>
          <th style="padding:8px 10px">Valor</th>
          <th style="padding:8px 10px">Vencimento</th>
        </tr></thead>
        <tbody>${lembretes.map(l => `
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${l.cliente.nome}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${l.parcela.num}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">R$ ${parseFloat(l.parcela.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${l.parcela.data_vencimento}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;

    const html = carregarTemplate("email-lembrete.html", {
      data_relatorio: new Date().toLocaleDateString("pt-BR"),
      total_parcelas: lembretes.length,
      tabela_parcelas: linhasLembrete,
    }) || `<p>${lembretes.length} parcela(s) vencem nos prÃ³ximos 3 dias.</p>`;

    const ok = await enviarEmail({
      to: adminEmail,
      subject: `[Araujo Prev] ${lembretes.length} parcela(s) vencem nos prÃ³ximos 3 dias`,
      html,
    });

    if (ok) {
      // Registra lembrete_enviado_em em cada parcela diretamente no NeDB
      const agora = new Date().toISOString();
      for (const l of lembretes) {
        const parcelasAtualizadas = inicializarParcelasLegado(l.cliente).parcelas.map(p =>
          p.num === l.parcela.num
            ? { ...p, lembrete_enviado_em: agora, lembrete_enviado_por: "sistema" }
            : p
        );
        const resumo = recalcularResumo(parcelasAtualizadas);
        await update(dbClientes, { _id: l.cliente._id }, { parcelas: parcelasAtualizadas, ...resumo });
      }
      logger.info(`âœ… Lembretes de parcela enviados: ${lembretes.length} parcela(s) â€” destinatÃ¡rio: ${adminEmail}`);
    }
  } catch (e) {
    logger.error(`âŒ Erro no lembrete automÃ¡tico de parcelas: ${e.message}`);
  }
}

// â”€â”€ CRON â€” LEMBRETE DIÃRIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa todo dia Ã s 8h no horÃ¡rio de BrasÃ­lia
cron.schedule("0 8 * * *", () => {
  logger.info(`ðŸ•— Cron disparado: verificando lembretes de parcelas...`);
  verificarEEnviarLembretesParcelasProximas();
}, { timezone: "America/Sao_Paulo" });

// â”€â”€ BACKUP AUTOMÃTICO DIÃRIO PARA S3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Zipa recibos.db + clientes.db e grava em s3://BUCKET/backups/YYYY-MM-DD_backup_db.zip
async function fazerBackupDiario() {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    logger.warn(`âš ï¸  Backup diÃ¡rio ignorado â€” BUCKET_NAME nÃ£o configurado.`);
    return;
  }
  const ts = new Date().toISOString().slice(0, 10);
  const chaveS3 = `backups/${ts}_backup_db.zip`;
  try {
    const dataDir = path.join(__dirname, "..", "data");
    const arquivos = ["recibos.db", "clientes.db"].filter(f => fs.existsSync(path.join(dataDir, f)));
    if (arquivos.length === 0) {
      logger.warn(`âš ï¸  Backup: nenhum arquivo .db encontrado em ${dataDir}`);
      return;
    }

    const zipBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("data", chunk => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
      for (const f of arquivos) archive.file(path.join(dataDir, f), { name: f });
      archive.finalize();
    });

    await withTimeout(s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: chaveS3,
      Body: zipBuffer,
      ContentType: "application/zip",
    })), 30000);
    logger.info(`âœ… Backup diÃ¡rio â†’ s3://${bucket}/${chaveS3} (${(zipBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    logger.error(`âŒ Erro no backup diÃ¡rio: ${e.message}`);
  }
}

// Executa todo dia Ã s 02:00 BRT (05:00 UTC)
cron.schedule("0 5 * * *", () => {
  logger.info(`ðŸ•— Cron disparado: backup diÃ¡rio para S3...`);
  fazerBackupDiario();
}, { timezone: "UTC" });

// â”€â”€ RENOVAÃ‡ÃƒO SEMANAL DE PRESIGNED URLS NO GOOGLE SHEETS â”€â”€
// Percorre a coluna K da planilha e regera os links "Ver comprovante" (URLs de 7 dias)
// para cada comprovante S3 encontrado — sempre antes de qualquer link expirar.
// Executa todo domingo Ã s 03:00 BRT (06:00 UTC)
cron.schedule("0 6 * * 0", () => {
  logger.info(`ðŸ•— Cron disparado: renovaÃ§Ã£o de presigned URLs no Sheets...`);
  renovarPresignedUrlsSheets(s3SignerClient);
}, { timezone: "UTC" });

// â”€â”€ CRON â€” INADIMPLÃŠNCIA + EMAIL DIÃRIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Executa todo dia Ã s 8h no horÃ¡rio de BrasÃ­lia: marca parcelas vencidas como atrasadas
// e envia e-mail ao admin se houver inadimplentes.
cron.schedule("0 8 * * *", async () => {
  logger.info("[CRON] Verificando parcelas inadimplentes...");
  try {
    const clientes = await find(dbClientes, NAO_DELETADO);
    const hoje = new Date().toISOString().slice(0, 10);
    let totalCount = 0;
    for (const c of clientes) {
      let count = 0;
      const parcelas = (c.parcelas || []).map(p => {
        if (p.status === "pendente" && p.data_vencimento) {
          const [d, m, y] = p.data_vencimento.split("/");
          if (d && m && y) {
            const vencFormatado = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            if (vencFormatado < hoje) {
              count++;
              return { ...p, status: "atrasado" };
            }
          }
        }
        return p;
      });
      if (count > 0) {
        await update(dbClientes, { _id: c._id }, { parcelas });
        totalCount += count;
      }
    }
    logger.info(`[CRON] ${totalCount} parcela(s) marcada(s) como atrasada(s).`);
    if (totalCount > 0 && smtpConfigurado()) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_ADMIN || process.env.SMTP_USER;
      if (adminEmail) {
        try {
          await enviarEmail({
            to: adminEmail,
            subject: `[Araujo Prev] ${totalCount} parcela(s) inadimplente(s)`,
            html: `<p>OlÃ¡,</p><p>${totalCount} parcela(s) estÃ£o vencidas e foram marcadas como atrasadas automaticamente.</p><p>Acesse o sistema para mais detalhes.</p>`,
          });
          logger.info(`[CRON] Email de inadimplÃªncia enviado para ${adminEmail}`);
        } catch(e) {
          logger.error("[CRON] Erro ao enviar email:", e.message);
        }
      }
    }
  } catch(e) {
    logger.error("[CRON] Erro na verificaÃ§Ã£o:", e.message);
  }
}, { timezone: "America/Sao_Paulo" });

// ── CRON — LIMPEZA DE JOBS DE EXPORTAÇÃO ANTIGOS ──────────────
// Remove registros de export_jobs com mais de 7 dias (os ZIPs no S3 já expiram
// pelo lifecycle). Roda todo dia às 04:00 UTC. Mantém a tabela enxuta.
cron.schedule("0 4 * * *", async () => {
  try {
    const { rowCount } = await pgPool.query(
      "DELETE FROM export_jobs WHERE criado_em < NOW() - INTERVAL '7 days'"
    );
    if (rowCount > 0) logger.info(`[CRON] ${rowCount} job(s) de exportação antigo(s) removido(s).`);
  } catch (e) {
    logger.error("[CRON] Erro ao limpar export_jobs antigos:", e.message);
  }
}, { timezone: "UTC" });

// ---- CRON - AUTO-RECIBOS MENSAIS: REMOVIDO ------------------------------------
// Removido a pedido do usuário: gerava recibos automaticamente todo mês e era
// fonte de duplicação/recibos indesejados. Não recriar sem aprovação explícita.

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const checks = { pg: false, s3: false, sqs: false };
  try {
    await pgPool.query("SELECT 1");
    checks.pg = true;
  } catch (_) {}
  if (s3Client) {
    try {
      await s3Client.config.region();
      checks.s3 = true;
    } catch (_) {}
  }
  checks.sqs = !!process.env.EXPORT_QUEUE_URL;
  const healthy = checks.pg;
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks, uptime: process.uptime() });
});

  return { verificarEEnviarLembretesParcelasProximas };
};
