@echo off
setlocal EnableDelayedExpansion
echo ========================================================
echo   NOVA Download Manager - Native Messaging Host Installer
echo ========================================================
echo.

set TARGET_DIR=%LOCALAPPDATA%\NOVA
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [1/4] Verifying and copying nova_host.exe...
set HOST_FOUND=0
if exist "%~dp0..\src-tauri\target\release\nova_host.exe" (
    copy /Y "%~dp0..\src-tauri\target\release\nova_host.exe" "%TARGET_DIR%\nova_host.exe" >nul
    if !errorlevel! equ 0 set HOST_FOUND=1
) else if exist "%~dp0nova_host.exe" (
    copy /Y "%~dp0nova_host.exe" "%TARGET_DIR%\nova_host.exe" >nul
    if !errorlevel! equ 0 set HOST_FOUND=1
) else if exist "%TARGET_DIR%\nova_host.exe" (
    set HOST_FOUND=1
)

if !HOST_FOUND! neq 1 (
    echo.
    echo ========================================================
    echo [ERROR] Installation failed: nova_host.exe was not found!
    echo ========================================================
    echo Expected to find nova_host.exe in one of these paths:
    echo   1. %~dp0..\src-tauri\target\release\nova_host.exe
    echo   2. %~dp0nova_host.exe
    echo   3. %TARGET_DIR%\nova_host.exe
    echo.
    echo Please compile nova_host.exe first:
    echo   cd src-tauri ^&^& cargo build --release --bin nova_host
    echo Or run scripts\build_windows_x64.bat before running this script.
    echo.
    pause
    exit /b 1
)

echo [SUCCESS] nova_host.exe confirmed at %TARGET_DIR%\nova_host.exe

set ESCAPED_TARGET=%TARGET_DIR:\=\\%

echo.
echo [2/4] Generating Native Messaging Manifests...
(
echo {
echo   "name": "com.nova.downloadmanager",
echo   "description": "NOVA Download Manager Native Messaging Host",
echo   "path": "!ESCAPED_TARGET!\\nova_host.exe",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://pmkbechehklelnopohiefbcafghkjjil/"
echo   ]
echo }
) > "%TARGET_DIR%\com.nova.downloadmanager.json"

(
echo {
echo   "name": "com.nova.downloadmanager",
echo   "description": "NOVA Download Manager Native Messaging Host for Firefox",
echo   "path": "!ESCAPED_TARGET!\\nova_host.exe",
echo   "type": "stdio",
echo   "allowed_extensions": [
echo     "extension@nova-download-manager.local"
echo   ]
echo }
) > "%TARGET_DIR%\com.nova.downloadmanager.firefox.json"

echo [3/4] Registering Windows Registry Keys (HKCU)...

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.nova.downloadmanager" /ve /t REG_SZ /d "%TARGET_DIR%\com.nova.downloadmanager.json" /f >nul
if !errorlevel! neq 0 (
    echo [ERROR] Failed to register NativeMessagingHosts for Google Chrome.
    pause
    exit /b 1
)

reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nova.downloadmanager" /ve /t REG_SZ /d "%TARGET_DIR%\com.nova.downloadmanager.json" /f >nul
if !errorlevel! neq 0 (
    echo [ERROR] Failed to register NativeMessagingHosts for Microsoft Edge.
    pause
    exit /b 1
)

reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.nova.downloadmanager" /ve /t REG_SZ /d "%TARGET_DIR%\com.nova.downloadmanager.json" /f >nul
if !errorlevel! neq 0 (
    echo [ERROR] Failed to register NativeMessagingHosts for Brave Browser.
    pause
    exit /b 1
)

reg add "HKCU\Software\Mozilla\NativeMessagingHosts\com.nova.downloadmanager" /ve /t REG_SZ /d "%TARGET_DIR%\com.nova.downloadmanager.firefox.json" /f >nul
if !errorlevel! neq 0 (
    echo [ERROR] Failed to register NativeMessagingHosts for Mozilla Firefox.
    pause
    exit /b 1
)

echo [4/4] Verified and Registered Successfully!
echo.
echo ========================================================
echo Native Messaging Host is active at:
echo   %TARGET_DIR%\nova_host.exe
echo.
echo Deterministic Extension ID for Chrome, Edge, and Brave:
echo   pmkbechehklelnopohiefbcafghkjjil
echo.
echo Registered for:
echo   - Google Chrome (HKCU\Software\Google\Chrome\NativeMessagingHosts)
echo   - Microsoft Edge (HKCU\Software\Microsoft\Edge\NativeMessagingHosts)
echo   - Brave Browser (HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts)
echo   - Mozilla Firefox (HKCU\Software\Mozilla\NativeMessagingHosts)
echo ========================================================
echo.
pause
