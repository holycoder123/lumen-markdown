/*
 * Real Electron regression checks. Run with: node scripts/test-documents.cjs
 * The app runs offscreen with temporary userData/sessionData. No build script,
 * installed app process, system file association, or real user draft is touched.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');
const pixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/o9sAAAAASUVORK5CYII=';

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const electronPath = require('electron');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-documents-test-'));
  let failed = false;
  try {
    for (const stage of ['features', 'restart']) {
      const env = { ...process.env, LUMEN_TEST_PROFILE: profile, LUMEN_TEST_STAGE: stage };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(electronPath, [__filename], { cwd: projectRoot, env, encoding: 'utf8', timeout: 90000 });
      process.stdout.write(result.stdout || '');
      if (result.status !== 0 || result.error) {
        process.stderr.write(result.stderr || '');
        if (result.error) console.error(result.error.message);
        failed = true;
        break;
      }
    }
  } finally {
    // Delete only the exact directory just created in the OS temporary directory.
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('lumen-documents-test-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
} else {
  runElectron().catch(error => {
    console.error(error.stack || error);
    require('electron').app.exit(1);
  });
}

async function runElectron() {
  const electron = require('electron');
  const { app, dialog, shell, ipcMain } = electron;
  const profile = process.env.LUMEN_TEST_PROFILE;
  assert.ok(profile && path.basename(profile).startsWith('lumen-documents-test-'), 'An isolated test profile is required');
  fs.mkdirSync(path.join(profile, 'sessions'), { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'sessions'));
  app.disableHardwareAcceleration();
  const NativeBrowserWindow = electron.BrowserWindow;
  let testWindow;
  class OffscreenBrowserWindow extends NativeBrowserWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true } });
      testWindow = this;
    }
    show() {}
    focus() {}
    loadFile(filePath, options) { return super.loadFile(path.resolve(projectRoot, filePath), options); }
  }
  const testElectron = Object.create(electron);
  Object.defineProperty(testElectron, 'BrowserWindow', { value: OffscreenBrowserWindow });
  const openedPaths = [];
  const openedUrls = [];
  shell.openPath = async target => { openedPaths.push(target); return ''; };
  shell.openExternal = async target => { openedUrls.push(target); };
  dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  const timer = setTimeout(() => { console.error('Electron test timed out'); app.exit(1); }, 75000);
  const Module = require('node:module');
  const nativeLoad = Module._load;
  const mainPath = path.join(projectRoot, 'main.js');
  Module._load = function(request, parent, isMain) {
    if (request === 'electron' && parent?.filename === mainPath) return testElectron;
    return nativeLoad.call(this, request, parent, isMain);
  };
  try { require(mainPath); }
  finally { Module._load = nativeLoad; }
  await app.whenReady();
  const win = await poll(async () => testWindow, 'App window');
  assert.equal(win.webContents.isOffscreen(), true, 'App window must remain offscreen');
  const wc = win.webContents;
  const rendererErrors = [];
  wc.on('console-message', event => {
    if (event.level === 'error' && !/Failed to load resource/.test(event.message)) rendererErrors.push(event.message);
  });
  await loaded();
  // HTTPS image coverage is deterministic and never accesses the network.
  wc.session.protocol.handle('https', request => {
    if (request.url === 'https://lumen-test.invalid/pixel.png') {
      return new Response(Buffer.from(pixelBase64, 'base64'), { headers: { 'content-type': 'image/png' } });
    }
    return new Response('Unexpected test network request', { status: 404 });
  });

  async function js(source) { return wc.executeJavaScript(source, true); }
  async function loaded() {
    await poll(async () => {
      if (wc.isLoading()) return false;
      return js("document.readyState === 'complete' && !!document.querySelector('#editor')");
    }, 'Renderer loaded');
  }
  async function click(selector) {
    assert.equal(await js(`!!document.querySelector(${JSON.stringify(selector)})`), true, `Missing ${selector}`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  async function state() {
    return js(`({
      name: document.querySelector('#documentName').textContent,
      content: document.querySelector('#editor').value,
      editHidden: document.querySelector('#editorView').hidden,
      previewHidden: document.querySelector('#previewView').hidden,
      preview: document.querySelector('#preview').textContent,
      tabs: [...document.querySelectorAll('#documentTabs [role=tab]')].map(tab => ({ id:tab.dataset.documentId, name:tab.textContent, selected:tab.getAttribute('aria-selected') === 'true' })),
      saved: document.querySelector('#saveStatus').textContent,
      encoding: document.querySelector('#encodingSelect').value,
      mode: document.querySelector('#previewModeButton').getAttribute('aria-selected')
    })`);
  }
  async function activeId() { return (await state()).tabs.find(tab => tab.selected)?.id; }
  async function setContent(value) {
    await js(`document.querySelector('#editor').value = ${JSON.stringify(value)}; document.querySelector('#editor').dispatchEvent(new Event('input', { bubbles:true }));`);
  }
  async function rename(value) {
    await click('#documentName');
    await js(`document.querySelector('#documentName').textContent = ${JSON.stringify(value)}; document.querySelector('#documentName').blur();`);
  }
  async function select(id) { await click(`#documentTabs [data-document-id="${id}"]`); }
  async function saved() { await poll(async () => (await state()).saved === '已自动保存', 'Draft persisted'); }
  async function reload() { wc.reload(); await loaded(); }
  async function previewMode() {
    const current = await state();
    assert.equal(current.mode, 'true', 'Preview tab must be selected');
    assert.equal(current.editHidden, true, 'Editor must be hidden in preview mode');
    assert.equal(current.previewHidden, false, 'Preview must be visible');
  }
  async function setRealFiles(selector, files) {
    wc.debugger.attach('1.3');
    try {
      const { root } = await wc.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', { nodeId:root.nodeId, selector });
      assert.ok(nodeId, `Missing ${selector}`);
      await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files });
    } finally { wc.debugger.detach(); }
  }
  async function openNativeFile(filePath) {
    wc.send('open-file', { name:path.basename(filePath), bytes:fs.readFileSync(filePath).toString('base64'), path:filePath });
    await poll(async () => (await state()).name === path.basename(filePath), 'IPC file opened');
  }
  async function setEncoding(value) {
    await js(`document.querySelector('#encodingSelect').value = ${JSON.stringify(value)}; document.querySelector('#encodingSelect').dispatchEvent(new Event('change', { bubbles:true }));`);
  }
  async function checkLayout(width, height) {
    win.setContentSize(width, height);
    await new Promise(resolve => setTimeout(resolve, 100));
    const layout = await js(`(() => {
      const selectors = ['#newDocumentButton','#uploadButton','#downloadButton','#themeButton','#defaultAppButton','#documentName','#documentTabs','#editModeButton','#previewModeButton','#splitModeButton','#insertImageButton','#encodingSelect','#documentFooter'];
      const bounds = selectors.flatMap(selector => {
        const element = document.querySelector(selector), rect = element.getBoundingClientRect();
        return rect.width && rect.height ? [{ selector, left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom }] : [];
      });
      const selected = document.querySelector('#documentTabs [aria-selected=true]');
      const tab = selected.getBoundingClientRect(), tabs = document.querySelector('#documentTabs').getBoundingClientRect();
      return { width:innerWidth, height:innerHeight, pageWidth:document.documentElement.scrollWidth, pageHeight:document.documentElement.scrollHeight, bounds, selected:{ left:tab.left, right:tab.right, containerLeft:tabs.left, containerRight:tabs.right } };
    })()`);
    assert.equal(layout.width, width);
    assert.equal(layout.height, height);
    assert.ok(layout.pageWidth <= width + 1, `No page horizontal overflow at ${width}x${height}`);
    assert.ok(layout.pageHeight <= height + 1, `No page vertical overflow at ${width}x${height}`);
    for (const bound of layout.bounds) {
      assert.ok(bound.left >= -1 && bound.top >= -1 && bound.right <= width + 1 && bound.bottom <= height + 1, `${bound.selector} stays inside ${width}x${height}: ${JSON.stringify(bound)}`);
    }
    assert.ok(layout.selected.left >= layout.selected.containerLeft - 1 && layout.selected.right <= layout.selected.containerRight + 1, `Selected document tab remains visible at ${width}x${height}: ${JSON.stringify(layout.selected)}`);
  }

  if (process.env.LUMEN_TEST_STAGE === 'restart') {
    const expected = JSON.parse(fs.readFileSync(path.join(profile, 'expected.json'), 'utf8'));
    await previewMode();
    const restored = await state();
    assert.equal(restored.tabs.length, expected.tabCount, 'All tabs survive a full app restart');
    assert.equal(await activeId(), expected.activeId, 'Selected document survives a full app restart');
    assert.equal(restored.content, expected.content, 'Selected draft survives a full app restart');
    await select(expected.firstId);
    assert.equal((await state()).content, expected.firstContent, 'Independent edited draft survives a full app restart');
    assert.equal((await state()).name, '第一份草稿.md', 'Renamed draft survives a full app restart');
    assert.equal((await state()).encoding, 'gbk', 'Independent draft encoding survives a full app restart');
    console.log('PASS: full app restart restores all documents and always opens preview');
    for (const legacy of ['# 旧草稿\n\n保留的旧版本内容', '']) {
      await js(`clearTimeout(saveTimer); window.removeEventListener('beforeunload', saveDocuments); window.removeEventListener('pagehide', saveDocuments); localStorage.clear(); localStorage.setItem('mojian-content', ${JSON.stringify(legacy)}); localStorage.setItem('mojian-name', '旧草稿.md'); localStorage.setItem('lumen-encoding', 'gbk'); localStorage.setItem('lumen-mode', 'edit');`);
      await reload();
      await previewMode();
      const migrated = await state();
      assert.equal(migrated.tabs.length, 1, 'Legacy draft becomes one document');
      assert.equal(migrated.content, legacy, 'Legacy content is preserved including an intentionally empty draft');
      assert.equal(migrated.name, '旧草稿.md');
      assert.equal(migrated.encoding, 'gbk');
      await saved();
      const storage = await js("JSON.parse(localStorage.getItem('lumen-documents-v1'))");
      assert.equal(storage.documents[0].content, legacy);
    }
    console.log('PASS: nonempty and empty legacy drafts migrate with their names and encoding; old edit preference still opens preview');
  } else {
    await previewMode();
    const initialCount = (await state()).tabs.length;
    assert.equal(initialCount, 1, 'Fresh profile starts with one document');
    await checkLayout(1280, 820);
    if (process.env.LUMEN_TEST_SCREENSHOT) {
      await saved();
      const screenshot = await wc.capturePage();
      fs.writeFileSync(process.env.LUMEN_TEST_SCREENSHOT, screenshot.toPNG());
      console.log(`SCREENSHOT: ${process.env.LUMEN_TEST_SCREENSHOT}`);
    }
    await click('#newDocumentButton');
    let current = await state();
    assert.equal(current.tabs.length, initialCount + 1);
    assert.equal(current.content, '', 'New documents start blank');
    assert.equal(current.editHidden, false, 'New document opens its editor');
    const firstId = await activeId();
    const firstContent = '# 第一份草稿\n\n**编辑器内容**';
    await setContent(firstContent);
    await rename('第一份草稿.md');
    await setEncoding('gbk');
    await click('#newDocumentButton');
    const secondId = await activeId();
    assert.notEqual(firstId, secondId, 'New document IDs must be independent');
    assert.equal((await state()).content, '');
    await setContent('# 第二份草稿\n\n第二份独立内容');
    await setEncoding('utf-16le');
    await select(firstId);
    assert.equal((await state()).content, firstContent, 'Switching keeps the first draft');
    assert.equal((await state()).name, '第一份草稿.md');
    assert.equal((await state()).encoding, 'gbk', 'First document keeps its own encoding');
    const rapidContent = '# 快速切换尚未保存的修改';
    const rapid = await js(`(() => {
      const started = performance.now();
      const editor = document.querySelector('#editor');
      editor.value = ${JSON.stringify(rapidContent)};
      editor.dispatchEvent(new Event('input', { bubbles:true }));
      const wasSaving = document.querySelector('#saveStatus').textContent;
      document.querySelector('#documentTabs [data-document-id="${secondId}"]').click();
      const second = editor.value;
      document.querySelector('#documentTabs [data-document-id="${firstId}"]').click();
      return { content:editor.value, second, wasSaving, elapsed:performance.now() - started };
    })()`);
    assert.equal(rapid.wasSaving, '正在保存…', 'Edit is still pending when tabs switch');
    assert.ok(rapid.elapsed < 350, 'Both tab switches occur before the save debounce');
    assert.equal(rapid.content, rapidContent, 'Rapid switching preserves the pending edit in its own document');
    assert.match(rapid.second, /第二份独立内容/);
    await setContent(firstContent);
    await select(secondId);
    assert.match((await state()).content, /第二份独立内容/);
    assert.equal((await state()).encoding, 'utf-16le', 'Second document keeps its own encoding');
    await saved();
    await click('#splitModeButton');
    await reload();
    await previewMode();
    assert.equal(await activeId(), secondId);
    assert.equal((await state()).encoding, 'utf-16le', 'Independent encoding survives renderer reload');
    await select(firstId);
    assert.equal((await state()).content, firstContent);
    await click('#editModeButton');
    await reload();
    await previewMode();
    console.log('PASS: blank creation, editing, rename, independent tabs, rapid switch, reload and preview startup');

    const iconv = require('iconv-lite');
    const encodeRequests = [];
    ipcMain.removeHandler('encode-text');
    ipcMain.handle('encode-text', async (_event, request) => {
      encodeRequests.push(request);
      await new Promise(resolve => setTimeout(resolve, 200));
      return iconv.encode(request.text, request.encoding).toString('base64');
    });
    const downloadPath = path.join(profile, 'exported-first.md');
    const download = new Promise((resolve, reject) => {
      const downloadTimer = setTimeout(() => reject(new Error('Timed out: delayed document export')), 10000);
      wc.session.once('will-download', (_event, item) => {
        const filename = item.getFilename();
        item.setSavePath(downloadPath);
        item.once('done', (_event, status) => {
          clearTimeout(downloadTimer);
          resolve({ filename, status });
        });
      });
    });
    await select(firstId);
    await click('#downloadButton');
    await select(secondId);
    const downloaded = await download;
    assert.equal(downloaded.status, 'completed');
    assert.equal(downloaded.filename, '第一份草稿.md', 'Delayed export keeps the document name captured when clicked');
    assert.equal(fs.readFileSync(downloadPath).toString('base64'), iconv.encode(firstContent, 'gbk').toString('base64'), 'Delayed export keeps the content and encoding captured when clicked');
    assert.equal(encodeRequests[0].text, firstContent);
    assert.equal(encodeRequests[0].encoding, 'gbk');
    assert.equal(await activeId(), secondId, 'Delayed export does not change the selected document');
    assert.match((await state()).content, /第二份独立内容/);
    assert.equal((await state()).encoding, 'utf-16le');
    console.log('PASS: delayed native encoding exports the clicked document while another tab stays selected');

    const fixtures = path.join(profile, 'docs with spaces');
    fs.mkdirSync(path.join(fixtures, 'images'), { recursive: true });
    const pixel = path.join(fixtures, 'images', 'pixel.png');
    const unicodePixel = path.join(fixtures, 'images', 'pixel ü.png');
    const windowsPixel = path.join(fixtures, 'images', 'pixel (1).png');
    fs.writeFileSync(pixel, Buffer.from(pixelBase64, 'base64'));
    fs.copyFileSync(pixel, unicodePixel);
    fs.copyFileSync(pixel, windowsPixel);
    const fileA = path.join(fixtures, 'alpha.md');
    const fileB = path.join(fixtures, 'beta.markdown');
    fs.writeFileSync(fileA, '# Alpha\n\nImported first document.');
    fs.writeFileSync(fileB, '# Beta\n\nImported second document.');
    const beforeImport = (await state()).tabs.length;
    assert.equal(await js("document.querySelector('#fileInput').multiple"), true, 'Import input supports multiple selection');
    await setRealFiles('#fileInput', [fileA, fileB]);
    await poll(async () => (await state()).tabs.length === beforeImport + 2, 'Multiple selected files imported');
    const imported = await state();
    assert.equal(imported.name, path.basename(fileB), 'Import selection order is preserved');
    await previewMode();
    await saved();
    const persisted = await js("JSON.parse(localStorage.getItem('lumen-documents-v1'))");
    assert.ok(persisted.documents.some(document => document.path === fileA), 'Electron 38 file input keeps the native file path');
    assert.ok(persisted.documents.some(document => document.path === fileB));
    const alphaTab = imported.tabs.find(tab => tab.name.includes('alpha.md'));
    await select(alphaTab.id);
    assert.match((await state()).content, /Imported first document/);
    await setContent('# Alpha changed');
    await openNativeFile(fileA);
    assert.equal((await state()).tabs.length, beforeImport + 2, 'Reopening an existing path does not duplicate tabs');
    assert.equal((await state()).content, '# Alpha changed', 'Reopening keeps the existing unsaved draft');
    console.log('PASS: real multiple File import, Electron native paths, independent imported documents and path deduplication');

    const beforeDrop = (await state()).tabs.length;
    await js(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['# Dropped A'], 'dropped-a.md', { type:'text/markdown' }));
      transfer.items.add(new File(['# Dropped B'], 'dropped-b.markdown', { type:'text/markdown' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer:transfer, bubbles:true, cancelable:true }));
    })()`);
    await poll(async () => (await state()).tabs.length === beforeDrop + 2, 'Multiple dropped files imported');
    assert.equal((await state()).name, 'dropped-b.markdown');
    assert.equal((await state()).content, '# Dropped B');
    console.log('PASS: multiple dropped documents are kept in order');

    const imageDoc = path.join(fixtures, 'images.md');
    fs.writeFileSync(imageDoc, [
      '# Images',
      '![relative](images/pixel.png)',
      '![unicode](<images/pixel ü.png>)',
      `![absolute](<${pixel.replaceAll('\\', '/')}>)`,
      `![file](<${pathToFileURL(pixel).href}>)`,
      `![windows](<${windowsPixel}>)`,
      `![data](data:image/png;base64,${pixelBase64})`,
      '![https](https://lumen-test.invalid/pixel.png)',
      '<img alt="html-relative" src="images/pixel.png" onerror="window.__unsafeImage=true">',
      '![javascript](javascript:alert(1))',
      '![vbscript](vbscript:msgbox)',
      '![html-data](data:text/html,hello)',
      '![missing](images/missing.png)',
      '<img alt="unsafe-html" src="javascript:alert(1)" onload="window.__unsafeImage=true">',
      '<script>window.__unsafeImage=true</script>'
    ].join('\n\n'));
    await openNativeFile(imageDoc);
    await previewMode();
    for (const alt of ['relative', 'unicode', 'absolute', 'file', 'windows', 'data', 'https', 'html-relative']) {
      await poll(async () => js(`(() => { const image = document.querySelector('#preview img[alt=${JSON.stringify(alt)}]'); return image?.complete && image.naturalWidth > 0; })()`), `${alt} image actually decoded`);
    }
    const imageSources = await js("[...document.querySelectorAll('#preview img')].map(image => ({ alt:image.alt, src:image.getAttribute('src'), handlers:[...image.attributes].filter(attribute => /^on/i.test(attribute.name)).length }))");
    for (const image of imageSources) {
      assert.equal(image.handlers, 0, 'Image event handlers are stripped');
      if (['javascript', 'vbscript', 'html-data', 'unsafe-html'].includes(image.alt)) assert.ok(!image.src, `Dangerous ${image.alt} image source rejected`);
    }
    assert.equal(await js("[...document.querySelectorAll('#preview [src]')].some(element => ['javascript:', 'vbscript:', 'data:text/html'].some(prefix => (element.getAttribute('src') || '').toLowerCase().startsWith(prefix)))"), false, 'Dangerous sources never remain on any rendered element');
    assert.equal(await js('!!window.__unsafeImage'), false, 'Unsafe markup never executes');
    await poll(async () => js("[...document.querySelectorAll('#preview .image-placeholder')].some(element => element.textContent.includes('missing'))"), 'Missing image shows a useful placeholder');
    console.log('PASS: actual relative, Unicode, absolute, file URL, data, HTTPS and HTML image decoding; dangerous sources and handlers rejected');

    await click('#newDocumentButton');
    await setRealFiles('#imageInput', [pixel]);
    await poll(async () => (await state()).content.includes('!['), 'Image insertion writes Markdown');
    await click('#previewModeButton');
    await poll(async () => js("[...document.querySelectorAll('#preview img')].some(image => image.complete && image.naturalWidth > 0)"), 'Inserted image decoded');
    console.log('PASS: real image file insertion works in a new draft');

    for (const mode of ['preview', 'edit', 'split']) {
      await click(`#${mode}ModeButton`);
      await checkLayout(900, 620);
      await checkLayout(1280, 820);
    }
    console.log('PASS: critical controls, selected tab and page bounds fit 900x620 and 1280x820 in all three views');

    await saved();
    const finalState = await state();
    fs.writeFileSync(path.join(profile, 'expected.json'), JSON.stringify({ tabCount:finalState.tabs.length, activeId:await activeId(), content:finalState.content, firstId, firstContent }));
    await click('#splitModeButton');
    wc.session.flushStorageData();
  }
  assert.deepEqual(rendererErrors, [], 'No unexpected renderer console errors');
  assert.deepEqual(openedPaths, [], 'Tests must not launch local external apps');
  assert.deepEqual(openedUrls, [], 'Tests must not launch the system browser');
  clearTimeout(timer);
  app.exit(0);
}

async function poll(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
