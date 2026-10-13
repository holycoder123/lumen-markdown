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

function createDocument({ name, content = '', encoding = 'utf-8', path = null, bytes = null, id } = {}) {
  if (!name) {
    let number = 1;
    do { name = number === 1 ? '未命名文档.md' : `未命名文档 ${number}.md`; number++; }
    while ([...documents, ...closedDocuments].some(document => document.name === name));
  }
  return { id: id || crypto.randomUUID(), name, content, encoding, path, bytes, scroll: 0, selectionStart: 0, selectionEnd: 0 };
}

function activeDocument() { return documents.find(document => document.id === activeDocumentId); }

function captureDocument() {
  const document = activeDocument();
  if (!document) return;
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
    const serialize = list => list.map(({ id, name, content, encoding, path }) => ({ id, name, content, encoding, path }));
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
    item.setAttribute('role', 'presentation');
    const button = window.document.createElement('button');
    button.type = 'button';
    button.className = 'document-tab';
    button.id = `doc-tab-${document.id}`;
    button.dataset.documentId = document.id;
    button.textContent = document.name;
    button.title = document.path || document.name;
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
}

function revealActiveTab() {
  documentTabs.querySelector('[aria-selected="true"]')?.closest('.document-tab-item').scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function setDocumentControls(enabled) {
  editor.disabled = !enabled;
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

function openDocument({ name, content, encoding, path, bytes }) {
  const normalizedPath = path ? path.replace(/\\/g, '/').toLowerCase() : null;
  const existing = normalizedPath && documents.find(document => document.path?.replace(/\\/g, '/').toLowerCase() === normalizedPath);
  if (existing) { activateDocument(existing.id, 'preview'); return; }
  const closedIndex = normalizedPath ? closedDocuments.findIndex(document => document.path?.replace(/\\/g, '/').toLowerCase() === normalizedPath) : -1;
  if (closedIndex >= 0) {
    const [document] = closedDocuments.splice(closedIndex, 1);
    documents.push(document);
    activateDocument(document.id, 'preview');
    return;
  }
  const document = createDocument({ name, content, encoding, path, bytes });
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
  return template.innerHTML;
}

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
  const count = activeDocument() ? value.length : 0;
  const lines = activeDocument() ? value.split('\n').length : 0;
  wordCount.textContent = count.toLocaleString('zh-CN');
  lineCount.textContent = lines.toLocaleString('zh-CN');
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  saveStatus.textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDocuments, 350);
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
  if (!supportedEncodings.has(encoding)) return;
  encodingSelect.value = encoding;
  try { localStorage.setItem('lumen-encoding', encoding); } catch (_) { /* storage may be disabled */ }
  if (reload && currentFileBytes) {
    const decoded = decodeBytes(currentFileBytes, encoding);
    if (decoded !== null) { editor.value = decoded; update(); showToast(`已按 ${encodingSelect.selectedOptions[0].textContent} 重新解析`); }
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
  currentMode = mode;
  const selectedDocumentId = activeDocumentId;
  requestAnimationFrame(() => {
    if (currentMode !== mode || activeDocumentId !== selectedDocumentId) return;
    syncingScroll = true;
    if (!isPreview) editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight) * scrollProgress;
    if (!isEdit) preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight) * scrollProgress;
    requestAnimationFrame(() => { syncingScroll = false; });
    if (!isPreview) editor.focus({ preventScroll: true });
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
  const link = event.target.closest('a');
  if (!link) return;
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
});
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
      document.bytes = null;
      saveDocuments();
    }
    showToast('已插入图片');
  } catch (_) { showToast('图片读取失败，请重试'); }
});
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
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
    openDocument({ name: file.name, content: decoded, encoding, path: file.path || null, bytes });
    if (file.fragment) requestAnimationFrame(() => scrollPreviewToFragment(file.fragment));
    saveDocuments();
    showToast(`已打开 ${file.name}`);
  });
}
