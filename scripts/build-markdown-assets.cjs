const fs = require('node:fs');
const path = require('node:path');
const browserify = require('browserify');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const modules = path.join(root, 'node_modules');
const copy = (source, destination) => {
  const target = path.join(assets, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(modules, source), target);
};

copy('marked/lib/marked.umd.js', 'marked.umd.js');
copy('dompurify/dist/purify.min.js', 'purify.min.js');
copy('katex/dist/katex.min.js', 'katex/katex.min.js');
copy('katex/dist/katex.min.css', 'katex/katex.min.css');
for (const font of fs.readdirSync(path.join(modules, 'katex/dist/fonts'))) {
  copy(`katex/dist/fonts/${font}`, `katex/fonts/${font}`);
}
for (const [source, destination] of [
  ['marked/LICENSE.md', 'marked-LICENSE.md'],
  ['katex/LICENSE', 'katex-LICENSE.txt'],
  ['dompurify/LICENSE', 'dompurify-LICENSE.txt'],
  ['dompurify/LICENSE-MPL', 'dompurify-LICENSE-MPL.txt'],
  ['highlight.js/LICENSE', 'highlight-LICENSE.txt']
]) copy(source, `vendor-licenses/${destination}`);

browserify(path.join(modules, 'highlight.js/lib/common.js'), { standalone: 'hljs' }).bundle((error, buffer) => {
  if (error) { console.error(error.message); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(assets, 'highlight.js'), buffer);
  console.log('Offline Markdown rendering assets updated.');
});
