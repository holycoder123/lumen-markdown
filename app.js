const starter = `# 欢迎使用 Lumen

一款轻盈、专注的 **Markdown 编辑器**。你的内容会实时呈现在右侧，并自动保存在当前浏览器中。

## 开始书写

你可以使用熟悉的 Markdown 语法：

- **粗体文字** 与 *斜体文字*
- [创建链接](https://www.markdownguide.org/)
- 插入 \`行内代码\`
- [x] 已完成的事项
- [ ] 等待完成的事项

> 好的工具应当安静地待在一旁，让想法自然流淌。

### 代码示例

\`\`\`javascript
const greeting = "Hello, Markdown!";
console.log(greeting);
\`\`\`

---

将本地 **.md** 文件拖到窗口，或点击右上角「上传文档」即可开始。
`;

const editor = document.querySelector('#editor');
const preview = document.querySelector('#preview');
const lineNumbers = document.querySelector('#lineNumbers');
const wordCount = document.querySelector('#wordCount');
const lineCount = document.querySelector('#lineCount');
const fileInput = document.querySelector('#fileInput');
const documentName = document.querySelector('#documentName');
const saveStatus = document.querySelector('#saveStatus');
const dropOverlay = document.querySelector('#dropOverlay');
const toast = document.querySelector('#toast');
const editModeButton = document.querySelector('#editModeButton');
const previewModeButton = document.querySelector('#previewModeButton');
const splitModeButton = document.querySelector('#splitModeButton');
const editorView = document.querySelector('#editorView');
const previewView = document.querySelector('#previewView');
const documentPane = document.querySelector('.document-pane');
const editorToolbar = document.querySelector('#editorToolbar');
const copyHtmlButton = document.querySelector('#copyHtmlButton');
const defaultAppButton = document.querySelector('#defaultAppButton');
const minimizeButton = document.querySelector('#minimizeButton');
const maximizeButton = document.querySelector('#maximizeButton');
const closeButton = document.querySelector('#closeButton');
const themeButton = document.querySelector('#themeButton');
const encodingSelect = document.querySelector('#encodingSelect');
let currentFileBytes = null;
let currentFilePath = null;
document.title = 'Lumen';
const brandName = document.querySelector('.brand > span:nth-of-type(2)');
if (brandName) brandName.textContent = 'Lumen';
let saveTimer;
let scrollProgress = 0;
let syncingScroll = false;
let currentMode = 'preview';

const savedTheme = (() => { try { return localStorage.getItem('lumen-theme') || 'light'; } catch (_) { return 'light'; } })();
document.documentElement.dataset.theme = savedTheme;
themeButton.textContent = savedTheme === 'dark' ? '☼' : '☾';
themeButton.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  themeButton.textContent = nextTheme === 'dark' ? '☼' : '☾';
  try { localStorage.setItem('lumen-theme', nextTheme); } catch (_) { /* storage may be disabled */ }
});

if (window.mojianDesktop?.minimize) {
  minimizeButton.addEventListener('click', () => window.mojianDesktop.minimize());
  maximizeButton.addEventListener('click', () => window.mojianDesktop.toggleMaximize());
  closeButton.addEventListener('click', () => window.mojianDesktop.close());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

function inline(text) {
  let out = escapeHtml(text);
  const code = [];
  out = out.replace(/`([^`]+)`/g, (_, value) => { code.push(`<code>${value}</code>`); return `\u0000CODE${code.length - 1}\u0000`; });
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, rawTarget) => {
    const target = rawTarget.trim();
    if (/^https?:\/\//i.test(target)) return `<a href="${target}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return `<a href="#" data-local-path="${target}">${label}</a>`;
  });
  out = out.replace(/(^|[\s(>])((?:https?:\/\/|www\.)[^\s<]+)/gi, (_, prefix, value) => {
    const trailing = value.match(/[.,!?;:，。！？；：)\]]+$/)?.[0] || '';
    const address = value.slice(0, value.length - trailing.length);
    const href = address.toLowerCase().startsWith('www.') ? `https://${address}` : address;
    return `${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${address}</a>${trailing}`;
  });
  out = out.replace(/(^|[\s(>])((?:[A-Za-z]:[\\/]|\\\\)[^\s<]+)/g, (_, prefix, value) => {
    const trailing = value.match(/[.,!?;:，。！？；：)\]]+$/)?.[0] || '';
    const target = value.slice(0, value.length - trailing.length);
    return `${prefix}<a href="#" data-local-path="${target}">${target}</a>${trailing}`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => code[Number(i)]);
  return out;
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === '|') { cell += '|'; i++; }
    else if (value[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += value[i];
  }
  cells.push(cell.trim());
  return cells;
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function tableAlignment(divider) {
  const value = divider.replace(/\s/g, '');
  if (value.startsWith(':') && value.endsWith(':')) return 'center';
  if (value.endsWith(':')) return 'right';
  return 'left';
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let html = '', paragraph = [], listType = '', inCode = false, codeLang = '', codeLines = [], inQuote = false;
  const flushParagraph = () => { if (paragraph.length) { html += `<p>${inline(paragraph.join(' '))}</p>`; paragraph = []; } };
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = ''; } };
  const closeQuote = () => { if (inQuote) { flushParagraph(); html += '</blockquote>'; inQuote = false; } };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      if (!inCode) { flushParagraph(); closeList(); closeQuote(); inCode = true; codeLang = fence[1]; codeLines = []; }
      else { html += `<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`; inCode = false; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); closeQuote(); continue; }
    if (line.includes('|') && lines[lineIndex + 1] && isTableDivider(lines[lineIndex + 1])) {
      flushParagraph(); closeList(); closeQuote();
      const headers = splitTableRow(line);
      const dividers = splitTableRow(lines[lineIndex + 1]);
      const aligns = dividers.map(tableAlignment);
      html += '<div class="table-wrap"><table><thead><tr>';
      headers.forEach((cell, index) => { html += `<th style="text-align:${aligns[index] || 'left'}">${inline(cell)}</th>`; });
      html += '</tr></thead><tbody>';
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
        const cells = splitTableRow(lines[lineIndex]);
        html += '<tr>';
        headers.forEach((_, index) => { html += `<td style="text-align:${aligns[index] || 'left'}">${inline(cells[index] || '')}</td>`; });
        html += '</tr>';
        lineIndex++;
      }
      html += '</tbody></table></div>';
      lineIndex--;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushParagraph(); closeList(); closeQuote(); html += '<hr>'; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); closeQuote(); const level = heading[1].length; html += `<h${level}>${inline(heading[2])}</h${level}>`; continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); closeList(); if (!inQuote) { html += '<blockquote>'; inQuote = true; } paragraph.push(quote[1]); continue; }
    closeQuote();
    const item = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (item) {
      flushParagraph(); const nextType = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (listType !== nextType) { closeList(); html += `<${nextType}>`; listType = nextType; }
      const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
      html += task ? `<li class="task"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(task[2])}</li>` : `<li>${inline(item[2])}</li>`;
      continue;
    }
    closeList(); paragraph.push(line.trim());
  }
  if (inCode) html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
  flushParagraph(); closeList(); closeQuote();
  return html;
}

function update() {
  const value = editor.value;
  preview.innerHTML = renderMarkdown(value);
  const count = value.length;
  const lines = value.split('\n').length;
  wordCount.textContent = count.toLocaleString('zh-CN');
  lineCount.textContent = lines.toLocaleString('zh-CN');
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  saveStatus.textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('mojian-content', value); localStorage.setItem('mojian-name', documentName.textContent); }
    catch (_) { /* storage may be disabled */ }
    saveStatus.textContent = '已自动保存';
  }, 350);
}

function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function decodeBytes(bytes, encoding) {
  try { return new TextDecoder(encoding, { fatal: false }).decode(bytes); }
  catch (_) { showToast(`不支持 ${encoding} 编码`); return null; }
}

function detectEncoding(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'utf-8'; }
  catch (_) { return 'gb18030'; }
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function setEncoding(encoding, reload = true) {
  encodingSelect.value = encoding;
  try { localStorage.setItem('lumen-encoding', encoding); } catch (_) { /* storage may be disabled */ }
  if (reload && currentFileBytes) {
    const decoded = decodeBytes(currentFileBytes, encoding);
    if (decoded !== null) { editor.value = decoded; update(); showToast(`已按 ${encodingSelect.selectedOptions[0].textContent} 重新解析`); }
  }
}

function setMode(mode) {
  const isEdit = mode === 'edit';
  const isPreview = mode === 'preview';
  const isSplit = mode === 'split';
  const outgoing = currentMode === 'preview' ? preview : editor;
  const outgoingRange = outgoing.scrollHeight - outgoing.clientHeight;
  if (outgoingRange > 0) scrollProgress = outgoing.scrollTop / outgoingRange;
  editModeButton.classList.toggle('active', isEdit);
  previewModeButton.classList.toggle('active', isPreview);
  splitModeButton.classList.toggle('active', isSplit);
  editModeButton.setAttribute('aria-selected', String(isEdit));
  previewModeButton.setAttribute('aria-selected', String(isPreview));
  splitModeButton.setAttribute('aria-selected', String(isSplit));
  editorView.hidden = isPreview;
  previewView.hidden = isEdit;
  editorView.classList.toggle('active', !isPreview);
  previewView.classList.toggle('active', !isEdit);
  documentPane.classList.toggle('split-mode', isSplit);
  editorToolbar.hidden = isPreview;
  copyHtmlButton.hidden = isEdit;
  currentMode = mode;
  try { localStorage.setItem('lumen-mode', mode); } catch (_) { /* storage may be disabled */ }
  requestAnimationFrame(() => {
    syncingScroll = true;
    if (!isPreview) editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight) * scrollProgress;
    if (!isEdit) preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight) * scrollProgress;
    requestAnimationFrame(() => { syncingScroll = false; });
    if (!isPreview) editor.focus({ preventScroll: true });
  });
}

function loadFile(file) {
  if (!file || !(/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain')) {
    showToast('请选择 .md 或 .markdown 文件'); return;
  }
  if (file.size > 5 * 1024 * 1024) { showToast('文件不能超过 5 MB'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    currentFileBytes = new Uint8Array(reader.result);
    currentFilePath = file.path || null;
    setEncoding(detectEncoding(currentFileBytes), false);
    const decoded = decodeBytes(currentFileBytes, encodingSelect.value);
    if (decoded === null) return;
    editor.value = decoded; documentName.textContent = file.name; update(); showToast(`已载入 ${file.name}`);
  };
  reader.onerror = () => showToast('文件读取失败，请重试');
  reader.readAsArrayBuffer(file);
}

editor.addEventListener('input', () => { currentFileBytes = null; update(); });
editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
  if (!syncingScroll && !editorView.hidden) {
    const range = editor.scrollHeight - editor.clientHeight;
    scrollProgress = range > 0 ? editor.scrollTop / range : 0;
    if (currentMode === 'split') {
      syncingScroll = true;
      preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight) * scrollProgress;
      requestAnimationFrame(() => { syncingScroll = false; });
    }
  }
});
preview.addEventListener('scroll', () => {
  if (!syncingScroll && !previewView.hidden) {
    const range = preview.scrollHeight - preview.clientHeight;
    scrollProgress = range > 0 ? preview.scrollTop / range : 0;
    if (currentMode === 'split') {
      syncingScroll = true;
      editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight) * scrollProgress;
      lineNumbers.scrollTop = editor.scrollTop;
      requestAnimationFrame(() => { syncingScroll = false; });
    }
  }
});
preview.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const localPath = link.dataset.localPath;
  if (localPath) {
    event.preventDefault();
    if (window.mojianDesktop?.openLocalPath) window.mojianDesktop.openLocalPath(localPath, currentFilePath);
    else showToast('本地文件链接需要在桌面版中打开');
    return;
  }
  const url = link.href;
  if (!/^https?:$/i.test(new URL(url).protocol)) return;
  event.preventDefault();
  if (window.mojianDesktop?.openExternalUrl) window.mojianDesktop.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
});
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') { event.preventDefault(); const s = editor.selectionStart; editor.setRangeText('  ', s, editor.selectionEnd, 'end'); update(); }
  if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
    event.preventDefault(); wrapSelection(event.key.toLowerCase() === 'b' ? '**' : '*');
  }
});

function wrapSelection(mark) {
  const start = editor.selectionStart, end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || '文字';
  editor.setRangeText(mark + selected + mark, start, end, 'select');
  editor.selectionStart = start + mark.length; editor.selectionEnd = start + mark.length + selected.length;
  editor.focus(); update();
}

function prefixLine(prefix) {
  const start = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
  editor.setRangeText(prefix, lineStart, lineStart, 'end'); editor.focus(); update();
}

document.querySelectorAll('.toolbar button').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.wrap) wrapSelection(button.dataset.wrap);
  if (button.dataset.prefix) prefixLine(button.dataset.prefix);
}));
document.querySelector('#uploadButton').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
document.querySelector('#downloadButton').addEventListener('click', () => {
  const encoding = encodingSelect.value;
  const finish = base64 => {
    const blob = new Blob([base64ToBytes(base64)], { type: `text/markdown;charset=${encoding}` });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = /\.(md|markdown)$/i.test(documentName.textContent) ? documentName.textContent : `${documentName.textContent}.md`;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); showToast(`已按 ${encodingSelect.selectedOptions[0].textContent} 导出`);
  };
  if (window.mojianDesktop?.encodeText) window.mojianDesktop.encodeText(editor.value, encoding).then(finish).catch(() => showToast('当前环境不支持该编码导出'));
  else finish(bytesToBase64(new TextEncoder().encode(editor.value)));
});
encodingSelect.addEventListener('change', () => setEncoding(encodingSelect.value));
copyHtmlButton.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(preview.innerHTML); showToast('HTML 已复制'); }
  catch (_) { showToast('无法访问剪贴板'); }
});
editModeButton.addEventListener('click', () => setMode('edit'));
previewModeButton.addEventListener('click', () => setMode('preview'));
splitModeButton.addEventListener('click', () => setMode('split'));

if (window.mojianDesktop?.setAsDefaultMarkdownApp) {
  defaultAppButton.hidden = false;
  defaultAppButton.addEventListener('click', async () => {
    await window.mojianDesktop.setAsDefaultMarkdownApp();
    showToast('请在系统设置中选择本应用作为 .md 默认应用');
  });
}

documentName.addEventListener('click', () => { documentName.contentEditable = 'true'; documentName.focus(); document.execCommand('selectAll', false, null); });
documentName.addEventListener('blur', () => { documentName.contentEditable = 'false'; if (!documentName.textContent.trim()) documentName.textContent = '未命名文档.md'; update(); });
documentName.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); documentName.blur(); } });

let dragDepth = 0;
window.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; dropOverlay.classList.add('visible'); });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('visible'); } });
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropOverlay.classList.remove('visible'); loadFile(event.dataTransfer.files[0]); });

try { setEncoding(localStorage.getItem('lumen-encoding') || 'utf-8', false); }
catch (_) { setEncoding('utf-8', false); }

try {
  editor.value = localStorage.getItem('mojian-content') ?? starter;
  documentName.textContent = localStorage.getItem('mojian-name') || '未命名文档.md';
} catch (_) { editor.value = starter; }
update();
let initialMode = 'preview';
try { initialMode = localStorage.getItem('lumen-mode') || 'preview'; } catch (_) { /* storage may be disabled */ }
setMode(['edit', 'preview', 'split'].includes(initialMode) ? initialMode : 'preview');

if (window.mojianDesktop) {
  window.mojianDesktop.onOpenFile(file => {
    currentFileBytes = file.bytes ? base64ToBytes(file.bytes) : new TextEncoder().encode(file.content || '');
    currentFilePath = file.path || null;
    setEncoding(detectEncoding(currentFileBytes), false);
    const decoded = decodeBytes(currentFileBytes, encodingSelect.value);
    if (decoded === null) return;
    editor.value = decoded;
    documentName.textContent = file.name;
    update();
    setMode('edit');
    showToast(`已打开 ${file.name}`);
  });
}
