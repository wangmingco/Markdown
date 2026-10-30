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
const editorMirror = document.getElementById('editorMirror');

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
    diskModTime: 0,
    diskSize: 0,
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
    loadEditorFromTab(tab);
  } else {
    addTab(makeTab(name, content, path));
  }
  if (path) syncDiskState(currentTab());
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
  await syncDiskState(tab);
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

// ---------- External file change detection ----------
const CHANGE_POLL_MS = 2000;
const checkingTabs = new Set();
let changePollTimer = null;

async function statFile(path) {
  if (!isWails() || !path) return null;
  try {
    return await window.go.main.App.StatFile(path);
  } catch {
    return null;
  }
}

async function syncDiskState(tab) {
  if (!tab || !tab.path) return;
  const meta = await statFile(tab.path);
  if (meta && meta.exists) {
    tab.diskModTime = meta.modTime;
    tab.diskSize = meta.size;
  }
}

function applyExternalContent(tab, content) {
  const pos = tab.id === activeTabId ? editor.selectionStart : (tab.cursor || 0);
  tab.content = content;
  tab.cursor = Math.min(pos, content.length);
  tab.dirty = false;
  tab.canCoalesce = false;
  tab.history = [{ value: content, start: tab.cursor, end: tab.cursor }];
  tab.historyIndex = 0;
  if (tab.id === activeTabId) loadEditorFromTab(tab);
  else renderTabBar();
  syncDiskState(tab);
}

function promptExternalChange(tab) {
  const note = tab.dirty ? '当前有未保存的修改，更新后将被覆盖。' : '';
  showModal(`「${tab.title}」的文件内容已在外部更新，是否加载最新内容？${note ? ' ' + note : ''}`, [
    {
      label: '更新',
      primary: true,
      action: async () => {
        try {
          const content = await window.go.main.App.OpenFile(tab.path);
          applyExternalContent(tab, content);
          toast('已更新：' + tab.title);
        } catch {
          toast('更新失败');
        }
      },
    },
    { label: '忽略', action: () => {} },
  ]);
}

async function checkTabForExternalChange(tab) {
  if (!tab.path || checkingTabs.has(tab.id)) return;
  checkingTabs.add(tab.id);
  try {
    const meta = await statFile(tab.path);
    if (meta && meta.exists && tab.diskModTime &&
        (meta.modTime !== tab.diskModTime || meta.size !== tab.diskSize)) {
      tab.diskModTime = meta.modTime;
      tab.diskSize = meta.size;
      promptExternalChange(tab);
    }
  } finally {
    checkingTabs.delete(tab.id);
  }
}

function checkExternalChanges() {
  if (!isWails()) return;
  tabs.forEach(checkTabForExternalChange);
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
  updateFindHighlights();
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

function setMode(mode) {
  document.body.className = `mode-${mode}`;
  pvButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

pvButtons.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
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
    if (!mask.hidden) { closeModal(); return; }
    hideCtxMenu();
    if (!findBar.hidden) closeFind();
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

// ---------- Find / Replace ----------
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const replaceInput = document.getElementById('replaceInput');
const replaceRow = document.getElementById('findReplaceRow');
const findCount = document.getElementById('findCount');
const findCaseBtn = document.getElementById('findCase');
const findToggleReplace = document.getElementById('findToggleReplace');

const findState = { query: '', caseSensitive: false, matches: [], index: -1, value: '' };
const FIND_LIMIT = 5000;

function findMatches() {
  const query = findState.query;
  const out = [];
  if (!query) return out;
  const haystack = findState.caseSensitive ? editor.value : editor.value.toLowerCase();
  const needle = findState.caseSensitive ? query : query.toLowerCase();
  if (!needle) return out;
  let from = 0;
  while (out.length < FIND_LIMIT) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    out.push({ start: at, end: at + query.length });
    from = at + needle.length;
  }
  return out;
}

function refreshFind() {
  findState.matches = findMatches();
  findState.value = editor.value;
  if (!findState.matches.length) findState.index = -1;
  else if (findState.index < 0) findState.index = 0;
  else if (findState.index >= findState.matches.length) findState.index = findState.matches.length - 1;
  updateFindHighlights();
  updateFindCount();
}

function syncMirrorScroll() {
  syncMirrorSize();
  editorMirror.scrollTop = editor.scrollTop;
  editorMirror.scrollLeft = editor.scrollLeft;
}

// Keep the mirror layer exactly as wide as the textarea's padding box. The
// textarea loses width to its scrollbar, so mirroring `inset: 0` alone would
// wrap long lines at a different point and misalign every highlight.
function syncMirrorSize() {
  const w = `${editor.clientWidth}px`;
  const h = `${editor.clientHeight}px`;
  if (editorMirror.style.width !== w) editorMirror.style.width = w;
  if (editorMirror.style.height !== h) editorMirror.style.height = h;
}

function updateFindHighlights() {
  if (findBar.hidden || !findState.query) {
    findState.value = editor.value;
    if (editorMirror.childNodes.length) editorMirror.replaceChildren();
    return;
  }
  // The document can change while the bar is open (typing, undo, replace),
  // so make sure the painted hits match the current text.
  if (findState.value !== editor.value) {
    findState.matches = findMatches();
    findState.value = editor.value;
    if (!findState.matches.length) findState.index = -1;
    else if (findState.index >= findState.matches.length) findState.index = findState.matches.length - 1;
    updateFindCount();
  }
  syncMirrorSize();
  const value = editor.value;
  const frag = document.createDocumentFragment();
  let last = 0;
  findState.matches.forEach((m, i) => {
    if (m.start > last) frag.appendChild(document.createTextNode(value.slice(last, m.start)));
    const mark = document.createElement('mark');
    if (i === findState.index) mark.className = 'current';
    mark.textContent = value.slice(m.start, m.end);
    frag.appendChild(mark);
    last = m.end;
  });
  frag.appendChild(document.createTextNode(value.slice(last) + '\n'));
  editorMirror.replaceChildren(frag);
  syncMirrorScroll();
}

function updateFindCount() {
  const total = findState.matches.length;
  findCount.textContent = total ? `${findState.index + 1}/${total}` : '0/0';
  findCount.style.color = findState.query && !total ? 'var(--danger)' : '';
}

function scrollEditorToOffset(start, end) {
  syncMirrorSize();
  const value = editor.value;
  const frag = document.createDocumentFragment();
  frag.appendChild(document.createTextNode(value.slice(0, start)));
  const mark = document.createElement('mark');
  mark.className = 'current';
  mark.textContent = value.slice(start, end) || ' ';
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(value.slice(end) + '\n'));
  editorMirror.replaceChildren(frag);
  editor.scrollTop = Math.max(0, mark.offsetTop - editor.clientHeight * 0.35);
  updateFindHighlights();
}

function gotoMatch(index) {
  const total = findState.matches.length;
  if (!total) return;
  const i = ((index % total) + total) % total;
  findState.index = i;
  const m = findState.matches[i];
  editor.setSelectionRange(m.start, m.end);
  updateFindHighlights();
  const mark = editorMirror.querySelector('mark.current');
  if (mark) {
    editor.scrollTop = Math.max(0, mark.offsetTop - editor.clientHeight * 0.4);
    syncMirrorScroll();
  }
  updateFindCount();
}

function stepFind(dir) {
  if (!findState.matches.length) refreshFind();
  if (!findState.matches.length) return;
  gotoMatch(findState.index < 0 ? 0 : findState.index + dir);
}

function setReplaceMode(on) {
  replaceRow.hidden = !on;
  findToggleReplace.classList.toggle('active', on);
  if (on) {
    replaceInput.focus();
    replaceInput.select();
  }
}

function openFind(withReplace = false) {
  if (document.body.className.includes('mode-preview')) setMode('split');
  findBar.hidden = false;
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (sel && !sel.includes('\n') && sel.length < 80) findInput.value = sel;
  findInput.focus();
  findInput.select();
  findState.query = findInput.value;
  findState.index = -1;
  refreshFind();
  const from = editor.selectionStart;
  const at = findState.matches.findIndex(m => m.start >= from);
  if (findState.matches.length) gotoMatch(at === -1 ? 0 : at);
  setReplaceMode(withReplace);
}

function closeFind() {
  findBar.hidden = true;
  findState.query = '';
  findState.matches = [];
  findState.index = -1;
  editorMirror.replaceChildren();
  editor.focus();
}

function replaceCurrent() {
  if (!findState.matches.length) return;
  const i = findState.index < 0 ? 0 : findState.index;
  const m = findState.matches[i];
  const text = replaceInput.value;
  const value = editor.value;
  editor.value = value.slice(0, m.start) + text + value.slice(m.end);
  const caret = m.start + text.length;
  editor.setSelectionRange(caret, caret);
  pushSnapshot(true);
  render();
  refreshFind();
  const next = findState.matches.findIndex(x => x.start >= caret);
  if (findState.matches.length) gotoMatch(next === -1 ? 0 : next);
  else updateFindCount();
}

function replaceAllMatches() {
  const matches = findState.matches.slice();
  if (!matches.length) return;
  const text = replaceInput.value;
  const value = editor.value;
  let out = '';
  let last = 0;
  matches.forEach(m => {
    out += value.slice(last, m.start) + text;
    last = m.end;
  });
  out += value.slice(last);
  const caret = Math.min(matches[0].start + text.length, out.length);
  editor.value = out;
  editor.setSelectionRange(caret, caret);
  pushSnapshot(true);
  render();
  refreshFind();
  toast(`已替换 ${matches.length} 处`);
}

document.getElementById('findBtn').addEventListener('click', () => openFind(false));
document.getElementById('findClose').addEventListener('click', closeFind);
document.getElementById('findPrev').addEventListener('click', () => { stepFind(-1); findInput.focus(); });
document.getElementById('findNext').addEventListener('click', () => { stepFind(1); findInput.focus(); });
document.getElementById('replaceOne').addEventListener('click', () => { replaceCurrent(); replaceInput.focus(); replaceInput.select(); });
document.getElementById('replaceAll').addEventListener('click', () => { replaceAllMatches(); replaceInput.focus(); replaceInput.select(); });
findToggleReplace.addEventListener('click', () => {
  const on = replaceRow.hidden;
  setReplaceMode(on);
  if (!on) findInput.focus();
});
findCaseBtn.addEventListener('click', () => {
  findState.caseSensitive = !findState.caseSensitive;
  findCaseBtn.classList.toggle('active', findState.caseSensitive);
  refreshFind();
});
editor.addEventListener('scroll', syncMirrorScroll);
window.addEventListener('resize', () => {
  if (!findBar.hidden) updateFindHighlights();
});
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (!findBar.hidden) updateFindHighlights();
  }).observe(editor);
}

findInput.addEventListener('input', () => {
  findState.query = findInput.value;
  findState.index = -1;
  refreshFind();
  const from = editor.selectionStart;
  const at = findState.matches.findIndex(m => m.start >= from);
  if (findState.matches.length) gotoMatch(at === -1 ? 0 : at);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) replaceAllMatches();
    else replaceCurrent();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});

// Global shortcuts: Ctrl+F find, Ctrl+H replace, Ctrl+Shift+F workspace search
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  const modal = document.getElementById('modalMask');
  const exportMask = document.getElementById('exportMask');
  if (!modal.hidden || !exportMask.hidden) return;
  if (key === 'f' && !e.shiftKey) {
    e.preventDefault();
    openFind(false);
  } else if (key === 'f' && e.shiftKey) {
    e.preventDefault();
    openWorkspaceSearch();
  } else if (key === 'h') {
    e.preventDefault();
    openFind(true);
  }
});

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
const wsSearch = document.getElementById('wsSearch');
const wsSearchCase = document.getElementById('wsSearchCase');
const wsSearchClear = document.getElementById('wsSearchClear');
const wsRoots = [];      // array of { root, expanded:Set }
const expandedDirs = new Set(); // set of folder paths that are expanded

let wsQuery = '';
let wsCaseSensitive = false;
let wsSearchToken = 0;
let wsSearchTimer = null;

function openWorkspaceSearch() {
  if (!isWails()) { toast('搜索功能仅在桌面端可用'); return; }
  wsPanel.classList.add('open');
  wsSearch.focus();
  wsSearch.select();
}

wsSearch.addEventListener('input', () => {
  wsQuery = wsSearch.value.trim();
  wsSearchClear.hidden = !wsSearch.value;
  renderWorkspace();
});

wsSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    wsSearch.value = '';
    wsQuery = '';
    wsSearchClear.hidden = true;
    renderWorkspace();
    wsSearch.blur();
  }
});

wsSearchClear.addEventListener('click', () => {
  wsSearch.value = '';
  wsQuery = '';
  wsSearchClear.hidden = true;
  renderWorkspace();
  wsSearch.focus();
});

wsSearchCase.addEventListener('click', () => {
  wsCaseSensitive = !wsCaseSensitive;
  wsSearchCase.classList.toggle('active', wsCaseSensitive);
  wsSearch.placeholder = wsCaseSensitive ? '区分大小写搜索…' : '搜索文件或内容…';
  renderWorkspace();
  wsSearch.focus();
});

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
    wsSearchToken++;
    wsBody.innerHTML = '<div class="empty">工作区为空<br>点击右上角 ＋ 添加文件夹</div>';
    return;
  }
  if (wsQuery) {
    renderSearchResults();
    return;
  }
  wsSearchToken++;
  wsRoots.forEach(tree => wsBody.appendChild(renderTreeItem(tree, 0)));
}

// ---------- Workspace search (filename + full text) ----------
function flattenFiles(nodes, out = [], seen = new Set()) {
  nodes.forEach(node => {
    if (node.isDir) {
      if (node.children) flattenFiles(node.children, out, seen);
    } else if (!seen.has(node.path)) {
      seen.add(node.path);
      out.push(node);
    }
  });
  return out;
}

// Path relative to the workspace root that contains it, for display.
function relPath(path) {
  for (const root of wsRoots) {
    if (path.startsWith(root.path + '\\') || path.startsWith(root.path + '/')) {
      return path.slice(root.path.length + 1);
    }
  }
  return path;
}

function includesQuery(text, query) {
  return wsCaseSensitive
    ? text.includes(query)
    : text.toLowerCase().includes(query.toLowerCase());
}

function highlightSnippet(text, query) {
  const frag = document.createDocumentFragment();
  if (!query) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const haystack = wsCaseSensitive ? text : text.toLowerCase();
  const needle = wsCaseSensitive ? query : query.toLowerCase();
  let from = 0;
  while (needle) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + needle.length);
    frag.appendChild(mark);
    from = at + needle.length;
  }
  if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
  return frag;
}

function renderSearchResults() {
  const query = wsQuery;
  const token = ++wsSearchToken;
  const files = flattenFiles(wsRoots);
  const nameMatches = files.filter(f => includesQuery(f.name, query));

  const nameSection = document.createElement('div');
  nameSection.className = 'sr-section';
  nameSection.textContent = `文件名 · ${nameMatches.length}`;
  wsBody.appendChild(nameSection);

  if (!nameMatches.length) {
    const empty = document.createElement('div');
    empty.className = 'sr-empty';
    empty.textContent = '没有匹配的文件名';
    wsBody.appendChild(empty);
  } else {
    nameMatches.slice(0, 60).forEach(file => {
      const row = document.createElement('div');
      row.className = 'sr-file';
      row.title = file.path;
      const name = document.createElement('span');
      name.className = 'sr-name';
      name.appendChild(highlightSnippet(file.name, query));
      const rel = relPath(file.path);
      const dirName = rel !== file.name ? rel.replace(/[\\/][^\\/]*$/, '') : '';
      const dir = document.createElement('span');
      dir.className = 'sr-dir';
      dir.textContent = dirName;
      row.appendChild(name);
      if (dirName) row.appendChild(dir);
      row.addEventListener('click', () => openPath(file.path));
      wsBody.appendChild(row);
    });
  }

  const contentSection = document.createElement('div');
  contentSection.className = 'sr-section';
  contentSection.textContent = '内容';
  wsBody.appendChild(contentSection);

  const contentBox = document.createElement('div');
  contentBox.className = 'sr-content';
  wsBody.appendChild(contentBox);

  if (!isWails()) {
    contentBox.innerHTML = '<div class="sr-hint">全文搜索仅在桌面端可用</div>';
    return;
  }

  contentBox.innerHTML = '<div class="sr-hint">搜索中…</div>';
  clearTimeout(wsSearchTimer);
  wsSearchTimer = setTimeout(async () => {
    let results = [];
    try {
      results = await window.go.main.App.SearchWorkspace(
        wsRoots.map(r => r.path), query, wsCaseSensitive, 200,
      ) || [];
    } catch {
      results = [];
    }
    if (token !== wsSearchToken) return;
    renderContentResults(contentBox, results, query);
  }, 220);
}

function renderContentResults(box, results, query) {
  box.innerHTML = '';
  if (!results.length) {
    box.innerHTML = '<div class="sr-empty">没有匹配的内容</div>';
    return;
  }
  const totalHits = results.reduce((n, f) => n + f.total, 0);
  const summary = document.createElement('div');
  summary.className = 'sr-hint';
  summary.style.padding = '2px 14px 6px';
  summary.textContent = `${results.length} 个文件 · ${totalHits} 处匹配`;
  box.appendChild(summary);

  results.forEach(file => {
    const group = document.createElement('div');
    group.className = 'sr-group';

    const head = document.createElement('div');
    head.className = 'sr-head';
    head.title = file.path;
    head.dataset.path = file.path;
    const name = document.createElement('span');
    name.className = 'sr-name';
    name.textContent = file.name;
    const badge = document.createElement('span');
    badge.className = 'sr-badge';
    badge.textContent = file.truncated ? `${file.hits.length}+` : String(file.total);
    head.appendChild(name);
    head.appendChild(badge);
    head.addEventListener('click', () => openPath(file.path));
    group.appendChild(head);

    file.hits.forEach(hit => {
      const row = document.createElement('div');
      row.className = 'sr-hit';
      row.title = `${file.rel}:${hit.line}`;
      const line = document.createElement('span');
      line.className = 'sr-line';
      line.textContent = hit.line;
      const text = document.createElement('span');
      text.className = 'sr-text';
      text.appendChild(highlightSnippet(hit.text, query));
      row.appendChild(line);
      row.appendChild(text);
      row.addEventListener('click', () => openPath(file.path, hit));
      group.appendChild(row);
    });

    box.appendChild(group);
  });
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
  return openPath(node.path);
}

function markActiveFile(path) {
  wsBody.querySelectorAll('.active').forEach(r => r.classList.remove('active'));
  const row = wsBody.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
  if (row) row.classList.add('active');
  const head = wsBody.querySelector(`.sr-head[data-path="${CSS.escape(path)}"]`);
  if (head) head.classList.add('active');
}

// Opens a markdown file in a tab. If the file is already open, that tab is
// focused instead. When `hit` is provided (from full-text search) the editor
// caret is moved to the matching line and the match is scrolled into view.
async function openPath(path, hit = null) {
  if (!isWails()) return;
  const existing = tabs.find(t => t.path === path);
  if (existing) {
    switchTo(existing.id);
    markActiveFile(path);
    if (hit) revealInEditor(hit);
    return;
  }
  try {
    const content = await window.go.main.App.OpenFile(path);
    openFileInTab(path, content);
    markActiveFile(path);
    if (hit) revealInEditor(hit);
    toast('已打开：' + path.split(/[\\/]/).pop());
  } catch {
    toast('打开失败');
  }
}

function runeIdxToJs(str, runeIdx) {
  let i = 0;
  let r = 0;
  while (r < runeIdx && i < str.length) {
    const cp = str.codePointAt(i);
    i += cp > 0xffff ? 2 : 1;
    r++;
  }
  return i;
}

function revealInEditor(hit) {
  const value = editor.value;
  let lineStart = 0;
  for (let i = 1; i < hit.line; i++) {
    const nl = value.indexOf('\n', lineStart);
    if (nl === -1) { lineStart = -1; break; }
    lineStart = nl + 1;
  }
  if (lineStart < 0) return;
  let lineEnd = value.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = value.length;
  const lineText = value.slice(lineStart, lineEnd).replace(/\r$/, '');

  const needle = wsCaseSensitive ? wsQuery : wsQuery.toLowerCase();
  let start = lineStart + runeIdxToJs(lineText, Math.max(0, hit.col - 1));
  const found = wsCaseSensitive
    ? value.slice(start, start + needle.length)
    : value.slice(start, start + needle.length).toLowerCase();
  if (!needle || found !== needle) {
    const at = wsCaseSensitive
      ? lineText.indexOf(wsQuery)
      : lineText.toLowerCase().indexOf(needle);
    start = at === -1 ? lineStart : lineStart + at;
  }
  const end = start + wsQuery.length;

  if (document.body.className.includes('mode-preview')) setMode('split');
  editor.focus();
  editor.setSelectionRange(start, end);
  scrollEditorToOffset(start, end);
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
  if (wsQuery) return;
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
  syncDiskState(tab);
}

initFromFileArg();

if (isWails()) {
  changePollTimer = setInterval(checkExternalChanges, CHANGE_POLL_MS);
  window.addEventListener('focus', checkExternalChanges);
}
