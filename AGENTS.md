# AGENTS.md

## What this is

Hybrid desktop + web Markdown editor.
- **Desktop**: Wails v2 (Go backend in `app.go`/`main.go`) + Vite vanilla-JS frontend in `frontend/`.
- **Web**: the same `frontend/` deploys standalone to Cloudflare Pages via `wrangler` (see `wrangler.toml`).
- Go module name is **`mdstudio`**, but the app/`wails.json` name is **MarkdownAK** (`outputfilename`). Don't assume they match.

## Build / verify commands (Windows PowerShell)

- Frontend build: `cd frontend; npm run build` (outputs `frontend/dist`, gitignored)
- Go check: `go build ./...` then `go vet ./...` (from repo root)
- Desktop build (also rebuilds frontend): `build.bat`; dev mode: `dev.bat`
- Web deploy: `cd frontend; npm run deploy:pages`

Order matters: desktop build needs `frontend/dist` built before `wails build`.

## Gotchas

- **`.bat` files must be CRLF line endings + GBK (cp936) encoding** for Chinese text in cmd. If the `Write` tool writes LF/UTF-8, run `.bat` will fail with `'xxx' 不是内部或外部命令`. Re-encode via PowerShell `GetEncoding(936)` with `\r\n` if you touch `build.bat`/`dev.bat`.
- **Frontend is `type: module` (ESM)**: `.js` files are modules. `node -e "require(...)"` or writing `_test.js` under `frontend/` fails with "require is not defined"; use `import` + `.mjs` extension for quick node checks.
- **`frontend/wailsjs/` is generated** by `wails dev`/`wails build` and gitignored. `main.js` deliberately calls `window.go.main.App.*` directly (not the generated bindings) so the frontend stays independently buildable/deployable as pure web.
- **No Wails runtime (web deploy)**: `isWails()` in `main.js` is `false`; open/save buttons are hidden, MathJax still loads.

## Architecture notes

- `app.go`: all Go↔JS bindings (`OpenFileDialog`, `SaveFileDialog`, `OpenFile`, `SaveFile`, `GetInitialFile`). `GetInitialFile` returns the file passed via `os.Args[1]` when the app is opened by double-clicking a `.md`.
- `SearchWorkspace(roots, query, caseSensitive, limit)` in `app.go` does workspace full-text search: markdown files only, skips `workspaceSkipDirs`/dot-dirs, returns per-file hits with a 1-based line and a 1-based **rune** column (the frontend converts to a JS index).
- `main.js` in-document find/replace (`Ctrl+F` / `Ctrl+H`): hits are painted by `#editorMirror`, a div layered *behind* the transparent `#editor` textarea. The mirror must keep the same font/padding/line-height **and** be sized from `editor.clientWidth/clientHeight` (scrollbar width) or highlights drift.
- Workspace search box lives in the `ws-panel` (`Ctrl+Shift+F`): filename matches are computed locally from the tree, content matches come from `SearchWorkspace` (debounced, desktop only). Clicking a content hit opens the file and jumps to the line.
- `main.js`: `initFromFileArg()` runs at startup — if a file arg exists it loads it, forces `body.mode-preview`, opens the TOC panel, and toasts the filename.
- **MathJax quirk**: `marked` uses `breaks:true`, which destroys multi-line `$$...$$` math. A custom marked block extension (`blockMathExtension`) preserves block math as a single token; inline `$...$` math is kept by `skipHtmlTags: ['code']`. Don't remove `breaks:true` or this extension independently.
- `main.go`: embeds `frontend/dist` via `//go:embed all:frontend/dist`.
- View modes: `body.mode-{split,edit,preview}`; TOC panel opens via `.toc-panel.open`.

## Conventions

- Windows-only target in practice (win32). No CI, no tests, no linter config in repo — `go vet` and `npm run build` are the only checks.
- `build/` (wails assets + `bin/`) and `dist/` outputs are gitignored; source is `app.go`, `main.go`, and `frontend/src/*`.
