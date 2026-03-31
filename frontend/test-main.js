const Module = require('module');
const fs = require('fs');
const path = require('path');

// Verifica se o _resolveFilename foi sobrescrito
const resolveStr = Module._resolveFilename.toString();
const hasElectronInterceptor = resolveStr.includes('electron') || resolveStr.length < 500;

// Testa o resolve
let resolveResult = 'error';
try {
  resolveResult = Module._resolveFilename('electron', null, false, {});
} catch(e) {
  resolveResult = 'ERROR: ' + e.message;
}

// Verifica o _nodeModulePaths
const origPaths = Module._nodeModulePaths(__dirname);

const result = {
  resolveFilenameLength: Module._resolveFilename.toString().length,
  hasElectronInterceptor,
  resolveResult,
  nodeModulePathsCount: origPaths.length,
  firstPath: origPaths[0],
  processType: process.type,
  electronVersion: process.versions.electron,
};

fs.writeFileSync(path.join(__dirname, 'test-result.txt'), JSON.stringify(result, null, 2));
process.exit(0);
