@echo off
setlocal EnableDelayedExpansion
echo ===================================================
echo   NOVA Download Manager - Native Host Uninstaller
echo ===================================================
echo.

set TARGET_DIR=%LOCALAPPDATA%\NOVA

echo [1/3] Removing Windows Registry Keys (HKCU)...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.nova.downloadmanager" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nova.downloadmanager" /f >nul 2>&1
reg delete "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.nova.downloadmanager" /f >nul 2>&1
reg delete "HKCU\Software\Mozilla\NativeMessagingHosts\com.nova.downloadmanager" /f >nul 2>&1

echo [2/3] Cleaning up native messaging manifests...
if exist "%TARGET_DIR%\com.nova.downloadmanager.json" del /q "%TARGET_DIR%\com.nova.downloadmanager.json" >nul 2>&1
if exist "%TARGET_DIR%\com.nova.downloadmanager.firefox.json" del /q "%TARGET_DIR%\com.nova.downloadmanager.firefox.json" >nul 2>&1

echo [3/3] Optional cleanup of host executable...
if exist "%TARGET_DIR%\nova_host.exe" (
    echo Note: %TARGET_DIR%\nova_host.exe can be safely deleted or kept for future reinstallation.
)

echo.
echo ===================================================
echo NOVA Native Messaging Bridge successfully uninstalled.
echo Browser extensions will no longer attempt handoff to NOVA.
echo ===================================================
echo.
pause
