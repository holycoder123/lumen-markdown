const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mojianDesktop', {
  onOpenFile(callback) { ipcRenderer.on('open-file', (_event, file) => callback(file)); },
  encodeText(text, encoding) { return ipcRenderer.invoke('encode-text', { text, encoding }); },
  openExternalUrl(url) { return ipcRenderer.invoke('open-external-url', url); },
  setAsDefaultMarkdownApp() { return ipcRenderer.invoke('set-default-markdown-app'); },
  minimize() { ipcRenderer.send('window-minimize'); },
  toggleMaximize() { ipcRenderer.send('window-toggle-maximize'); },
  close() { ipcRenderer.send('window-close'); },
  isMaximized() { return ipcRenderer.invoke('window-is-maximized'); }
});
