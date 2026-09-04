import marked from './marked-config.js';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import 'highlight.js/styles/atom-one-dark.css';
import { toPng } from 'html-to-image';

hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);

const editor = document.getElementById('editor');
const exportMask = document.getElementById('exportMask');
const stage = document.getElementById('exportStage');
const scaler = document.getElementById('exportScaler');

const LANG_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby', go: 'Go', rust: 'Rust',
  json: 'JSON', html: 'HTML', xml: 'XML', svg: 'SVG', css: 'CSS', scss: 'SCSS', less: 'LESS',
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', ps1: 'PowerShell', java: 'Java', c: 'C',
  cpp: 'C++', h: 'C', cs: 'C#', kt: 'Kotlin', kotlin: 'Kotlin', swift: 'Swift',
  sql: 'SQL', md: 'Markdown', markdown: 'Markdown', yml: 'YAML', yaml: 'YAML',
  ini: 'INI', toml: 'TOML', dockerfile: 'Docker', diff: 'Diff', graphql: 'GraphQL',
  lua: 'Lua', perl: 'Perl', php: 'PHP', r: 'R', dart: 'Dart', scala: 'Scala',
  vb: 'VB.NET', elixir: 'Elixir', clojure: 'Clojure', haskell: 'Haskell', julia: 'Julia',
  txt: 'Text', text: 'Text', '': 'Text',
};

const THEMES = [
  { name: '炭黑', bg: 'linear-gradient(160deg, #111114 0%, #1d1d24 55%, #2a2a33 100%)' },
  { name: '夜空', bg: 'linear-gradient(160deg, #0f2027 0%, #203a43 55%, #2c5364 100%)' },
  { name: '紫罗兰', bg: 'linear-gradient(160deg, #1b0a3a 0%, #5527a6 60%, #7a5cff 100%)' },
  { name: '极光', bg: 'linear-gradient(160deg, #0f4c3a 0%, #1d976c 55%, #93f9b9 100%)' },
  { name: '海洋', bg: 'linear-gradient(160deg, #0b3a53 0%, #2193b0 55%, #6dd5ed 100%)' },
  { name: '晚霞', bg: 'linear-gradient(160deg, #5f0a42 0%, #c31432 55%, #ff7e5f 100%)' },
  { name: '蜜桃', bg: 'linear-gradient(160deg, #7a3d1d 0%, #f6a954 55%, #ffd194 100%)' },
  { name: '森林', bg: 'linear-gradient(160deg, #12310d 0%, #3e8e3f 55%, #a8e063 100%)' },
];

const CARD_WIDTH = 680;
let themeIdx = 0;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---------- Source extraction ----------
function extractCodeBlocks(md) {
  const blocks = [];
  const re = /```([^\n]*)\r?\n([\s\S]*?)(?:```|$)/g;
  let m;
  while ((m = re.exec(md))) {
    const code = m[2].replace(/\r\n/g, '\n').replace(/\n+$/, '');
    if (code.trim() !== '') {
      blocks.push({ lang: m[1].trim(), code, start: m.index, end: m.index + m[0].length });
    }
  }
  return blocks;
}

function highlightCode(code, lang) {
  const escape = (s) => escapeHtml(s);
  if (!lang) {
    try { return hljs.highlightAuto(code).value; } catch { return escape(code); }
  }
  const language = hljs.getLanguage(lang) ? lang : 'plaintext';
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escape(code);
  }
}

// ---------- Card builders ----------
function buildCodeCard({ code, lang, title, theme, lineNumbers, chrome }) {
  const card = document.createElement('div');
  card.className = 'carbon-card';
  card.style.width = CARD_WIDTH + 'px';
  card.style.background = theme.bg;

  const win = document.createElement('div');
  win.className = 'carbon-window';

  if (chrome) {
    const bar = document.createElement('div');
    bar.className = 'carbon-bar';
    const dots = document.createElement('span');
    dots.className = 'carbon-dots';
    dots.innerHTML = '<i></i><i></i><i></i>';
    const fname = document.createElement('span');
    fname.className = 'carbon-fname';
    fname.textContent = title;
    const langEl = document.createElement('span');
    langEl.className = 'carbon-lang';
    langEl.textContent = LANG_LABELS[lang] || lang || '代码';
    bar.appendChild(dots);
    bar.appendChild(fname);
    bar.appendChild(langEl);
    win.appendChild(bar);
  }

  const body = document.createElement('div');
  body.className = 'carbon-body';

  if (lineNumbers) {
    const nums = document.createElement('pre');
    nums.className = 'carbon-lines';
    const count = code.split('\n').length;
    nums.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    body.appendChild(nums);
  }

  const pre = document.createElement('pre');
  pre.className = 'carbon-code';
  const codeEl = document.createElement('code');
  codeEl.className = 'hljs';
  codeEl.innerHTML = highlightCode(code, lang);
  pre.appendChild(codeEl);
  body.appendChild(pre);

  win.appendChild(body);
  card.appendChild(win);
  return card;
}

function buildMdCard({ md, title, theme, chrome }) {
  const html = DOMPurify.sanitize(marked.parse(md), { USE_PROFILES: { html: true } });

  const card = document.createElement('div');
  card.className = 'carbon-card';
  card.style.width = CARD_WIDTH + 'px';
  card.style.background = theme.bg;

  const win = document.createElement('div');
  win.className = 'md-window';

  if (chrome) {
    const bar = document.createElement('div');
    bar.className = 'carbon-bar';
    const dots = document.createElement('span');
    dots.className = 'carbon-dots';
    dots.innerHTML = '<i></i><i></i><i></i>';
    const fname = document.createElement('span');
    fname.className = 'carbon-fname';
    fname.textContent = title;
    bar.appendChild(dots);
    bar.appendChild(fname);
    win.appendChild(bar);
  }

  const body = document.createElement('div');
  body.className = 'md-body';
  body.innerHTML = html;
  win.appendChild(body);
  card.appendChild(win);
  return card;
}

// ---------- Preview ----------
function currentCard() {
  const src = document.getElementById('exportSource').value;
  const theme = THEMES[themeIdx];
  const chrome = document.getElementById('exportChrome').checked;
  const title = document.getElementById('exportTitleInput').value.trim() || '未命名';

  if (src === 'markdown') {
    return buildMdCard({ md: editor.value, title, theme, chrome });
  }

  let code, lang;
  if (src === 'selection') {
    code = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (!code.trim()) { toast('请先在编辑器中选中内容'); return null; }
    lang = '';
  } else {
    const blocks = extractCodeBlocks(editor.value);
    const idx = parseInt(document.getElementById('exportBlock').value, 10);
    const block = blocks[idx];
    if (!block) { toast('未找到代码块'); return null; }
    code = block.code;
    lang = block.lang;
  }
  const lineNumbers = document.getElementById('exportLineNum').checked;
  return buildCodeCard({ code, lang, title, theme, lineNumbers, chrome });
}

function renderPreview() {
  const card = currentCard();
  scaler.innerHTML = '';
  if (!card) return;
  scaler.appendChild(card);

  const finish = () => {
    const cardW = card.offsetWidth || CARD_WIDTH;
    const cardH = card.offsetHeight || 200;
    const avail = stage.clientWidth - 40;
    const scale = Math.min(1, avail / cardW);
    scaler.style.width = Math.round(cardW * scale) + 'px';
    scaler.style.height = Math.round(cardH * scale) + 'px';
    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = 'top left';
  };

  const src = document.getElementById('exportSource').value;
  if (src === 'markdown' && window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([card]).catch(() => {}).then(finish);
  } else {
    requestAnimationFrame(finish);
  }
}

// ---------- Export ----------
async function exportPng() {
  const card = scaler.firstElementChild;
  if (!card) return;
  const btn = document.getElementById('exportDownload');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '生成中…';
  try {
    if (window.MathJax && window.MathJax.typesetPromise) {
      try { await window.MathJax.typesetPromise([card]); } catch { /* ignore */ }
    }
    await document.fonts.ready;
    const dataUrl = await toPng(card, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: 'transparent',
      embedFonts: true,
    });
    const title = (document.getElementById('exportTitleInput').value.trim() || 'markdown')
      .replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.download = title + '.png';
    a.href = dataUrl;
    a.click();
    toast('图片已导出');
  } catch (e) {
    console.error(e);
    toast('导出失败，请重试');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------- Controls ----------
function updateSourceVisibility() {
  const src = document.getElementById('exportSource').value;
  document.getElementById('exportBlockWrap').style.display = src === 'code' ? '' : 'none';
  document.getElementById('exportLineNumWrap').style.display = src === 'markdown' ? 'none' : '';
  document.getElementById('exportMdNote').style.display = src === 'markdown' ? '' : 'none';
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  grid.innerHTML = '';
  THEMES.forEach((t, i) => {
    const sw = document.createElement('div');
    sw.className = 'theme-swatch' + (i === themeIdx ? ' active' : '');
    sw.title = t.name;
    sw.style.background = t.bg;
    sw.addEventListener('click', () => {
      themeIdx = i;
      grid.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      renderPreview();
    });
    grid.appendChild(sw);
  });
}

function showExport() {
  exportMask.hidden = false;
  renderPreview();
}

function hideExport() {
  exportMask.hidden = true;
}

// ---------- Public ----------
export function openExport(title) {
  const md = editor.value;
  const blocks = extractCodeBlocks(md);

  const srcSel = document.getElementById('exportSource');
  const blockSel = document.getElementById('exportBlock');
  blockSel.options.length = 0;

  let curIdx = 0;
  if (blocks.length) {
    blocks.forEach((b, i) => {
      blockSel.add(new Option(`代码块 ${i + 1} · ${LANG_LABELS[b.lang] || b.lang || '文本'}`, String(i)));
    });
    const cursor = editor.selectionStart;
    const found = blocks.findIndex(b => cursor >= b.start && cursor <= b.end);
    if (found >= 0) curIdx = found;
    blockSel.value = String(curIdx);
  }

  const hasSelection = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  let defaultSrc = 'markdown';
  if (hasSelection) defaultSrc = 'selection';
  else if (blocks.length) defaultSrc = 'code';
  srcSel.value = defaultSrc;

  document.getElementById('exportTitleInput').value = (title || '').replace(/^●\s*/, '');
  updateSourceVisibility();
  renderThemeGrid();
  showExport();
}

// ---------- Wiring ----------
document.getElementById('exportSource').addEventListener('change', () => {
  updateSourceVisibility();
  renderPreview();
});
document.getElementById('exportBlock').addEventListener('change', renderPreview);
document.getElementById('exportLineNum').addEventListener('change', renderPreview);
document.getElementById('exportChrome').addEventListener('change', renderPreview);
document.getElementById('exportTitleInput').addEventListener('input', renderPreview);
document.getElementById('exportDownload').addEventListener('click', exportPng);
document.getElementById('exportClose').addEventListener('click', hideExport);

exportMask.addEventListener('click', (e) => {
  if (e.target === exportMask) hideExport();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportMask.hidden) hideExport();
});