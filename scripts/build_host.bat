@echo off
setlocal
echo ========================================================
echo   Building NOVA Native Messaging Host (nova_host.exe)
echo ========================================================
echo.

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Rust / Cargo is not installed.
    exit /b 1
)

cd src-tauri
cargo build --release --bin nova_host
if %errorlevel% neq 0 (
    echo [ERROR] Failed to compile nova_host.exe.
    cd ..
    exit /b 1
)
cd ..

set TARGET_DIR=%LOCALAPPDATA%\NOVA
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

copy /Y "%~dp0..\src-tauri\target\release\nova_host.exe" "%TARGET_DIR%\nova_host.exe"
echo [SUCCESS] Copied nova_host.exe to %TARGET_DIR%\nova_host.exe
echo Run extension\install_host.bat to register with browsers.
