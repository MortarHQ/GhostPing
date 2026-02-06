@echo off
setlocal EnableExtensions DisableDelayedExpansion

for /f "tokens=2 delims=:." %%A in ('chcp') do set "CURRENT_CP=%%A"
set "CURRENT_CP=%CURRENT_CP: =%"
if not "%CURRENT_CP%"=="65001" (
    chcp 65001 >nul 2>&1
    if errorlevel 1 (
        echo [错误] 无法设置控制台编码为 UTF-8。
        exit /b 1
    )
    "%ComSpec%" /d /c "chcp 65001>nul & call ""%~f0"" %*"
    exit /b %errorlevel%
)

setlocal EnableDelayedExpansion
set "SCRIPT_EXIT_CODE=0"

set "COMMAND="
set "REQUESTED_VERSION="
set "BUNDLED_NODE_VERSION="
set "SHOW_HELP=false"

call :parseArgs %*
if errorlevel 1 exit /b %SCRIPT_EXIT_CODE%
if /i "%SHOW_HELP%"=="true" goto :end

if not defined REQUESTED_VERSION (
    if defined GP_VERSION (
        set "REQUESTED_VERSION=%GP_VERSION%"
    ) else (
        set "REQUESTED_VERSION=latest"
    )
)

if not defined BUNDLED_NODE_VERSION (
    if defined GP_NODE_VERSION (
        set "BUNDLED_NODE_VERSION=%GP_NODE_VERSION%"
    ) else (
        set "BUNDLED_NODE_VERSION=v20.11.0"
    )
)
if /i not "%BUNDLED_NODE_VERSION:~0,1%"=="v" (
    set "BUNDLED_NODE_VERSION=v%BUNDLED_NODE_VERSION%"
)

set "REQUIRED_NODE_VERSION=20"
set "PNPM_VERSION=9.0.0"
set "PROJECT_REPO=MortarHQ/GhostPing"
set "MANIFEST_URL=https://raw.githubusercontent.com/%PROJECT_REPO%/master/docs/releases/versions.json"
set "CURRENT_DIR=%CD%"
set "INSTALL_ROOT=%CURRENT_DIR%\ghostping"
set "NODE_ROOT=%INSTALL_ROOT%\node"
set "VERSIONS_ROOT=%INSTALL_ROOT%\versions"
set "MANIFEST_FILE=%INSTALL_ROOT%\versions.json"
set "TEMP_NODE_DIR="
set "TEMP_SOURCE_DIR="

call :safePrint "[信息] 此脚本将创建目录：%INSTALL_ROOT%"
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>&1
if errorlevel 1 call :fail "创建安装目录失败。"
if not exist "%NODE_ROOT%" mkdir "%NODE_ROOT%" >nul 2>&1
if errorlevel 1 call :fail "创建 node 目录失败。"
if not exist "%VERSIONS_ROOT%" mkdir "%VERSIONS_ROOT%" >nul 2>&1
if errorlevel 1 call :fail "创建 versions 目录失败。"

where powershell >nul 2>&1
if errorlevel 1 call :fail "PowerShell 不可用。"

set "NODE_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=win-arm64"
set "NODE_ZIP_DIR=%NODE_ROOT%\node_%BUNDLED_NODE_VERSION%"
set "NODE_DIR=%NODE_ZIP_DIR%\node-%BUNDLED_NODE_VERSION%-%NODE_ARCH%"

set "USE_SYSTEM_NODE=false"
where node >nul 2>&1
if not errorlevel 1 (
    set "NODE_VERSION="
    for /f "tokens=*" %%i in ('node -v') do set "NODE_VERSION=%%i"
    if not defined NODE_VERSION call :fail "无法获取 Node.js 版本。"
    call :safePrint "[信息] 检测到系统 Node.js !NODE_VERSION!"

    set "VERSION_NUMBER=!NODE_VERSION:~1!"
    for /f "tokens=1 delims=." %%a in ("!VERSION_NUMBER!") do set "MAJOR_VERSION=%%a"
    if !MAJOR_VERSION! geq %REQUIRED_NODE_VERSION% (
        set "USE_SYSTEM_NODE=true"
    ) else (
        call :safePrint "[警告] 系统 Node.js 低于推荐版本 v%REQUIRED_NODE_VERSION%"
        set /p CONTINUE_WITH_SYSTEM_NODE="是否继续使用当前系统的 Node.js？(y/n): "
        if /i "!CONTINUE_WITH_SYSTEM_NODE!"=="y" set "USE_SYSTEM_NODE=true"
    )
)

if "%USE_SYSTEM_NODE%"=="false" (
    if not exist "%NODE_DIR%" (
        if not exist "%NODE_ZIP_DIR%" mkdir "%NODE_ZIP_DIR%" >nul 2>&1
        if errorlevel 1 call :fail "创建 Node.js 目录失败。"

        set "TEMP_NODE_DIR=%NODE_ROOT%\_tmp_node_%RANDOM%%RANDOM%"
        mkdir "!TEMP_NODE_DIR!" >nul 2>&1
        if errorlevel 1 call :fail "创建 Node.js 临时目录失败。"

        call :safePrint "[信息] 下载 Node.js %BUNDLED_NODE_VERSION%..."
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/%BUNDLED_NODE_VERSION%/node-%BUNDLED_NODE_VERSION%-%NODE_ARCH%.zip' -OutFile '!TEMP_NODE_DIR!\\node.zip' -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
        if errorlevel 1 (
            call :fail "下载 Node.js 失败。"
        )

        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -Path '!TEMP_NODE_DIR!\\node.zip' -DestinationPath '%NODE_ZIP_DIR%' -Force -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
        if errorlevel 1 (
            call :fail "解压 Node.js 失败。"
        )

        call :safeRemoveTempDir "!TEMP_NODE_DIR!" "%NODE_ROOT%"
        set "TEMP_NODE_DIR="
    )
    set "PATH=%NODE_DIR%;%PATH%"
)

call :ensurePnpm
if errorlevel 1 call :fail "pnpm 准备失败。"

call :safePrint "[信息] 获取版本清单..."
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%MANIFEST_URL%' -OutFile '%MANIFEST_FILE%' -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
if errorlevel 1 call :fail "下载版本清单失败。"

set "RESOLVED_VERSION="
set "RESOLVED_COMMIT="
for /f "usebackq tokens=1,2 delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = Get-Content -Raw '%MANIFEST_FILE%' | ConvertFrom-Json; $requested = '%REQUESTED_VERSION%'; if ([string]::IsNullOrWhiteSpace($requested) -or $requested -eq 'latest') { $request = $m.latest } else { $request = $requested }; $versions = $m.versions; if ($null -eq $versions) { Write-Error 'missing versions'; exit 4 }; if ([string]::IsNullOrWhiteSpace($request)) { Write-Error 'version not found'; exit 2 }; if ($request.StartsWith('v')) { $version = $request } else { $version = ('v' + $request) }; $entry = $versions.$version; if ($null -eq $entry) { Write-Error 'version not found'; exit 2 }; if ([string]::IsNullOrWhiteSpace($entry.commit)) { Write-Error 'missing commit'; exit 3 }; Write-Output ($version + '|' + $entry.commit)"`) do (
    set "RESOLVED_VERSION=%%A"
    set "RESOLVED_COMMIT=%%B"
)
if not defined RESOLVED_VERSION call :fail "解析版本清单失败，请检查版本号：%REQUESTED_VERSION%"
if not defined RESOLVED_COMMIT call :fail "版本缺少 commit 信息。"

call :safePrint "[信息] 目标版本：%RESOLVED_VERSION% (%RESOLVED_COMMIT%)"
set "VERSION_DIR=%VERSIONS_ROOT%\%RESOLVED_VERSION%"

if not exist "%VERSION_DIR%" (
    set "TEMP_SOURCE_DIR=%INSTALL_ROOT%\_tmp_source_%RANDOM%%RANDOM%"
    mkdir "!TEMP_SOURCE_DIR!" >nul 2>&1
    if errorlevel 1 call :fail "创建临时目录失败。"

    call :safePrint "[信息] 下载源码..."
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://codeload.github.com/%PROJECT_REPO%/zip/%RESOLVED_COMMIT%' -OutFile '!TEMP_SOURCE_DIR!\\source.zip' -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
    if errorlevel 1 call :fail "下载源码失败。"

    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -Path '!TEMP_SOURCE_DIR!\\source.zip' -DestinationPath '!TEMP_SOURCE_DIR!' -Force -ErrorAction Stop; $src = Get-ChildItem -Path '!TEMP_SOURCE_DIR!' -Directory | Where-Object { $_.Name -notlike '_tmp_*' } | Select-Object -First 1; if ($null -eq $src) { throw 'missing extracted directory' }; New-Item -ItemType Directory -Path '%VERSION_DIR%' -Force | Out-Null; Copy-Item -Path (Join-Path $src.FullName '*') -Destination '%VERSION_DIR%' -Recurse -Force } catch { Write-Error $_; exit 1 }"
    if errorlevel 1 call :fail "解压或复制源码失败。"

    call :safeRemoveTempDir "!TEMP_SOURCE_DIR!" "%INSTALL_ROOT%"
    set "TEMP_SOURCE_DIR="
) else (
    call :safePrint "[信息] 版本目录已存在，跳过下载。"
)

cd /d "%VERSION_DIR%"
if errorlevel 1 call :fail "无法进入版本目录。"

call :safePrint "[信息] 安装依赖..."
call pnpm install
if errorlevel 1 (
    call :safePrint "[警告] 首次安装失败，重试一次..."
    call pnpm install
    if errorlevel 1 call :fail "依赖安装失败。"
)

call :safePrint "=================================================="
if /i "%COMMAND%"=="start" (
    call :safePrint "[信息] 启动生产模式..."
    call pnpm start
    if errorlevel 1 call :fail "启动失败。"
) else if /i "%COMMAND%"=="dev" (
    call :safePrint "[信息] 启动开发模式..."
    call pnpm run dev
    if errorlevel 1 call :fail "启动失败。"
) else (
    call :safePrint "[信息] 安装完成。"
    call :safePrint "目录结构："
    call :safePrint "  - %NODE_ROOT%"
    call :safePrint "  - %VERSIONS_ROOT%\%RESOLVED_VERSION%"
    echo.
    call :safePrint "使用方式："
    echo   - install.bat [start^|dev] --version ^<version^|latest^> --node-version ^<nodeVersion^>
    echo   - install.bat [start^|dev] -v ^<version^|latest^> -n ^<nodeVersion^>
    call :safePrint "示例："
    call :safePrint "  - install.bat start"
    call :safePrint "  - install.bat dev"
)
call :safePrint "=================================================="

:end
call :safeRemoveTempDir "%TEMP_SOURCE_DIR%" "%INSTALL_ROOT%"
call :safeRemoveTempDir "%TEMP_NODE_DIR%" "%NODE_ROOT%"
set "TEMP_SOURCE_DIR="
set "TEMP_NODE_DIR="
if "%SCRIPT_EXIT_CODE%"=="0" (
    call :safePrint "[信息] 脚本运行完成，即将退出..."
) else (
    call :safePrint "[信息] 脚本异常结束，错误码：%SCRIPT_EXIT_CODE%"
)
call :pauseIfInteractive
exit /b %SCRIPT_EXIT_CODE%

:ensurePnpm
where pnpm >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%i in ('pnpm -v') do set "PNPM_VERSION_INSTALLED=%%i"
    call :safePrint "[信息] 检测到 pnpm !PNPM_VERSION_INSTALLED!"
    exit /b 0
)

where corepack >nul 2>&1
if not errorlevel 1 (
    call :safePrint "[信息] 使用 Corepack 安装 pnpm@%PNPM_VERSION%"
    call corepack enable
    if not errorlevel 1 (
        call corepack prepare pnpm@%PNPM_VERSION% --activate
        if not errorlevel 1 exit /b 0
    )
)

where npm >nul 2>&1
if errorlevel 1 exit /b 1

call npm install -g pnpm@%PNPM_VERSION%
if errorlevel 1 exit /b 1
exit /b 0

:safePrint
setlocal DisableDelayedExpansion
set "SAFE_TEXT=%~1"
<nul set /p "=%SAFE_TEXT%"
echo(
endlocal
exit /b 0

:safeRemoveTempDir
setlocal EnableDelayedExpansion
set "TARGET=%~1"
set "PARENT=%~2"

if not defined TARGET (
    endlocal
    exit /b 0
)
if not defined PARENT (
    endlocal
    exit /b 0
)
if not exist "!TARGET!" (
    endlocal
    exit /b 0
)

for %%I in ("!TARGET!") do set "TARGET_ABS=%%~fI"
for %%I in ("!TARGET!") do set "TARGET_ATTR=%%~aI"
for %%I in ("!PARENT!") do set "PARENT_ABS=%%~fI"
if not defined TARGET_ABS (
    call :safePrint "[警告] 跳过删除，无法解析目标路径：!TARGET!"
    endlocal
    exit /b 0
)
if /i not "!TARGET_ATTR:~0,1!"=="d" (
    call :safePrint "[警告] 跳过删除，目标不是目录：!TARGET!"
    endlocal
    exit /b 0
)
if not defined PARENT_ABS (
    call :safePrint "[警告] 跳过删除，无法解析父目录：!PARENT!"
    endlocal
    exit /b 0
)
if /i "!TARGET_ABS!"=="!PARENT_ABS!" (
    call :safePrint "[警告] 跳过删除，目标路径不安全：!TARGET_ABS!"
    endlocal
    exit /b 0
)

    set "PARENT_PREFIX=!PARENT_ABS!\_tmp_"
    set "TARGET_SUFFIX=!TARGET_ABS:*%PARENT_PREFIX%=!"
    if /i "!TARGET_SUFFIX!"=="!TARGET_ABS!" (
        call :safePrint "[警告] 跳过删除，目录名不符合 _tmp_* 规则：!TARGET_ABS!"
        endlocal
        exit /b 0
    )
    if /i not "!TARGET_ABS!"=="!PARENT_PREFIX!!TARGET_SUFFIX!" (
        call :safePrint "[警告] 跳过删除，目录名不符合 _tmp_* 规则：!TARGET_ABS!"
        endlocal
        exit /b 0
    )

rmdir /s /q "!TARGET_ABS!" >nul 2>&1
if errorlevel 1 (
    call :safePrint "[警告] 删除临时目录失败：!TARGET_ABS!"
) else (
    call :safePrint "[信息] 已删除临时目录：!TARGET_ABS!"
)
endlocal
exit /b 0

:strlen
setlocal EnableDelayedExpansion
set "TEXT=!%~1!"
set /a LEN=0
:strlen_loop
if defined TEXT (
    set "TEXT=!TEXT:~1!"
    set /a LEN+=1
    goto :strlen_loop
)
endlocal & set "%~2=%LEN%"
exit /b 0

:usage
echo 用法:
echo   install.bat [start^|dev] [-v^|--version ^<version^|latest^>] [-n^|--node-version ^<nodeVersion^>]
echo.
echo 参数:
echo   start^|dev              可选，安装完成后直接启动
echo   -v, --version          指定 GhostPing 版本，默认 latest（可用 0.0.1 或 v0.0.1）
echo   -n, --node-version     指定 Node 版本，默认 v20.11.0
echo   -h, --help             显示此帮助
exit /b 0

:parseArgs
if "%~1"=="" exit /b 0

if /i "%~1"=="start" (
    if defined COMMAND call :fail "命令重复：%COMMAND% 与 %~1"
    set "COMMAND=start"
    shift
    goto :parseArgs
)

if /i "%~1"=="dev" (
    if defined COMMAND call :fail "命令重复：%COMMAND% 与 %~1"
    set "COMMAND=dev"
    shift
    goto :parseArgs
)

if /i "%~1"=="-v" (
    if "%~2"=="" call :fail "%~1 缺少版本参数"
    set "REQUESTED_VERSION=%~2"
    shift
    shift
    goto :parseArgs
)

if /i "%~1"=="--version" (
    if "%~2"=="" call :fail "%~1 缺少版本参数"
    set "REQUESTED_VERSION=%~2"
    shift
    shift
    goto :parseArgs
)

if /i "%~1"=="-n" (
    if "%~2"=="" call :fail "%~1 缺少 Node 版本参数"
    set "BUNDLED_NODE_VERSION=%~2"
    shift
    shift
    goto :parseArgs
)

if /i "%~1"=="--node-version" (
    if "%~2"=="" call :fail "%~1 缺少 Node 版本参数"
    set "BUNDLED_NODE_VERSION=%~2"
    shift
    shift
    goto :parseArgs
)

if /i "%~1"=="-h" (
    call :usage
    set "SHOW_HELP=true"
    exit /b 0
)

if /i "%~1"=="--help" (
    call :usage
    set "SHOW_HELP=true"
    exit /b 0
)

call :fail "未知参数: %~1"
exit /b 1

:fail
call :safePrint "[错误] %~1"
set "SCRIPT_EXIT_CODE=1"
goto :end

:pauseIfInteractive
where powershell >nul 2>&1
if errorlevel 1 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 exit /b 0
pause
exit /b 0
