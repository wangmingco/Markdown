import { marked } from 'marked';
import DOMPurify from 'dompurify';

// MathJax config must be set before the library loads
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
  svg: { fontCache: 'global' },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] },
};

async function loadMathJax() {
  if (window.MathJax.typesetPromise) return;
  await import('mathjax/es5/tex-svg.js');
}

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const wordCount = document.getElementById('wordCount');

// ---------- Undo / Redo history ----------
const HISTORY_LIMIT = 200;
const history = [];      // snapshots: { value, start, end }
let historyIndex = 0;    // current snapshot
let lastChangeTime = 0;
let applyingHistory = false;
let canCoalesce = false; // whether the current entry may absorb rapid typing

function getState() {
  return {
    value: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
}

function pushSnapshot(force = false) {
  if (applyingHistory) return;
  const state = getState();
  const last = history[historyIndex];
  if (last && last.value === state.value) return;
  const now = Date.now();
  const hasRedoBranch = historyIndex < history.length - 1;
  if (!force && !hasRedoBranch && canCoalesce && now - lastChangeTime < 600) {
    history[historyIndex] = state;
  } else {
    history.length = historyIndex + 1;
    history.push(state);
    if (history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length - 1;
    canCoalesce = !force;
  }
  lastChangeTime = now;
}

function applySnapshot(index) {
  applyingHistory = true;
  const s = history[index];
  editor.value = s.value;
  editor.setSelectionRange(Math.min(s.start, s.value.length), Math.min(s.end, s.value.length));
  historyIndex = index;
  canCoalesce = false;
  render();
  applyingHistory = false;
}

function undo() {
  if (historyIndex <= 0) return;
  applySnapshot(historyIndex - 1);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  applySnapshot(historyIndex + 1);
}

// ---------- Marked config ----------
marked.setOptions({
  gfm: true,
  breaks: true,
});

function render() {
  const html = marked.parse(editor.value);
  preview.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([preview]).catch(() => {});
  }
  updateCount();
  renderTOC();
  observeHeadings();
}

function updateCount() {
  const text = editor.value.trim();
  const chars = text.length;
  const words = text ? text.replace(/[\s\u3000]+/g, '').length : 0;
  wordCount.textContent = words ? `${words} 字` : '0 字';
}

// ---------- Default content ----------
const DEFAULT = `# MarkdownAK

一个**极简**而*优雅*的 Markdown 编辑器。

## 特性

- [x] 实时预览
- [x] 多种导出格式
- [x] 一键生成目录
- [x] 暗色主题

## 语法速览

### 文字

**粗体** · *斜体* · ~~删除线~~ · \`行内代码\`

### 引用

> 简洁是终极的精致。
> —— 达·芬奇

### 列表

1. 有序列表项
2. 有序列表项

### 表格

| 功能 | 快捷键 | 说明 |
| ---- | :---: | :--- |
| 粗体 | Ctrl+B | 加粗选中文字 |
| 斜体 | Ctrl+I | 倾斜选中文字 |
| 链接 | Ctrl+K | 插入链接 |

### 代码

\`\`\`javascript
// 一段示例代码
function greet(name) {
  return \`你好, \${name}!\`;
}
\`\`\`

### 数学公式

行内公式 $E=mc^2$，以及块级公式：

$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$

> 尝试点击上方工具栏，或编辑左侧文字，预览会实时更新。
`;

// ---------- TOC ----------
const tocPanel = document.getElementById('tocPanel');
const tocBody = document.getElementById('tocBody');

function renderTOC() {
  const headings = preview.querySelectorAll('h1, h2, h3');
  tocBody.innerHTML = '';
  if (!headings.length) {
    tocBody.innerHTML = '<div class="empty">暂无标题</div>';
    return;
  }
  headings.forEach((h, i) => {
    if (!h.id) h.id = `h-${i}`;
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.className = `lvl-${parseInt(h.tagName[1], 10)}`;
    a.textContent = h.textContent;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    tocBody.appendChild(a);
  });
}

// scroll spy
const observer = new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (en.isIntersecting) {
      tocBody.querySelectorAll('a').forEach(a => a.classList.remove('active'));
      const link = tocBody.querySelector(`a[href="#${en.target.id}"]`);
      if (link) link.classList.add('active');
    }
  });
}, { root: preview, rootMargin: '-10% 0px -80% 0px' });

function observeHeadings() {
  observer.disconnect();
  preview.querySelectorAll('h1,h2,h3').forEach(h => observer.observe(h));
}

// ---------- Toolbar commands ----------
const commands = {
  bold: () => wrap('**'),
  italic: () => wrap('*'),
  strike: () => wrap('~~'),
  code: () => wrap('`'),
  h1: () => heading(1),
  h2: () => heading(2),
  h3: () => heading(3),
  quote: () => block('> '),
  ul: () => block('- '),
  ol: () => block('1. '),
  task: () => block('- [ ] '),
  link: () => wrapLink('[]()'),
  image: () => wrapLink('![]()'),
  codeblock: () => block('```\n\n```', false, 'code'),
  table: () => {
    insert('\n| 列一 | 列二 |\n| ---- | ---- |\n| 内容 | 内容 |\n');
  },
};

function wrap(marker) {
  const { start, end, value, selected } = getSelection();
  const newText = `${start}${marker}${selected}${marker}${end}`;
  editor.value = value.slice(0, start.length) + newText + value.slice(end);
  setCursor(start.length + marker.length, start.length + marker.length + selected.length);
  pushSnapshot(true);
  render();
}

function wrapLink(template) {
  const { start, end, value, selected } = getSelection();
  const inner = selected || '链接文字';
  const text = template.replace('[]', `[${inner}]`);
  const newText = `${start}${text}${end}`;
  editor.value = value.slice(0, start.length) + newText + value.slice(end);
  setCursor(start.length + text.length - 1);
  pushSnapshot(true);
  render();
}

function heading(level) {
  const marker = '#'.repeat(level) + ' ';
  const { start, end, value, selected } = getSelection();
  const lineStart = value.lastIndexOf('\n', start.length - 1) + 1;
  const lineEnd = value.indexOf('\n', end.length);
  const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
  const stripped = line.replace(/^#{1,6}\s*/, '');
  const prefix = value.slice(0, lineStart);
  const suffix = lineEnd === -1 ? '' : value.slice(lineEnd);
  editor.value = prefix + marker + stripped + suffix;
  setCursor(lineStart + marker.length);
  pushSnapshot(true);
  render();
}

function block(marker, insertAtLine = true, type = '') {
  const { start, end, value, selected } = getSelection();
  let text;
  if (type === 'code') {
    text = `${marker}${selected || '\n'}\n${marker}`;
  } else if (selected) {
    text = selected.split('\n').map(l => marker + l).join('\n');
  } else {
    text = marker;
  }
  const newText = value.slice(0, start.length) + text + value.slice(end.length);
  editor.value = newText;
  setCursor(start.length + text.length);
  pushSnapshot(true);
  render();
}

function getSelection() {
  const start = editor.value.slice(0, editor.selectionStart);
  const end = editor.value.slice(editor.selectionEnd);
  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  return { start, end, value: editor.value, selected };
}

function setCursor(from, to = from) {
  editor.focus();
  editor.setSelectionRange(from, to);
}

function insert(text) {
  const { start, end, value } = getSelection();
  editor.value = value.slice(0, start.length) + text + value.slice(end.length);
  setCursor(start.length + text.length);
  pushSnapshot(true);
  render();
}

// toolbar click
document.getElementById('toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tool');
  if (!btn || !btn.dataset.cmd) return;
  const cmd = commands[btn.dataset.cmd];
  if (cmd) cmd();
});

// keyboard shortcuts
editor.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && key === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.shiftKey && key === 'z') { e.preventDefault(); redo(); }
  else if (mod && key === 'b') { e.preventDefault(); commands.bold(); }
  else if (mod && key === 'i') { e.preventDefault(); commands.italic(); }
  else if (mod && key === 'k') { e.preventDefault(); commands.link(); }
});

// live render + record typing history
editor.addEventListener('input', () => {
  pushSnapshot();
  render();
});

// tab key
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    insert('  ');
  }
});

// ---------- Resizer ----------
const resizer = document.getElementById('resizer');
let dragging = false;

resizer.addEventListener('mousedown', (e) => {
  dragging = true;
  resizer.classList.add('active');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = document.querySelector('.workspace').getBoundingClientRect();
  const rel = e.clientX - rect.left;
  const pct = Math.min(75, Math.max(25, (rel / rect.width) * 100));
  document.documentElement.style.setProperty('--preview-w', `${pct}%`);
});
window.addEventListener('mouseup', () => {
  dragging = false;
  resizer.classList.remove('active');
});

// ---------- View modes ----------
const pvButtons = document.querySelectorAll('.pv');
pvButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    pvButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.body.className = `mode-${btn.dataset.mode}`;
  });
});

// ---------- TOC toggle ----------
document.getElementById('tocBtn').addEventListener('click', () => tocPanel.classList.toggle('open'));
document.getElementById('tocClose').addEventListener('click', () => tocPanel.classList.remove('open'));

// ---------- Copy ----------
document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(editor.value).then(() => toast('已复制 Markdown'));
});

document.getElementById('htmlBtn').addEventListener('click', () => {
  const { start, end, value } = getSelection();
  const sel = value.slice(start.length, end.length) || editor.value;
  const html = DOMPurify.sanitize(marked.parse(sel));
  const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Markdown</title></head><body>${html}</body></html>`;
  navigator.clipboard.writeText(full).then(() => toast('已复制 HTML'));
});

// ---------- Print / PDF ----------
document.getElementById('printBtn').addEventListener('click', () => window.print());

// ---------- Theme ----------
const themeBtn = document.getElementById('themeBtn');
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '☀' : '☾';
  localStorage.setItem('md-theme', t);
}
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
});
setTheme(localStorage.getItem('md-theme') || 'light');

// ---------- Templates ----------
const templates = {
  基础语法: `# 一级标题\n## 二级标题\n### 三级标题\n\n**粗体** *斜体* ~~删除线~~ \`代码\`\n\n> 引用内容\n\n- 无序列表\n- 无序列表\n\n1. 有序列表\n2. 有序列表\n\n| 表格 | 列二 |\n| ---- | ---- |\n| 内容 | 内容 |`,
  论文排版: `# 论文标题\n\n> 作者：XXX\n\n## 摘要\n\n这里是摘要内容……\n\n## 1. 引言\n\n研究背景与意义。\n\n## 2. 相关工作\n\n介绍相关工作。\n\n## 3. 方法\n\n### 3.1 方法一\n\n### 3.2 方法二\n\n## 4. 实验结果\n\n## 5. 结论\n\n## 参考文献\n\n[1] 参考文献一。\n[2] 参考文献二。`,
  待办清单: `# 今日待办\n\n## 工作\n\n- [ ] 完成任务 A\n- [x] 完成任务 B\n- [ ] 编写周报\n\n## 生活\n\n- [ ] 买菜\n- [x] 健身\n\n## 备注\n\n> 保持专注，逐项完成。`,
  代码文档: `# 项目文档\n\n## 安装\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## 快速开始\n\n\`\`\`javascript\nimport { app } from './app';\n\napp.start();\n\`\`\`\n\n## API\n\n| 方法 | 说明 |\n| ---- | ---- |\n| start() | 启动应用 |\n| stop() | 停止应用 |`,
};

const templateBtn = document.getElementById('templateBtn');
templateBtn.addEventListener('click', (e) => {
  const existing = document.querySelector('.template-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'template-menu';
  Object.entries(templates).forEach(([name, content]) => {
    const item = document.createElement('button');
    item.textContent = name;
    item.addEventListener('click', () => {
      editor.value = content.trim();
      pushSnapshot(true);
      render();
      menu.remove();
      toast(`已加载模板：${name}`);
    });
    menu.appendChild(item);
  });
  const rect = templateBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.position = 'fixed';
  document.body.appendChild(menu);
});

document.addEventListener('click', (e) => {
  const menu = document.querySelector('.template-menu');
  if (menu && !menu.contains(e.target) && e.target !== templateBtn) menu.remove();
});

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---------- Init ----------
editor.value = DEFAULT;
render();
observeHeadings();
history.push(getState());
historyIndex = 0;
loadMathJax().then(() => render());

// ---------- Native file open / save (Wails) ----------
// Wails 注入 window.go 运行时；无 Wails 时（Web 部署）直接隐藏按钮。
// 直接调用 window.go 而非 import 生成的 wailsjs 封装，保证前端可独立构建部署。
const isWails = () => typeof window.go !== 'undefined' && window.go.main && window.go.main.App;
if (!isWails()) {
  document.getElementById('openBtn').style.display = 'none';
  document.getElementById('saveBtn').style.display = 'none';
}

document.getElementById('openBtn').addEventListener('click', async () => {
  if (!isWails()) { toast('打开功能仅在桌面端可用'); return; }
  const result = await window.go.main.App.OpenFileDialog();
  if (result && result.path) {
    const content = await window.go.main.App.OpenFile(result.path);
    editor.value = content;
    pushSnapshot(true);
    render();
    toast('已打开：' + result.path.split(/[\\/]/).pop());
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  if (!isWails()) { toast('保存功能仅在桌面端可用'); return; }
  const result = await window.go.main.App.SaveFileDialog(editor.value);
  if (result && result.path) {
    toast('已保存：' + result.path.split(/[\\/]/).pop());
  }
});
