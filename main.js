const { app, BrowserWindow, dialog, ipcMain, shell, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const iconv = require('iconv-lite');

let mainWindow;
const pendingFiles = [];
const imageFiles = new Map();
const imageUrls = new Map();
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif', '.apng']);
app.setName('Lumen');
protocol.registerSchemesAsPrivileged([{ scheme: 'lumen-image', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function markdownPath(value, workingDirectory = process.cwd()) {
  if (!value || typeof value !== 'string' || value.startsWith('-')) return null;
  try {
    const target = /^file:/i.test(value) ? fileURLToPath(new URL(value)) : value;
    const resolved = path.resolve(workingDirectory, target);
    return /\.(md|markdown)$/i.test(resolved) ? resolved : null;
  } catch (_) { return null; }
}
function readMarkdown(filePath) {
  try { return { name: path.basename(filePath), bytes: fs.readFileSync(filePath).toString('base64'), path: filePath }; }
  catch (error) { dialog.showErrorBox('无法打开 Markdown 文件', `${filePath}\n\n${error.message}`); return null; }
}
function filesFromArgs(argv, workingDirectory) {
  return [...new Set(argv.map(value => markdownPath(value, workingDirectory)).filter(Boolean))];
}
function sendFile(filePath) {
  const file = readMarkdown(filePath);
  if (!file) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) { pendingFiles.push(file); return; }
  mainWindow.webContents.send('open-file', file); mainWindow.show(); mainWindow.focus();
}
function resolveLocalImage(target, sourceFile) {
  const fragmentIndex = target.indexOf('#');
  const fragment = fragmentIndex < 0 ? '' : target.slice(fragmentIndex);
  const withoutFragment = fragmentIndex < 0 ? target : target.slice(0, fragmentIndex);
  const withoutQuery = withoutFragment.split('?')[0];
  let resolved;
  if (/^file:/i.test(target)) resolved = fileURLToPath(new URL(target));
  else {
    const decoded = decodeURIComponent(withoutQuery);
    if (path.isAbsolute(decoded)) resolved = path.normalize(decoded);
    else {
      const sourcePath = markdownPath(sourceFile);
      if (!sourcePath) return null;
      resolved = path.resolve(path.dirname(sourcePath), decoded);
    }
  }
  if (!imageExtensions.has(path.extname(resolved).toLowerCase())) return null;
  return { path: resolved, fragment };
}
function registerImageProtocol() {
  protocol.handle('lumen-image', async request => {
    try {
      const url = new URL(request.url);
      const filePath = url.hostname === 'local' && imageFiles.get(url.pathname.slice(1));
      if (!filePath || !['GET', 'HEAD'].includes(request.method)) return new Response('Image not found', { status: 404 });
      return await net.fetch(pathToFileURL(filePath).toString(), { method: request.method });
    } catch (_) { return new Response('Image not found', { status: 404 }); }
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, show: true, backgroundColor: '#FAFAF8', backgroundMaterial: 'mica', transparent: false, frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true, thickFrame: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => { for (const file of pendingFiles.splice(0)) mainWindow.webContents.send('open-file', file); });
  mainWindow.on('closed', () => { mainWindow = null; imageFiles.clear(); imageUrls.clear(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  for (const filePath of filesFromArgs(process.argv)) sendFile(filePath);
  app.on('second-instance', (_event, commandLine, workingDirectory) => { for (const filePath of filesFromArgs(commandLine, workingDirectory)) sendFile(filePath); if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('open-file', (event, filePath) => { event.preventDefault(); const resolved = markdownPath(filePath); if (resolved) sendFile(resolved); });
  app.whenReady().then(() => { registerImageProtocol(); createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}
ipcMain.handle('resolve-image-url', async (_event, value, sourceFile) => {
  try {
    const target = String(value || '').trim();
    if (!target) return null;
    if (/^https?:/i.test(target)) {
      const url = new URL(target);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    }
    if (/^data:/i.test(target)) return /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml|apng)(?:;[^,]*)?,/i.test(target) ? target : null;
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return null;
    let image;
    if (path.isAbsolute(target) && imageExtensions.has(path.extname(target).toLowerCase())) {
      const info = await fs.promises.stat(target).catch(() => null);
      if (info?.isFile()) image = { path: path.normalize(target), fragment: '' };
    }
    if (!image) {
      image = resolveLocalImage(target, sourceFile);
      if (!image || !(await fs.promises.stat(image.path)).isFile()) return null;
    }
    let url = imageUrls.get(image.path);
    if (!url) {
      const token = randomUUID();
      imageFiles.set(token, image.path);
      url = `lumen-image://local/${token}`;
      imageUrls.set(image.path, url);
    }
    return url + image.fragment;
  } catch (_) { return null; }
});
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
ipcMain.handle('open-local-path', async (_event, value, sourceFile) => {
  try {
    let target = String(value || '');
    if (/^file:/i.test(target)) target = fileURLToPath(new URL(target));
    const baseDir = sourceFile && /\.(md|markdown)$/i.test(sourceFile) ? path.dirname(sourceFile) : app.getPath('documents');
    const resolved = path.isAbsolute(target) ? path.normalize(target) : path.resolve(baseDir, target);
    const error = await shell.openPath(resolved);
    return { opened: !error, error };
  } catch (_) { return { opened: false }; }
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-toggle-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
