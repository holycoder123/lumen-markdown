const starter = `# 欢迎使用 Lumen

一款轻盈、专注的 **Markdown 编辑器**。文档会自动保存在本机，打开软件即可阅读预览。

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

点击「新建文档」开始书写，或点击「打开文档」一次打开多个 **.md** 文件。通过上方标签切换文档，编辑时可从工具栏插入图片。
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
const documentTabs = document.querySelector('#documentTabs');
const documentCount = document.querySelector('#documentCount');
const reopenDocumentButton = document.querySelector('#reopenDocumentButton');
const imageInput = document.querySelector('#imageInput');
const outlineSidebar = document.querySelector('#outlineSidebar');
const outlineButton = document.querySelector('#outlineButton');
const outlineList = document.querySelector('#outlineList');
const outlineSummary = document.querySelector('#outlineSummary');
const readingWidthButton = document.querySelector('#readingWidthButton');
const tableDialog = document.querySelector('#tableDialog');
const tableDialogContent = document.querySelector('#tableDialogContent');
const tableDialogDescription = document.querySelector('#tableDialogDescription');
let outlineHeadings = [];
let outlineSignature = '';
let outlineActiveFrame = 0;
let presentedTable = null;
let tableLayoutFrame = 0;
const tableLayoutTargets = new Set();
const tableLayoutObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const scroll = entry.target.matches('table') ? entry.target.parentElement : entry.target;
    if (scroll?.classList.contains('table-scroll')) tableLayoutTargets.add(scroll);
  }
  if (tableLayoutFrame) return;
  tableLayoutFrame = requestAnimationFrame(() => {
    tableLayoutFrame = 0;
    for (const scroll of tableLayoutTargets) if (scroll.isConnected) updateTableOverflow(scroll);
    tableLayoutTargets.clear();
  });
});
const externalChangeNotice = document.querySelector('#externalChangeNotice');
const externalChangeMessage = document.querySelector('#externalChangeMessage');
const reloadExternalButton = document.querySelector('#reloadExternalButton');
const keepLocalButton = document.querySelector('#keepLocalButton');
const findButton = document.querySelector('#findButton');
const searchPanel = document.querySelector('#searchPanel');
const searchInput = document.querySelector('#searchInput');
const searchStatus = document.querySelector('#searchStatus');
const matchCaseInput = document.querySelector('#matchCaseInput');
const toggleReplaceButton = document.querySelector('#toggleReplaceButton');
const replaceRow = document.querySelector('#replaceRow');
const replaceInput = document.querySelector('#replaceInput');
const previousMatchButton = document.querySelector('#previousMatchButton');
const nextMatchButton = document.querySelector('#nextMatchButton');
const replaceButton = document.querySelector('#replaceButton');
const replaceAllButton = document.querySelector('#replaceAllButton');
const searchHighlights = document.querySelector('#searchHighlights');
const searchHighlightContent = document.querySelector('#searchHighlightContent');
let searchMatches = [];
let searchMatchIndex = -1;
let searchFocusRequest = 0;
let searchHighlightLayout = null;
let searchResultContext = '';
let previewSearchRefreshFrame = 0;
const documentsStorageKey = 'lumen-documents-v1';
const supportedEncodings = new Set(['utf-8', 'gb18030', 'gbk', 'utf-16le', 'utf-16be']);
let documents = [];
let closedDocuments = [];
let activeDocumentId = null;
let currentFileBytes = null;
let currentFilePath = null;
document.title = 'Lumen';
const brandName = document.querySelector('.brand > span:nth-of-type(2)');
if (brandName) brandName.textContent = 'Lumen';
let saveTimer;
let scrollProgress = 0;
let syncingScroll = false;
let currentMode = 'preview';
let mermaidRenderId = 0;
const imageUrlCache = new Map();
let markdownSession = null;

function createDocument({ name, content = '', encoding = 'utf-8', path = null, bytes = null, id, diskRevision = null, diskDirty = Boolean(path && !bytes) } = {}) {
  if (!name) {
    let number = 1;
    do { name = number === 1 ? '未命名文档.md' : `未命名文档 ${number}.md`; number++; }
    while ([...documents, ...closedDocuments].some(document => document.name === name));
  }
  return { id: id || crypto.randomUUID(), name, content, encoding, path, bytes, diskRevision, diskDirty, diskContent: bytes ? normalizeDocumentText(content) : null, externalChange: null, scroll: 0, selectionStart: 0, selectionEnd: 0 };
}

function activeDocument() { return documents.find(document => document.id === activeDocumentId); }
function normalizeDocumentText(value) { return value.replace(/\r\n?/g, '\n'); }
function documentPathKey(value) { return value?.replace(/\\/g, '/').toLowerCase(); }

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* Preferences are optional. */ }
}
function setOutlineOpen(open, remember = false) {
  outlineSidebar.hidden = !open;
  outlineButton.setAttribute('aria-expanded', String(open));
  outlineButton.title = open ? '收起文档大纲' : '显示文档大纲';
  if (remember) savePreference('lumen-outline-open', String(open));
}
function setReadingWidth(wide, remember = false) {
  documentPane.classList.toggle('wide-reading', wide);
  readingWidthButton.setAttribute('aria-pressed', String(wide));
  readingWidthButton.textContent = wide ? '⤢ 宽页' : '▤ 舒适';
  readingWidthButton.title = wide ? '切换为舒适阅读宽度' : '铺满可用阅读宽度';
  if (remember) savePreference('lumen-reading-width', wide ? 'wide' : 'comfortable');
}
function renderOutline() {
  outlineHeadings = [...preview.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
  const signature = JSON.stringify([activeDocumentId, ...outlineHeadings.map(heading => [heading.id, heading.textContent])]);
  if (signature !== outlineSignature) {
    outlineSignature = signature;
    outlineList.replaceChildren();
    outlineSummary.textContent = outlineHeadings.length ? `${outlineHeadings.length} 个章节 · 点击跳转` : '当前文档';
    for (const heading of outlineHeadings) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.headingId = heading.id;
      button.style.setProperty('--outline-depth', Math.min(4, Number(heading.tagName.slice(1)) - 1));
      button.textContent = heading.textContent;
      button.title = heading.textContent;
      outlineList.append(button);
    }
    if (!outlineHeadings.length) {
      const empty = document.createElement('p');
      empty.className = 'outline-empty';
      empty.textContent = activeDocument() ? '使用 Markdown 标题组织内容，章节会显示在这里。' : '新建或打开文档，开始你的工作。';
      outlineList.append(empty);
    }
  }
  scheduleOutlineActive();
}
function scheduleOutlineActive() {
  if (outlineActiveFrame) return;
  outlineActiveFrame = requestAnimationFrame(() => {
    outlineActiveFrame = 0;
    if (previewView.hidden) return;
    const top = preview.getBoundingClientRect().top + 80;
    let active = outlineHeadings[0]?.id;
    for (const heading of outlineHeadings) {
      if (heading.getBoundingClientRect().top > top) break;
      active = heading.id;
    }
    for (const button of outlineList.querySelectorAll('[data-heading-id]')) {
      if (button.dataset.headingId === active) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    }
  });
}
outlineButton.addEventListener('click', () => setOutlineOpen(outlineSidebar.hidden, true));
document.querySelector('#closeOutlineButton').addEventListener('click', () => { setOutlineOpen(false, true); outlineButton.focus(); });
readingWidthButton.addEventListener('click', () => setReadingWidth(!documentPane.classList.contains('wide-reading'), true));
outlineList.addEventListener('click', event => {
  const button = event.target.closest('[data-heading-id]');
  if (!button) return;
  if (currentMode === 'edit') setMode('preview');
  requestAnimationFrame(() => {
    scrollPreviewToFragment(`#${button.dataset.headingId}`);
    scheduleOutlineActive();
    if (!wideWorkspace.matches) { setOutlineOpen(false); preview.focus({ preventScroll: true }); }
  });
});
const wideWorkspace = matchMedia('(min-width: 1101px)');
wideWorkspace.addEventListener('change', () => setOutlineOpen(wideWorkspace.matches && readPreference('lumen-outline-open', 'true') !== 'false'));
setOutlineOpen(wideWorkspace.matches && readPreference('lumen-outline-open', 'true') !== 'false');
setReadingWidth(readPreference('lumen-reading-width', 'wide') === 'wide');

function captureDocument() {
  const document = activeDocument();
  if (!document) return;
  document.diskDirty = document.diskContent === null ? document.diskDirty || editor.value !== document.content : editor.value !== document.diskContent;
  document.content = editor.value;
  document.name = documentName.textContent.trim() || '未命名文档.md';
  document.encoding = encodingSelect.value;
  document.bytes = currentFileBytes;
  document.scroll = scrollProgress;
  document.selectionStart = editor.selectionStart;
  document.selectionEnd = editor.selectionEnd;
}

function saveDocuments() {
  clearTimeout(saveTimer);
  captureDocument();
  try {
    const serialize = list => list.map(({ id, name, content, encoding, path, diskRevision, diskDirty }) => ({ id, name, content, encoding, path, diskRevision, diskDirty }));
    localStorage.setItem(documentsStorageKey, JSON.stringify({
      version: 1,
      activeId: activeDocumentId,
      documents: serialize(documents),
      closedDocuments: serialize(closedDocuments)
    }));
    saveStatus.textContent = '已自动保存';
    return true;
  } catch (error) {
    saveStatus.textContent = error.name === 'QuotaExceededError' ? '存储空间不足，请导出文档' : '自动保存失败，请导出文档';
    return false;
  }
}

function renderDocumentTabs() {
  documentTabs.replaceChildren();
  documents.forEach(document => {
    const item = window.document.createElement('div');
    item.className = 'document-tab-item';
    item.classList.toggle('active', document.id === activeDocumentId);
    item.classList.toggle('external-change', Boolean(document.externalChange));
    item.setAttribute('role', 'presentation');
    const button = window.document.createElement('button');
    button.type = 'button';
    button.className = 'document-tab';
    button.id = `doc-tab-${document.id}`;
    button.dataset.documentId = document.id;
    button.textContent = document.name;
    button.title = (document.path || document.name) + (document.externalChange ? ' · 原文件有变更' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'documentPanel');
    button.setAttribute('aria-selected', String(document.id === activeDocumentId));
    button.tabIndex = document.id === activeDocumentId ? 0 : -1;
    const close = window.document.createElement('button');
    close.type = 'button';
    close.className = 'document-tab-close';
    close.dataset.closeDocumentId = document.id;
    close.textContent = '×';
    close.title = `关闭 ${document.name} (Ctrl+W)`;
    close.setAttribute('aria-label', `关闭 ${document.name}`);
    item.append(button, close);
    documentTabs.append(item);
  });
  documentCount.textContent = `${documents.length} 个文档`;
  reopenDocumentButton.disabled = !closedDocuments.length;
  if (activeDocumentId) documentPane.setAttribute('aria-labelledby', `doc-tab-${activeDocumentId}`);
  else documentPane.removeAttribute('aria-labelledby');
  window.mojianDesktop?.watchFiles?.(documents.map(document => document.path).filter(Boolean));
}

function renderExternalChangeNotice() {
  const change = activeDocument()?.externalChange;
  externalChangeNotice.hidden = !change;
  if (!change) return;
  externalChangeMessage.textContent = change.status === 'changed'
    ? '原文件已在其他地方修改，当前草稿也有编辑。请选择要保留的版本。'
    : change.status === 'missing' ? '原文件已被删除或移动。当前草稿仍保留在本机，文件恢复后会继续同步。'
    : change.status === 'too-large' ? '原文件已超过 5 MB，暂停同步。当前草稿已保留，可导出。'
    : '暂时无法读取原文件。当前草稿已保留，恢复访问后会继续同步。';
  reloadExternalButton.hidden = change.status !== 'changed';
  keepLocalButton.textContent = change.status === 'changed' ? '保留当前草稿' : '知道了';
}

function acknowledgeDiskVersion(document, change) {
  document.diskContent = change.content;
  document.diskRevision = change.revision || document.diskRevision;
  document.diskDirty = normalizeDocumentText(document.content) !== change.content;
  document.externalChange = null;
}

function applyDiskVersion(document, change) {
  const isActive = document.id === activeDocumentId;
  if (isActive) captureDocument();
  document.content = change.content;
  document.bytes = change.bytes;
  document.encoding = change.encoding;
  acknowledgeDiskVersion(document, change);
  if (isActive) {
    const start = editor.selectionStart, end = editor.selectionEnd;
    const progress = scrollProgress, mode = currentMode;
    editor.value = change.content;
    editor.setSelectionRange(start, end);
    currentFileBytes = change.bytes;
    encodingSelect.value = change.encoding;
    update();
    requestAnimationFrame(() => {
      if (activeDocumentId !== document.id || currentMode !== mode || editor.value !== change.content) return;
      editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight) * progress;
      preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight) * progress;
      lineNumbers.scrollTop = editor.scrollTop;
      syncSearchHighlightScroll();
    });
  }
}

function reconcileDiskVersion(document, change) {
  if (document.id === activeDocumentId) captureDocument();
  const hadChange = Boolean(document.externalChange);
  change = { ...change, status: 'changed', content: normalizeDocumentText(change.content) };
  const content = normalizeDocumentText(document.content);
  if (content === change.content || document.diskContent === change.content || (change.revision && change.revision === document.diskRevision)) {
    acknowledgeDiskVersion(document, change);
    if (content === change.content) {
      document.bytes = change.bytes;
      if (document.id === activeDocumentId) currentFileBytes = change.bytes;
    }
  } else if (!document.diskDirty) {
    applyDiskVersion(document, change);
    if (document.id === activeDocumentId) showToast('已同步外部修改');
  } else document.externalChange = change;
  renderExternalChangeNotice();
  if (hadChange !== Boolean(document.externalChange)) renderDocumentTabs();
  saveDocuments();
}

function receiveExternalFileChange(file) {
  const document = documents.find(document => documentPathKey(document.path) === documentPathKey(file.path));
  if (!document) return;
  if (file.status !== 'changed') {
    const hadChange = Boolean(document.externalChange);
    document.externalChange = file;
    renderExternalChangeNotice();
    if (!hadChange) renderDocumentTabs();
    return;
  }
  const bytes = base64ToBytes(file.bytes);
  let encoding = detectEncoding(bytes);
  const hasBom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  if (!hasBom && document.encoding.startsWith('utf-16') && (encoding !== 'utf-8' || bytes.includes(0))) encoding = document.encoding;
  if (encoding === 'gb18030' && document.encoding === 'gbk') encoding = 'gbk';
  const content = decodeBytes(bytes, encoding);
  if (content !== null) reconcileDiskVersion(document, { ...file, bytes, encoding, content });
}

reloadExternalButton.addEventListener('click', () => {
  const document = activeDocument(), change = document?.externalChange;
  if (change?.status !== 'changed') return;
  applyDiskVersion(document, change);
  renderDocumentTabs();
  saveDocuments();
  (currentMode === 'preview' ? preview : editor).focus({ preventScroll: true });
});
keepLocalButton.addEventListener('click', () => {
  const document = activeDocument(), change = document?.externalChange;
  if (!change) return;
  captureDocument();
  if (change.status === 'changed') acknowledgeDiskVersion(document, change);
  else document.externalChange = null;
  renderExternalChangeNotice();
  renderDocumentTabs();
  saveDocuments();
});

function revealActiveTab() {
  documentTabs.querySelector('[aria-selected="true"]')?.closest('.document-tab-item').scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function setDocumentControls(enabled) {
  editor.disabled = !enabled;
  findButton.disabled = !enabled;
  readingWidthButton.disabled = !enabled;
  if (!enabled) closeSearch(false);
  encodingSelect.disabled = !enabled;
  editModeButton.disabled = !enabled;
  splitModeButton.disabled = !enabled;
  copyHtmlButton.disabled = !enabled;
  document.querySelector('#downloadButton').disabled = !enabled;
  documentName.tabIndex = enabled ? 0 : -1;
}

function clearDocumentView() {
  activeDocumentId = null;
  currentFileBytes = null;
  currentFilePath = null;
  scrollProgress = 0;
  editor.value = '';
  documentName.textContent = '未打开文档';
  documentName.contentEditable = 'false';
  setDocumentControls(false);
  update();
  renderDocumentTabs();
  setMode('preview', false);
}

function activateDocument(id, mode = currentMode) {
  const next = documents.find(document => document.id === id);
  if (!next) return;
  if (documentName.isContentEditable) documentName.blur();
  captureDocument();
  activeDocumentId = id;
  editor.value = next.content;
  documentName.textContent = next.name;
  currentFileBytes = next.bytes;
  currentFilePath = next.path;
  encodingSelect.value = next.encoding;
  setDocumentControls(true);
  scrollProgress = next.scroll;
  editor.setSelectionRange(next.selectionStart, next.selectionEnd);
  update();
  renderDocumentTabs();
  setMode(mode, false);
  revealActiveTab();
}

function closeDocument(id = activeDocumentId) {
  const index = documents.findIndex(document => document.id === id);
  if (index < 0) return;
  if (documentName.isContentEditable) documentName.blur();
  captureDocument();
  const previousDocuments = [...documents], previousClosed = [...closedDocuments];
  const previousId = activeDocumentId, previousMode = currentMode;
  const [closed] = documents.splice(index, 1);
  closedDocuments.push(closed);
  if (id === activeDocumentId) {
    activeDocumentId = null;
    const next = documents[Math.min(index, documents.length - 1)];
    if (next) activateDocument(next.id, previousMode);
    else clearDocumentView();
  } else { renderDocumentTabs(); revealActiveTab(); }
  if (!saveDocuments()) {
    const failedStatus = saveStatus.textContent;
    documents = previousDocuments;
    closedDocuments = previousClosed;
    activateDocument(previousId, previousMode);
    clearTimeout(saveTimer);
    saveStatus.textContent = failedStatus;
    showToast('关闭失败：无法保存草稿，请先导出文档');
    return;
  }
  requestAnimationFrame(() => documentTabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
  showToast(`已关闭 ${closed.name}，可恢复最近关闭的文档`);
}

function reopenDocument() {
  const document = closedDocuments.pop();
  if (!document) return;
  documents.push(document);
  activateDocument(document.id, currentMode);
  saveDocuments();
  showToast(`已恢复 ${document.name}`);
}

function newDocument() {
  const document = createDocument();
  documents.push(document);
  activateDocument(document.id, 'edit');
  saveDocuments();
  showToast('已新建文档');
}

function openDocument({ name, content, encoding, path, bytes, revision = null }) {
  const normalizedPath = path ? path.replace(/\\/g, '/').toLowerCase() : null;
  const existing = normalizedPath && documents.find(document => document.path?.replace(/\\/g, '/').toLowerCase() === normalizedPath);
  if (existing) {
    reconcileDiskVersion(existing, { content, encoding, bytes, revision });
    activateDocument(existing.id, 'preview');
    return;
  }
  const closedIndex = normalizedPath ? closedDocuments.findIndex(document => document.path?.replace(/\\/g, '/').toLowerCase() === normalizedPath) : -1;
  if (closedIndex >= 0) {
    const [document] = closedDocuments.splice(closedIndex, 1);
    documents.push(document);
    reconcileDiskVersion(document, { content, encoding, bytes, revision });
    activateDocument(document.id, 'preview');
    return;
  }
  const document = createDocument({ name, content, encoding, path, bytes, diskRevision: revision });
  documents.push(document);
  activateDocument(document.id, 'preview');
}

function restoreDocuments() {
  try {
    const stored = JSON.parse(localStorage.getItem(documentsStorageKey) || 'null');
    if (stored?.version === 1 && Array.isArray(stored.documents)) {
      const ids = new Set();
      const deserialize = list => list.filter(document => {
        if (!document || typeof document.id !== 'string' || ids.has(document.id) || typeof document.name !== 'string' || typeof document.content !== 'string') return false;
        ids.add(document.id);
        return true;
      }).map(document => createDocument({
        ...document,
        encoding: supportedEncodings.has(document.encoding) ? document.encoding : 'utf-8',
        path: typeof document.path === 'string' ? document.path : null,
        diskDirty: typeof document.diskDirty === 'boolean' ? document.diskDirty : true,
        diskRevision: typeof document.diskRevision === 'string' && /^[a-f\d]{64}$/.test(document.diskRevision) ? document.diskRevision : null,
        bytes: null
      }));
      documents = deserialize(stored.documents);
      closedDocuments = deserialize(Array.isArray(stored.closedDocuments) ? stored.closedDocuments : []);
      if (documents.length) {
        activateDocument(documents.some(document => document.id === stored.activeId) ? stored.activeId : documents[0].id, 'preview');
        return;
      }
      clearDocumentView();
      return;
    }
  } catch (_) { /* Fall back to the previous single-document draft. */ }
  let content = starter, name = '欢迎使用 Lumen.md', encoding = 'utf-8';
  try {
    const legacy = localStorage.getItem('mojian-content');
    if (legacy !== null) { content = legacy; name = localStorage.getItem('mojian-name') || '未命名文档.md'; }
    const savedEncoding = localStorage.getItem('lumen-encoding');
    if (supportedEncodings.has(savedEncoding)) encoding = savedEncoding;
  } catch (_) { /* Storage may be unavailable. */ }
  const document = createDocument({ name, content, encoding });
  documents.push(document);
  activateDocument(document.id, 'preview');
}

const savedTheme = (() => { try { return localStorage.getItem('lumen-theme') || 'light'; } catch (_) { return 'light'; } })();
document.documentElement.dataset.theme = savedTheme;
themeButton.textContent = savedTheme === 'dark' ? '☼' : '☾';
themeButton.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  themeButton.textContent = nextTheme === 'dark' ? '☼' : '☾';
  try { localStorage.setItem('lumen-theme', nextTheme); } catch (_) { /* storage may be disabled */ }
  update();
});

if (window.mojianDesktop?.minimize) {
  minimizeButton.addEventListener('click', () => window.mojianDesktop.minimize());
  maximizeButton.addEventListener('click', () => window.mojianDesktop.toggleMaximize());
  closeButton.addEventListener('click', () => window.mojianDesktop.close());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}

const allowedHtmlTags = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'center', 'cite', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark',
  'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'th', 'thead', 'tr', 'u', 'ul', 'audio', 'video', 'source', 'font'
]);
const allowedHtmlAttributes = new Set(['align', 'alt', 'checked', 'colspan', 'color', 'disabled', 'height', 'open', 'rowspan', 'start', 'title', 'type', 'width']);
const safeHtmlClasses = new Set(['task', 'table-wrap', 'flowchart-diagram', 'mermaid-diagram', 'math-expression', 'footnotes', 'footnote-ref', 'footnote-backref', 'markdown-toc', 'markdown-callout', 'callout-title', 'export-placeholder', 'html-markdown-table']);

function safeLocalTarget(value) {
  return value && !/[\u0000-\u001f]/.test(value) && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:file:|[a-z]:[\\/])/i.test(value));
}

function safeTextStyle(element, value) {
  const probe = document.createElement('span');
  probe.style.cssText = value;
  element.removeAttribute('style');
  for (const property of ['color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration', 'vertical-align', 'white-space']) {
    const rule = probe.style.getPropertyValue(property);
    if (rule && !/(?:url\s*\(|expression\s*\(|var\s*\(|[<>])/i.test(rule) && CSS.supports(property, rule)) element.style.setProperty(property, rule);
  }
}

function sanitizeRenderedHtml(html, parseHtmlCells = true) {
  const template = document.createElement('template');
  template.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...allowedHtmlTags],
    ALLOWED_ATTR: [...allowedHtmlAttributes, 'class', 'style', 'id', 'href', 'src', 'data-local-path', 'data-flowchart-source', 'data-math-source', 'data-math-display'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed']
  }) : escapeHtml(html);
  const elements = [...template.content.querySelectorAll('*')];
  elements.forEach(element => {
    const tag = element.tagName.toLowerCase();
    if (!allowedHtmlTags.has(tag)) {
      if (['script', 'style', 'iframe', 'object', 'embed'].includes(tag)) element.remove();
      else element.replaceWith(...element.childNodes);
      return;
    }
    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (name === 'class') {
        const safeClasses = attribute.value.split(/\s+/).filter(value => safeHtmlClasses.has(value) || /^(?:language-[\w-]+|toc-level-[1-6]|callout-(?:note|tip|important|warning|caution|success))$/.test(value));
        if (safeClasses.length) element.className = safeClasses.join(' ');
        else element.removeAttribute('class');
      } else if (name === 'style') {
        safeTextStyle(element, attribute.value);
      } else if (name === 'id') {
        const id = attribute.value.replace(/[^\p{L}\p{N}_:.-]/gu, '-').slice(0, 240);
        if (id) element.id = id.startsWith('lumen-') ? id : `lumen-html-${id}`;
        else element.removeAttribute('id');
      } else if (!allowedHtmlAttributes.has(name) && !['href', 'src', 'data-local-path', 'data-flowchart-source', 'data-math-source', 'data-math-display'].includes(name)) {
        element.removeAttribute(attribute.name);
      }
    });
    if (tag === 'a') {
      const href = element.getAttribute('href')?.trim() || '';
      const localPath = element.dataset.localPath;
      if (localPath) {
        if (safeLocalTarget(localPath)) element.setAttribute('href', '#');
        else { element.removeAttribute('href'); element.removeAttribute('data-local-path'); }
      } else if (/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else if (/^#[^\s]*$/.test(href) && href !== '#') {
        /* Anchor links are resolved inside the current preview. */
      } else if (href && href !== '#' && safeLocalTarget(href)) {
        element.setAttribute('href', '#');
        element.dataset.localPath = href;
      } else {
        element.removeAttribute('href');
      }
    }
    if (tag === 'img') {
      const src = element.getAttribute('src')?.trim() || '';
      element.removeAttribute('src');
      element.dataset.imageSource = src;
      element.setAttribute('loading', 'lazy');
    }
    if (['audio', 'video', 'source'].includes(tag)) {
      const src = element.getAttribute('src')?.trim() || '';
      element.removeAttribute('src');
      element.dataset.mediaSource = src;
      if (tag !== 'source') {
        element.setAttribute('controls', '');
        element.setAttribute('preload', 'metadata');
      }
    }
    if (tag === 'input') {
      if (element.getAttribute('type')?.toLowerCase() !== 'checkbox') element.remove();
      else element.disabled = true;
    }
  });
  if (parseHtmlCells && window.LumenMarkdown?.renderInline) {
    template.content.querySelectorAll('table.html-markdown-table td, table.html-markdown-table th').forEach(cell => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement.closest('pre, code, a, .math-expression') && /[*_`$~]|!?\[/.test(node.textContent)) nodes.push(node);
      }
      nodes.forEach(node => {
        const fragment = document.createElement('template');
        fragment.innerHTML = sanitizeRenderedHtml(markdownSession ? markdownSession.renderInline(node.textContent) : window.LumenMarkdown.renderInline(node.textContent), false);
        node.replaceWith(fragment.content);
      });
    });
  }
  // HTML exports need the same constrained, scrollable table container as GFM.
  template.content.querySelectorAll('table').forEach(table => {
    if (table.parentElement?.classList.contains('table-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    table.replaceWith(wrapper);
    wrapper.append(table);
  });
  return template.innerHTML;
}

function updateTableOverflow(scroll) {
  if (!scroll.classList.contains('table-scroll')) return;
  const hint = scroll.parentElement?.querySelector(':scope > .table-tools .table-overflow-hint');
  const bar = scroll.parentElement?.querySelector(':scope > .table-scrollbar');
  const overflow = scroll.clientWidth > 0 && scroll.scrollWidth > scroll.clientWidth + 1;
  if (hint && hint.hidden === overflow) hint.hidden = !overflow;
  if (bar) {
    if (bar.hidden === overflow) bar.hidden = !overflow;
    const width = `${scroll.scrollWidth}px`;
    if (bar.firstElementChild.style.width !== width) bar.firstElementChild.style.width = width;
    bar.scrollLeft = scroll.scrollLeft;
  }
}
function decoratePreviewTables() {
  tableLayoutObserver.disconnect();
  tableLayoutTargets.clear();
  preview.querySelectorAll('.table-wrap').forEach((wrapper, index) => {
    const table = wrapper.querySelector(':scope > table');
    if (!table) return;
    const columns = Math.max(0, ...[...table.rows].map(row => [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)));
    const rows = [...table.tBodies].reduce((sum, body) => sum + body.rows.length, 0);
    const description = `${columns} 列 · ${rows} 行`;
    const tools = document.createElement('div');
    tools.className = 'table-tools';
    tools.dataset.previewUi = '';
    const label = document.createElement('span');
    label.textContent = description;
    const actions = document.createElement('div');
    actions.className = 'table-tools-actions';
    const hint = document.createElement('span');
    hint.className = 'table-overflow-hint';
    hint.textContent = '可横向滚动';
    hint.hidden = true;
    const expand = document.createElement('button');
    expand.className = 'table-expand-button';
    expand.type = 'button';
    expand.textContent = '⤢ 展开表格';
    expand.setAttribute('aria-label', `展开第 ${index + 1} 张表格，${description}`);
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', `第 ${index + 1} 张表格，${description}，可横向滚动`);
    const bar = document.createElement('div');
    bar.className = 'table-scrollbar';
    bar.dataset.previewUi = '';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', `第 ${index + 1} 张表格顶部横向滚动区域`);
    bar.hidden = true;
    bar.append(document.createElement('div'));
    table.replaceWith(scroll);
    scroll.append(table);
    actions.append(hint, expand);
    tools.append(label, actions);
    wrapper.prepend(tools, bar);
    bar.addEventListener('scroll', () => { if (Math.abs(scroll.scrollLeft - bar.scrollLeft) > .5) scroll.scrollLeft = bar.scrollLeft; });
    scroll.addEventListener('scroll', () => { if (Math.abs(bar.scrollLeft - scroll.scrollLeft) > .5) bar.scrollLeft = scroll.scrollLeft; });
    expand.addEventListener('click', () => openTableView(table, scroll, expand, `第 ${index + 1} 张表格 · ${description}`));
    tableLayoutObserver.observe(scroll);
    tableLayoutObserver.observe(table);
  });
}
function openTableView(table, scroll, trigger, description) {
  closeTableView(false);
  const placeholder = document.createElement('div');
  placeholder.className = 'table-presentation-placeholder';
  placeholder.dataset.previewUi = '';
  placeholder.style.height = `${scroll.clientHeight}px`;
  placeholder.textContent = '表格已在独立视图中打开';
  presentedTable = { table, scroll, trigger, placeholder, left: scroll.scrollLeft, top: preview.scrollTop };
  scroll.append(placeholder);
  tableDialogContent.append(table);
  tableDialogDescription.textContent = description;
  tableDialog.showModal();
  tableDialogContent.scrollLeft = presentedTable.left;
  tableDialogContent.scrollTop = 0;
}
function closeTableView(restoreFocus = true) {
  const current = presentedTable;
  presentedTable = null;
  if (current) {
    const left = tableDialogContent.scrollLeft;
    current.placeholder.remove();
    if (current.scroll.isConnected) {
      current.scroll.append(current.table);
      current.scroll.scrollLeft = left;
      preview.scrollTop = current.top;
      updateTableOverflow(current.scroll);
    } else current.table.remove();
  }
  if (tableDialog.open) tableDialog.close();
  if (restoreFocus && current?.trigger.isConnected) current.trigger.focus({ preventScroll: true });
}
document.querySelector('#closeTableDialogButton').addEventListener('click', () => closeTableView());
tableDialog.addEventListener('cancel', event => { event.preventDefault(); closeTableView(); });
tableDialog.addEventListener('close', () => { if (!tableDialog.open && presentedTable) closeTableView(); });

function imagePlaceholder(image, source) {
  if (!image.isConnected) return;
  const placeholder = document.createElement('span');
  placeholder.className = 'image-placeholder';
  placeholder.setAttribute('role', 'status');
  const message = document.createElement('span');
  message.textContent = `图片无法显示：${image.alt || (source.startsWith('data:') ? '插入的图片' : source) || '图片地址为空'}`;
  placeholder.append(message);
  appendResourceLink(placeholder, source);
  image.replaceWith(placeholder);
}

function appendResourceLink(container, source) {
  const link = document.createElement('a');
  link.textContent = '打开原链接';
  if (/^https?:\/\//i.test(source)) {
    try { link.href = new URL(source).href; } catch (_) { return; }
  } else if (safeLocalTarget(source)) {
    link.href = '#';
    link.dataset.localPath = source;
    link.textContent = '打开原文件';
  } else return;
  container.append(link);
}

function resolvePreviewMedia() {
  const sourceFile = currentFilePath;
  preview.querySelectorAll('audio, video').forEach(async media => {
    const direct = media.dataset.mediaSource;
    const sources = direct ? [direct] : Array.from(media.querySelectorAll('source'), source => source.dataset.mediaSource).filter(Boolean);
    const fail = () => {
      if (!media.isConnected) return;
      const placeholder = document.createElement('span');
      placeholder.className = 'image-placeholder';
      placeholder.textContent = '音视频无法播放，可打开原文件或链接';
      appendResourceLink(placeholder, sources[0] || '');
      media.replaceWith(placeholder);
    };
    media.addEventListener('error', fail, { once: true });
    for (const source of sources) {
      let url;
      try {
        if (/^https?:\/\//i.test(source)) url = new URL(source).href;
        else if (/^data:(audio|video)\/[^,]+,/i.test(source)) url = source;
        else url = await window.mojianDesktop?.resolveMediaUrl?.(source, sourceFile);
      } catch (_) { /* Try the next source before showing the fallback. */ }
      if (!media.isConnected) return;
      if (url) { media.src = url; return; }
    }
    fail();
  });
}

function highlightCodeBlocks() {
  if (!window.hljs) return;
  preview.querySelectorAll('pre code').forEach(code => {
    const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
    if (!language || !window.hljs.getLanguage(language) || code.textContent.length > 100000) return;
    try { code.innerHTML = window.hljs.highlight(code.textContent, { language, ignoreIllegals: true }).value; }
    catch (_) { /* Preserve code text for unknown or invalid syntax. */ }
  });
}

function scrollPreviewToFragment(fragment) {
  let target = String(fragment || '').replace(/^#/, '');
  try { target = decodeURIComponent(target); } catch (_) { return false; }
  const slug = target.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s+/g, '-');
  const candidates = new Set([target, `lumen-heading-${slug}`, `lumen-html-${target}`]);
  const element = [...preview.querySelectorAll('[id]')].find(element => candidates.has(element.id));
  if (!element) return false;
  preview.scrollTop += element.getBoundingClientRect().top - preview.getBoundingClientRect().top - 12;
  return true;
}

function resolvePreviewImages() {
  const sourceFile = currentFilePath;
  preview.querySelectorAll('img[data-image-source]').forEach(async image => {
    const source = image.dataset.imageSource;
    image.removeAttribute('data-image-source');
    image.addEventListener('error', () => imagePlaceholder(image, source), { once: true });
    let url = null;
    try {
      if (/^https?:\/\//i.test(source)) {
        const parsed = new URL(source);
        if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href;
      } else if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon|apng)(?:;[^,]*)?,/i.test(source)) {
        url = source;
      } else if (window.mojianDesktop?.resolveImageUrl) {
        const key = JSON.stringify([sourceFile, source]);
        if (!imageUrlCache.has(key)) {
          if (imageUrlCache.size > 200) imageUrlCache.clear();
          imageUrlCache.set(key, window.mojianDesktop.resolveImageUrl(source, sourceFile));
        }
        url = await imageUrlCache.get(key);
        if (!url) imageUrlCache.delete(key);
      }
    } catch (_) { /* Show a placeholder when the image cannot be resolved. */ }
    if (!image.isConnected) return;
    if (url) image.src = url;
    else imagePlaceholder(image, source);
  });
}

function renderMarkdown(source) {
  try { markdownSession = window.LumenMarkdown.createSession(source); return markdownSession.html; }
  catch (error) { return '<p>Markdown 预览失败：' + escapeHtml(error.message) + '</p><pre><code>' + escapeHtml(source) + '</code></pre>'; }
}

function renderFlowcharts() {
  preview.querySelectorAll('.flowchart-diagram').forEach(container => {
    const source = container.dataset.flowchartSource;
    if (!source) return;
    try {
      if (!window.flowchart) throw new Error('流程图库未加载');
      container.removeAttribute('data-flowchart-source');
      const diagramSource = decodeURIComponent(source).replace(/:\$[^\r\n]*/g, '');
      const chart = window.flowchart.parse(diagramSource);
      Object.values(chart.symbols || {}).forEach(symbol => {
        delete symbol.function;
        if (symbol.link && !/^(?:https?:\/\/|#[^\s]*)/i.test(symbol.link)) delete symbol.link;
      });
      chart.drawSVG(container, {
        'line-width': 2,
        'line-length': 38,
        'text-margin': 10,
        'font-size': 15,
        'font-color': document.documentElement.dataset.theme === 'dark' ? '#e8efec' : '#303236',
        'line-color': document.documentElement.dataset.theme === 'dark' ? '#9db2aa' : '#66706d',
        'element-color': document.documentElement.dataset.theme === 'dark' ? '#9db2aa' : '#66706d',
        'fill': document.documentElement.dataset.theme === 'dark' ? '#182329' : '#ffffff',
        'yes-text': '是',
        'no-text': '否',
        'arrow-end': 'block',
        'scale': 1
      });
      normalizeDiagramLinks(container);
    } catch (error) {
      container.classList.add('flowchart-error');
      container.textContent = `流程图渲染失败：${error.message}`;
    }
  });
}

function normalizeDiagramLinks(container) {
  container.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href') || link.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    link.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    link.removeAttribute('href');
    link.removeAttribute('target');
    if (/^#[^\s]+$/.test(href)) link.setAttribute('href', href);
    else if (/^https?:\/\//i.test(href)) {
      try {
        const url = new URL(href);
        if (['http:', 'https:'].includes(url.protocol)) link.setAttribute('href', url.href);
      } catch (_) { /* Leave invalid diagram links inactive. */ }
    }
  });
}

async function renderMermaidDiagrams() {
  const containers = preview.querySelectorAll('.mermaid-diagram');
  if (!containers.length) return;
  if (!window.mermaid) {
    containers.forEach(container => {
      container.classList.add('flowchart-error');
      container.textContent = '流程图渲染失败：Mermaid 未加载';
    });
    return;
  }
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
  });
  containers.forEach(async container => {
    const source = container.dataset.flowchartSource;
    if (!source) return;
    try {
      const id = `lumen-mermaid-${++mermaidRenderId}`;
      const result = await window.mermaid.render(id, decodeURIComponent(source));
      if (!container.isConnected) return;
      container.removeAttribute('data-flowchart-source');
      container.innerHTML = result.svg;
      result.bindFunctions?.(container);
      normalizeDiagramLinks(container);
    } catch (error) {
      if (!container.isConnected) return;
      container.classList.add('flowchart-error');
      container.textContent = `流程图渲染失败：${error.message}`;
    }
  });
}

function update() {
  closeTableView(false);
  const value = editor.value;
  markdownSession = null;
  const previousName = activeDocument()?.name;
  captureDocument();
  if (previousName !== activeDocument()?.name) renderDocumentTabs();
  preview.innerHTML = !activeDocument()
    ? '<div class="preview-empty"><strong>尚未打开文档</strong><p>点击「新建文档」开始书写，或打开已有文档。关闭的草稿可通过「恢复关闭」重新打开。</p></div>'
    : value.trim() ? sanitizeRenderedHtml(renderMarkdown(value)) : '<div class="preview-empty"><strong>这份文档还是空白的</strong><p>点击「编辑」开始书写，或在编辑工具栏中插入图片。</p></div>';
  const footnotes = markdownSession?.renderFootnotes();
  if (footnotes) preview.insertAdjacentHTML('beforeend', sanitizeRenderedHtml(footnotes, false));
  resolvePreviewImages();
  resolvePreviewMedia();
  window.LumenMarkdown?.renderMath(preview);
  highlightCodeBlocks();
  renderFlowcharts();
  renderMermaidDiagrams();
  decoratePreviewTables();
  renderOutline();
  const count = activeDocument() ? value.length : 0;
  const lines = activeDocument() ? value.split('\n').length : 0;
  wordCount.textContent = count.toLocaleString('zh-CN');
  lineCount.textContent = lines.toLocaleString('zh-CN');
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  renderExternalChangeNotice();
  refreshSearch();
  saveStatus.textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDocuments, 350);
}

function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function updateSearchStatus() {
  if (currentMode !== 'preview') searchMatchIndex = searchMatches.findIndex(match => match.start === editor.selectionStart && match.end === editor.selectionEnd);
  const hasMatches = searchMatches.length > 0;
  searchStatus.textContent = !searchInput.value ? '输入要查找的文本'
    : !hasMatches ? '无匹配结果'
    : searchMatchIndex < 0 ? `${searchMatches.length} 处匹配` : `${searchMatchIndex + 1} / ${searchMatches.length}`;
  searchInput.setAttribute('aria-invalid', String(Boolean(searchInput.value) && !hasMatches));
  previousMatchButton.disabled = nextMatchButton.disabled = !hasMatches;
  replaceButton.disabled = replaceAllButton.disabled = !hasMatches || currentMode === 'preview';
  renderPreviewSearchHighlights();
  renderSearchHighlight();
}

function collectPreviewTextRuns() {
  const runs = [];
  let run = null, offset = 0;
  const flush = () => { if (run) { run.text = run.parts.join(''); runs.push(run); offset += run.text.length + 1; run = null; } };
  const append = (node, text, from, to, collapsed = false) => {
    if (!text) return;
    if (!run) run = { parts: [], segments: [], length: 0, offset, last: '' };
    if (collapsed && run.last === ' ') return;
    run.segments.push({ node, start: run.length, end: run.length + text.length, from, to, collapsed });
    run.parts.push(text);
    run.length += text.length;
    run.last = text.slice(-1);
  };
  const visit = element => {
    if (element.matches('script,style,template,defs,title,desc,metadata,.katex-mathml,.preview-empty,[data-preview-ui]')) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return;
    const boundary = element !== preview && (!['inline', 'contents', 'inline-block', 'inline-flex', 'inline-grid'].includes(style.display) || element.localName === 'text');
    if (boundary || ['br', 'hr', 'img', 'audio', 'video'].includes(element.localName)) flush();
    for (const child of element.childNodes) {
      if (element.localName === 'details' && !element.open && (child.nodeType !== Node.ELEMENT_NODE || child.localName !== 'summary')) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        if (['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace)) append(child, child.data, 0, child.length);
        else if (!/[\t\n\r\f]| {2,}/.test(child.data)) {
          // Most prose needs no per-word mapping; only trim a repeated boundary space.
          const from = run?.last === ' ' && child.data.startsWith(' ') ? 1 : 0;
          append(child, child.data.slice(from), from, child.length);
        }
        else {
          const parts = style.whiteSpace === 'pre-line' ? /\r\n|[\r\n]|[\t\f ]+|[^\t\n\r\f ]+/g : /[\t\n\r\f ]+|[^\t\n\r\f ]+/g;
          for (const part of child.data.matchAll(parts)) {
            if (style.whiteSpace === 'pre-line' && /[\r\n]/.test(part[0])) { flush(); continue; }
            const collapsed = /^[\t\n\r\f ]/.test(part[0]);
            append(child, collapsed ? ' ' : part[0], part.index, part.index + part[0].length, collapsed);
          }
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) visit(child);
    }
    if (boundary) flush();
  };
  visit(preview);
  flush();
  return runs;
}

function previewTextPosition(segments, offset, end = false) {
  let low = 0, high = segments.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (end ? segments[middle].end >= offset : segments[middle].end > offset) high = middle;
    else low = middle + 1;
  }
  const segment = segments[low];
  return { node: segment.node, offset: segment.collapsed ? (offset > segment.start ? segment.to : segment.from) : segment.from + offset - segment.start };
}

function findPreviewMatches(expression) {
  for (const run of collectPreviewTextRuns()) {
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(run.text))) {
      const start = previewTextPosition(run.segments, match.index);
      const end = previewTextPosition(run.segments, match.index + match[0].length, true);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if ([...range.getClientRects()].some(rect => rect.width && rect.height)) searchMatches.push({ start: run.offset + match.index, end: run.offset + match.index + match[0].length, range });
    }
  }
}

function renderPreviewSearchHighlights() {
  if (!CSS.highlights) return;
  CSS.highlights.delete('lumen-preview-search');
  CSS.highlights.delete('lumen-preview-search-active');
  if (searchPanel.hidden || currentMode !== 'preview' || !searchMatches.length) return;
  const highlight = new Highlight();
  for (const match of searchMatches) highlight.add(match.range);
  CSS.highlights.set('lumen-preview-search', highlight);
  const active = searchMatches[searchMatchIndex];
  if (active) {
    const selected = new Highlight(active.range);
    selected.priority = 1;
    CSS.highlights.set('lumen-preview-search-active', selected);
  }
}

function refreshSearch() {
  const context = JSON.stringify([activeDocumentId, currentMode, searchInput.value, matchCaseInput.checked]);
  const previousIndex = context === searchResultContext ? searchMatchIndex : -1;
  const previousMatch = context === searchResultContext ? searchMatches[searchMatchIndex] : null;
  searchResultContext = context;
  searchMatches = [];
  searchMatchIndex = -1;
  if (!searchPanel.hidden && activeDocument() && searchInput.value) {
    // Escape the query so punctuation and replacement tokens are always literal text.
    // RegExp case folding preserves original UTF-16 offsets, including Unicode text.
    const literal = searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(literal, matchCaseInput.checked ? 'gu' : 'giu');
    if (currentMode === 'preview') {
      findPreviewMatches(expression);
      if (previousMatch) {
        searchMatchIndex = searchMatches.findIndex(match => match.range.startContainer === previousMatch.range.startContainer && match.range.startOffset === previousMatch.range.startOffset && match.range.endContainer === previousMatch.range.endContainer && match.range.endOffset === previousMatch.range.endOffset);
        if (searchMatchIndex < 0) searchMatchIndex = Math.min(previousIndex, searchMatches.length - 1);
      }
    } else {
      let match;
      while ((match = expression.exec(editor.value))) searchMatches.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  updateSearchStatus();
}

function syncSearchHighlightScroll() {
  searchHighlightContent.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
}

function renderSearchHighlight() {
  const match = searchMatches[searchMatchIndex];
  if (searchPanel.hidden || editorView.hidden || !match) {
    searchHighlights.hidden = true;
    searchHighlightLayout = null;
    searchHighlightContent.replaceChildren();
    return;
  }
  const value = editor.value, width = editor.clientWidth;
  if (searchHighlightLayout?.value === value && searchHighlightLayout.width === width && searchHighlightLayout.start === match.start && searchHighlightLayout.end === match.end) {
    syncSearchHighlightScroll();
    return;
  }
  // Measure the complete text in one node to preserve Unicode glyphs and wrapping.
  // Drawing underneath the textarea keeps the current match visible while typing
  // in the search box, when Chromium hides the textarea's native selection.
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'textTransform', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap']) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none', width: `${width}px`, boxSizing: 'border-box' });
  mirror.setAttribute('aria-hidden', 'true');
  mirror.textContent = value;
  document.body.append(mirror);
  const range = document.createRange();
  range.setStart(mirror.firstChild, match.start);
  range.setEnd(mirror.firstChild, match.end);
  const origin = mirror.getBoundingClientRect();
  const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
  searchHighlightContent.replaceChildren(...rects.map(rect => {
    const box = document.createElement('span');
    box.className = 'search-highlight-box';
    Object.assign(box.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    return box;
  }));
  searchHighlightContent.style.width = `${width}px`;
  searchHighlightLayout = { value, width, start: match.start, end: match.end, top: (rects[0]?.top ?? origin.top) - origin.top, height: rects[0]?.height || 0 };
  mirror.remove();
  searchHighlights.hidden = false;
  syncSearchHighlightScroll();
}

function selectSearchMatch(index) {
  const match = searchMatches[index];
  if (!match) return;
  if (currentMode === 'preview') {
    searchMatchIndex = index;
    updateSearchStatus();
    // Reveal horizontally scrollable code/tables before centering in the preview.
    for (let parent = match.range.startContainer.parentElement; parent && parent !== preview; parent = parent.parentElement) {
      if (parent.scrollWidth <= parent.clientWidth || !/auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const rect = [...match.range.getClientRects()].find(rect => rect.width && rect.height);
      if (!rect) break;
      const viewport = parent.getBoundingClientRect();
      if (rect.left < viewport.left) parent.scrollLeft -= viewport.left - rect.left;
      else if (rect.right > viewport.left + parent.clientWidth) parent.scrollLeft += rect.right - viewport.left - parent.clientWidth;
    }
    const rect = [...match.range.getClientRects()].find(rect => rect.width && rect.height);
    if (rect) {
      const viewport = preview.getBoundingClientRect();
      // Reveal inside the preview without moving focus away from the find box.
      preview.scrollTop += rect.top - viewport.top - (preview.clientHeight - rect.height) / 2;
      const scrollRange = preview.scrollHeight - preview.clientHeight;
      scrollProgress = scrollRange > 0 ? preview.scrollTop / scrollRange : 0;
    }
    return;
  }
  editor.setSelectionRange(match.start, match.end);
  updateSearchStatus();
  if (searchHighlightLayout) editor.scrollTop = Math.max(0, searchHighlightLayout.top - (editor.clientHeight - searchHighlightLayout.height) / 2);
  lineNumbers.scrollTop = editor.scrollTop;
  const scrollRange = editor.scrollHeight - editor.clientHeight;
  scrollProgress = scrollRange > 0 ? editor.scrollTop / scrollRange : 0;
  syncSearchHighlightScroll();
}

function selectNearestSearchMatch() {
  if (currentMode === 'preview') {
    if (searchMatchIndex >= 0) { selectSearchMatch(searchMatchIndex); return; }
    const top = preview.getBoundingClientRect().top;
    const index = searchMatches.findIndex(match => [...match.range.getClientRects()].some(rect => rect.bottom >= top));
    selectSearchMatch(index < 0 ? 0 : index);
    return;
  }
  const index = searchMatches.findIndex(match => match.start >= editor.selectionStart);
  selectSearchMatch(index < 0 ? 0 : index);
}

function moveSearchMatch(direction) {
  refreshSearch();
  if (!searchMatches.length) return;
  let index;
  if (searchMatchIndex >= 0) index = (searchMatchIndex + direction + searchMatches.length) % searchMatches.length;
  else if (currentMode === 'preview') index = direction > 0 ? 0 : searchMatches.length - 1;
  else if (direction > 0) {
    index = searchMatches.findIndex(match => match.start >= editor.selectionEnd);
    if (index < 0) index = 0;
  } else {
    index = searchMatches.findLastIndex(match => match.end <= editor.selectionStart);
    if (index < 0) index = searchMatches.length - 1;
  }
  selectSearchMatch(index);
}

function setReplaceExpanded(expanded) {
  replaceRow.hidden = !expanded;
  toggleReplaceButton.textContent = expanded ? '⌄' : '›';
  toggleReplaceButton.setAttribute('aria-expanded', String(expanded));
  toggleReplaceButton.setAttribute('aria-label', expanded ? '收起替换' : '展开替换');
  toggleReplaceButton.title = expanded ? '收起替换' : '展开替换';
}

function openSearch(withReplace = false) {
  if (!activeDocument()) return;
  if (searchPanel.hidden) {
    const selection = window.getSelection();
    const selected = currentMode === 'preview'
      ? selection && preview.contains(selection.anchorNode) && preview.contains(selection.focusNode) ? selection.toString() : ''
      : editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected && !/[\r\n]/.test(selected)) searchInput.value = selected;
  }
  searchPanel.hidden = false;
  findButton.setAttribute('aria-expanded', 'true');
  if (withReplace && currentMode === 'preview') setMode('edit');
  setReplaceExpanded(currentMode !== 'preview' && (withReplace || !replaceRow.hidden));
  const request = ++searchFocusRequest, documentId = activeDocumentId;
  requestAnimationFrame(() => {
    if (searchPanel.hidden || request !== searchFocusRequest || documentId !== activeDocumentId) return;
    refreshSearch();
    selectNearestSearchMatch();
    searchInput.focus({ preventScroll: true });
    searchInput.select();
  });
}

function closeSearch(restoreFocus = true) {
  if (searchPanel.hidden) return;
  searchPanel.hidden = true;
  searchFocusRequest++;
  findButton.setAttribute('aria-expanded', 'false');
  searchMatches = [];
  searchMatchIndex = -1;
  searchResultContext = '';
  renderPreviewSearchHighlights();
  renderSearchHighlight();
  if (restoreFocus) (editorView.hidden ? preview : editor).focus({ preventScroll: true });
}

function replaceSearchRange(start, end, replacement) {
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
  // Chromium's editing command keeps each replacement in the native undo history.
  // Its input event also updates preview, stats and the active document's draft.
  if (!document.execCommand('insertText', false, replacement)) {
    editor.setRangeText(replacement, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function replaceCurrentMatch() {
  if (currentMode === 'preview') return;
  refreshSearch();
  if (!searchMatches.length) return;
  if (searchMatchIndex < 0) selectNearestSearchMatch();
  const match = searchMatches[searchMatchIndex], replacement = replaceInput.value;
  replaceSearchRange(match.start, match.end, replacement);
  refreshSearch();
  const next = searchMatches.findIndex(result => result.start >= match.start + replacement.length);
  selectSearchMatch(next < 0 ? 0 : next);
  replaceInput.focus({ preventScroll: true });
}

function replaceAllMatches() {
  if (currentMode === 'preview') return;
  refreshSearch();
  if (!searchMatches.length) return;
  const value = editor.value, replacement = replaceInput.value, count = searchMatches.length;
  const parts = [];
  let cursor = 0;
  for (const match of searchMatches) {
    parts.push(value.slice(cursor, match.start), replacement);
    cursor = match.end;
  }
  parts.push(value.slice(cursor));
  replaceSearchRange(0, value.length, parts.join(''));
  refreshSearch();
  selectSearchMatch(0);
  replaceInput.focus({ preventScroll: true });
  showToast(`已替换 ${count} 处文本`);
}

findButton.addEventListener('click', () => openSearch());
document.querySelector('#closeSearchButton').addEventListener('click', () => closeSearch());
toggleReplaceButton.addEventListener('click', () => {
  if (currentMode === 'preview') { openSearch(true); return; }
  setReplaceExpanded(replaceRow.hidden);
  (replaceRow.hidden ? searchInput : replaceInput).focus({ preventScroll: true });
});
for (const input of [searchInput, matchCaseInput]) input.addEventListener('input', () => { refreshSearch(); selectNearestSearchMatch(); });
previousMatchButton.addEventListener('click', () => moveSearchMatch(-1));
nextMatchButton.addEventListener('click', () => moveSearchMatch(1));
replaceButton.addEventListener('click', replaceCurrentMatch);
replaceAllButton.addEventListener('click', replaceAllMatches);
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); moveSearchMatch(event.shiftKey ? -1 : 1); }
});
replaceInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); replaceCurrentMatch(); }
});
editor.addEventListener('select', () => { if (!searchPanel.hidden) updateSearchStatus(); });
new ResizeObserver(() => renderSearchHighlight()).observe(editor);

function schedulePreviewSearchRefresh() {
  if (searchPanel.hidden || currentMode !== 'preview' || previewSearchRefreshFrame) return;
  previewSearchRefreshFrame = requestAnimationFrame(() => {
    previewSearchRefreshFrame = 0;
    if (searchPanel.hidden || currentMode !== 'preview') return;
    refreshSearch();
    if (searchMatchIndex < 0) selectNearestSearchMatch();
  });
}
new MutationObserver(schedulePreviewSearchRefresh).observe(preview, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden', 'style', 'class'] });
preview.addEventListener('toggle', schedulePreviewSearchRefresh, true);

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
  if (!supportedEncodings.has(encoding)) return;
  encodingSelect.value = encoding;
  try { localStorage.setItem('lumen-encoding', encoding); } catch (_) { /* storage may be disabled */ }
  if (reload && currentFileBytes) {
    const decoded = decodeBytes(currentFileBytes, encoding);
    if (decoded !== null) {
      const document = activeDocument();
      if (document) { document.diskContent = normalizeDocumentText(decoded); document.diskDirty = false; }
      editor.value = decoded;
      update();
      showToast(`已按 ${encodingSelect.selectedOptions[0].textContent} 重新解析`);
    }
  }
  captureDocument();
  saveDocuments();
}

function setMode(mode, preserveScroll = true) {
  const isEdit = mode === 'edit';
  const isPreview = mode === 'preview';
  const isSplit = mode === 'split';
  const outgoing = currentMode === 'preview' ? preview : editor;
  const outgoingRange = outgoing.scrollHeight - outgoing.clientHeight;
  if (preserveScroll && outgoingRange > 0) scrollProgress = outgoing.scrollTop / outgoingRange;
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
  readingWidthButton.hidden = isEdit;
  currentMode = mode;
  searchInput.placeholder = isPreview ? '查找预览正文…' : '查找 Markdown 源文本…';
  searchPanel.dataset.scope = isPreview ? 'preview' : 'source';
  if (isPreview) setReplaceExpanded(false);
  if (!searchPanel.hidden) refreshSearch();
  const selectedDocumentId = activeDocumentId;
  requestAnimationFrame(() => {
    if (currentMode !== mode || activeDocumentId !== selectedDocumentId) return;
    syncingScroll = true;
    if (!isPreview) editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight) * scrollProgress;
    if (!isEdit) preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight) * scrollProgress;
    requestAnimationFrame(() => { syncingScroll = false; });
    if (!searchPanel.hidden) { refreshSearch(); selectNearestSearchMatch(); }
    scheduleOutlineActive();
    if (!isPreview && searchPanel.hidden) editor.focus({ preventScroll: true });
  });
}

async function loadFile(file) {
  if (!file || !(/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain')) {
    showToast('请选择 .md 或 .markdown 文件'); return false;
  }
  if (file.size > 5 * 1024 * 1024) { showToast('文件不能超过 5 MB'); return false; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = detectEncoding(bytes);
    const content = decodeBytes(bytes, encoding);
    if (content === null) return false;
    const path = window.mojianDesktop?.getPathForFile?.(file) || file.path || null;
    openDocument({ name: file.name, content, encoding, path, bytes });
    return true;
  } catch (_) { showToast(`无法读取 ${file.name}，请重试`); return false; }
}

async function loadFiles(files) {
  let opened = 0;
  for (const file of files) if (await loadFile(file)) opened++;
  saveDocuments();
  if (opened) showToast(`已打开 ${opened} 个文档${opened < files.length ? `，${files.length - opened} 个文件未导入` : ''}`);
}

editor.addEventListener('input', () => { currentFileBytes = null; update(); });
editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
  syncSearchHighlightScroll();
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
  scheduleOutlineActive();
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
function handlePreviewLink(event) {
  const link = event.target.closest('a');
  if (!link) return;
  if (tableDialog.open) closeTableView(false);
  event.preventDefault();
  const localPath = link.dataset.localPath;
  if (localPath) {
    event.preventDefault();
    if (window.mojianDesktop?.openLocalPath) window.mojianDesktop.openLocalPath(localPath, currentFilePath).then(result => { if (!result?.opened) showToast(result?.error || '文件无法打开，请检查附件是否已下载'); }).catch(() => showToast('文件无法打开，请重试'));
    else showToast('本地文件链接需要在桌面版中打开');
    return;
  }
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    event.preventDefault();
    if (!scrollPreviewToFragment(href)) showToast('文档中未找到对应位置');
    return;
  }
  let url;
  try { url = new URL(href, window.location.href); } catch (_) { return; }
  if (!/^(https?|mailto|tel):$/i.test(url.protocol)) return;
  event.preventDefault();
  if (window.mojianDesktop?.openExternalUrl) window.mojianDesktop.openExternalUrl(url.href);
  else window.open(url.href, '_blank', 'noopener,noreferrer');
}
preview.addEventListener('click', handlePreviewLink);
tableDialogContent.addEventListener('click', handlePreviewLink);
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') { event.preventDefault(); const s = editor.selectionStart; editor.setRangeText('  ', s, editor.selectionEnd, 'end'); currentFileBytes = null; update(); }
  if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
    event.preventDefault(); wrapSelection(event.key.toLowerCase() === 'b' ? '**' : '*');
  }
});

function wrapSelection(mark) {
  const start = editor.selectionStart, end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || '文字';
  editor.setRangeText(mark + selected + mark, start, end, 'select');
  editor.selectionStart = start + mark.length; editor.selectionEnd = start + mark.length + selected.length;
  editor.focus(); currentFileBytes = null; update();
}

function prefixLine(prefix) {
  const start = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
  editor.setRangeText(prefix, lineStart, lineStart, 'end'); editor.focus(); currentFileBytes = null; update();
}

document.querySelectorAll('.toolbar button[data-wrap], .toolbar button[data-prefix]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.wrap) wrapSelection(button.dataset.wrap);
  if (button.dataset.prefix) prefixLine(button.dataset.prefix);
}));
document.querySelector('#uploadButton').addEventListener('click', () => fileInput.click());
document.querySelector('#newDocumentButton').addEventListener('click', newDocument);
fileInput.addEventListener('change', () => { loadFiles(Array.from(fileInput.files)); fileInput.value = ''; });
documentTabs.addEventListener('click', event => {
  const close = event.target.closest('[data-close-document-id]');
  if (close) { event.preventDefault(); event.stopPropagation(); closeDocument(close.dataset.closeDocumentId); return; }
  const button = event.target.closest('[data-document-id]');
  if (button && button.dataset.documentId !== activeDocumentId) activateDocument(button.dataset.documentId);
});
documentTabs.addEventListener('keydown', event => {
  if (!documents.length) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = documents.findIndex(document => document.id === activeDocumentId);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? documents.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + documents.length) % documents.length;
  activateDocument(documents[nextIndex].id);
  documentTabs.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
});
reopenDocumentButton.addEventListener('click', reopenDocument);
new ResizeObserver(() => requestAnimationFrame(revealActiveTab)).observe(documentTabs);

document.querySelector('#insertImageButton').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  imageInput.value = '';
  if (!file) return;
  const documentId = activeDocumentId;
  const start = editor.selectionStart, end = editor.selectionEnd;
  try {
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(file.type)) { showToast('请选择 PNG、JPEG、GIF、WebP、AVIF、BMP 或 SVG 图片'); return; }
    let source = window.mojianDesktop?.getPathForFile?.(file);
    if (source) source = source.replace(/\\/g, '/');
    else {
      if (file.size > 2 * 1024 * 1024) { showToast('嵌入的图片不能超过 2 MB'); return; }
      source = `data:${file.type};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
    }
    const document = [...documents, ...closedDocuments].find(document => document.id === documentId);
    if (!document) return;
    const label = file.name.replace(/[\[\]<>\r\n]/g, '');
    const destination = /^data:/i.test(source) ? source : encodeURI(source).replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/</g, '%3C').replace(/>/g, '%3E');
    const markdown = `![${label}](<${destination}>)`;
    if (activeDocumentId === documentId) {
      editor.setRangeText(markdown, start, end, 'end');
      currentFileBytes = null;
      update();
      setMode('edit');
    } else {
      document.content = document.content.slice(0, start) + markdown + document.content.slice(end);
      document.diskDirty = true;
      document.bytes = null;
      saveDocuments();
    }
    showToast('已插入图片');
  } catch (_) { showToast('图片读取失败，请重试'); }
});
window.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape' && tableDialog.open) { event.preventDefault(); closeTableView(); return; }
  if (event.key === 'Escape' && !searchPanel.hidden) { event.preventDefault(); closeSearch(); return; }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (!event.shiftKey && (key === 'f' || key === 'h')) { event.preventDefault(); closeTableView(false); openSearch(key === 'h'); return; }
  if (event.shiftKey) {
    if (key === 't') { event.preventDefault(); reopenDocument(); }
    return;
  }
  if (key === 'w') { event.preventDefault(); closeDocument(); }
  if (key === 'n') { event.preventDefault(); newDocument(); }
  if (key === 'o') { event.preventDefault(); fileInput.click(); }
  if (key === 's') { event.preventDefault(); document.querySelector('#downloadButton').click(); }
});
document.querySelector('#downloadButton').addEventListener('click', () => {
  const encoding = encodingSelect.value;
  const encodingLabel = encodingSelect.selectedOptions[0].textContent;
  const name = documentName.textContent.trim() || '未命名文档.md';
  const filename = /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
  const content = editor.value;
  const finish = base64 => {
    const exportEncoding = window.mojianDesktop?.encodeText ? encoding : 'utf-8';
    const blob = new Blob([base64ToBytes(base64)], { type: `text/markdown;charset=${exportEncoding}` });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); showToast(`已按 ${exportEncoding === encoding ? encodingLabel : 'UTF-8'} 导出 ${filename}`);
  };
  if (window.mojianDesktop?.encodeText) window.mojianDesktop.encodeText(content, encoding).then(finish).catch(() => showToast('当前环境不支持该编码导出'));
  else finish(bytesToBase64(new TextEncoder().encode(content)));
});
encodingSelect.addEventListener('change', () => setEncoding(encodingSelect.value));
copyHtmlButton.addEventListener('click', async () => {
  closeTableView(false);
  const exported = preview.cloneNode(true);
  exported.querySelectorAll('[data-preview-ui]').forEach(element => element.remove());
  exported.querySelectorAll('.table-scroll, .table-wrap').forEach(element => element.replaceWith(...element.childNodes));
  try { await navigator.clipboard.writeText(exported.innerHTML); showToast('HTML 已复制'); }
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

function renameDocument() { if (!activeDocument()) return; documentName.contentEditable = 'true'; documentName.focus(); document.execCommand('selectAll', false, null); }
documentName.addEventListener('click', renameDocument);
documentName.addEventListener('blur', () => { documentName.contentEditable = 'false'; documentName.textContent = documentName.textContent.trim() || '未命名文档.md'; update(); });
documentName.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); if (documentName.isContentEditable) documentName.blur(); else renameDocument(); }
});

let dragDepth = 0;
window.addEventListener('dragenter', event => { if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return; event.preventDefault(); dragDepth++; dropOverlay.classList.add('visible'); });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('visible'); } });
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropOverlay.classList.remove('visible'); loadFiles(Array.from(event.dataTransfer.files)); });

window.mojianDesktop?.onFileChanged?.(receiveExternalFileChange);
restoreDocuments();
window.mojianDesktop?.onCloseDocument?.(() => closeDocument());
window.addEventListener('beforeunload', saveDocuments);
window.addEventListener('pagehide', saveDocuments);

if (window.mojianDesktop) {
  window.mojianDesktop.onOpenFile(file => {
    const bytes = file.bytes ? base64ToBytes(file.bytes) : new TextEncoder().encode(file.content || '');
    const encoding = detectEncoding(bytes);
    const decoded = decodeBytes(bytes, encoding);
    if (decoded === null) return;
    openDocument({ name: file.name, content: decoded, encoding, path: file.path || null, bytes, revision: file.revision });
    if (file.fragment) requestAnimationFrame(() => scrollPreviewToFragment(file.fragment));
    saveDocuments();
    showToast(`已打开 ${file.name}`);
  });
}
