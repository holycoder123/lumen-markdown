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
      mode: document.querySelector('#previewModeButton').getAttribute('aria-selected'),
      reopenDisabled: document.querySelector('#reopenDocumentButton').disabled,
      selection: [document.querySelector('#editor').selectionStart, document.querySelector('#editor').selectionEnd]
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
  async function closeDocument(id) { await click(`#documentTabs [data-close-document-id="${id}"]`); }
  async function shortcut(key, shiftKey = false) {
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key:${JSON.stringify(key)}, ctrlKey:true, shiftKey:${shiftKey}, bubbles:true, cancelable:true }));`);
  }
  async function nativeShortcut(key, shiftKey = false) {
    let received;
    const onInput = (event, input) => {
      if (input.type === 'keyDown' && input.key.toLowerCase() === key.toLowerCase()) received = { input, prevented:event.defaultPrevented };
    };
    wc.on('before-input-event', onInput);
    try {
      wc.focus();
      await js("document.querySelector('#editor').focus()");
      const modifiers = shiftKey ? ['control', 'shift'] : ['control'];
      wc.sendInputEvent({ type:'keyDown', keyCode:key.toUpperCase(), modifiers });
      wc.sendInputEvent({ type:'keyUp', keyCode:key.toUpperCase(), modifiers });
      await poll(async () => received, `Native Ctrl+${shiftKey ? 'Shift+' : ''}${key.toUpperCase()} reaches Electron`);
      return received;
    } finally { wc.removeListener('before-input-event', onInput); }
  }
  async function documentStorage() { return js("JSON.parse(localStorage.getItem('lumen-documents-v1'))"); }
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
    await poll(async () => js(`(() => {
      const selected = document.querySelector('#documentTabs [aria-selected=true]');
      const tab = selected?.closest('.document-tab-item').getBoundingClientRect(), tabs = document.querySelector('#documentTabs').getBoundingClientRect();
      return tab && tab.left >= tabs.left - 1 && tab.right <= tabs.right + 1;
    })()`), `Resized selected document tab becomes visible at ${width}x${height}`, 1500);
    const layout = await js(`(() => {
      const selectors = ['#newDocumentButton','#uploadButton','#downloadButton','#themeButton','#defaultAppButton','#documentName','#documentTabs','#reopenDocumentButton','#editModeButton','#previewModeButton','#splitModeButton','#insertImageButton','#encodingSelect','#documentFooter'];
      const bounds = selectors.flatMap(selector => {
        const element = document.querySelector(selector), rect = element.getBoundingClientRect();
        return rect.width && rect.height ? [{ selector, left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom }] : [];
      });
      const selected = document.querySelector('#documentTabs [aria-selected=true]');
      const tab = selected.closest('.document-tab-item').getBoundingClientRect(), tabs = document.querySelector('#documentTabs').getBoundingClientRect();
      const bodyChildren = [...document.body.children].filter(element => !['SCRIPT', 'INPUT'].includes(element.tagName)).map(element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return { tag:element.tagName, id:element.id, className:element.className, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height, position:style.position, cssTop:style.top, cssLeft:style.left }; });
      return { width:innerWidth, height:innerHeight, pageWidth:document.documentElement.scrollWidth, pageHeight:document.documentElement.scrollHeight, bounds, bodyChildren, selected:{ left:tab.left, right:tab.right, containerLeft:tabs.left, containerRight:tabs.right } };
    })()`);
    assert.equal(layout.width, width);
    assert.equal(layout.height, height);
    assert.ok(layout.pageWidth <= width + 1, `No page horizontal overflow at ${width}x${height}`);
    assert.ok(layout.pageHeight <= height + 1, `No page vertical overflow at ${width}x${height}: ${JSON.stringify(layout)}`);
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
    const stored = await documentStorage();
    assert.ok(stored.closedDocuments.some(document => document.id === expected.closedImage.id), 'Closed document history survives a full app restart');
    assert.equal((await state()).tabs.some(tab => tab.id === expected.closedImage.id), false, 'Restart keeps closed documents closed');
    await click('#reopenDocumentButton');
    assert.equal(await activeId(), expected.closedImage.id, 'Reopening after restart restores the same document ID');
    assert.equal((await state()).content, expected.closedImage.content, 'Closed Markdown and image links survive a full app restart');
    assert.equal((await state()).name, expected.closedImage.name);
    assert.equal((await state()).encoding, expected.closedImage.encoding);
    assert.equal((await documentStorage()).documents.find(document => document.id === expected.closedImage.id).path, expected.closedImage.path, 'Reopened image document retains its base file path');
    await click('#previewModeButton');
    await poll(async () => js("document.querySelector('#preview img[alt=relative]')?.naturalWidth > 0"), 'Reopened relative image decoded after full restart');
    console.log('PASS: full app restart restores open documents in preview and retains recoverable closed drafts with their images');
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
    const starterId = await activeId();
    const starterContent = (await state()).content;
    assert.equal((await state()).reopenDisabled, true, 'Reopen is disabled before a document has been closed');
    const closeControls = await js(`(() => {
      const tab = document.querySelector('#documentTabs [role=tab]');
      const close = tab.closest('.document-tab-item').querySelector('.document-tab-close');
      return { count:document.querySelectorAll('#documentTabs .document-tab-close').length, id:close?.dataset.closeDocumentId, label:close?.getAttribute('aria-label'), title:close?.title, nested:!!document.querySelector('#documentTabs button button') };
    })()`);
    assert.equal(closeControls.count, initialCount, 'Each tab has a dedicated close button');
    assert.equal(closeControls.id, starterId);
    assert.ok(closeControls.label.includes((await state()).name), 'Close button has a descriptive accessible label');
    assert.ok(closeControls.title.includes((await state()).name), 'Close button names the document in its tooltip');
    assert.equal(closeControls.nested, false, 'Tab and close actions are independent buttons');

    await js(`window.__testStorageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'lumen-documents-v1') throw new DOMException('Test quota exceeded', 'QuotaExceededError'); return window.__testStorageSetItem.call(this, key, value); }; void 0;`);
    try {
      await closeDocument(starterId);
      assert.equal((await state()).tabs.length, 1, 'Failed persistence cannot discard the final open draft');
      assert.equal(await activeId(), starterId);
      assert.equal((await state()).content, starterContent, 'Failed close preserves the complete draft');
      assert.match((await state()).saved, /存储空间不足|自动保存失败/, 'Failed close reports its storage error');
    } finally {
      await js('Storage.prototype.setItem = window.__testStorageSetItem; delete window.__testStorageSetItem; saveDocuments();');
    }
    await closeDocument(starterId);
    assert.equal((await state()).tabs.length, 0, 'Closing the final document leaves no open tabs');
    assert.equal((await state()).content, '', 'No stale editor content remains after the final close');
    await previewMode();
    assert.equal((await state()).reopenDisabled, false, 'A closed draft can be recovered');
    await reload();
    assert.equal((await state()).tabs.length, 0, 'An intentionally empty workspace stays empty after reload');
    await previewMode();
    const openedFromEmptyPath = path.join(profile, 'opened-from-empty.md');
    fs.writeFileSync(openedFromEmptyPath, '# 从空白工作区打开文件');
    await openNativeFile(openedFromEmptyPath);
    const openedFromEmptyId = await activeId();
    assert.equal((await state()).tabs.length, 1, 'Opening a native file works from an empty workspace');
    assert.equal((await state()).content, '# 从空白工作区打开文件');
    await previewMode();
    await closeDocument(openedFromEmptyId);
    await click('#newDocumentButton');
    const blankFromEmptyId = await activeId();
    assert.equal((await state()).content, '', 'New document works from an empty workspace');
    assert.equal((await state()).editHidden, false);
    await shortcut('w');
    assert.equal((await state()).tabs.length, 0, 'Ctrl+W closes the current document');
    await shortcut('T', true);
    assert.equal(await activeId(), blankFromEmptyId, 'Ctrl+Shift+T restores the most recently closed document');
    await click('#reopenDocumentButton');
    assert.equal(await activeId(), openedFromEmptyId, 'Reopen restores the file opened from the empty workspace');
    await click('#reopenDocumentButton');
    assert.equal(await activeId(), starterId, 'Reopen recovers the original welcome draft');
    assert.equal((await state()).content, starterContent);
    await closeDocument(blankFromEmptyId);
    await closeDocument(openedFromEmptyId);
    assert.equal(await activeId(), starterId, 'Closing a background document keeps the active document');
    console.log('PASS: close button accessibility, failed storage rollback, final-tab close, empty reload, blank creation and close/reopen shortcuts');

    await checkLayout(1280, 820);
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

    if (process.env.LUMEN_TEST_SCREENSHOT) {
      await select(starterId);
      await saved();
      const screenshot = await wc.capturePage();
      fs.writeFileSync(process.env.LUMEN_TEST_SCREENSHOT, screenshot.toPNG());
      console.log(`SCREENSHOT: ${process.env.LUMEN_TEST_SCREENSHOT}`);
      await select(firstId);
    }

    const baselineId = (await state()).tabs.at(-1).id;
    await select(baselineId);
    const baselineContent = (await state()).content;
    const closableIds = [];
    for (const label of ['A', 'B', 'C']) {
      await click('#newDocumentButton');
      closableIds.push(await activeId());
      await rename(`可关闭草稿 ${label}.md`);
      await setContent(`# 可关闭草稿 ${label}\n\n保留独立内容`);
    }
    const [closeA, closeB, closeC] = closableIds;
    await setEncoding('utf-16le');
    await click('#splitModeButton');
    await js("document.querySelector('#editor').setSelectionRange(3, 9)");
    const beforeBackgroundClose = await state();
    await closeDocument(closeB);
    const afterBackgroundClose = await state();
    assert.equal(await activeId(), closeC, 'Closing a background tab keeps the active document');
    assert.equal(afterBackgroundClose.content, beforeBackgroundClose.content, 'Closing another tab cannot overwrite the active draft');
    assert.deepEqual(afterBackgroundClose.selection, beforeBackgroundClose.selection, 'Closing another tab preserves the active selection');
    assert.equal(afterBackgroundClose.encoding, beforeBackgroundClose.encoding);
    assert.equal(afterBackgroundClose.editHidden, beforeBackgroundClose.editHidden);
    assert.equal(afterBackgroundClose.previewHidden, beforeBackgroundClose.previewHidden, 'Closing another tab preserves split mode');
    await select(closeA);
    const pendingClosedContent = '# 尚未自动保存的关闭草稿\n\n关闭后也可找回';
    const pendingClose = await js(`(() => {
      const editor = document.querySelector('#editor');
      editor.value = ${JSON.stringify(pendingClosedContent)};
      editor.dispatchEvent(new Event('input', { bubbles:true }));
      const wasSaving = document.querySelector('#saveStatus').textContent;
      document.querySelector('#documentTabs [data-close-document-id="${closeA}"]').click();
      return { wasSaving, selected:document.querySelector('#documentTabs [aria-selected=true]')?.dataset.documentId, saved:JSON.parse(localStorage.getItem('lumen-documents-v1')) };
    })()`);
    assert.equal(pendingClose.wasSaving, '正在保存…', 'Close occurs while the edit is pending');
    assert.equal(pendingClose.selected, closeC, 'Closing the active tab selects its right neighbor');
    assert.equal(pendingClose.saved.closedDocuments.find(document => document.id === closeA).content, pendingClosedContent, 'Close persists the pending edit before removing the tab');
    await closeDocument(closeC);
    assert.equal(await activeId(), baselineId, 'Closing the final tab in the row selects its left neighbor');
    assert.equal((await state()).content, baselineContent, 'Returning to the neighboring document restores its own content');
    await click('#reopenDocumentButton');
    assert.equal(await activeId(), closeC);
    assert.equal((await state()).encoding, 'utf-16le', 'Reopening restores the document encoding');
    assert.match((await state()).content, /可关闭草稿 C/);
    await click('#reopenDocumentButton');
    assert.equal(await activeId(), closeA);
    assert.equal((await state()).content, pendingClosedContent, 'Reopening restores a draft closed before debounce');
    assert.equal((await state()).name, '可关闭草稿 A.md');
    await shortcut('t', true);
    assert.equal(await activeId(), closeB, 'Reopening follows the most recent close order');
    assert.match((await state()).content, /可关闭草稿 B/);
    for (const id of closableIds) await closeDocument(id);
    await select(firstId);
    console.log('PASS: background close preserves selection and mode, active close chooses adjacent tabs, pending drafts and encoding reopen in close order');

    await select(secondId);
    const nativeNeighborContent = (await state()).content;
    await click('#newDocumentButton');
    const nativeCloseId = await activeId();
    const nativeClosedContent = '# Native shortcut pending draft';
    await setContent(nativeClosedContent);
    const nativeCloseInput = await nativeShortcut('w');
    assert.equal(nativeCloseInput.prevented, true, 'Electron intercepts Ctrl+W before the default menu can close the window');
    await poll(async () => !win.isDestroyed() && (await activeId()) === secondId, 'Native Ctrl+W closes its document and preserves the app window');
    assert.equal(win.isDestroyed(), false, 'Native Ctrl+W keeps the window open');
    assert.equal((await state()).tabs.some(tab => tab.id === nativeCloseId), false, 'Native Ctrl+W removes only the active document tab');
    assert.equal((await state()).content, nativeNeighborContent, 'Native Ctrl+W preserves the neighboring draft');
    await nativeShortcut('t', true);
    await poll(async () => (await activeId()) === nativeCloseId, 'Native Ctrl+Shift+T restores the closed document');
    assert.equal((await state()).content, nativeClosedContent, 'Native reopening restores the pending draft');
    await closeDocument(nativeCloseId);
    await select(firstId);
    console.log('PASS: native Electron Ctrl+W closes only its document, keeps the window and neighboring draft, and native Ctrl+Shift+T restores the draft');

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
    await closeDocument(alphaTab.id);
    assert.equal((await state()).tabs.some(tab => tab.id === alphaTab.id), false);
    await openNativeFile(fileA);
    assert.equal(await activeId(), alphaTab.id, 'Reimporting a closed file restores its existing document ID');
    assert.equal((await state()).tabs.length, beforeImport + 2, 'Reimporting a closed path restores one tab');
    assert.equal((await state()).content, '# Alpha changed', 'Reimporting a closed file keeps its edited draft instead of reading stale disk content');
    assert.equal((await documentStorage()).closedDocuments.some(document => document.id === alphaTab.id), false, 'A reopened path is removed from closed history');
    console.log('PASS: real multiple File import, Electron native paths, independent documents, open/closed path deduplication and preserved edits');

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

    // This representative fixture covers Markdown/HTML commonly preserved by
    // document exporters. It is assembled for tests, not an official Feishu export.
    const feishuDir = path.join(fixtures, '飞书 导出');
    fs.mkdirSync(path.join(feishuDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(feishuDir, '附件'), { recursive: true });
    const feishuImage = path.join(feishuDir, 'assets', '图片 空格 & (示意).png');
    const feishuAttachment = path.join(feishuDir, '附件', '需求 文档 & (版本1).pdf');
    fs.copyFileSync(pixel, feishuImage);
    fs.writeFileSync(feishuAttachment, '%PDF-1.4\n% isolated attachment fixture\n');
    // A short, silent PCM WAV lets Electron decode real media metadata without
    // network access, third-party encoders, or audio playback.
    const wavFrames = 1600, wavRate = 8000, wavBytes = wavFrames * 2;
    const silentWav = Buffer.alloc(44 + wavBytes);
    silentWav.write('RIFF', 0); silentWav.writeUInt32LE(36 + wavBytes, 4);
    silentWav.write('WAVEfmt ', 8); silentWav.writeUInt32LE(16, 16);
    silentWav.writeUInt16LE(1, 20); silentWav.writeUInt16LE(1, 22);
    silentWav.writeUInt32LE(wavRate, 24); silentWav.writeUInt32LE(wavRate * 2, 28);
    silentWav.writeUInt16LE(2, 32); silentWav.writeUInt16LE(16, 34);
    silentWav.write('data', 36); silentWav.writeUInt32LE(wavBytes, 40);
    const feishuAudio = path.join(feishuDir, 'assets', '静音 样例.wav');
    fs.writeFileSync(feishuAudio, silentWav);
    const outsideAttachment = path.join(fixtures, 'outside-note.txt');
    fs.writeFileSync(outsideAttachment, 'A user-authored relative attachment outside the exported directory.');
    const feishuDoc = path.join(feishuDir, '飞书 兼容样例.md');
    const feishuFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'feishu-export.md'), 'utf8');
    fs.writeFileSync(feishuDoc, `${feishuFixture}\n\n![文件URL图片](<${pathToFileURL(feishuImage).href}?v=1#preview>)\n\n<audio src="${encodeURI('assets/静音 样例.wav')}" controls></audio>\n\n[跳到另一份文档](<关联 文档.md#目标章节>)\n\n## 重复标题\n\n第一次。\n\n## 重复标题\n\n第二次。\n\n## ${'长标题'.repeat(100)}\n\n长标题的目录链接仍然准确。\n`);
    await openNativeFile(feishuDoc);
    await previewMode();
    assert.equal(await js("typeof window.LumenMarkdown?.render === 'function' && typeof window.LumenMarkdown?.renderMath === 'function'"), true, 'The offline Markdown engine is loaded in the real renderer');
    const feishuDom = await js(`(() => {
      const root = document.querySelector('#preview');
      const paragraphs = [...root.querySelectorAll('p')];
      const paragraph = text => paragraphs.find(element => element.textContent.includes(text));
      const tables = [...root.querySelectorAll('table')];
      const colored = [...root.querySelectorAll('span')].find(element => element.textContent === '保留颜色和背景');
      const dangerousStyle = paragraph('危险样式内容');
      const outerQuote = [...root.querySelectorAll('blockquote')].find(element => element.textContent.includes('引用第一段'));
      const code = [...root.querySelectorAll('pre code')].find(element => element.textContent.includes('literalTicks'));
      return {
        bold:[...root.querySelectorAll('strong')].map(element => element.textContent),
        soft:paragraph('段内第一行')?.innerHTML,
        hard:paragraph('显式换行第一行')?.innerHTML,
        slashBreak:paragraph('反斜杠换行第一行')?.innerHTML,
        orderedStart:root.querySelector('ol[start="3"]')?.start,
        nestedList:!!root.querySelector('ol > li > ul > li > ol'),
        tasks:[...root.querySelectorAll('input[type=checkbox]')].map(element => ({ checked:element.checked, disabled:element.disabled })),
        quoteParagraphs:outerQuote ? [...outerQuote.children].filter(element => element.tagName === 'P').map(element => element.textContent) : [],
        quoteList:!!outerQuote?.querySelector('ul > li'),
        nestedQuote:!!outerQuote?.querySelector('blockquote'),
        callout:[...root.querySelectorAll('.markdown-callout')].find(element => element.textContent.includes('飞书导出中的说明提示'))?.className || '',
        markdownTable:tables[0] ? [...tables[0].rows].map(row => [...row.cells].map(cell => ({ text:cell.textContent, align:getComputedStyle(cell).textAlign, code:cell.querySelector('code')?.textContent }))) : [],
        mergedHeader:root.querySelector('th[colspan="2"]')?.textContent,
        mergedRow:root.querySelector('td[rowspan="2"]')?.textContent,
        richHtmlCell:(() => { const cell = [...root.querySelectorAll('table.html-markdown-table td')].find(element => element.textContent.includes('单元格粗体')); return cell ? { reference:cell.querySelector('a[href^="https:"]')?.getAttribute('href'), note:cell.querySelector('sup.footnote-ref a')?.getAttribute('href'), bold:cell.querySelector('strong')?.textContent, math:cell.querySelectorAll('.katex').length, imageTitle:cell.querySelector('img[alt="单元格引用图"]')?.title } : null; })(),
        color:colored?.style.color,
        background:colored?.style.backgroundColor,
        weight:colored?.style.fontWeight,
        centered:paragraph('居中段落')?.style.textAlign,
        underline:root.querySelector('u')?.textContent,
        sub:root.querySelector('sub')?.textContent,
        sup:[...root.querySelectorAll('sup')].find(element => element.textContent === '2')?.textContent,
        detail:root.querySelector('details') ? { open:root.querySelector('details').open, summary:root.querySelector('summary')?.textContent, text:root.querySelector('details p')?.textContent } : null,
        referenceLink:[...root.querySelectorAll('a')].find(element => element.textContent === '飞书参考')?.getAttribute('href'),
        referenceImage:root.querySelector('img[alt="引用图片"]')?.title,
        codeText:code?.textContent,
        codeLanguage:code?.className,
        codeKeywords:code?.querySelectorAll('.hljs-keyword').length || 0,
        codeMath:!!code?.querySelector('.katex'),
        inlineLiteral:[...root.querySelectorAll('p code')].map(element => element.textContent),
        mathInline:root.querySelectorAll('.katex').length,
        mathDisplay:root.querySelectorAll('.katex-display').length,
        unavailableAssets:[...root.querySelectorAll('.export-placeholder')].map(element => element.textContent),
        headings:[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(element => ({ text:element.textContent, id:element.id })),
        anchors:[...root.querySelectorAll('a[href^="#"]')].map(element => ({ text:element.textContent, href:element.getAttribute('href'), className:element.className })),
        footnoteText:root.textContent.includes('脚注正文第一段。') && root.textContent.includes('脚注正文第二段'),
        unsafeNodes:[...root.querySelectorAll('script,style,iframe,object,embed,form,button,select,textarea')].filter(element => !(element.tagName.toLowerCase() === 'style' && element.closest('.mermaid-diagram svg'))).map(element => element.tagName),
        unsafeHandlers:[...root.querySelectorAll('*')].flatMap(element => [...element.attributes].filter(attribute => /^on/i.test(attribute.name))).length,
        unsafeUrls:[...root.querySelectorAll('[href],[src]')].flatMap(element => ['href','src'].map(name => element.getAttribute(name))).filter(value => ['javascript:','vbscript:','data:text/html','chrome:'].some(prefix => (value || '').toLowerCase().startsWith(prefix))),
        unsafeCss:dangerousStyle ? { position:dangerousStyle.style.position, top:dangerousStyle.style.top, left:dangerousStyle.style.left, zIndex:dangerousStyle.style.zIndex, backgroundImage:dangerousStyle.style.backgroundImage } : null,
        ranUnsafe:!!window.__feishuUnsafe
      };
    })()`);
    assert.ok(feishuDom.bold.includes('中文粗体'), 'Chinese bold next to ordinary text renders as strong');
    assert.match(feishuDom.soft, /段内第一行[\s\S]*段内第二行/, 'Soft line breaks keep both lines in one paragraph');
    assert.match(feishuDom.hard, /第一行\s*<br\s*\/?>(?:\n)?第二行|第一行\s*<br\s*\/?>(?:\n)?显式换行第二行/, 'Two trailing spaces produce a hard line break');
    assert.match(feishuDom.slashBreak, /<br\s*\/?\>/, 'A trailing backslash produces a hard line break');
    assert.equal(feishuDom.orderedStart, 3, 'An exported ordered list preserves its starting number');
    assert.equal(feishuDom.nestedList, true, 'Nested ordered and unordered lists form a proper DOM tree');
    assert.equal(feishuDom.tasks.length, 3, 'Nested task items render as checkboxes');
    assert.equal(feishuDom.tasks.filter(task => task.checked).length, 1);
    assert.ok(feishuDom.tasks.every(task => task.disabled), 'Preview tasks remain read-only');
    assert.ok(feishuDom.quoteParagraphs.includes('引用第一段') && feishuDom.quoteParagraphs.includes('引用第二段'), 'A multi-paragraph quotation retains separate paragraphs');
    assert.equal(feishuDom.quoteList, true);
    assert.equal(feishuDom.nestedQuote, true);
    assert.match(feishuDom.callout, /callout/, 'Document callouts receive their intended presentation');
    assert.equal(feishuDom.markdownTable.length, 3);
    assert.ok(feishuDom.markdownTable.every(row => row.length === 3), 'Pipes inside inline code cannot create extra table cells');
    assert.equal(feishuDom.markdownTable[1][0].text, '文字中的转义 | 竖线');
    assert.equal(feishuDom.markdownTable[1][1].code, 'a|b');
    assert.equal(feishuDom.markdownTable[2][1].code, 'a|b');
    assert.deepEqual(feishuDom.markdownTable[0].map(cell => cell.align), ['left', 'center', 'right']);
    assert.equal(feishuDom.mergedHeader, '合并表头');
    assert.equal(feishuDom.mergedRow, '合并行');
    assert.ok(feishuDom.richHtmlCell, 'An exported HTML table retains its Markdown cell content');
    assert.equal(feishuDom.richHtmlCell.reference, 'https://www.feishu.cn/');
    assert.match(feishuDom.richHtmlCell.note, /^#lumen-fn-/);
    assert.equal(feishuDom.richHtmlCell.bold, '单元格粗体');
    assert.equal(feishuDom.richHtmlCell.math, 1, 'Inline cell math uses the same local KaTeX renderer');
    assert.equal(feishuDom.richHtmlCell.imageTitle, '图片说明', 'A cell image shares the document reference-image definition');
    assert.equal(feishuDom.color, 'rgb(211, 47, 47)');
    assert.equal(feishuDom.background, 'rgb(255, 244, 204)');
    assert.equal(feishuDom.weight, '600');
    assert.equal(feishuDom.centered, 'center');
    assert.equal(feishuDom.underline, '下划线内容');
    assert.equal(feishuDom.sub, '2');
    assert.equal(feishuDom.sup, '2');
    assert.deepEqual(feishuDom.detail, { open:true, summary:'折叠块标题', text:'折叠块内容' });
    assert.equal(feishuDom.referenceLink, 'https://www.feishu.cn/');
    assert.equal(feishuDom.referenceImage, '图片说明');
    assert.ok(feishuDom.codeText.includes('const literalTicks = "```";') && feishuDom.codeText.includes('"$x^2$"'), 'Long tilde fences keep nested backticks and math as code');
    assert.equal(feishuDom.codeMath, false);
    assert.match(feishuDom.codeLanguage, /language-javascript/);
    assert.ok(feishuDom.codeKeywords > 0, 'The offline highlighter marks JavaScript keywords in real DOM');
    assert.ok(feishuDom.inlineLiteral.includes('$code^2$'), 'Inline code containing a math delimiter stays literal');
    assert.ok(feishuDom.mathInline >= 2 && feishuDom.mathDisplay === 1, 'Inline and display math render locally through KaTeX');
    assert.equal(feishuDom.unavailableAssets.length, 5, 'Feishu token-only assets remain visible with an explanation');
    assert.ok(feishuDom.unavailableAssets.every(text => text.includes('未导出')), 'The viewer distinguishes missing export assets from decoded images');
    assert.ok(feishuDom.unavailableAssets.some(text => text.includes('原图素材')) && feishuDom.unavailableAssets.some(text => text.includes('原始附件')), 'Names of token-only images and attachments are retained');
    assert.equal(feishuDom.footnoteText, true, 'Footnote definitions render with all paragraphs');
    const headingIds = feishuDom.headings.map(heading => heading.id);
    assert.ok(headingIds.every(Boolean), 'Every Markdown heading has an anchor');
    assert.equal(new Set(headingIds).size, headingIds.length, 'Repeated titles receive unique heading anchors');
    assert.ok(headingIds.every(id => id.length <= 240), 'Long heading anchors fit the sanitizer without losing their TOC target');
    assert.equal(feishuDom.headings.find(heading => heading.text === 'A & B')?.id, 'lumen-heading-a-b', 'HTML entities in headings produce the same readable slug as their displayed text');
    assert.ok(feishuDom.anchors.filter(anchor => feishuDom.headings.some(heading => heading.text === anchor.text)).length >= feishuDom.headings.length - 1, 'TOC links cover the generated headings');
    assert.equal(await js("[...document.querySelectorAll('#preview .markdown-toc a[href]')].every(link => document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)))?.closest('#preview'))"), true, 'Every TOC link points to a real heading in the current preview');
    const noteRefs = feishuDom.anchors.filter(anchor => /footnote|fnref|fn-/i.test(anchor.href) && !/back/i.test(anchor.className));
    assert.equal(noteRefs.length, 3, 'HTML table and ordinary Markdown share repeated footnote references');
    assert.equal(await js("document.querySelectorAll('#preview .footnotes a.footnote-backref').length"), 3, 'Every reference, including the HTML table cell, has its own footnote return link');
    assert.deepEqual(feishuDom.unsafeNodes, [], 'Executable HTML and interactive forms are removed');
    assert.equal(feishuDom.unsafeHandlers, 0);
    assert.deepEqual(feishuDom.unsafeUrls, []);
    assert.deepEqual(feishuDom.unsafeCss, { position:'', top:'', left:'', zIndex:'', backgroundImage:'' }, 'Document CSS cannot overlay the app or issue background network requests');
    assert.equal(feishuDom.ranUnsafe, false);
    assert.deepEqual(await js(`(() => {
      const template = document.createElement('template');
      template.innerHTML = window.LumenMarkdown.render('<video src="movie/$x$.mp4" title="属性 $x$"></video>');
      const video = template.content.querySelector('video');
      return { source:video?.getAttribute('src'), title:video?.title, math:template.content.querySelectorAll('.math-expression').length };
    })()`), { source:'movie/$x$.mp4', title:'属性 $x$', math:0 }, 'Math delimiters in video HTML attributes stay literal');
    for (const alt of ['引用图片', '单元格引用图', '中文空格图片', '编码查询图片', '文件URL图片']) {
      // Exported documents can be long; reveal each image so native lazy loading
      // observes the same visibility that a reader reaches by scrolling.
      await js(`document.querySelector('#preview img[alt=${JSON.stringify(alt)}]')?.scrollIntoView({ block:'center' })`);
      await poll(async () => js(`(() => { const image = document.querySelector('#preview img[alt=${JSON.stringify(alt)}]'); return image?.complete && image.naturalWidth > 0; })()`), `Exported ${alt} image decoded`);
    }
    await poll(async () => js("[...document.querySelectorAll('#preview .image-placeholder')].some(element => element.textContent.includes('签名在线图片') && element.querySelector('a[href]'))"), 'Failed signed remote image offers its original link');
    await poll(async () => js("!!document.querySelector('#preview .flowchart-diagram svg') && !!document.querySelector('#preview .mermaid-diagram svg')"), 'Legacy flowchart and Mermaid both render after the Markdown engine upgrade');
    await poll(async () => js("(() => { const audio = document.querySelector('#preview audio'); return audio?.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0; })()"), 'A real local WAV is decoded by the native audio element');
    const audioMetadata = await js("(() => { const audio = document.querySelector('#preview audio'); return { src:audio.currentSrc, duration:audio.duration, controls:audio.controls, paused:audio.paused }; })()");
    assert.match(audioMetadata.src, /^lumen-media:\/\/local\//, 'Media uses the registered native local-file protocol');
    assert.ok(Math.abs(audioMetadata.duration - wavFrames / wavRate) < 0.01, 'Decoded duration matches the WAV sample frames');
    assert.equal(audioMetadata.controls, true);
    assert.equal(audioMetadata.paused, true, 'Preview media does not autoplay');
    const mediaProtocol = await js(`(async () => {
      const url = document.querySelector('#preview audio').currentSrc;
      const head = await fetch(url, { method:'HEAD' });
      const partial = await fetch(url, { headers:{ Range:'bytes=0-15' } });
      const partialBytes = [...new Uint8Array(await partial.arrayBuffer())];
      const outside = await fetch(url, { headers:{ Range:${JSON.stringify(`bytes=${silentWav.length}-`)} } });
      return {
        head:{ status:head.status, length:head.headers.get('content-length'), ranges:head.headers.get('accept-ranges'), bytes:(await head.arrayBuffer()).byteLength },
        partial:{ status:partial.status, range:partial.headers.get('content-range'), length:partial.headers.get('content-length'), bytes:partialBytes },
        outside:{ status:outside.status, range:outside.headers.get('content-range') }
      };
    })()`);
    assert.deepEqual(mediaProtocol.head, { status:200, length:String(silentWav.length), ranges:'bytes', bytes:0 }, 'HEAD returns media length and byte-range support without a body');
    assert.deepEqual(mediaProtocol.partial, { status:206, range:`bytes 0-15/${silentWav.length}`, length:'16', bytes:[...silentWav.subarray(0, 16)] }, 'Browser Range fetch receives exact partial media bytes with status 206');
    assert.deepEqual(mediaProtocol.outside, { status:416, range:`bytes */${silentWav.length}` }, 'An out-of-range browser media request receives status 416');
    console.log('PASS: representative exporter Markdown, nested lists/tasks, paragraphs, reference links/images, pipe tables, HTML merges/style/details, long fences, math/code isolation, footnotes, TOC, diagram compatibility and sanitization');
    console.log('PASS: real local silent WAV metadata, paused native media controls and renderer HEAD/Range 206/invalid-range 416');

    async function clickLinkWithText(text) {
      assert.equal(await js(`!![...document.querySelectorAll('#preview a')].find(element => element.textContent.trim() === ${JSON.stringify(text)})`), true, `Missing link ${text}`);
      await js(`[...document.querySelectorAll('#preview a')].find(element => element.textContent.trim() === ${JSON.stringify(text)}).click()`);
    }
    await clickLinkWithText('本地附件');
    await poll(async () => openedPaths.length === 1, 'Local attachment is handled by native IPC');
    assert.equal(openedPaths.pop(), feishuAttachment, 'A local attachment resolves Chinese, spaces, ampersands and parentheses against its document');
    await clickLinkWithText('编码附件');
    await poll(async () => openedPaths.length === 1, 'Encoded attachment is handled by native IPC');
    assert.equal(openedPaths.pop(), feishuAttachment, 'URL encoding, query and fragment do not alter the attachment file path');
    await clickLinkWithText('父目录附件');
    await poll(async () => openedPaths.length === 1, 'A user-authored parent-directory attachment is handled');
    assert.equal(openedPaths.pop(), outsideAttachment, 'Relative user attachments can intentionally refer to their parent directory');
    await clickLinkWithText('飞书参考');
    await poll(async () => openedUrls.length === 1, 'Reference URL is handled by native IPC');
    assert.equal(openedUrls.pop(), 'https://www.feishu.cn/');
    const signedUrl = 'https://lumen-test.invalid/feishu-signed.png?token=test-signature&expires=1';
    await js(`[...document.querySelectorAll('#preview .image-placeholder a')].find(element => element.href === ${JSON.stringify(signedUrl)}).click()`);
    await poll(async () => openedUrls.length === 1, 'Failed signed-image original URL is handled by native IPC');
    assert.equal(openedUrls.pop(), signedUrl);
    for (const text of ['危险脚本', '危险数据', '危险浏览器协议', 'HTML 危险链接']) {
      await js(`(() => { const link = [...document.querySelectorAll('#preview a')].find(element => element.textContent.trim() === ${JSON.stringify(text)}); link?.click(); })()`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(openedPaths, [], 'Dangerous link schemes never launch a local app');
    assert.deepEqual(openedUrls, [], 'Dangerous link schemes never launch the browser');

    await new Promise(resolve => setTimeout(resolve, 100));
    await js("document.querySelector('#preview').scrollTop = 0");
    await clickLinkWithText('跳到数学');
    await poll(async () => js("document.querySelector('#preview').scrollTop > 0"), 'Chinese heading anchor scrolls within the preview');
    assert.deepEqual(openedPaths, [], 'Heading anchors do not reach local-file IPC');
    assert.deepEqual(openedUrls, [], 'Heading anchors do not reach external-browser IPC');
    await clickLinkWithText('跳到自定义区域');
    assert.equal(await js("(() => { const root = document.querySelector('#preview'), heading = [...root.querySelectorAll('h3')].find(element => element.textContent === '自定义区域'); return !!heading && heading.getBoundingClientRect().top >= root.getBoundingClientRect().top - 1 && heading.getBoundingClientRect().top < root.getBoundingClientRect().bottom; })()"), true, 'An HTML element ID remains a valid anchor after sanitization');
    const footnoteNavigation = await js(`(() => {
      const root = document.querySelector('#preview');
      const reference = [...root.querySelectorAll('sup a[href^="#"]')].find(element => root.querySelector('[id="' + decodeURIComponent(element.getAttribute('href').slice(1)) + '"]'));
      if (!reference) return null;
      const targetId = decodeURIComponent(reference.getAttribute('href').slice(1));
      const target = document.getElementById(targetId);
      const back = [...target.querySelectorAll('a[href^="#"]')].find(element => /↩|返回|back/i.test(element.textContent + element.className));
      root.scrollTop = 0;
      reference.click();
      return { targetId, backHref:back?.getAttribute('href'), referenceId:reference.id || reference.closest('[id]')?.id };
    })()`);
    assert.ok(footnoteNavigation?.backHref, 'Rendered footnotes provide a return link');
    await poll(async () => js("document.querySelector('#preview').scrollTop > 0"), 'Footnote reference scrolls to the definition');
    const footnoteScroll = await js("document.querySelector('#preview').scrollTop");
    await js(`document.getElementById(${JSON.stringify(footnoteNavigation.targetId)}).querySelector('a[href="' + ${JSON.stringify(footnoteNavigation.backHref)} + '"]').click()`);
    assert.equal(await js(`!!document.getElementById(decodeURIComponent(${JSON.stringify(footnoteNavigation.backHref)}.slice(1)))`), true, 'Footnote return anchor exists');
    await poll(async () => (await js("document.querySelector('#preview').scrollTop")) < footnoteScroll, 'Footnote return link scrolls back to the original reference');
    assert.deepEqual(openedPaths, []);
    assert.deepEqual(openedUrls, []);
    console.log('PASS: native mock-shell attachment/reference/failing-image interactions, blocked dangerous schemes and preview-only heading/footnote navigation');

    const relatedDoc = path.join(feishuDir, '关联 文档.md');
    const relatedSource = '# 关联文档\n\n' + '导航前的内容。\n\n'.repeat(45) + '## 目标章节\n\n跨文档链接的目标正文。\n';
    fs.writeFileSync(relatedDoc, relatedSource);
    const feishuId = await activeId(), beforeRelatedOpen = (await state()).tabs.length;
    await clickLinkWithText('跳到另一份文档');
    await poll(async () => (await state()).name === path.basename(relatedDoc), 'A relative Markdown link opens another document in the app');
    const relatedId = await activeId();
    assert.equal((await state()).tabs.length, beforeRelatedOpen + 1);
    assert.equal((await state()).content, relatedSource);
    await previewMode();
    await poll(async () => js("document.querySelector('#preview').scrollTop > 0"), 'Cross-document fragment navigation scrolls to the requested section');
    assert.equal(await js("(() => { const root = document.querySelector('#preview'), heading = [...root.querySelectorAll('h2')].find(element => element.textContent === '目标章节'); return !!heading && heading.getBoundingClientRect().top >= root.getBoundingClientRect().top - 1 && heading.getBoundingClientRect().top < root.getBoundingClientRect().bottom; })()"), true, 'The linked section is visible in the new document');
    assert.deepEqual(openedPaths, [], 'Local Markdown links use document tabs without launching an external app');
    assert.deepEqual(openedUrls, []);
    await setContent(relatedSource + '\n用户未保存到磁盘的修改。');
    await select(feishuId);
    await clickLinkWithText('跳到另一份文档');
    await poll(async () => (await activeId()) === relatedId, 'Revisiting a Markdown link reuses its existing document');
    assert.equal((await state()).tabs.length, beforeRelatedOpen + 1, 'Repeated cross-document links do not duplicate tabs');
    assert.ok((await state()).content.endsWith('用户未保存到磁盘的修改。'), 'Cross-document navigation preserves an existing draft');
    await select(feishuId);
    console.log('PASS: relative Markdown links open app tabs at Chinese fragment targets, reuse existing documents and preserve unsaved drafts');

    if (process.env.LUMEN_FEISHU_SCREENSHOT_DIR) {
      const screenshots = path.resolve(process.env.LUMEN_FEISHU_SCREENSHOT_DIR);
      fs.mkdirSync(screenshots, { recursive: true });
      await saved();
      await poll(async () => js("!document.querySelector('#toast').classList.contains('show')"), 'Screenshot toast has finished');
      for (const [name, target] of [['top', null], ['tables', '#lumen-heading-表格'], ['math', '#lumen-heading-数学']]) {
        await js(target
          ? `document.querySelector('#preview ${target}')?.scrollIntoView({ block:'start' })`
          : "document.querySelector('#preview').scrollTop = 0");
        await new Promise(resolve => setTimeout(resolve, 100));
        const screenshotPath = path.join(screenshots, `feishu-export-preview-${name}.png`);
        fs.writeFileSync(screenshotPath, (await wc.capturePage()).toPNG());
        console.log(`SCREENSHOT: ${screenshotPath}`);
      }
    }

    // Diagram libraries generate SVG after Markdown HTML has been sanitized.
    // Exercise their link/callback DSL through the real app, then click the
    // generated SVG shapes and text instead of inspecting only the Markdown.
    await js("window.__feishuUnsafeCallback = () => { window.__feishuUnsafeCallbackCalls = (window.__feishuUnsafeCallbackCalls || 0) + 1; }; window.__feishuUnsafeCallbackCalls = 0; window.__diagramUnsafe = false;");
    const diagramDoc = path.join(feishuDir, '流程图 链接安全.md');
    fs.writeFileSync(diagramDoc, [
      '# 流程图后处理安全',
      '```flowchart',
      'bad=>operation: 脚本链接:>javascript:window.__diagramUnsafe=true',
      'callback=>operation: 回调节点:$__feishuUnsafeCallback',
      'bad->callback',
      '```',
      '',
      '```flowchart',
      'safe=>operation: 正常 HTTPS:>https://lumen-test.invalid/diagram?view=1',
      'done=>end: 正常终点',
      'safe->done',
      '```'
    ].join('\n'));
    await openNativeFile(diagramDoc);
    await previewMode();
    await poll(async () => js("document.querySelectorAll('#preview .flowchart-diagram svg').length === 2"), 'Unsafe and allowed-link flowcharts render their real SVG');
    const diagramChecks = await js(`(() => {
      const root = document.querySelector('#preview');
      const unsafe = [...root.querySelectorAll('.flowchart-diagram')].find(element => element.textContent.includes('回调节点'));
      const links = [...root.querySelectorAll('.flowchart-diagram svg *')].flatMap(element => [...element.attributes].filter(attribute => /href$/i.test(attribute.name)).map(attribute => attribute.value));
      const clickable = [...root.querySelectorAll('.flowchart-diagram svg a')].map(element => element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).filter(Boolean);
      const shapes = [...unsafe.querySelectorAll('svg path,svg rect,svg ellipse,svg text')];
      shapes.forEach(element => element.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true })));
      return { links, clickable, shapes:shapes.length, callbackCalls:window.__feishuUnsafeCallbackCalls, ranScript:window.__diagramUnsafe };
    })()`);
    assert.ok(diagramChecks.shapes >= 4, 'The safety check clicks generated symbol shapes and text');
    assert.deepEqual([...new Set(diagramChecks.clickable)], ['https://lumen-test.invalid/diagram?view=1'], 'Allowed diagram links remain available');
    assert.ok(diagramChecks.links.every(value => !/^(javascript|vbscript|data):/i.test(value)), 'No dangerous scheme remains in any SVG href or xlink:href');
    assert.equal(diagramChecks.callbackCalls, 0, 'The flowchart callback DSL cannot invoke a renderer-global function');
    assert.equal(diagramChecks.ranScript, false, 'Clicking an unsafe flowchart link never executes script');
    assert.deepEqual(openedPaths, []);
    assert.deepEqual(openedUrls, []);
    const diagramPageUrl = wc.getURL(), diagramNavigations = [];
    const recordDiagramNavigation = event => { if (event.isMainFrame) diagramNavigations.push(event.url); };
    wc.on('did-start-navigation', recordDiagramNavigation);
    try {
      await js(`(() => {
        const link = document.querySelector('#preview .flowchart-diagram svg a[href="https://lumen-test.invalid/diagram?view=1"]');
        const target = link.querySelector('text') || link.firstElementChild || link;
        target.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
      })()`);
      await poll(async () => openedUrls.length === 1, 'A generated SVG HTTPS link uses native external-link IPC');
      assert.equal(openedUrls.pop(), 'https://lumen-test.invalid/diagram?view=1');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(wc.getURL(), diagramPageUrl, 'A diagram link cannot navigate the app page');
      assert.deepEqual(diagramNavigations, [], 'No main-frame navigation begins from a diagram link');
      assert.deepEqual(openedPaths, [], 'A diagram HTTPS link does not open a local app');
      assert.equal(await js('window.__feishuUnsafeCallbackCalls'), 0);
      assert.equal(await js('window.__diagramUnsafe'), false);
    } finally { wc.removeListener('did-start-navigation', recordDiagramNavigation); }
    assert.deepEqual(openedUrls, [], 'The expected diagram mock-shell call has been consumed');
    console.log('PASS: generated flowchart SVG blocks javascript links and callbacks; allowed HTTPS clicks use mock-shell IPC without page navigation');

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

    const imageTab = (await state()).tabs.find(tab => tab.name === path.basename(imageDoc));
    await select(imageTab.id);
    await setEncoding('gbk');
    await saved();
    const closedImage = (await documentStorage()).documents.find(document => document.id === imageTab.id);
    await closeDocument(imageTab.id);
    await saved();
    const finalState = await state();
    fs.writeFileSync(path.join(profile, 'expected.json'), JSON.stringify({ tabCount:finalState.tabs.length, activeId:await activeId(), content:finalState.content, firstId, firstContent, closedImage }));
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
