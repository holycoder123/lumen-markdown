const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const iconv = require('iconv-lite');

let mainWindow;
let pendingFile;
app.setName('Lumen');

function markdownPath(value) {
  if (!value || typeof value !== 'string' || value.startsWith('-')) return null;
  const resolved = path.resolve(value.replace(/^file:\/\//, ''));
  return /\.(md|markdown)$/i.test(resolved) ? resolved : null;
}
function readMarkdown(filePath) {
  try { return { name: path.basename(filePath), bytes: fs.readFileSync(filePath).toString('base64'), path: filePath }; }
  catch (error) { dialog.showErrorBox('无法打开 Markdown 文件', `${filePath}\n\n${error.message}`); return null; }
}
function fileFromArgs(argv) { return argv.map(markdownPath).find(Boolean) || null; }
function sendFile(filePath) {
  const file = readMarkdown(filePath);
  if (!file || !mainWindow) return;
  if (mainWindow.webContents.isLoading()) { pendingFile = file; return; }
  mainWindow.webContents.send('open-file', file); mainWindow.show(); mainWindow.focus();
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, show: true, backgroundColor: '#FAFAF8', backgroundMaterial: 'mica', transparent: false, frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true, thickFrame: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => { if (pendingFile) { mainWindow.webContents.send('open-file', pendingFile); pendingFile = null; } });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const initialFile = fileFromArgs(process.argv);
if (initialFile) pendingFile = readMarkdown(initialFile);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => { const filePath = fileFromArgs(commandLine); if (filePath) sendFile(filePath); if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { createWindow(); if (process.platform === 'darwin') app.on('open-file', (event, filePath) => { event.preventDefault(); sendFile(filePath); }); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}
ipcMain.handle('set-default-markdown-app', async () => { if (process.platform === 'win32') { await shell.openExternal('ms-settings:defaultapps'); return { opened: true }; } return { opened: false }; });
ipcMain.handle('encode-text', (_event, { text, encoding }) => {
  const normalized = String(encoding || 'utf-8').toLowerCase();
  if (!iconv.encodingExists(normalized)) throw new Error(`不支持的编码：${normalized}`);
  return iconv.encode(String(text ?? ''), normalized).toString('base64');
});
ipcMain.handle('open-external-url', async (_event, value) => {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return { opened: false };
    await shell.openExternal(url.toString());
    return { opened: true };
  } catch (_) { return { opened: false }; }
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-toggle-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
