// ============================================================
// services/email.js — SMTP: transporter, envio e templates
// Movido de server.js na Fase 1 da refatoração.
// ============================================================
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const logger = require("./logger");

// â”€â”€ EMAIL SMTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VariÃ¡veis de ambiente necessÃ¡rias no Elastic Beanstalk:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=email@dominio.com
//   SMTP_PASS=senha_de_app          â† use App Password do Google, nÃ£o a senha da conta
//   SMTP_FROM=Araujo Prev <email@dominio.com>
//   SMTP_ADMIN=email-do-admin@dominio.com  â† destinatÃ¡rio dos alertas de inadimplÃªncia

function smtpConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function criarTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function enviarEmail({ to, subject, html, attachments = [] }) {
  if (!smtpConfigurado()) {
    logger.warn("âš ï¸  SMTP nÃ£o configurado â€” e-mail nÃ£o enviado.");
    return false;
  }
  const transporter = criarTransporter();
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    logger.info(`âœ… E-mail enviado para ${to} â€” messageId: ${info.messageId}`);
    return true;
  } catch (e) {
    logger.error(`âŒ Falha ao enviar e-mail para ${to}: ${e.message}`);
    return false;
  }
}

// Carrega template HTML de web/templates/ e substitui variÃ¡veis {{chave}} pelos valores.
function carregarTemplate(nome, variaveis = {}) {
  try {
    const templatePath = path.join(__dirname, "..", "templates", nome);
    let html = fs.readFileSync(templatePath, "utf8");
    for (const [chave, valor] of Object.entries(variaveis)) {
      html = html.replaceAll(`{{${chave}}}`, valor ?? "");
    }
    return html;
  } catch (e) {
    logger.error(`âŒ Erro ao carregar template ${nome}: ${e.message}`);
    return null;
  }
}

module.exports = { smtpConfigurado, criarTransporter, enviarEmail, carregarTemplate };
