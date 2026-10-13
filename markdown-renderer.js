/* Markdown rendering is kept separate from DOM sanitization and local file resolution. */
(function (root) {
  'use strict';

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const isWindowsPath = value => /^(?:[a-z]:[\\/]|\\\\)/i.test(value);

  function decodeEntities(text) {
    if (!String(text).includes('&')) return String(text);
    if (root.document?.createElement) {
      const textarea = root.document.createElement('textarea');
      // No tag can be introduced: the temporary element only decodes character references.
      textarea.innerHTML = String(text).replace(/</g, '&lt;');
      return textarea.value;
    }
    const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    return String(text).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
      if (entity[0] !== '#') return names[entity.toLowerCase()] || raw;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
    });
  }

  function slug(text) {
    return String(text).normalize('NFC').toLowerCase()
      .replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .trim().replace(/\s+/g, '-').slice(0, 200) || 'section';
  }

  function plainText(tokens) {
    return (tokens || []).map(token => {
      if (token.type === 'html') return '';
      if (token.type === 'br') return ' ';
      if (token.tokens) return plainText(token.tokens);
      if (token.type === 'text' || token.type === 'escape') return decodeEntities(token.text || '');
      return token.text || token.source || '';
    }).join('');
  }

  // GFM normally asks authors to escape pipes even inside code. Exporters do not
  // always do so, so recognize matching backtick runs before splitting cells.
  function splitTableRow(line, expected) {
    let text = line.trim(), cells = [], cell = '', codeRun = 0;
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|') && !/(?:^|[^\\])(?:\\\\)*\\\|$/.test(text)) text = text.slice(0, -1);
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '\\' && text[index + 1] === '|') {
        cell += '|'; index++; continue;
      }
      if (char === '\\' && text[index + 1] === '\\') {
        cell += '\\\\'; index++; continue;
      }
      if (char === '`') {
        const run = text.slice(index).match(/^`+/)[0].length;
        if (codeRun === run) codeRun = 0;
        else if (!codeRun) {
          const remainder = text.slice(index + run);
          const closing = new RegExp('(^|[^`])`{' + run + '}(?!`)').test(remainder);
          if (closing) codeRun = run;
        }
        cell += '`'.repeat(run); index += run - 1; continue;
      }
      if (char === '|' && !codeRun) { cells.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    cells.push(cell.trim());
    if (expected !== undefined) {
      cells = cells.slice(0, expected);
      while (cells.length < expected) cells.push('');
    }
    return cells;
  }

  function inlineDestination(src) {
    const image = src.startsWith('!['), first = image ? 1 : 0;
    if (src[first] !== '[') return undefined;
    let labelEnd = first + 1, depth = 1;
    for (; labelEnd < src.length; labelEnd++) {
      if (src[labelEnd] === '\\') { labelEnd++; continue; }
      if (src[labelEnd] === '[') depth++;
      if (src[labelEnd] === ']' && --depth === 0) break;
      if (src[labelEnd] === '\n') return undefined;
    }
    if (depth || src[labelEnd + 1] !== '(') return undefined;
    const start = labelEnd + 2;
    const windows = isWindowsPath(src.slice(start).trimStart().replace(/^</, ''));
    let end = start, angle = false, parentheses = 1;
    for (; end < src.length; end++) {
      const char = src[end];
      if (char === '\n') return undefined;
      if (!windows && char === '\\') { end++; continue; }
      if (char === '<') angle = true;
      else if (char === '>') angle = false;
      else if (!angle && char === '(') parentheses++;
      else if (!angle && char === ')' && --parentheses === 0) break;
    }
    if (parentheses) return undefined;
    const destination = src.slice(start, end).trim();
    const parts = destination.match(/^<([^>]+)>(?:\s+["']([\s\S]*)["'])?$/)
      || destination.match(/^(.+?)(?:\s+["']([\s\S]*)["'])?$/);
    if (!parts || (!image && !windows && !/\s/.test(parts[1]))) return undefined;
    if (!image && !windows && /^[a-z][a-z\d+.-]*:/i.test(parts[1])) return undefined;
    const unescape = value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/g, '$1');
    return {
      image, raw: src.slice(0, end + 1), text: src.slice(first + 1, labelEnd),
      href: windows ? parts[1] : unescape(parts[1]), title: parts[2] ? unescape(parts[2]) : null
    };
  }

  function readFootnote(src) {
    const opening = src.match(/^ {0,3}\[\^([^\]\n]+)\]:[ \t]*([^\n]*)(?:\n|$)/);
    if (!opening) return undefined;
    let raw = opening[0], body = opening[2], rest = src.slice(raw.length);
    while (rest) {
      const continuation = rest.match(/^(?: {4}|\t)([^\n]*)(?:\n|$)/);
      if (continuation) {
        raw += continuation[0]; body += '\n' + continuation[1]; rest = rest.slice(continuation[0].length); continue;
      }
      const blank = rest.match(/^[ \t]*\n(?=(?:[ \t]*\n)*(?: {4}|\t)\S)/);
      if (blank) { raw += blank[0]; body += '\n'; rest = rest.slice(blank[0].length); continue; }
      break;
    }
    return { raw, id: opening[1].trim().toLowerCase(), body };
  }

  function mathPlaceholder(source, display) {
    const tag = display ? 'div' : 'span';
    return `<${tag} class="math-expression" data-math-source="${escapeHtml(encodeURIComponent(source))}" data-math-display="${display ? 'block' : 'inline'}">${escapeHtml(source)}</${tag}>`;
  }

  function createSession(source, inlineOnly = false) {
    if (!root.marked?.Marked) throw new Error('Markdown parser is unavailable.');
    const engine = new root.marked.Marked({ gfm: true, breaks: true, async: false });
    const definitions = new Map(), references = new Map(), headings = [], headingCounts = new Map(), headingTargets = new Map();
    const defaultTokenizer = root.marked.Tokenizer.prototype;
    const defaultRenderer = root.marked.Renderer.prototype;
    let documentLinks = Object.create(null);

    engine.use({
      hooks: {
        processAllTokens(tokens) {
          documentLinks = tokens.links || Object.create(null);
          return tokens;
        }
      },
      tokenizer: {
        emStrong(src, maskedSrc, previousChar) {
          const standard = defaultTokenizer.emStrong.call(this, src, maskedSrc, previousChar);
          if (standard) return standard;
          // Exported CJK emphasis often borders full-width punctuation without spaces.
          const opening = src.match(/^(\*\*|__)(?=\S)/);
          if (!opening || src[2] === src[0]) return false;
          // Marked masks code spans and escaped punctuation with equal-length text.
          const delimiter = opening[1], masked = maskedSrc.slice(-src.length);
          const end = masked.indexOf(delimiter, 2), text = src.slice(2, end);
          if (end < 3 || /\s/.test(src[end - 1]) || src[end + 2] === delimiter[0]
            || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
          return { type: 'strong', raw: src.slice(0, end + 2), text, tokens: this.lexer.inlineTokens(text) };
        },
        table(src) {
          const match = this.rules.block.table.exec(src);
          if (!match || !this.rules.other.tableDelimiter.test(match[2])) return false;
          const header = splitTableRow(match[1]), delimiters = splitTableRow(match[2]);
          if (header.length !== delimiters.length || !delimiters.every(value => /^:?-+:?$/.test(value.replace(/\s/g, '')))) return false;
          const align = delimiters.map(value => /^\s*:-+:\s*$/.test(value) ? 'center' : /:\s*$/.test(value) ? 'right' : /^\s*:/.test(value) ? 'left' : null);
          const cell = (text, index, isHeader) => ({ text, tokens: this.lexer.inline(text), header: isHeader, align: align[index] });
          const rows = (match[3] || '').replace(this.rules.other.tableRowBlankLine, '').trimEnd();
          return {
            type: 'table', raw: match[0], align,
            header: header.map((text, index) => cell(text, index, true)),
            rows: rows ? rows.split('\n').map(row => splitTableRow(row, header.length).map((text, index) => cell(text, index, false))) : []
          };
        },
        def(src) {
          const token = defaultTokenizer.def.call(this, src);
          if (!token) return false;
          const match = this.rules.block.def.exec(src);
          const href = (match?.[2] || '').replace(/^<|>$/g, '');
          if (isWindowsPath(href)) token.href = href;
          return token;
        }
      },
      extensions: [
        {
          name: 'lumenFootnoteDefinition', level: 'block',
          start(src) { const index = src.search(/^ {0,3}\[\^[^\]\n]+\]:/m); return index < 0 ? undefined : index; },
          tokenizer(src) {
            const note = readFootnote(src);
            if (!note) return undefined;
            const bodyTokens = this.lexer.blockTokens(note.body);
            if (!definitions.has(note.id)) definitions.set(note.id, { bodyTokens });
            return { type: 'lumenFootnoteDefinition', raw: note.raw };
          },
          renderer() { return ''; }
        },
        {
          name: 'lumenFootnoteReference', level: 'inline',
          start(src) { const index = src.indexOf('[^'); return index < 0 ? undefined : index; },
          tokenizer(src) {
            if (this.lexer.state.inRawBlock) return undefined;
            const match = src.match(/^\[\^([^\]\n]+)\]/);
            if (match) return { type: 'lumenFootnoteReference', raw: match[0], id: match[1].trim().toLowerCase() };
          },
          renderer(token) {
            if (!definitions.has(token.id)) return escapeHtml(token.raw);
            if (!references.has(token.id)) references.set(token.id, { number: references.size + 1, count: 0 });
            const note = references.get(token.id); note.count++;
            return `<sup class="footnote-ref" id="lumen-fnref-${note.number}-${note.count}"><a href="#lumen-fn-${note.number}" title="脚注 ${note.number}">${note.number}</a></sup>`;
          }
        },
        {
          name: 'lumenToc', level: 'block',
          start(src) { const index = src.search(/^ {0,3}\[toc\][ \t]*$/im); return index < 0 ? undefined : index; },
          tokenizer(src) { const match = src.match(/^ {0,3}\[toc\][ \t]*(?:\n|$)/i); if (match) return { type: 'lumenToc', raw: match[0] }; },
          renderer() {
            return `<div class="markdown-toc"><p>目录</p><ul>${headings.map(heading => `<li class="toc-level-${heading.depth}"><a href="#${heading.anchor}">${escapeHtml(heading.label)}</a></li>`).join('')}</ul></div>\n`;
          }
        },
        {
          name: 'lumenDisplayMath', level: 'block',
          start(src) { const index = src.search(/^ {0,3}\$\$/m); return index < 0 ? undefined : index; },
          tokenizer(src) {
            const match = src.match(/^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n|$)/)
              || src.match(/^ {0,3}\$\$([^\n]+?)\$\$[ \t]*(?:\n|$)/);
            if (match) return { type: 'lumenDisplayMath', raw: match[0], source: match[1] };
          },
          renderer(token) { return mathPlaceholder(token.source, true) + '\n'; }
        },
        {
          name: 'lumenInlineMath', level: 'inline',
          start(src) { const index = src.indexOf('$'); return index < 0 ? undefined : index; },
          tokenizer(src) {
            if (this.lexer.state.inRawBlock || src[0] !== '$' || /^\$\s/.test(src)) return undefined;
            const delimiter = src.startsWith('$$') ? '$$' : '$';
            for (let index = delimiter.length; index < src.length && src[index] !== '\n'; index++) {
              if (src[index] === '\\') { index++; continue; }
              if (src.startsWith(delimiter, index)) {
                if (/\s/.test(src[index - 1]) || /\d/.test(src[index + delimiter.length] || '')) return undefined;
                const text = src.slice(delimiter.length, index);
                if (!text) return undefined;
                return { type: 'lumenInlineMath', raw: src.slice(0, index + delimiter.length), source: text, display: delimiter.length === 2 };
              }
            }
          },
          renderer(token) {
            // An inline display expression remains a span so it never splits a paragraph.
            return mathPlaceholder(token.source, false).replace('data-math-display="inline"', `data-math-display="${token.display ? 'block' : 'inline'}"`);
          }
        },
        {
          name: 'lumenDestination', level: 'inline',
          start(src) { const index = src.search(/!?\[/); return index < 0 ? undefined : index; },
          tokenizer(src) {
            if (this.lexer.state.inLink || this.lexer.state.inRawBlock) return undefined;
            const link = inlineDestination(src);
            if (!link) return undefined;
            const previous = this.lexer.state.inLink;
            if (!link.image) this.lexer.state.inLink = true;
            let tokens;
            try { tokens = this.lexer.inlineTokens(link.text); }
            finally { this.lexer.state.inLink = previous; }
            return { ...link, type: link.image ? 'image' : 'link', tokens };
          }
        },
        {
          name: 'lumenWindowsPath', level: 'inline',
          start(src) { const index = src.search(/(?:[a-z]:[\\/]|\\\\)/i); return index < 0 ? undefined : index; },
          tokenizer(src) {
            if (this.lexer.state.inLink || this.lexer.state.inRawBlock) return undefined;
            const match = src.match(/^(?:[a-z]:[\\/]|\\\\)[^\s<>]+/i);
            if (!match) return undefined;
            const path = match[0].replace(/[.,!?;:，。！？；：)\]]+$/, '');
            if (!path) return undefined;
            return { type: 'lumenWindowsPath', raw: path, path };
          },
          renderer(token) {
            const path = decodeEntities(token.path);
            return `<a href="#" data-local-path="${escapeHtml(path)}">${escapeHtml(path)}</a>`;
          }
        }
      ],
      walkTokens(token) {
        if (token.type !== 'heading') return;
        const label = plainText(token.tokens), name = slug(label);
        const count = (headingCounts.get(name) || 0) + 1; headingCounts.set(name, count);
        const anchor = `lumen-heading-${name}${count > 1 ? '-' + count : ''}`;
        token.lumenAnchor = anchor;
        headings.push({ anchor, label, depth: token.depth });
        if (!headingTargets.has(name)) headingTargets.set(name, anchor);
      },
      renderer: {
        heading(token) { return `<h${token.depth} id="${escapeHtml(token.lumenAnchor || 'lumen-heading-section')}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`; },
        code(token) {
          const language = (token.lang || '').trim().split(/\s/)[0].toLowerCase();
          if (language === 'math' || language === 'latex' || language === 'tex') return mathPlaceholder(token.text, true) + '\n';
          if (language === 'flow' || language === 'flowchart') return `<div class="flowchart-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(token.text))}"></div>\n`;
          if (language === 'mermaid') return `<div class="mermaid-diagram" data-flowchart-source="${escapeHtml(encodeURIComponent(token.text))}"></div>\n`;
          return defaultRenderer.code.call(this, token);
        },
        table(token) { return `<div class="table-wrap">${defaultRenderer.table.call(this, token)}</div>\n`; },
        listitem(token) {
          const html = defaultRenderer.listitem.call(this, token);
          return token.task ? html.replace('<li>', '<li class="task">') : html;
        },
        blockquote(token) {
          const match = token.text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS)\][ \t]*(?:\n|$)/i);
          if (!match) return false;
          const kind = match[1].toLowerCase(), titles = { note: '提示', tip: '建议', important: '重要', warning: '警告', caution: '注意', success: '成功' };
          const tokens = token.tokens.map(child => ({ ...child }));
          if (tokens[0]?.tokens?.[0]?.type !== 'text') return false;
          const first = { ...tokens[0].tokens[0] };
          first.text = first.text.replace(/^\[![A-Z]+\][ \t]*(?:\n|$)/i, '');
          first.raw = first.raw.replace(/^\[![A-Z]+\][ \t]*(?:\n|$)/i, '');
          const remainder = tokens[0].tokens.slice(1);
          if (!first.text && remainder[0]?.type === 'br') remainder.shift();
          tokens[0].tokens = [first, ...remainder];
          if (!first.text && tokens[0].tokens.length === 1) tokens.shift();
          return `<section class="markdown-callout callout-${kind}"><p class="callout-title">${titles[kind]}</p>${this.parser.parse(tokens)}</section>\n`;
        },
        html(token) {
          const labels = { image: '图片', file: '附件', whiteboard: '画板', bitable: '多维表格', sheet: '电子表格' };
          return token.text.replace(/<(image|file|whiteboard|bitable|sheet)\b([^>]*?)(?:\/>|>\s*<\/\1\s*>|>)/gi, (raw, kind, attributes) => {
            if (!/\btoken\s*=/.test(attributes) || /\b(?:src|href)\s*=/.test(attributes)) return raw;
            const name = attributes.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
            const label = name ? `${labels[kind.toLowerCase()]}「${name[1] || name[2] || ''}」` : labels[kind.toLowerCase()];
            return `<span class="export-placeholder">${escapeHtml(label)}未导出，请从飞书保存素材或查看原文</span>`;
          }).replace(/<table\b([^>]*)>/gi, '<table class="html-markdown-table"$1>');
        },
        image(token) {
          const alt = token.tokens ? plainText(token.tokens) : token.text;
          return `<img src="${escapeHtml(decodeEntities(token.href))}" alt="${escapeHtml(alt || '')}"${token.title ? ` title="${escapeHtml(decodeEntities(token.title))}"` : ''}>`;
        },
        link(token) {
          const label = this.parser.parseInline(token.tokens), href = decodeEntities(token.href || '').trim();
          const title = token.title ? ` title="${escapeHtml(decodeEntities(token.title))}"` : '';
          if (href.startsWith('#')) {
            let target = href.slice(1);
            try { target = decodeURIComponent(target); } catch (_) { /* Keep malformed literal anchors visible. */ }
            if (!target.startsWith('lumen-')) target = headingTargets.get(slug(target)) || target;
            return `<a href="#${escapeHtml(target)}"${title}>${label}</a>`;
          }
          if (/^(?:https?:|mailto:|tel:)/i.test(href)) return `<a href="${escapeHtml(href)}"${title}>${label}</a>`;
          if (href && (!/^[a-z][a-z\d+.-]*:/i.test(href) || isWindowsPath(href) || /^file:/i.test(href))) return `<a href="#" data-local-path="${escapeHtml(href)}"${title}>${label}</a>`;
          return label;
        }
      }
    });

    const html = engine[inlineOnly ? 'parseInline' : 'parse'](String(source || '').replace(/^\uFEFF/, ''));
    let footnotesHtml;
    function renderFootnotes() {
      if (footnotesHtml !== undefined) return footnotesHtml;
      if (!references.size) return (footnotesHtml = '');
      // Parse each note once: cross references may add notes, and self references
      // add another back link without recursively rendering the same body.
      const bodies = new Map();
      for (const [id] of references) {
        const tokens = definitions.get(id).bodyTokens;
        engine.walkTokens(tokens, engine.defaults.walkTokens);
        bodies.set(id, engine.parser(tokens));
      }
      footnotesHtml = `<section class="footnotes"><hr><ol>${[...references].map(([id, note]) => {
        const backrefs = Array.from({ length: note.count }, (_, index) => `<a class="footnote-backref" href="#lumen-fnref-${note.number}-${index + 1}" title="返回引用 ${note.number}${note.count > 1 ? '（' + (index + 1) + '）' : ''}">↩${note.count > 1 ? `<sup>${index + 1}</sup>` : ''}</a>`).join(' ');
        return `<li id="lumen-fn-${note.number}">${bodies.get(id)}<p>${backrefs}</p></li>`;
      }).join('')}</ol></section>\n`;
      return footnotesHtml;
    }

    function renderInline(text) {
      const lexer = new root.marked.Lexer(engine.defaults);
      lexer.tokens.links = documentLinks;
      return root.marked.Parser.parseInline(lexer.inlineTokens(String(text || '')), engine.defaults);
    }
    return Object.freeze({ html, renderInline, renderFootnotes });
  }

  function render(source, inlineOnly = false) {
    const session = createSession(source, inlineOnly);
    return session.html + session.renderFootnotes();
  }

  function renderMath(preview) {
    if (!preview || !root.katex?.render) return 0;
    let count = 0;
    preview.querySelectorAll('.math-expression[data-math-source]').forEach(element => {
      let source;
      try { source = decodeURIComponent(element.getAttribute('data-math-source') || ''); }
      catch (_) { element.textContent = '公式编码错误'; element.removeAttribute('data-math-source'); return; }
      element.removeAttribute('data-math-source');
      if (source.length > 20000) { element.textContent = source; return; }
      try {
        root.katex.render(source, element, {
          displayMode: element.getAttribute('data-math-display') === 'block',
          throwOnError: false, strict: 'ignore', trust: false,
          maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml'
        });
        count++;
      } catch (_) { element.textContent = source; }
    });
    return count;
  }

  root.LumenMarkdown = Object.freeze({ render, renderInline: source => render(source, true), createSession, renderMath });
})(typeof window !== 'undefined' ? window : globalThis);
