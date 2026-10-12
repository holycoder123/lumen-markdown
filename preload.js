const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mojianDesktop', {
  onOpenFile(callback) { ipcRenderer.on('open-file', (_event, file) => callback(file)); },
  getPathForFile(file) { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  resolveImageUrl(target, sourceFile) { return ipcRenderer.invoke('resolve-image-url', target, sourceFile); },
  encodeText(text, encoding) { return ipcRenderer.invoke('encode-text', { text, encoding }); },
  openExternalUrl(url) { return ipcRenderer.invoke('open-external-url', url); },
  openLocalPath(target, sourceFile) { return ipcRenderer.invoke('open-local-path', target, sourceFile); },
  setAsDefaultMarkdownApp() { return ipcRenderer.invoke('set-default-markdown-app'); },
  minimize() { ipcRenderer.send('window-minimize'); },
  toggleMaximize() { ipcRenderer.send('window-toggle-maximize'); },
  close() { ipcRenderer.send('window-close'); },
  isMaximized() { return ipcRenderer.invoke('window-is-maximized'); }
});
