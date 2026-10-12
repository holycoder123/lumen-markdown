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
const imageInput = document.querySelector('#imageInput');
const documentsStorageKey = 'lumen-documents-v1';
const supportedEncodings = new Set(['utf-8', 'gb18030', 'gbk', 'utf-16le', 'utf-16be']);
let documents = [];
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

function createDocument({ name, content = '', encoding = 'utf-8', path = null, bytes = null, id } = {}) {
  if (!name) {
    let number = 1;
    do { name = number === 1 ? '未命名文档.md' : `未命名文档 ${number}.md`; number++; }
    while (documents.some(document => document.name === name));
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
    localStorage.setItem(documentsStorageKey, JSON.stringify({
      version: 1,
      activeId: activeDocumentId,
      documents: documents.map(({ id, name, content, encoding, path }) => ({ id, name, content, encoding, path }))
    }));
    saveStatus.textContent = '已自动保存';
  } catch (error) {
    saveStatus.textContent = error.name === 'QuotaExceededError' ? '存储空间不足，请导出文档' : '自动保存失败，请导出文档';
  }
}

function renderDocumentTabs() {
  documentTabs.replaceChildren();
  documents.forEach(document => {
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
    documentTabs.append(button);
  });
  documentCount.textContent = `${documents.length} 个文档`;
  documentPane.setAttribute('aria-labelledby', `doc-tab-${activeDocumentId}`);
}

function revealActiveTab() {
  documentTabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  scrollProgress = next.scroll;
  editor.setSelectionRange(next.selectionStart, next.selectionEnd);
  update();
  renderDocumentTabs();
  setMode(mode, false);
  revealActiveTab();
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
  const document = createDocument({ name, content, encoding, path, bytes });
  documents.push(document);
  activateDocument(document.id, 'preview');
}

function restoreDocuments() {
  try {
    const stored = JSON.parse(localStorage.getItem(documentsStorageKey) || 'null');
    if (stored?.version === 1 && Array.isArray(stored.documents)) {
      const ids = new Set();
      documents = stored.documents.filter(document => {
        if (!document || typeof document.id !== 'string' || ids.has(document.id) || typeof document.name !== 'string' || typeof document.content !== 'string') return false;
        ids.add(document.id);
        return true;
      }).map(document => createDocument({
        ...document,
        encoding: supportedEncodings.has(document.encoding) ? document.encoding : 'utf-8',
        path: typeof document.path === 'string' ? document.path : null,
        bytes: null
      }));
      if (documents.length) {
        activateDocument(documents.some(document => document.id === stored.activeId) ? stored.activeId : documents[0].id, 'preview');
        return;
      }
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

function extractImages(text, images) {
  const pattern = /!\[([^\]\n]*)\]\(/g;
  let output = '', offset = 0, match;
  while ((match = pattern.exec(text))) {
    let end = pattern.lastIndex, depth = 1, angle = false;
    for (; end < text.length; end++) {
      if (!angle && text[end] === '\\' && /[()]/.test(text[end + 1] || '')) { end++; continue; }
      if (text[end] === '<') angle = true;
      if (text[end] === '>') angle = false;
      if (!angle && text[end] === '(') depth++;
      if (!angle && text[end] === ')' && --depth === 0) break;
      if (text[end] === '\n') break;
    }
    if (depth !== 0) continue;
    const destination = text.slice(pattern.lastIndex, end).trim();
    const parts = destination.match(/^<([^>]+)>(?:\s+["'](.*)["'])?$/) || destination.match(/^(.+?)(?:\s+["'](.*)["'])?$/);
    if (!parts) continue;
    const source = /^(?:[a-z]:[\\/]|\\\\)/i.test(parts[1]) ? parts[1] : parts[1].replace(/\\([()])/g, '$1');
    images.push(`<img src="${escapeHtml(source)}" alt="${escapeHtml(match[1])}"${parts[2] ? ` title="${escapeHtml(parts[2])}"` : ''}>`);
    output += text.slice(offset, match.index) + `\u0000IMAGE${images.length - 1}\u0000`;
    offset = end + 1;
    pattern.lastIndex = offset;
  }
  return output + text.slice(offset);
}

function inline(text) {
  const code = [];
  let prepared = text.replace(/`([^`]+)`/g, (_, value) => {
    code.push(`<code>${escapeHtml(value)}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  const images = [];
  prepared = extractImages(prepared, images);
  const rawHtml = [];
  let out = escapeHtml(prepared.replace(/<\/?[A-Za-z][^>\n]*>/g, tag => {
    rawHtml.push(tag);
    return `\u0000HTML${rawHtml.length - 1}\u0000`;
  }));
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
  out = out.replace(/\u0000HTML(\d+)\u0000/g, (_, i) => rawHtml[Number(i)]);
  out = out.replace(/\u0000IMAGE(\d+)\u0000/g, (_, i) => images[Number(i)]);
  return out;
}

const allowedHtmlTags = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'center', 'cite', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark',
  'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'th', 'thead', 'tr', 'u', 'ul'
]);
const allowedHtmlAttributes = new Set(['align', 'alt', 'checked', 'colspan', 'disabled', 'height', 'open', 'rowspan', 'start', 'title', 'type', 'width']);

function sanitizeRenderedHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
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
        const safeClasses = attribute.value.split(/\s+/).filter(value => value === 'task' || value === 'table-wrap' || value === 'flowchart-diagram' || value === 'mermaid-diagram' || /^language-[\w-]+$/.test(value));
        if (safeClasses.length) element.className = safeClasses.join(' ');
        else element.removeAttribute('class');
      } else if (name === 'style' && /^text-align\s*:\s*(left|center|right)\s*;?$/i.test(attribute.value)) {
        element.style.textAlign = attribute.value.match(/(left|center|right)/i)[1].toLowerCase();
      } else if (!allowedHtmlAttributes.has(name) && name !== 'href' && name !== 'src' && name !== 'data-local-path' && name !== 'data-flowchart-source') {
        element.removeAttribute(attribute.name);
      }
    });
    if (tag === 'a') {
      const href = element.getAttribute('href')?.trim() || '';
      if (/^https?:\/\//i.test(href)) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else if (href && href !== '#') {
        element.setAttribute('href', '#');
        element.dataset.localPath = href;
      } else if (!element.dataset.localPath) {
        element.removeAttribute('href');
      }
    }
    if (tag === 'img') {
      const src = element.getAttribute('src')?.trim() || '';
      element.removeAttribute('src');
      element.dataset.imageSource = src;
      element.setAttribute('loading', 'lazy');
    }
    if (tag === 'input') {
      if (element.getAttribute('type')?.toLowerCase() !== 'checkbox') element.remove();
      else element.disabled = true;
    }
  });
  return template.innerHTML;
}

function imagePlaceholder(image, source) {
  if (!image.isConnected) return;
  const placeholder = document.createElement('span');
  placeholder.className = 'image-placeholder';
  placeholder.setAttribute('role', 'status');
  placeholder.textContent = `图片无法显示：${image.alt || (source.startsWith('data:') ? '插入的图片' : source) || '图片地址为空'}`;
  image.replaceWith(placeholder);
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
      else {
        const code = codeLines.join('\n');
        const language = codeLang.toLowerCase();
        html += language === 'flowchart'
          ? `<div class="flowchart-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(code))}"></div>`
          : language === 'mermaid'
            ? `<div class="mermaid-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(code))}"></div>`
            : `<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(code)}</code></pre>`;
        inCode = false;
      }
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
      if (listType !== nextType) {
        closeList();
        const start = nextType === 'ol' ? Number.parseInt(item[1], 10) : 1;
        html += nextType === 'ol' && start !== 1 ? `<ol start="${start}">` : `<${nextType}>`;
        listType = nextType;
      }
      const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
      html += task ? `<li class="task"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(task[2])}</li>` : `<li>${inline(item[2])}</li>`;
      continue;
    }
    closeList(); paragraph.push(line.trim());
  }
  if (inCode) {
    const code = codeLines.join('\n');
    const language = codeLang.toLowerCase();
    html += language === 'flowchart'
      ? `<div class="flowchart-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(code))}"></div>`
      : language === 'mermaid'
        ? `<div class="mermaid-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(code))}"></div>`
        : `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
  flushParagraph(); closeList(); closeQuote();
  return html;
}

function renderFlowcharts() {
  preview.querySelectorAll('.flowchart-diagram').forEach(container => {
    const source = container.dataset.flowchartSource;
    if (!source) return;
    try {
      if (!window.flowchart) throw new Error('流程图库未加载');
      container.removeAttribute('data-flowchart-source');
      window.flowchart.parse(decodeURIComponent(source)).drawSVG(container, {
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
    } catch (error) {
      container.classList.add('flowchart-error');
      container.textContent = `流程图渲染失败：${error.message}`;
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
    } catch (error) {
      if (!container.isConnected) return;
      container.classList.add('flowchart-error');
      container.textContent = `流程图渲染失败：${error.message}`;
    }
  });
}

function update() {
  const value = editor.value;
  const previousName = activeDocument()?.name;
  captureDocument();
  if (previousName !== activeDocument()?.name) renderDocumentTabs();
  preview.innerHTML = value.trim() ? sanitizeRenderedHtml(renderMarkdown(value)) : '<div class="preview-empty"><strong>这份文档还是空白的</strong><p>点击「编辑」开始书写，或在编辑工具栏中插入图片。</p></div>';
  resolvePreviewImages();
  renderFlowcharts();
  renderMermaidDiagrams();
  const count = value.length;
  const lines = value.split('\n').length;
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
  const button = event.target.closest('[data-document-id]');
  if (button && button.dataset.documentId !== activeDocumentId) activateDocument(button.dataset.documentId);
});
documentTabs.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = documents.findIndex(document => document.id === activeDocumentId);
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? documents.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + documents.length) % documents.length;
  activateDocument(documents[nextIndex].id);
  documentTabs.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
});
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
    const document = documents.find(document => document.id === documentId);
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
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
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

function renameDocument() { documentName.contentEditable = 'true'; documentName.focus(); document.execCommand('selectAll', false, null); }
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
window.addEventListener('beforeunload', saveDocuments);
window.addEventListener('pagehide', saveDocuments);

if (window.mojianDesktop) {
  window.mojianDesktop.onOpenFile(file => {
    const bytes = file.bytes ? base64ToBytes(file.bytes) : new TextEncoder().encode(file.content || '');
    const encoding = detectEncoding(bytes);
    const decoded = decodeBytes(bytes, encoding);
    if (decoded === null) return;
    openDocument({ name: file.name, content: decoded, encoding, path: file.path || null, bytes });
    saveDocuments();
    showToast(`已打开 ${file.name}`);
  });
}
