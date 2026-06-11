// ============================================================
// services/google-sheets.js — Google Sheets + Drive integration
// ============================================================
const { google } = require("googleapis");
const { Readable } = require("stream");
const { withTimeout } = require("./timeout");

const SHEET_ID   = process.env.SHEET_ID || "1qbpuZo5HLQHw4itjWbnXJNjBjIy63So3erMswhP2-68";
const SHEET_NAME = "Respostas ao formulário 1";
const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "1BUAPGfIIyehGWkmYlas0SYER3kriQK_H";

function getSheetsClient() {
  const credsB64 = process.env.GOOGLE_CREDENTIALS;
  if (!credsB64) {
    console.warn("⚠️  GOOGLE_CREDENTIALS não configurado — integração com Sheets desativada.");
    return null;
  }
  try {
    const creds = JSON.parse(Buffer.from(credsB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    return google.sheets({ version: "v4", auth });
  } catch (e) {
    console.error("❌ Erro ao inicializar Google Sheets:", e.message);
    return null;
  }
}

async function testarConexaoSheets() {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    await withTimeout(sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "spreadsheetId" }));
    console.log("✅ Conexão com Google Sheets OK.");
  } catch (e) {
    console.error(`❌ FALHA na conexão com Google Sheets: ${e.message}`);
    console.error(`   → Planilha ID: ${SHEET_ID}`);
  }
}

async function uploadParaDrive(buffer, nomeArquivo, mimeType) {
  const credsB64 = process.env.GOOGLE_CREDENTIALS;
  if (!credsB64) return null;
  try {
    const creds = JSON.parse(Buffer.from(credsB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const drive = google.drive({ version: "v3", auth });
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    const meta = { name: nomeArquivo };
    if (DRIVE_FOLDER_ID) meta.parents = [DRIVE_FOLDER_ID];
    const res = await withTimeout(drive.files.create({
      requestBody: meta,
      media: { mimeType, body: stream },
      fields: "id",
      supportsAllDrives: true,
    }));
    const fileId = res.data.id;
    await withTimeout(drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    }));
    return `https://drive.google.com/file/d/${fileId}/view`;
  } catch (e) {
    console.error("❌ Erro ao fazer upload pro Drive:", e.message);
    throw e;
  }
}

function sanitizarLinkParaSheets(link) {
  if (!link) return "";
  const s3Match = link.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
  if (s3Match) return `/api/comprovante-s3/${s3Match[1]}`;
  return link;
}

async function registrarNoSheets(dados) {
  const sheets = getSheetsClient();
  if (!sheets) return false;
  try {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const horaFormatada = agora.toLocaleTimeString("pt-BR");
    const carimbo = `${agora.toLocaleDateString("pt-BR")} ${horaFormatada}`;
    const dataPagamento = dados.data || agora.toLocaleDateString("pt-BR");
    const [dp, mp] = dataPagamento.split("/");
    const mesPagamento = (dp && mp && mp.length <= 2)
      ? MESES[parseInt(mp, 10) - 1] || MESES[agora.getMonth()]
      : MESES[agora.getMonth()];

    const linha = [
      carimbo,
      dados.nome || "",
      dados.cpf || "",
      dados.valor ? `R$ ${dados.valor}` : "",
      dataPagamento,
      dataPagamento,
      dados.forma_pagamento || "",
      dados.motivo_pagamento || dados.complemento || "Honorários Advocatícios",
      dados.escritorio || "",
      "",
      sanitizarLinkParaSheets(dados.link_comprovante),
      mesPagamento,
      dados.num_recibo || "",
      dados.emitido_por || "",
      dados.referencia || "",
    ];

    const colA = await withTimeout(sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    }));
    const nextRow = (colA.data.values || []).length + 1;

    await withTimeout(sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${nextRow}:O${nextRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [linha] },
    }));
    console.log(`✅ Recibo ${dados.num_recibo} registrado no Google Sheets (linha ${nextRow})`);
    return true;
  } catch (e) {
    console.error("❌ Erro ao registrar no Google Sheets:", e.message);
    return e.message;
  }
}

async function atualizarNoSheets(num, dados) {
  const sheets = getSheetsClient();
  if (!sheets) return;
  try {
    const res = await withTimeout(sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!M4:M`,
    }));
    const rows = res.data.values || [];
    const idx = rows.findIndex(r => r[0] === num);
    if (idx === -1) return;
    const rowNum = 4 + idx;
    const mes = MESES[new Date().getMonth()];
    const linha = [
      undefined,
      dados.nome || "",
      dados.cpf || "",
      dados.valor ? `R$ ${dados.valor}` : "",
      dados.data || "",
      dados.data || "",
      dados.forma_pagamento || "",
      dados.motivo_pagamento || dados.complemento || "",
      dados.escritorio || "",
      "",
      sanitizarLinkParaSheets(dados.link_comprovante),
      mes,
      num,
      dados.emitido_por || "",
      dados.referencia || "",
    ];
    await withTimeout(sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B${rowNum}:O${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [linha.slice(1)] },
    }));
    console.log(`✅ Recibo ${num} atualizado no Google Sheets`);
  } catch (e) {
    console.error("❌ Erro ao atualizar no Google Sheets:", e.message);
  }
}

async function linkParaSheets(link, s3SignerClient) {
  if (!link) return "";
  const s3Match = link.match(/^\/api\/comprovante-s3\/(.+)$/);
  if (!s3Match) return link;
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) return link;
  try {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: s3Match[1] });
    const urlPromise = getSignedUrl(s3SignerClient, cmd, { expiresIn: 30 * 24 * 3600 });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000));
    return await Promise.race([urlPromise, timeoutPromise]);
  } catch (e) {
    console.error("❌ Presigned URL falhou:", e.message);
    return link;
  }
}

async function renovarPresignedUrlsSheets(s3SignerClient) {
  const sheets = getSheetsClient();
  const bucket = process.env.BUCKET_NAME;
  if (!sheets || !bucket) {
    console.warn(`⚠️  Renovação de URLs ignorada — Sheets ou BUCKET_NAME não configurados.`);
    return;
  }
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!K:K`,
    });
    const linhas = resp.data.values || [];
    const atualizacoes = [];
    for (let i = 0; i < linhas.length; i++) {
      const celK = (linhas[i][0] || "").trim();
      if (!celK) continue;
      const s3PathMatch = celK.match(/^\/api\/comprovante-s3\/(.+)$/);
      const presignedMatch = celK.match(/amazonaws\.com\/(.+?)(?:\?|$)/);
      const chave = s3PathMatch ? s3PathMatch[1] : presignedMatch ? presignedMatch[1] : null;
      if (!chave) continue;
      try {
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: decodeURIComponent(chave) });
        const novaUrl = await getSignedUrl(s3SignerClient, cmd, { expiresIn: 30 * 24 * 3600 });
        atualizacoes.push({ range: `${SHEET_NAME}!K${i + 1}`, values: [[novaUrl]] });
      } catch (e) {
        console.warn(`⚠️  Não foi possível renovar URL para chave "${chave}": ${e.message}`);
      }
    }
    if (atualizacoes.length === 0) {
      console.log(`ℹ️  Renovação de URLs: nenhum link S3 encontrado na planilha.`);
      return;
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: atualizacoes },
    });
    console.log(`✅ Renovação de presigned URLs — ${atualizacoes.length} link(s) atualizado(s).`);
  } catch (e) {
    console.error(`❌ Erro na renovação de presigned URLs: ${e.message}`);
  }
}

module.exports = {
  getSheetsClient,
  testarConexaoSheets,
  uploadParaDrive,
  sanitizarLinkParaSheets,
  registrarNoSheets,
  atualizarNoSheets,
  linkParaSheets,
  renovarPresignedUrlsSheets,
  SHEET_ID,
  SHEET_NAME,
  MESES,
};
