@echo off
title MarkdownAK - Build
cd /d "%~dp0"

echo ============================================
echo   MarkdownAK Wails 构建脚本
echo ============================================
echo.

echo [1/3] 检查前端依赖...
cd frontend
if not exist node_modules (
    call npm install
    if errorlevel 1 goto :error
)

echo [2/3] 构建前端...
call npm run build
if errorlevel 1 goto :error

cd ..

echo [3/3] 构建桌面应用...
call wails build
if errorlevel 1 goto :error

echo.
echo 构建成功! 输出: build\bin\MarkdownAK.exe
echo.
pause
exit /b 0

:error
echo.
echo 构建失败!
pause
exit /b 1