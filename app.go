package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx            context.Context
	initialFile    string
	initialContent string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.captureInitialFile()
}

// captureInitialFile reads a markdown file passed via command line, which
// happens when the user opens a .md file by double-clicking it.
func (a *App) captureInitialFile() {
	if len(os.Args) < 2 {
		return
	}
	path := os.Args[1]
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".md" && ext != ".markdown" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	a.initialFile = path
	a.initialContent = string(data)
}

// GetInitialFile returns the file that was opened by double-clicking. The
// frontend calls this once during startup. Returns nil when no file was passed.
func (a *App) GetInitialFile() map[string]string {
	if a.initialFile == "" {
		return nil
	}
	return map[string]string{
		"path":    a.initialFile,
		"content": a.initialContent,
	}
}

// OpenFileDialog shows a native file picker and returns the chosen file
func (a *App) OpenFileDialog() (map[string]string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md;*.markdown)", Pattern: "*.md;*.markdown"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return map[string]string{"path": ""}, nil
	}
	return map[string]string{"path": path}, nil
}

// SaveFileDialog shows a native save dialog and writes content to the chosen file
func (a *App) SaveFileDialog(content string) (map[string]string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存 Markdown 文件",
		DefaultFilename: "untitled.md",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return map[string]string{"path": ""}, nil
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return nil, err
	}
	return map[string]string{"path": path}, nil
}

// OpenFile reads and returns the content of a markdown file
func (a *App) OpenFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveFile writes content to a file
func (a *App) SaveFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// FileMeta is a lightweight snapshot of a file used to detect external changes.
type FileMeta struct {
	Exists  bool  `json:"exists"`
	ModTime int64 `json:"modTime"`
	Size    int64 `json:"size"`
}

// StatFile returns the modification time and size of a file so the frontend
// can detect when the file changed on disk. Missing files return exists=false.
func (a *App) StatFile(path string) FileMeta {
	info, err := os.Stat(path)
	if err != nil {
		return FileMeta{}
	}
	return FileMeta{Exists: true, ModTime: info.ModTime().UnixMilli(), Size: info.Size()}
}

// CreateFile creates a new empty file in the given directory. If the name is
// already taken, a numeric suffix is appended so existing files are never
// overwritten.
func (a *App) CreateFile(dir string, name string) (string, error) {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	path := filepath.Join(dir, name)
	for i := 1; ; i++ {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			break
		}
		suffix := fmt.Sprintf("(%d)%s", i, ext)
		path = filepath.Join(dir, base+suffix)
	}
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		return "", err
	}
	return path, nil
}

// CreateFolder creates a new folder in the given directory. If the name is
// already taken, a numeric suffix is appended.
func (a *App) CreateFolder(dir string, name string) (string, error) {
	path := filepath.Join(dir, name)
	for i := 1; ; i++ {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			break
		}
		path = filepath.Join(dir, fmt.Sprintf("%s(%d)", name, i))
	}
	if err := os.MkdirAll(path, 0755); err != nil {
		return "", err
	}
	return path, nil
}

// DeletePath deletes a file or a folder (recursively).
func (a *App) DeletePath(path string) error {
	return os.RemoveAll(path)
}

// CopyFile duplicates a file in the same directory with a 副本 suffix.
func (a *App) CopyFile(path string) (string, error) {
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)
	dir := filepath.Dir(path)
	dest := ""
	for i := 1; ; i++ {
		name := fmt.Sprintf("%s-副本%s", base, ext)
		if i > 1 {
			name = fmt.Sprintf("%s-副本(%d)%s", base, i, ext)
		}
		candidate := filepath.Join(dir, name)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			dest = candidate
			break
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, data, 0644); err != nil {
		return "", err
	}
	return dest, nil
}

// FileEntry is a node in the recursive workspace file tree
type FileEntry struct {
	Name     string       `json:"name"`
	Path     string       `json:"path"`
	IsDir    bool         `json:"isDir"`
	Children []*FileEntry `json:"children,omitempty"`
}

// workspaceSkipDirs are directories excluded from the workspace tree
var workspaceSkipDirs = map[string]bool{
	".git": true, ".svn": true, ".hg": true,
	"node_modules": true, ".vscode": true, ".idea": true,
	"dist": true, "build": true, "out": true,
	"__pycache__": true, ".cache": true,
}

// OpenFolderDialog shows a native folder picker and returns the chosen folder
func (a *App) OpenFolderDialog() (map[string]string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "添加工作区文件夹",
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return map[string]string{"path": ""}, nil
	}
	return map[string]string{"path": path}, nil
}

// ListDirectory recursively lists the contents of a folder as a file tree.
// Dirs and files are sorted with dirs first, then by name.
func (a *App) ListDirectory(root string) (*FileEntry, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	return buildFileTree(root, info)
}

func buildFileTree(path string, info os.FileInfo) (*FileEntry, error) {
	node := &FileEntry{Name: info.Name(), Path: path, IsDir: info.IsDir()}
	if !info.IsDir() {
		return node, nil
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return node, nil
	}
	for _, e := range entries {
		if e.IsDir() && (workspaceSkipDirs[e.Name()] || strings.HasPrefix(e.Name(), ".")) {
			continue
		}
		childInfo, err := e.Info()
		if err != nil {
			continue
		}
		child, err := buildFileTree(filepath.Join(path, e.Name()), childInfo)
		if err != nil {
			continue
		}
		node.Children = append(node.Children, child)
	}
	sort.Slice(node.Children, func(i, j int) bool {
		ci, cj := node.Children[i], node.Children[j]
		if ci.IsDir != cj.IsDir {
			return ci.IsDir
		}
		return strings.ToLower(ci.Name) < strings.ToLower(cj.Name)
	})
	return node, nil
}