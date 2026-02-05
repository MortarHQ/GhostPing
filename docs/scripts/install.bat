@echo off
setlocal enabledelayedexpansion

:: 设置UTF-8编码
chcp 65001 > nul

:: 接收参数
set "COMMAND=%1"
set "REQUIRED_NODE_VERSION=20"
set "BUNDLED_NODE_VERSION=v20.11.0"
set "PNPM_VERSION=9.0.0"
set "CURRENT_DIR=%CD%"
set "NODE_ZIP_DIR=%CURRENT_DIR%\node_%BUNDLED_NODE_VERSION%"
set "NODE_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=win-arm64"
set "NODE_DIR=%NODE_ZIP_DIR%\node-%BUNDLED_NODE_VERSION%-%NODE_ARCH%"
set "PROJECT_ZIP_URL=https://github.com/MortarHQ/Mortar-Daemon/archive/refs/heads/master.zip"
set "PROJECT_DIR=%CURRENT_DIR%\Mortar-Daemon-master"

:: 安全性提醒
echo [信息] 此脚本将使用PowerShell来下载和解压文件。

:: 检测PowerShell是否可用
where powershell >nul 2>&1
if not %errorlevel% == 0 (
    echo [错误] PowerShell不可用，请确保你的系统支持PowerShell。
    goto :end
)

:: 检查系统是否已安装Node.js
set "USE_SYSTEM_NODE=false"
where node >nul 2>&1
if %errorlevel% == 0 (
    for /f "tokens=*" %%i in ('node -v') do set "NODE_VERSION=%%i"
    echo [信息] 检测到系统已安装Node.js !NODE_VERSION!
    
    :: 提取主版本号
    set "VERSION_NUMBER=!NODE_VERSION:~1!"
    for /f "tokens=1 delims=." %%a in ("!VERSION_NUMBER!") do set "MAJOR_VERSION=%%a"
    
    if !MAJOR_VERSION! geq %REQUIRED_NODE_VERSION% (
        echo [信息] 系统Node.js版本满足要求^(^>= v%REQUIRED_NODE_VERSION%^)
        set "USE_SYSTEM_NODE=true"
    ) else (
        echo [警告] 系统Node.js版本^(!NODE_VERSION!^)低于推荐版本^(v%REQUIRED_NODE_VERSION%^)
        set /p CONTINUE_WITH_SYSTEM_NODE="是否继续使用当前系统的Node.js？(y/n): "
        if /i "!CONTINUE_WITH_SYSTEM_NODE!"=="y" (
            echo [信息] 将使用系统Node.js!NODE_VERSION!
            set "USE_SYSTEM_NODE=true"
        ) else (
            echo [信息] 将使用脚本提供的Node.js%BUNDLED_NODE_VERSION%
        )
    )
) else (
    echo [信息] 系统未安装Node.js，将使用脚本提供的Node.js%BUNDLED_NODE_VERSION%
)

:: 如果不使用系统Node.js，则检查本地是否已有指定版本的Node.js
if "%USE_SYSTEM_NODE%"=="false" (
    if not exist "%NODE_DIR%" (
        echo [信息] Node.js%BUNDLED_NODE_VERSION%未在当前目录找到，正在下载...
        
        if not exist "%NODE_ZIP_DIR%" (
            mkdir "%NODE_ZIP_DIR%" >nul 2>&1
            if not %errorlevel% == 0 (
                echo [错误] 创建Node.js目录失败。
                goto :end
            )
        )
        
        cd "%NODE_ZIP_DIR%"
        
        :: 下载Node.js
        echo [信息] 正在下载Node.js...
        powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/%BUNDLED_NODE_VERSION%/node-%BUNDLED_NODE_VERSION%-%NODE_ARCH%.zip' -OutFile 'node.zip'}"
        if not %errorlevel% == 0 (
            echo [错误] 下载Node.js失败。
            cd "%CURRENT_DIR%"
            goto :end
        )
        
        :: 解压Node.js
        echo [信息] 正在解压Node.js...
        powershell -Command "& {Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force}"
        if not %errorlevel% == 0 (
            echo [错误] 解压Node.js失败。
            cd "%CURRENT_DIR%"
            goto :end
        )
        
        :: 清理下载的zip文件
        del /q "node.zip" >nul 2>&1
        if not %errorlevel% == 0 (
            echo [警告] 清理Node.js安装包失败，但将继续执行。
        )
        
        echo [信息] Node.js%BUNDLED_NODE_VERSION%安装完成。
        cd "%CURRENT_DIR%"
    ) else (
        echo [信息] 使用当前目录下的Node.js%BUNDLED_NODE_VERSION%
    )
    
    :: 设置环境变量使用下载的Node.js
    set "PATH=%NODE_DIR%;%PATH%"
)

:: 确保 pnpm 可用
call :ensurePnpm
if not %errorlevel% == 0 goto :end

:: 下载项目文件
if not exist "%PROJECT_DIR%" (
    echo [信息] 正在下载项目文件...
    
    :: 下载项目文件
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PROJECT_ZIP_URL%' -OutFile '%CURRENT_DIR%\project.zip'}"
    if not %errorlevel% == 0 (
        echo [错误] 下载项目文件失败。
        goto :end
    )
    
    :: 解压项目文件
    echo [信息] 正在解压项目文件...
    powershell -Command "& {Expand-Archive -Path '%CURRENT_DIR%\project.zip' -DestinationPath '%CURRENT_DIR%' -Force}"
    if not %errorlevel% == 0 (
        echo [错误] 解压项目文件失败。
        goto :end
    )
    
    :: 清理下载的zip文件
    del /q "%CURRENT_DIR%\project.zip" >nul 2>&1
    if not %errorlevel% == 0 (
        echo [警告] 清理项目安装包失败，但将继续执行。
    )
    
    echo [信息] 项目文件下载并解压完成。
) else (
    echo [信息] 项目目录已存在。
)

:: 安装依赖并运行项目
cd "%PROJECT_DIR%"
if not %errorlevel% == 0 (
    echo [错误] 无法进入项目目录。
    goto :end
)

echo [信息] 正在安装依赖...
call pnpm install
if not %errorlevel% == 0 (
    echo [警告] 首次安装依赖失败，尝试重新安装...
    call pnpm install
    if not %errorlevel% == 0 (
        echo [错误] 依赖安装失败，终止执行。
        goto :end
    )
)

echo ==================================================
if "%COMMAND%"=="start" (
    echo [信息] 尝试启动项目...
    call pnpm start
    if not %errorlevel% == 0 (
        echo [警告] 启动失败，尝试重新安装依赖...
        call pnpm install
        if not %errorlevel% == 0 (
            echo [错误] 依赖重新安装失败，终止执行。
            goto :end
        )
        call pnpm start
        if not %errorlevel% == 0 (
            echo [错误] 项目启动失败，请检查错误日志。
            goto :end
        )
    )
) else if "%COMMAND%"=="dev" (
    echo [信息] 尝试以开发模式启动项目...
    call pnpm run dev
    if not %errorlevel% == 0 (
        echo [警告] 启动失败，尝试重新安装依赖...
        call pnpm install
        if not %errorlevel% == 0 (
            echo [错误] 依赖重新安装失败，终止执行。
            goto :end
        )
        call pnpm run dev
        if not %errorlevel% == 0 (
            echo [错误] 项目开发模式启动失败，请检查错误日志。
            goto :end
        )
    )
) else (
    echo [信息] 安装完成！
    echo.
    echo 启动指令
    echo  - 生产模式 请运行 install.bat start
    echo  - 开发模式 请运行 install.bat dev
    echo.
)
echo ==================================================

:end
echo [信息] 脚本运行完成，即将退出...
pause
goto :eof

:ensurePnpm
where pnpm >nul 2>&1
if %errorlevel% == 0 (
    for /f "tokens=*" %%i in ('pnpm -v') do set "PNPM_VERSION_INSTALLED=%%i"
    echo [信息] 检测到pnpm !PNPM_VERSION_INSTALLED!
    exit /b 0
)

where corepack >nul 2>&1
if %errorlevel% == 0 (
    echo [信息] 正在启用Corepack并安装pnpm@%PNPM_VERSION%...
    call corepack enable
    if %errorlevel% == 0 (
        call corepack prepare pnpm@%PNPM_VERSION% --activate
        if %errorlevel% == 0 exit /b 0
    )
    echo [警告] Corepack安装pnpm失败，尝试使用npm安装...
)

where npm >nul 2>&1
if not %errorlevel% == 0 (
    echo [错误] 未找到npm，无法安装pnpm。
    exit /b 1
)

call npm install -g pnpm@%PNPM_VERSION%
if not %errorlevel% == 0 (
    echo [错误] 安装pnpm失败。
    exit /b 1
)
exit /b 0
