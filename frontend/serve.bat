@echo off
setlocal enabledelayedexpansion

:: ==========================================
:: 1. Config: default port and max retries
:: ==========================================
set DEFAULT_PORT=9800
set MAX_RETRIES=200
set RETRY_COUNT=0
set CURRENT_PORT=%DEFAULT_PORT%

:: ==========================================
:: 2. Detect a working Python interpreter
::    Prefer the "py" launcher (always on PATH),
::    fall back to "python" on PATH.
:: ==========================================
set PYCMD=py -3
py -3 -c "import sys" >nul 2>&1
if %errorlevel% neq 0 (
    set PYCMD=python
    python -c "import sys" >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Python is required but not found.
        echo   Install Python from https://www.python.org/
        pause
        exit /b 1
    )
)

echo ==========================================
echo   Starting HTTP Static File Server...
echo ==========================================

:: ==========================================
:: 3. Get local IP address
:: ==========================================
set IP_ADDRESS=Unknown
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP_ADDRESS=%%a
)
set IP_ADDRESS=%IP_ADDRESS: =%

:: ==========================================
:: 4. Port check with auto switch
:: ==========================================
:check_port
%PYCMD% -c "import socket; s=socket.socket(); s.bind(('0.0.0.0', %CURRENT_PORT%)); s.close()" >nul 2>&1

if %errorlevel% equ 0 (
    echo [OK] Port %CURRENT_PORT% is available.
    goto start_server
) else (
    echo [WARN] Port %CURRENT_PORT% is occupied.
    set /a CURRENT_PORT+=1
    set /a RETRY_COUNT+=1
    if !RETRY_COUNT! lss %MAX_RETRIES% (
        echo        Trying next port: !CURRENT_PORT!...
        goto check_port
    ) else (
        echo [ERROR] Could not find an available port after %MAX_RETRIES% attempts.
        pause
        exit /b 1
    )
)

:: ==========================================
:: 5. Start HTTP server
:: ==========================================
:start_server
echo.
echo   Local:   http://localhost:%CURRENT_PORT%
echo   Network: http://%IP_ADDRESS%:%CURRENT_PORT%
echo ==========================================
echo Press Ctrl+C to stop the server.
echo.

%PYCMD% -m http.server %CURRENT_PORT% --bind 0.0.0.0

echo.
echo [Info] Server stopped.
pause