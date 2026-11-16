// Builds the offline manual (HTML, CSS, JS: no inline script, the app's CSP forbids it) and the machine-readable help index for the AI guide.
//   node tools/release-candidate-01/build-manual.mjs [outDir]      (default: desktop-dist/manual)
// Source of truth: docs/manual/user-manual.md. Output: <outDir>/index.html + manual.css + manual.js, and src/capabilities/helpIndex.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'desktop-dist/manual'));
const md = fs.readFileSync(path.join(ROOT, 'docs/manual/user-manual.md'), 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
const slug = (s) => s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sections = []; let cur = null, title = 'User manual', html = '', list = null;
const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
const open = (h) => { cur = { id: slug(h), title: h, text: [] }; sections.push(cur); };
for (const raw of md.split('\n')) {
  const line = raw.trimEnd();
  let m;
  if ((m = /^# (.+)$/.exec(line))) { flushList(); title = m[1]; continue; }
  if ((m = /^## (.+)$/.exec(line))) { flushList(); if (cur) html += '</section>'; open(m[1]); html += `<section id="${cur.id}" data-title="${esc(m[1])}"><h2>${inline(m[1])}</h2>`; continue; }
  if ((m = /^### (.+)$/.exec(line))) { flushList(); html += `<h3>${inline(m[1])}</h3>`; cur?.text.push(m[1]); continue; }
  if ((m = /^- (.+)$/.exec(line))) { if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; cur?.text.push(m[1]); continue; }
  if ((m = /^\d+\. (.+)$/.exec(line))) { if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; cur?.text.push(m[1]); continue; }
  if ((m = /^> (.+)$/.exec(line))) { flushList(); html += `<p class="note">${inline(m[1])}</p>`; cur?.text.push(m[1]); continue; }
  if (line === '') { flushList(); continue; }
  flushList(); html += `<p>${inline(line)}</p>`; cur?.text.push(line);
}
flushList(); if (cur) html += '</section>';

const toc = sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="manual.css"></head>
<body><nav id="toc" aria-label="Contents"><h1>${esc(title)}</h1><input id="q" type="search" placeholder="Search the manual…" aria-label="Search the manual"><ol>${toc}</ol></nav>
<main id="content">${html}<p id="none" hidden>No sections match the search.</p></main><script src="manual.js"></script></body></html>`;
const css = `html{scroll-behavior:smooth}body{margin:0;display:flex;font:16px/1.55 system-ui,"Segoe UI",sans-serif;background:#14181d;color:#e8eaed}
#toc{position:sticky;top:0;align-self:flex-start;height:100vh;overflow:auto;width:19rem;padding:14px 16px;box-sizing:border-box;background:#1b2128;border-right:1px solid #38434e}
#toc h1{font-size:1.15rem;margin:.2rem 0 .6rem}#toc ol{padding-left:1.2rem;margin:.6rem 0}#toc a{color:#9fd0ff;text-decoration:none}#toc a:hover{text-decoration:underline}
#q{width:100%;box-sizing:border-box;padding:6px 8px;font-size:1rem;border-radius:5px;border:1px solid #556;background:#0f1317;color:#fff}
#content{max-width:48rem;padding:18px 32px 80px}section{margin-bottom:2rem}h2{font-size:1.5rem;border-bottom:1px solid #38434e;padding-bottom:.25rem;margin-top:2rem}h3{font-size:1.15rem;margin:1.4rem 0 .4rem;color:#ffd27a}
code{background:#242c35;padding:1px 5px;border-radius:4px;font-size:.92em}strong{color:#fff}.note{background:#2a2f1f;border-left:4px solid #ffbf53;padding:8px 12px;border-radius:4px}li{margin:.25rem 0}
mark{background:#ffbf53;color:#000}@media(max-width:800px){body{display:block}#toc{position:static;width:auto;height:auto}#content{padding:14px}}`;
const js = `(function(){var q=document.getElementById('q'),secs=[].slice.call(document.querySelectorAll('section')),none=document.getElementById('none'),items=[].slice.call(document.querySelectorAll('#toc li'));
q.addEventListener('input',function(){var t=q.value.trim().toLowerCase(),shown=0;secs.forEach(function(s,i){var hit=!t||s.textContent.toLowerCase().indexOf(t)>=0;s.hidden=!hit;items[i].hidden=!hit;if(hit)shown++;});none.hidden=shown>0;});})();`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page); fs.writeFileSync(path.join(OUT, 'manual.css'), css); fs.writeFileSync(path.join(OUT, 'manual.js'), js);

// The AI guide reads the same text: short, searchable sections (the model asks for what it needs; nothing here is a promise about features that are not in the manual).
const index = sections.map((s) => ({ id: s.id, title: s.title, text: s.text.join(' ').replace(/\*\*|`/g, '').slice(0, 1400) }));
fs.writeFileSync(path.join(ROOT, 'src/capabilities/helpIndex.json'), JSON.stringify({ source: 'docs/manual/user-manual.md', sections: index }, null, 1) + '\n');
console.log(`manual: ${sections.length} sections -> ${OUT}`);
