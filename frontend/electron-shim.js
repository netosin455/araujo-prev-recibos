// Este arquivo substitui o node_modules/electron/index.js
// quando rodando dentro do processo principal do Electron
const fs = require('fs');
const path = require('path');

const pathFile = path.join(__dirname, 'node_modules', 'electron', 'path.txt');

// Se estamos dentro do processo principal do Electron,
// os modulos sao acessiveis via process.electronBinding ou similar
// Caso contrario, retornamos o path do executavel (comportamento padrao do npm electron)
if (process.versions && process.versions.electron) {
  // Estamos dentro do Electron - retorna os modulos internos
  module.exports = require('electron');
} else {
  // Fora do Electron - retorna o path do executavel
  let executablePath;
  if (fs.existsSync(pathFile)) {
    executablePath = fs.readFileSync(pathFile, 'utf-8');
  }
  module.exports = path.join(__dirname, 'node_modules', 'electron', 'dist', executablePath || 'electron.exe');
}
