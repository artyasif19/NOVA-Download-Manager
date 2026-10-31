@echo off
setlocal
echo ========================================================
echo   NOVA Download Manager - Windows x64 Build Script
echo ========================================================
echo.

:: Prerequisites Check
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Rust and Cargo are not installed or not in PATH.
    echo Please install Rust via https://rustup.rs/ and ensure
    echo MSVC C++ Build Tools 2022 are installed.
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js and NPM are not installed or not in PATH.
    exit /b 1
)

echo [1/4] Installing NPM dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    exit /b %errorlevel%
)

echo [2/4] Building React frontend production bundle...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed.
    exit /b %errorlevel%
)

echo [3/4] Building Rust Tauri desktop application and nova_host...
cd src-tauri
cargo build --release --bin nova-download-manager --bin nova_host
if %errorlevel% neq 0 (
    echo [ERROR] Rust cargo build failed.
    cd ..
    exit /b %errorlevel%
)
cd ..

echo [4/4] Bundling Tauri MSI / NSIS installer...
call npm run tauri build
if %errorlevel% neq 0 (
    echo [WARNING] Full installer bundle generation failed. The compiled release binaries are at:
    echo   src-tauri\target\release\nova-download-manager.exe
    echo   src-tauri\target\release\nova_host.exe
) else (
    echo [SUCCESS] Installer generated in src-tauri\target\release\bundle\
)

echo.
echo Build finished! Run 'extension\install_host.bat' to register browser integration.
echo ========================================================
pause
