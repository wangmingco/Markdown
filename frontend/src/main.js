import marked from './marked-config.js';
import DOMPurify from 'dompurify';
import { openExport } from './export.js';

// MathJax config must be set before the library loads
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
  svg: { fontCache: 'global' },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'], processEscapes: true },
};

async function loadMathJax() {
  if (window.MathJax.typesetPromise) return;
  await import('mathjax/es5/tex-svg.js');
}

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const wordCount = document.getElementById('wordCount');

// ---------- Tabs ----------
let tabs = [];
let activeTabId = null;
let untitledCounter = 0;
let tabSeq = 0;
let applyingHistory = false;

function currentTab() {
  return tabs.find(t => t.id === activeTabId);
}

function makeTab(title, content, path = null) {
  return {
    id: 'tab-' + (++tabSeq),
    title,
    path,
    content,
    cursor: 0,
    dirty: false,
    history: [],
    historyIndex: -1,
    canCoalesce: false,
    lastChangeTime: 0,
  };
}

function saveActiveState() {
  const tab = currentTab();
  if (!tab) return;
  tab.content = editor.value;
  tab.cursor = editor.selectionStart;
}

function loadEditorFromTab(tab) {
  editor.value = tab.content;
  applyingHistory = true;
  const pos = Math.min(tab.cursor || 0, tab.content.length);
  editor.setSelectionRange(pos, pos);
  applyingHistory = false;
  render();
  renderTabBar();
}

function addTab(tab) {
  saveActiveState();
  tabs.push(tab);
  activeTabId = tab.id;
  loadEditorFromTab(tab);
  tab.history = [getState()];
  tab.historyIndex = 0;
}

function switchTo(id) {
  if (id === activeTabId) return;
  saveActiveState();
  activeTabId = id;
  loadEditorFromTab(currentTab());
}

function openFileInTab(path, content) {
  const name = path.split(/[\\/]/).pop();
  const tab = currentTab();
  const reusable = tab && !tab.dirty && !tab.path;
  if (reusable) {
    tab.path = path;
    tab.title = name;
    tab.content = content;
    tab.cursor = 0;
    tab.dirty = false;
    tab.history = [{ value: content, start: 0, end: 0 }];
    tab.historyIndex = 0;
    render();
    renderTabBar();
  } else {
    addTab(makeTab(name, content, path));
  }
}

function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (tab.dirty) {
    showSavePrompt(tab);
    return;
  }
  removeTab(id);
}

function removeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    if (next) {
      activeTabId = next.id;
      loadEditorFromTab(next);
    } else {
      activeTabId = null;
      addTab(makeTab('未命名' + (++untitledCounter), ''));
    }
  } else {
    renderTabBar();
  }
}

function renderTabBar() {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.id = tab.id;
    el.title = tab.title;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = (tab.dirty ? '● ' : '') + tab.title;
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = '关闭';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => switchTo(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab.id);
    });

    tabsEl.appendChild(el);
  });
}

async function saveTab(tab) {
  if (!isWails()) { toast('保存功能仅在桌面端可用'); return false; }
  let path = tab.path;
  if (!path) {
    const result = await window.go.main.App.SaveFileDialog(tab.content);
    if (!result || !result.path) return false;
    path = result.path;
    tab.path = path;
    tab.title = path.split(/[\\/]/).pop();
  } else {
    await window.go.main.App.SaveFile(path, tab.content);
  }
  tab.dirty = false;
  toast('已保存：' + tab.title);
  renderTabBar();
  return true;
}

function showSavePrompt(tab) {
  showModal(`「${tab.title}」的内容已修改，是否保存？`, [
    {
      label: '保存',
      primary: true,
      action: async () => {
        const ok = await saveTab(tab);
        if (ok) removeTab(tab.id);
      },
    },
    { label: '不保存', action: () => removeTab(tab.id) },
    { label: '取消', action: () => {} },
  ]);
}

function newDocument() {
  const title = '未命名' + (++untitledCounter);
  addTab(makeTab(title, ''));
  toast('已新建：' + title);
}

// ---------- Undo / Redo history ----------
const HISTORY_LIMIT = 200;

function getState() {
  return {
    value: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
}

function pushSnapshot(force = false) {
  if (applyingHistory) return;
  const tab = currentTab();
  if (!tab) return;
  const state = getState();
  const last = tab.history[tab.historyIndex];
  if (last && last.value === state.value) return;
  tab.dirty = true;
  renderTabBar();
  const now = Date.now();
  const hasRedoBranch = tab.historyIndex < tab.history.length - 1;
  if (!force && !hasRedoBranch && tab.canCoalesce && now - tab.lastChangeTime < 600) {
    tab.history[tab.historyIndex] = state;
  } else {
    tab.history.length = tab.historyIndex + 1;
    tab.history.push(state);
    if (tab.history.length > HISTORY_LIMIT) tab.history.shift();
    tab.historyIndex = tab.history.length - 1;
    tab.canCoalesce = !force;
  }
  tab.lastChangeTime = now;
}

function applySnapshot(index) {
  applyingHistory = true;
  const tab = currentTab();
  if (!tab) { applyingHistory = false; return; }
  const s = tab.history[index];
  editor.value = s.value;
  editor.setSelectionRange(Math.min(s.start, s.value.length), Math.min(s.end, s.value.length));
  tab.historyIndex = index;
  tab.canCoalesce = false;
  tab.dirty = true;
  render();
  renderTabBar();
  applyingHistory = false;
}

function undo() {
  const tab = currentTab();
  if (!tab || tab.historyIndex <= 0) return;
  applySnapshot(tab.historyIndex - 1);
}

function redo() {
  const tab = currentTab();
  if (!tab || tab.historyIndex >= tab.history.length - 1) return;
  applySnapshot(tab.historyIndex + 1);
}

// ---------- Marked config ----------
// Configured in marked-config.js (shared with export.js).

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
  let text, cursor;
  if (type === 'code') {
    text = `${marker}${selected || '\n'}\n${marker}`;
    cursor = start.length + marker.length + selected.length;
  } else if (selected) {
    text = selected.split('\n').map(l => marker + l).join('\n');
    cursor = start.length + text.length;
  } else {
    text = marker;
    cursor = start.length + text.length;
  }
  const newText = value.slice(0, start.length) + text + value.slice(end.length);
  editor.value = newText;
  setCursor(cursor);
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

// ---------- Export to image (Carbon style) ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  openExport(currentTab()?.title || 'markdown');
});

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

// ---------- Modal ----------
function closeModal() {
  const mask = document.getElementById('modalMask');
  mask.hidden = true;
  document.getElementById('modalInputWrap').hidden = true;
}

function showModal(title, buttons) {
  closeModal();
  const mask = document.getElementById('modalMask');
  document.getElementById('modalTitle').textContent = title;
  const actions = document.getElementById('modalActions');
  actions.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.className = 'modal-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
    btn.addEventListener('click', async () => {
      closeModal();
      if (b.action) await b.action();
    });
    actions.appendChild(btn);
  });
  mask.hidden = false;
}

function showPrompt(title, opts = {}, onConfirm) {
  closeModal();
  const mask = document.getElementById('modalMask');
  const inputWrap = document.getElementById('modalInputWrap');
  const input = document.getElementById('modalInput');
  document.getElementById('modalTitle').textContent = title;
  input.value = opts.defaultValue || '';
  input.placeholder = opts.placeholder || '';
  inputWrap.hidden = false;
  const actions = document.getElementById('modalActions');
  actions.innerHTML = '';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.className = 'modal-btn';
  cancel.addEventListener('click', closeModal);
  const ok = document.createElement('button');
  ok.textContent = opts.confirmLabel || '确定';
  ok.className = 'modal-btn primary';
  ok.addEventListener('click', () => {
    const value = input.value.trim();
    closeModal();
    if (value) onConfirm(value);
  });
  actions.appendChild(cancel);
  actions.appendChild(ok);
  mask.hidden = false;
  input.focus();
  input.select();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
  };
}

document.getElementById('modalMask').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalMask')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const mask = document.getElementById('modalMask');
    if (!mask.hidden) closeModal();
    hideCtxMenu();
  }
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
addTab(makeTab('未命名' + (++untitledCounter), DEFAULT));
loadMathJax().then(() => render());

// ---------- Native file open / save (Wails) ----------
// Wails 注入 window.go 运行时；无 Wails 时（Web 部署）直接隐藏按钮。
// 直接调用 window.go 而非 import 生成的 wailsjs 封装，保证前端可独立构建部署。
const isWails = () => typeof window.go !== 'undefined' && window.go.main && window.go.main.App;
if (!isWails()) {
  document.getElementById('openBtn').style.display = 'none';
  document.getElementById('saveBtn').style.display = 'none';
  document.getElementById('wsBtn').style.display = 'none';
  document.getElementById('addFolderBtn').style.display = 'none';
}

document.getElementById('newBtn').addEventListener('click', () => newDocument());

document.getElementById('openBtn').addEventListener('click', async () => {
  if (!isWails()) { toast('打开功能仅在桌面端可用'); return; }
  const result = await window.go.main.App.OpenFileDialog();
  if (result && result.path) {
    const content = await window.go.main.App.OpenFile(result.path);
    openFileInTab(result.path, content);
    toast('已打开：' + result.path.split(/[\\/]/).pop());
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  if (!isWails()) { toast('保存功能仅在桌面端可用'); return; }
  await saveTab(currentTab());
});

// ---------- Workspace file tree (Wails only) ----------
const wsPanel = document.getElementById('wsPanel');
const wsBody = document.getElementById('wsBody');
const wsRoots = [];      // array of { root, expanded:Set }
const expandedDirs = new Set(); // set of folder paths that are expanded

document.getElementById('wsBtn').addEventListener('click', () => {
  wsPanel.classList.toggle('open');
});

document.getElementById('addFolderBtn').addEventListener('click', async () => {
  if (!isWails()) { toast('工作区功能仅在桌面端可用'); return; }
  const result = await window.go.main.App.OpenFolderDialog();
  if (!result || !result.path) return;
  const tree = await window.go.main.App.ListDirectory(result.path);
  wsRoots.push(tree);
  renderWorkspace();
  toast('已添加文件夹：' + tree.name);
});

function renderWorkspace() {
  wsBody.innerHTML = '';
  if (!wsRoots.length) {
    wsBody.innerHTML = '<div class="empty">工作区为空<br>点击右上角 ＋ 添加文件夹</div>';
    return;
  }
  wsRoots.forEach(tree => wsBody.appendChild(renderTreeItem(tree, 0)));
}

function renderTreeItem(node, depth) {
  const isDir = node.isDir;
  const row = document.createElement('div');
  row.className = 'tree-item ' + (isDir ? 'tree-dir' : 'tree-file');

  const item = document.createElement('div');
  item.className = 'tree-row' + (isDir ? ' folder' : '');
  item.style.paddingLeft = `${8 + depth * 16}px`;
  item.dataset.path = node.path;

  if (isDir) {
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow';
    arrow.textContent = expandedDirs.has(node.path) ? '▾' : '▸';
    item.appendChild(arrow);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    item.appendChild(label);

    item.addEventListener('click', () => {
      if (expandedDirs.has(node.path)) expandedDirs.delete(node.path);
      else expandedDirs.add(node.path);
      renderWorkspace();
    });

    row.appendChild(item);

    if (expandedDirs.has(node.path) && node.children) {
      node.children.forEach(child => row.appendChild(renderTreeItem(child, depth + 1)));
    }
  } else {
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    item.appendChild(label);

    item.addEventListener('click', () => openWorkspaceNode(node));

    row.appendChild(item);
  }

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showNodeMenu(node, e.clientX, e.clientY);
  });

  return row;
}

// ---------- Workspace context menu ----------
let ctxMenu = null;

function hideCtxMenu() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
}

function showCtxMenu(x, y, items) {
  hideCtxMenu();
  ctxMenu = document.createElement('div');
  ctxMenu.className = 'ctx-menu';
  items.forEach(item => {
    if (item === '-') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.danger) btn.className = 'danger';
    btn.addEventListener('click', () => {
      hideCtxMenu();
      item.action();
    });
    ctxMenu.appendChild(btn);
  });
  document.body.appendChild(ctxMenu);
  const rect = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}

document.addEventListener('click', hideCtxMenu);
window.addEventListener('resize', hideCtxMenu);

function showNodeMenu(node, x, y) {
  const items = [];
  if (node.isDir) {
    items.push(
      { label: '新建文件', action: () => createNewFile(node.path) },
      { label: '新建文件夹', action: () => createNewFolder(node.path) },
      '-',
      { label: '复制路径', action: () => copyPath(node.path) },
      '-',
      { label: '删除', danger: true, action: () => deleteNode(node) },
    );
  } else {
    items.push(
      { label: '打开', action: () => openWorkspaceNode(node) },
      '-',
      { label: '复制', action: () => copyNode(node) },
      { label: '复制路径', action: () => copyPath(node.path) },
      '-',
      { label: '删除', danger: true, action: () => deleteNode(node) },
    );
  }
  showCtxMenu(x, y, items);
}

function openWorkspaceNode(node) {
  if (!isWails()) return;
  const ext = node.path.split('.').pop().toLowerCase();
  if (ext !== 'md' && ext !== 'markdown') { toast('仅支持打开 Markdown 文件'); return; }
  return window.go.main.App.OpenFile(node.path)
    .then((content) => {
      openFileInTab(node.path, content);
      wsBody.querySelectorAll('.tree-row.active').forEach(r => r.classList.remove('active'));
      const row = wsBody.querySelector(`.tree-row[data-path="${CSS.escape(node.path)}"]`);
      if (row) row.classList.add('active');
      toast('已打开：' + node.name);
    })
    .catch(() => toast('打开失败'));
}

async function refreshWorkspace() {
  const fresh = [];
  for (const root of wsRoots) {
    try {
      const tree = await window.go.main.App.ListDirectory(root.path);
      if (tree) fresh.push(tree);
    } catch { /* skip */ }
  }
  wsRoots.length = 0;
  wsRoots.push(...fresh);
  renderWorkspace();
}

async function createNewFile(dir) {
  showPrompt('新建文件', { defaultValue: '未命名.md', placeholder: '文件名（无扩展名时自动补 .md）' }, async (name) => {
    const finalName = name.includes('.') ? name : name + '.md';
    try {
      const path = await window.go.main.App.CreateFile(dir, finalName);
      expandedDirs.add(dir);
      await refreshWorkspace();
      openFileInTab(path, '');
      toast('已新建：' + path.split(/[\\/]/).pop());
    } catch {
      toast('创建失败');
    }
  });
}

async function createNewFolder(dir) {
  showPrompt('新建文件夹', { defaultValue: '新建文件夹', placeholder: '文件夹名称' }, async (name) => {
    try {
      const path = await window.go.main.App.CreateFolder(dir, name);
      expandedDirs.add(dir);
      expandedDirs.add(path);
      await refreshWorkspace();
      toast('已新建文件夹：' + path.split(/[\\/]/).pop());
    } catch {
      toast('创建失败');
    }
  });
}

function copyPath(path) {
  navigator.clipboard.writeText(path).then(() => toast('已复制路径'));
}

async function copyNode(node) {
  try {
    const dest = await window.go.main.App.CopyFile(node.path);
    await refreshWorkspace();
    toast('已复制：' + dest.split(/[\\/]/).pop());
  } catch {
    toast('复制失败');
  }
}

function deleteNode(node) {
  showModal(`确定要删除「${node.name}」吗？此操作不可恢复。`, [
    {
      label: '删除',
      primary: true,
      danger: true,
      action: async () => {
        try {
          await window.go.main.App.DeletePath(node.path);
          await refreshWorkspace();
          toast('已删除：' + node.name);
        } catch {
          toast('删除失败');
        }
      },
    },
    { label: '取消', action: () => {} },
  ]);
}

wsBody.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tree-item')) return;
  e.preventDefault();
  if (!wsRoots.length) { toast('请先添加工作区文件夹'); return; }
  if (wsRoots.length > 1) { toast('请在文件夹上右键新建'); return; }
  const root = wsRoots[0];
  showCtxMenu(e.clientX, e.clientY, [
    { label: '新建文件', action: () => createNewFile(root.path) },
    { label: '新建文件夹', action: () => createNewFolder(root.path) },
  ]);
});

wsBody.addEventListener('scroll', hideCtxMenu);

// ---------- Open by double-click (command line arg) ----------
// When the user opens a .md file directly, load it, switch to preview mode
// and show the table of contents.
async function initFromFileArg() {
  if (!isWails()) return;
  let file;
  try {
    file = await window.go.main.App.GetInitialFile();
  } catch {
    return;
  }
  if (!file || !file.path) return;
  const tab = currentTab();
  tab.path = file.path;
  tab.title = file.path.split(/[\\/]/).pop();
  tab.content = file.content;
  tab.cursor = 0;
  tab.dirty = false;
  tab.history = [{ value: file.content, start: 0, end: 0 }];
  tab.historyIndex = 0;
  editor.value = file.content;
  render();
  renderTabBar();
  document.body.className = 'mode-preview';
  document.querySelectorAll('.pv').forEach(b => b.classList.remove('active'));
  const previewBtn = document.querySelector('.pv[data-mode="preview"]');
  if (previewBtn) previewBtn.classList.add('active');
  tocPanel.classList.add('open');
  toast('已打开：' + tab.title);
}

initFromFileArg();
