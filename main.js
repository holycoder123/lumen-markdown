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
const mediaFiles = new Map();
const mediaUrls = new Map();
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif', '.apng']);
const mediaExtensions = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.ogv', '.mov', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.opus']);
app.setName('Lumen');
protocol.registerSchemesAsPrivileged([
  { scheme: 'lumen-image', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'lumen-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

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
function sendFile(filePath, fragment = '') {
  const file = readMarkdown(filePath);
  if (!file) return false;
  if (fragment) file.fragment = fragment;
  if (!mainWindow || mainWindow.webContents.isLoading()) { pendingFiles.push(file); return true; }
  mainWindow.webContents.send('open-file', file); mainWindow.show(); mainWindow.focus();
  return true;
}
function hasUnsupportedLocalScheme(target) {
  return /^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:/i.test(target) && !/^[a-z]:[\\/]/i.test(target);
}
async function existingFile(filePath) {
  try { return (await fs.promises.stat(filePath)).isFile(); }
  catch (_) { return false; }
}
async function resolveLocalFile(target, sourceFile, fallbackDirectory) {
  if (!target || hasUnsupportedLocalScheme(target) || target.includes('\0')) return null;
  const sourcePath = markdownPath(sourceFile);
  const baseDir = sourcePath ? path.dirname(sourcePath) : fallbackDirectory;
  // Native filenames can contain # and %. Check the exact filename before
  // interpreting a document's URI query, fragment, or percent escapes.
  if (!/^file:/i.test(target) && (path.isAbsolute(target) || baseDir)) {
    const literalPath = path.isAbsolute(target) ? path.normalize(target) : path.resolve(baseDir, target);
    if (await existingFile(literalPath)) return { path: literalPath, fragment: '' };
  }
  let url;
  if (/^file:/i.test(target)) url = new URL(target);
  else if (/^[a-z]:[\\/]/i.test(target)) {
    const fragmentIndex = target.indexOf('#');
    const fragment = fragmentIndex < 0 ? '' : target.slice(fragmentIndex);
    const withoutFragment = fragmentIndex < 0 ? target : target.slice(0, fragmentIndex);
    const resolved = path.normalize(decodeURIComponent(withoutFragment.split('?')[0]));
    return await existingFile(resolved) ? { path: resolved, fragment } : null;
  } else {
    if (!baseDir && !path.isAbsolute(target)) return null;
    const base = sourcePath ? pathToFileURL(sourcePath) : pathToFileURL(`${baseDir || path.parse(target).root}${path.sep}`);
    url = new URL(target.replace(/\\/g, '/'), base);
  }
  if (url.protocol !== 'file:') return null;
  const resolved = path.normalize(fileURLToPath(url));
  return await existingFile(resolved) ? { path: resolved, fragment: url.hash } : null;
}
function registerLocalProtocol(scheme, files) {
  protocol.handle(scheme, async request => {
    try {
      const url = new URL(request.url);
      const filePath = url.hostname === 'local' && files.get(url.pathname.slice(1));
      if (!filePath || !['GET', 'HEAD'].includes(request.method)) return new Response('File not found', { status: 404 });
      const info = await fs.promises.stat(filePath);
      if (!info.isFile()) return new Response('File not found', { status: 404 });
      const range = request.method === 'GET' && request.headers.get('range');
      let byteRange;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (match && (match[1] || match[2])) {
          const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
          const end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
          if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < info.size && (match[1] || Number(match[2]) > 0)) byteRange = { start, end };
        }
        if (!byteRange) return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${info.size}` } });
      }
      const response = await net.fetch(pathToFileURL(filePath).toString(), { method: request.method, ...(byteRange ? { headers: { Range: `bytes=${byteRange.start}-${byteRange.end}` } } : {}) });
      const headers = new Headers(response.headers);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Length', String(byteRange ? byteRange.end - byteRange.start + 1 : info.size));
      if (byteRange) headers.set('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${info.size}`);
      // Electron's file fetch returns partial bytes with status 200 and no range
      // headers. Restore the HTTP response metadata that media seeking expects.
      return new Response(request.method === 'HEAD' ? null : response.body, { status: byteRange ? 206 : response.status, headers });
    } catch (_) { return new Response('File not found', { status: 404 }); }
  });
}
async function resolveAssetUrl(value, sourceFile, { extensions, scheme, files, urls, allowDataImages = false }) {
  try {
    const target = String(value || '').trim();
    if (!target) return null;
    if (/^https?:/i.test(target)) {
      const url = new URL(target);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    }
    if (allowDataImages && /^data:/i.test(target)) return /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml|apng)(?:;[^,]*)?,/i.test(target) ? target : null;
    const file = await resolveLocalFile(target, sourceFile);
    if (!file || !extensions.has(path.extname(file.path).toLowerCase())) return null;
    let url = urls.get(file.path);
    if (!url) {
      const token = randomUUID();
      files.set(token, file.path);
      url = `${scheme}://local/${token}`;
      urls.set(file.path, url);
    }
    return url + file.fragment;
  } catch (_) { return null; }
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, show: true, backgroundColor: '#FAFAF8', backgroundMaterial: 'mica', transparent: false, frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true, thickFrame: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      mainWindow.webContents.send('close-document');
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => { for (const file of pendingFiles.splice(0)) mainWindow.webContents.send('open-file', file); });
  mainWindow.on('closed', () => { mainWindow = null; imageFiles.clear(); imageUrls.clear(); mediaFiles.clear(); mediaUrls.clear(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  for (const filePath of filesFromArgs(process.argv)) sendFile(filePath);
  app.on('second-instance', (_event, commandLine, workingDirectory) => { for (const filePath of filesFromArgs(commandLine, workingDirectory)) sendFile(filePath); if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('open-file', (event, filePath) => { event.preventDefault(); const resolved = markdownPath(filePath); if (resolved) sendFile(resolved); });
  app.whenReady().then(() => { registerLocalProtocol('lumen-image', imageFiles); registerLocalProtocol('lumen-media', mediaFiles); createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}
ipcMain.handle('resolve-image-url', (_event, value, sourceFile) => resolveAssetUrl(value, sourceFile, { extensions: imageExtensions, scheme: 'lumen-image', files: imageFiles, urls: imageUrls, allowDataImages: true }));
ipcMain.handle('resolve-media-url', (_event, value, sourceFile) => resolveAssetUrl(value, sourceFile, { extensions: mediaExtensions, scheme: 'lumen-media', files: mediaFiles, urls: mediaUrls }));
ipcMain.handle('set-default-markdown-app', async () => { if (process.platform === 'win32') { await shell.openExternal('ms-settings:defaultapps'); return { opened: true }; } return { opened: false }; });
ipcMain.handle('encode-text', (_event, { text, encoding }) => {
  const normalized = String(encoding || 'utf-8').toLowerCase();
  if (!iconv.encodingExists(normalized)) throw new Error(`不支持的编码：${normalized}`);
  return iconv.encode(String(text ?? ''), normalized).toString('base64');
});
ipcMain.handle('open-external-url', async (_event, value) => {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return { opened: false };
    await shell.openExternal(url.toString());
    return { opened: true };
  } catch (_) { return { opened: false }; }
});
ipcMain.handle('open-local-path', async (_event, value, sourceFile) => {
  try {
    const target = String(value || '').trim();
    if (hasUnsupportedLocalScheme(target)) return { opened: false, error: '不支持此链接类型。' };
    const file = await resolveLocalFile(target, sourceFile, app.getPath('documents'));
    if (!file) return { opened: false, error: '找不到链接指向的文件，请确认导出的附件文件夹与文档一起保留。' };
    if (/\.(md|markdown)$/i.test(file.path)) {
      const opened = sendFile(file.path, file.fragment);
      return { opened, kind: 'document', path: file.path, fragment: file.fragment, ...(opened ? {} : { error: '无法读取此 Markdown 文档。' }) };
    }
    const error = await shell.openPath(file.path);
    return { opened: !error, kind: 'attachment', path: file.path, error };
  } catch (_) { return { opened: false, error: '无法打开此文件，请检查链接地址与系统关联的应用。' }; }
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-toggle-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
