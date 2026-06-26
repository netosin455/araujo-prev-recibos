// Lambda worker — exportação de recibos em lote (PDF -> ZIP -> S3)
// Disparado pela fila SQS araujo-prev-jobs. Atualiza a tabela export_jobs no Neon.
// O app (EB) gera a URL assinada de download a partir do s3_key (signer de credenciais longas).
const { Pool } = require("pg");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");

const BUCKET = process.env.BUCKET_NAME;
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

let _pool;
function db() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  return _pool;
}

const MESES_EXT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

// Mesma lógica de gerarBufferPDFRecibo do app (web/routes/recibos.js)
function gerarBufferPDFRecibo(recibo) {
  const logoPath = path.join(__dirname, "logo.png");
  const logoExists = fs.existsSync(logoPath);
  const digits = (recibo.cpf || "").replace(/\D/g, "");
  const labelDoc = digits.length > 11 ? "CNPJ" : "CPF";
  const complemento = recibo.complemento ? ` - ${recibo.complemento}` : "";
  const [dia, mes, ano] = (recibo.data || "").split("/");
  const mesNome = MESES_EXT[parseInt(mes, 10) - 1] || "";
  const data_extenso = dia && mes && ano ? `${parseInt(dia, 10)} de ${mesNome} de ${ano}` : (recibo.data || "");
  const textoCorpo = `Recebemos do (a) senhor (a) ${recibo.nome}, residente e domiciliado(a) no Município de ${recibo.municipio_uf}, a importância de R$ ${recibo.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ margin: 60, size: "A4" });
    pdf.on("data", c => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    if (logoExists) pdf.image(logoPath, { fit: [160, 61], align: "center" }).moveDown(0.5);
    pdf.fontSize(14).fillColor("#1E40AF").font("Helvetica-Bold")
      .text("A ARAUJO SERVIÇOS LTDA ME", { align: "center" }).moveDown(0.2);
    pdf.fontSize(12).fillColor("#000000").text("A ARAUJO PREV", { align: "center" }).moveDown(0.3);
    const lx = pdf.page.margins.left;
    const lw = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.4);
    pdf.fontSize(12).font("Helvetica-Bold")
      .text(`Recibo Nº ${recibo.num}${recibo.referencia ? "   |   Ref: " + recibo.referencia : ""}`, { align: "center" }).moveDown(0.2);
    pdf.fontSize(14).text("RECIBO DE HONORÁRIOS ADVOCATÍCIOS", { align: "center" }).moveDown(0.8);
    pdf.fontSize(11).font("Helvetica").text(textoCorpo, { align: "justify" }).moveDown(0.6);
    pdf.text("Por ser verdade, firmo o presente que segue datado e assinado.", { align: "justify" }).moveDown(0.8);
    pdf.moveTo(lx, pdf.y).lineTo(lx + lw, pdf.y).stroke().moveDown(0.6);
    pdf.text(`${recibo.municipio_uf}, ${data_extenso}`, { align: "left" }).moveDown(6);
    pdf.text("________________________________________", { align: "center" }).moveDown(0.2);
    pdf.fontSize(10).text(recibo.nome, { align: "center" }).moveDown(0.1);
    pdf.fontSize(9).text(`${labelDoc}: ${recibo.cpf}`, { align: "center" }).moveDown(5);
    pdf.fontSize(11).text("________________________", { align: "left" }).moveDown(0.2);
    pdf.fontSize(10).text(recibo.emitido_por || "A ARAUJO PREV", { align: "left" });
    if (logoExists) pdf.moveDown(1).image(logoPath, { fit: [140, 53], align: "center" });
    pdf.end();
  });
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
      const buf = await gerarBufferPDFRecibo(recibo);
      const nomeArq = `recibo_${String(recibo.num || id).replace(/[\/\\]/g, "-")}_${(recibo.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_").toLowerCase()}.pdf`;
      arquivos.push({ buffer: buf, name: nomeArq });
      prontos++;
      if (prontos % 5 === 0) await pool.query("UPDATE export_jobs SET prontos=$1 WHERE id=$2", [prontos, jobId]);
    } catch (e) {
      console.error(`Erro PDF recibo ${id}:`, e.message);
    }
  }

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
