// Gerador de PDF de recibo — FONTE ÚNICA compartilhada entre o app (web/routes/recibos.js)
// e o Lambda worker (lambda/export-worker/index.js).
//
// IMPORTANTE: a Lambda é empacotada separadamente do web/. O build da Lambda copia
// este arquivo para dentro de lambda/export-worker/ (ver script "build" no package.json
// da Lambda). NÃO edite uma cópia divergente — altere apenas este arquivo.
const PDFDocument = require("pdfkit");
const fs = require("fs");

const MESES_EXT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

// Gera o buffer PDF de um recibo do banco.
// logoPath: caminho absoluto para a logo (opcional — se não existir, o PDF é gerado sem ela).
function gerarBufferPDFRecibo(recibo, logoPath) {
  const logoExists = !!logoPath && fs.existsSync(logoPath);
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

module.exports = { gerarBufferPDFRecibo, MESES_EXT };
