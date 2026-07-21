// Lambda worker — exportação de recibos em lote (PDF -> ZIP -> S3)
// Disparado pela fila SQS araujo-prev-jobs. Atualiza a tabela export_jobs no Neon.
// O app (EB) gera a URL assinada de download a partir do s3_key (signer de credenciais longas).
const { Pool } = require("pg");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
// pdf-generator.js é a FONTE ÚNICA, copiada de web/services/ pelo script "build"
// (npm run build) antes de zipar a Lambda. Não há cópia divergente para manter em sync.
const { gerarBufferPDFRecibo } = require("./pdf-generator");

const BUCKET = process.env.BUCKET_NAME;
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const LOGO_PATH = path.join(__dirname, "logo.png");

let _pool;
function db() {
  // Neon exige SSL com certificado válido (CA pública) — mantemos a verificação ligada
  // por padrão. DB_SSL=false permite apontar pra um Postgres sem certificado público
  // (ex: instância EC2 própria) sem afetar o Neon em produção.
  // max:1 — cada execução concorrente da Lambda abre seu próprio pool; manter 1 conexão
  // por execução evita estourar o limite de conexões do banco em picos de concorrência.
  const useDbSsl = process.env.DB_SSL !== "false";
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: useDbSsl ? { rejectUnauthorized: true } : false, max: 1 });
  return _pool;
}

function montarZip(arquivos) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("data", c => chunks.push(c));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const a of arquivos) archive.append(a.buffer, { name: a.name });
    archive.finalize();
  });
}

async function processarJob(jobId, ids) {
  const pool = db();
  const cur = await pool.query("SELECT status FROM export_jobs WHERE id=$1", [jobId]);
  if (!cur.rows[0]) { console.warn("job inexistente:", jobId); return; }
  if (cur.rows[0].status === "pronto") { console.log("job já pronto, ignorando:", jobId); return; }
  await pool.query("UPDATE export_jobs SET status='processando' WHERE id=$1", [jobId]);

  const arquivos = [];
  let prontos = 0;
  for (const id of ids) {
    const { rows } = await pool.query("SELECT * FROM recibos WHERE id=$1 AND deletado_em IS NULL", [id]);
    const recibo = rows[0];
    if (!recibo) continue;
    try {
      const buf = await gerarBufferPDFRecibo(recibo, LOGO_PATH);
      const nomeArq = `recibo_${String(recibo.num || id).replace(/[\/\\]/g, "-")}_${(recibo.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_").toLowerCase()}.pdf`;
      arquivos.push({ buffer: buf, name: nomeArq });
      prontos++;
      if (prontos % 5 === 0) await pool.query("UPDATE export_jobs SET prontos=$1 WHERE id=$2", [prontos, jobId]);
    } catch (e) {
      console.error(`Erro PDF recibo ${id}:`, e.message);
    }
  }

  // Não sobe ZIP vazio: se nenhum PDF foi gerado, falha o job (catch grava 'erro' e re-lança pra SQS/DLQ).
  if (arquivos.length === 0) throw new Error(`Nenhum PDF gerado para o job ${jobId} (${ids.length} ids solicitados)`);

  const zipBuf = await montarZip(arquivos);
  const key = `exports/${jobId}.zip`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: zipBuf, ContentType: "application/zip" }));
  await pool.query("UPDATE export_jobs SET status='pronto', prontos=$1, s3_key=$2 WHERE id=$3", [prontos, key, jobId]);
  console.log(`Job ${jobId} pronto: ${prontos}/${ids.length} recibos -> s3://${BUCKET}/${key}`);
}

exports.handler = async (event) => {
  for (const record of (event.Records || [])) {
    let body;
    try { body = JSON.parse(record.body); } catch { console.error("mensagem com body inválido, ignorando"); continue; }
    const { jobId, ids } = body;
    if (!jobId || !Array.isArray(ids)) { console.error("payload inválido:", record.body); continue; }
    try {
      await processarJob(jobId, ids);
    } catch (e) {
      console.error(`Falha no job ${jobId}:`, e.message);
      try { await db().query("UPDATE export_jobs SET status='erro', erro=$1 WHERE id=$2", [String(e.message).slice(0, 500), jobId]); } catch (_) {}
      throw e; // re-lança: SQS re-tenta e, após maxReceiveCount, manda pra DLQ
    }
  }
  return { ok: true };
};
