# MarkdownAK · 极简 Markdown 编辑器

一个**极简**而*优雅*的 Markdown 编辑器。支持实时预览、数学公式渲染、一键生成目录、多种导出格式与暗色主题。同一套前端代码同时构建为 **Windows 桌面应用**（Wails v2）和**网页应用**（Cloudflare Pages）。

## 特性

- ⚡ 实时预览（分屏 / 仅编辑 / 仅预览三种模式）
- 🧮 数学公式渲染（MathJax 3，支持行内 `$...$` 与块级 `$$...$$`）
- 📑 一键生成目录，滚动自动高亮当前标题
- 🌙 暗色 / 亮色主题，自动记忆选择
- 📋 复制 Markdown / 复制 HTML / 导出 PDF（打印）
- 🧩 工具栏快速插入：标题、列表、引用、链接、图片、表格、代码块
- 📂 桌面端原生打开 / 保存文件，支持双击 `.md` 直接打开并进入预览模式
- 🎨 内置多套示例模板（基础语法、论文排版、待办清单、代码文档）
- ↩️ 撤销 / 重做历史（200 步）

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面后端 | [Wails](https://wails.io/) v2 (Go 1.25) |
| 桌面前端 | Vite + 原生 JavaScript (ESM) |
| 渲染 | [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) |
| 公式 | [MathJax](https://www.mathjax.org/) 3 (tex-svg) |
| 网页部署 | Cloudflare Pages（[wrangler](https://developers.cloudflare.com/workers/wrangler/)） |

## 快速开始

### 环境要求

- Go 1.25+
- Node.js 18+
- Wails CLI（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）
- Windows 10/11（桌面端仅面向 Windows）

### 开发模式

```bat
dev.bat
```

内部执行 `wails dev`，改动前端源码后热更新。

### 桌面端构建

```bat
build.bat
```

脚本会自动安装前端依赖、构建前端，再执行 `wails build`，输出到 `build\bin\MarkdownAK.exe`。

### 直接运行

```bat
cd frontend
npm install
npm run build
```

然后在仓库根目录运行 `wails dev` 或 `wails build`。桌面构建需要先有 `frontend/dist` 产物。

### 网页端开发 / 部署

```bash
cd frontend
npm run dev       # 本地开发服务器 (http://localhost:34115)
npm run build     # 构建到 frontend/dist
npm run deploy:pages   # 构建并部署到 Cloudflare Pages
```

## 双击 `.md` 文件打开

首次使用需手动关联文件类型：

1. 右键任意 `.md` 文件 → **打开方式** → **选择其他应用**
2. 选择 `build\bin\MarkdownAK.exe`，勾选 **始终使用此应用打开 .md 文件**

之后双击 `.md` 文件即可直接打开，应用会自动加载文件、切换到**预览模式**并显示**目录**。

## 项目结构

```
.
├── app.go              # Go 后端：打开/保存对话框、文件读写、命令行参数
├── main.go             # Wails 入口，内嵌 frontend/dist
├── main.go / go.mod    # Go 模块 (mdstudio)
├── wails.json          # Wails 配置（应用名 MarkdownAK）
├── wrangler.toml       # Cloudflare Pages 部署配置
├── build.bat           # 桌面端一键构建脚本
├── dev.bat             # 桌面端开发模式脚本
└── frontend/
    ├── src/main.js     # 前端核心逻辑（渲染、编辑、工具栏、目录）
    ├── src/style.css   # 样式与主题
    ├── index.html      # 入口页面
    ├── vite.config.js  # Vite 配置
    └── serve.bat       # Python 静态文件服务器（网页端本地预览）
```

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+B` | 粗体 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 插入链接 |
| `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Tab` | 插入两个空格 |

## 许可证

暂无显式许可证。
