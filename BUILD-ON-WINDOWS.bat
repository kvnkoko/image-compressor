@echo off
title Image Compressor - Build Tool
color 0A
cls

echo.
echo  ============================================
echo   Image Compressor - Windows Build Tool
echo  ============================================
echo.

:: Fix PowerShell execution policy silently
powershell -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force" >nul 2>&1

:: Use mirror in case GitHub is blocked by firewall
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

:: ── 1. Check for Node.js ──────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js not found.
    echo  [!] Please install Node.js from nodejs.org then run this file again.
    echo.
    start https://nodejs.org/dist/v24.17.0/node-v24.17.0-x64.msi
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js found: %NODE_VER%
echo.

:: ── 2. Install dependencies ────────────────────────────────────────────────
echo  Installing dependencies (a few minutes)...
echo  Please wait - do not close this window.
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed.
    echo  Please take a photo of this screen and send for support.
    pause
    exit /b 1
)
echo.
echo  [OK] Dependencies installed.
echo.

:: ── 3. Build Windows exe ───────────────────────────────────────────────────
echo  Building app (1-3 minutes)...
echo  Please wait - do not close this window.
echo.
call npm run dist
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Build failed.
    echo  Please take a photo of this screen and send for support.
    pause
    exit /b 1
)

:: ── 4. Done ────────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo   BUILD COMPLETE!
echo  ============================================
echo.
echo  Your installer is in the "dist" folder.
echo  Opening now...
echo.

if exist "dist\" (
    explorer dist
) else (
    echo  Could not find dist folder.
)

pause
