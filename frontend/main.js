const path = require("path");
const fs   = require("fs");
const os   = require("os");
const { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun, BorderStyle } = require("docx");

// Deleta o cache do node_modules/electron/index.js para que o interceptor
// do reset-search-paths (instalado pelo browser_init) possa resolver corretamente
const electronPkg = path.join(__dirname, "node_modules", "electron", "index.js");
delete require.cache[electronPkg];

const { app, BrowserWindow, ipcMain, shell } = require("electron");

function getLogoPath() {
  const prod = path.join(process.resourcesPath, "Logo par forms.png");
  const dev  = path.join(__dirname, "Logo par forms.png");
  return fs.existsSync(prod) ? prod : (fs.existsSync(dev) ? dev : null);
}

function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { after: opts.spaceAfter ?? 80 },
    children: [new TextRun({
      text, bold: opts.bold || false,
      size: (opts.size || 11) * 2,
      color: opts.color || "000000",
      font: "Arial",
    })],
  });
}

function linha() {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
    children: [],
  });
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 700,
    minWidth: 800, minHeight: 600,
    title: "Araujo Prev — Gestão de Recibos",
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: true },
  });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("gerar-recibo", async (event, dados) => {
    try {
      const digits      = dados.cpf.replace(/\D/g, "");
      const labelDoc    = digits.length > 11 ? "CNPJ" : "CPF";
      const complemento = dados.complemento ? ` - ${dados.complemento}` : "";
      const logoPath    = getLogoPath();
      const children    = [];

      if (logoPath) {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new ImageRun({ data: fs.readFileSync(logoPath), transformation: { width: 200, height: 76 }, type: "png" })],
        }));
      }

      const textoCorpo = `Recebemos do (a) senhor (a) ${dados.nome}, residente e domiciliado(a) no Município de ${dados.municipio_uf}, a importância de R$ ${dados.valor} referentes aos honorários advocatícios relacionados à Ação Previdenciária${complemento}.`;

      children.push(
        p("A ARAUJO SERVIÇOS LTDA ME", { align: AlignmentType.CENTER, bold: true, size: 14, color: "1E40AF", spaceAfter: 40 }),
        p("A ARAUJO PREV",              { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 40 }),
        linha(),
        p(`Recibo Nº ${dados.num_recibo}${dados.referencia ? "   |   Ref: " + dados.referencia : ""}`, { align: AlignmentType.CENTER, bold: true, size: 12, spaceAfter: 20 }),
        p("RECIBO DE HONORÁRIOS ADVOCATÍCIOS",       { align: AlignmentType.CENTER, bold: true, size: 14, spaceAfter: 120 }),
        p(textoCorpo,                                { align: AlignmentType.JUSTIFIED, spaceAfter: 80 }),
        p("Por ser verdade, firmo o presente que segue datado e assinado.", { align: AlignmentType.JUSTIFIED, spaceAfter: 120 }),
        linha(),
        p(`${dados.municipio_uf}, ${dados.data_extenso}`, { align: AlignmentType.LEFT, spaceAfter: 800 }),
        p("________________________________________",      { align: AlignmentType.CENTER, spaceAfter: 160 }),
        p(`${labelDoc}: ${dados.cpf}`,                    { align: AlignmentType.CENTER, size: 10, spaceAfter: 0 }),
      );

      if (logoPath) {
        children.push(
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 40 }, children: [new TextRun({ text: "________________________", font: "Arial", size: 22 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: dados.emitido_por || "A ARAUJO PREV", bold: true, font: "Arial", size: 22 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 700, after: 0 }, children: [new ImageRun({ data: fs.readFileSync(logoPath), transformation: { width: 200, height: 76 }, type: "png" })] }),
        );
      }

      const doc = new Document({
        sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children }],
      });

      const buf    = await Packer.toBuffer(doc);
      const ano    = new Date().getFullYear();
      const pasta  = path.join(os.homedir(), "Documents", "Araujo Prev", "Recibos", String(ano));
      fs.mkdirSync(pasta, { recursive: true });
      const nomeArquivoSanitizado = dados.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").toLowerCase();
      const numReciboSanitizado = dados.num_recibo.replace(/[\/\\]/g, "-");
      const arquivo = path.join(pasta, `recibo_${numReciboSanitizado}_${nomeArquivoSanitizado}.docx`);
      fs.writeFileSync(arquivo, buf);
      shell.openPath(arquivo);
      return { ok: true, arquivo };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  });

  ipcMain.handle("abrir-arquivo", async (event, arquivo) => {
    if (fs.existsSync(arquivo)) { await shell.openPath(arquivo); return { ok: true }; }
    return { ok: false, erro: "Arquivo não encontrado" };
  });

  ipcMain.handle("abrir-pasta", async (event, arquivo) => {
    if (fs.existsSync(arquivo)) { shell.showItemInFolder(arquivo); return { ok: true }; }
    return { ok: false, erro: "Arquivo não encontrado" };
  });

  ipcMain.handle("escolher-pasta", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("salvar-backup", async (event, { pasta, json }) => {
    try {
      const nome = `backup_araujo_${new Date().toISOString().slice(0,10)}.json`;
      const arquivo = path.join(pasta, nome);
      fs.writeFileSync(arquivo, json, "utf8");
      return { ok: true, arquivo };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
});

app.on("window-all-closed", () => app.quit());
