:: 鸿蒙 RN Bundle 打包脚本 (Windows)
:: 用法: scripts\bundle-harmony.bat [--dev]

@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set MOBILE_DIR=%SCRIPT_DIR%..
set HARMONY_DIR=%MOBILE_DIR%\harmony
set RAWFILE_DIR=%HARMONY_DIR%\entry\src\main\resources\rawfile

set DEV_MODE=false
if "%1"=="--dev" set DEV_MODE=true

echo === 鸿蒙 RN Bundle 打包 ===
echo 开发模式: %DEV_MODE%
echo 输出目录: %RAWFILE_DIR%

:: 确保 rawfile 目录存在
if not exist "%RAWFILE_DIR%\bundle" mkdir "%RAWFILE_DIR%\bundle"

cd /d "%MOBILE_DIR%"

:: 清理旧 bundle
del /q "%RAWFILE_DIR%\bundle\*" 2>nul
if exist "%RAWFILE_DIR%\assets" rmdir /s /q "%RAWFILE_DIR%\assets"

:: 打包
if "%DEV_MODE%"=="true" (
  pnpm react-native bundle ^
    --platform harmony ^
    --dev true ^
    --entry-file index.js ^
    --bundle-output "%RAWFILE_DIR%\bundle\index.harmony.bundle" ^
    --assets-dest "%RAWFILE_DIR%\"
) else (
  pnpm react-native bundle ^
    --platform harmony ^
    --dev false ^
    --entry-file index.js ^
    --bundle-output "%RAWFILE_DIR%\bundle\index.harmony.bundle" ^
    --assets-dest "%RAWFILE_DIR%\" ^
    --minify true
)

echo === 打包完成 ===
dir "%RAWFILE_DIR%\bundle\"
