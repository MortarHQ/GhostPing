# Mortar Daemon

## 简介

MD是一个轻量化的伪造的MineCraft服务端应用，利用LSP协议达成对客户端的各种显示效果。  
![server status png](docs/img/ServerStatus.png)
您只需要简单的修改JSON信息即可创建一个高度自定义的状态信息！

``` JSON
{
  "players": {
    "max": -300,
    "online": -300
  }
}
```  

***修改后***：
![server status png](docs/img/ServerStatus~1.png)

## 一键安装

为了简化安装过程，特别提供了一键安装脚本，适用于Windows和Linux系统。请根据您的操作系统执行相应的命令。

### Windows

在Windows系统中，您可以通过运行以下PowerShell命令来启动安装过程：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/MortarHQ/Mortar-Daemon/master/docs/scripts/install.bat" -OutFile "install.bat"; .\install.bat
```

这条命令会自动从项目仓库下载安装脚本并立即执行它（脚本内部使用 pnpm 安装依赖）。

### Linux

在Linux系统中，您可以使用以下命令来一键安装：

```bash
curl -sL https://raw.githubusercontent.com/MortarHQ/Mortar-Daemon/master/docs/scripts/install.sh > install.sh && bash install.sh
```

这条命令会从您的项目仓库下载安装脚本并立即执行它（脚本内部使用 pnpm 安装依赖）。

**注意**：出于安全考虑，运行来自互联网的脚本之前，请确保您已经审核了脚本的内容。

## 主要技术栈

- **Node.js net/http**: 原生 TCP + HTTP 处理
- **TypeScript**: `JavaScript` 的一个超集，增加了类型系统
- **Pino**: 日志系统
- **LSP**: `MineCraft` 服务器状态获取协议

## 项目结构

- `src/app.ts` 和 `src/appServer.ts`: HTTP 处理器与 TCP+HTTP 统一入口。
- `src/mcClient.ts` 与 `test.json`: 模拟 Minecraft 客户端请求并输出结果。
- `src/config` 目录: 配置解析逻辑。
- `public` 目录: Web 控制台静态资源。
- `src/utils` 目录: 工具函数与协议实现。

## 安装与运行

### 安装依赖

在项目根目录下运行以下命令安装依赖：

```bash
pnpm install
```

### 开发模式

要在开发模式下运行前端和守护进程，请执行：

```bash
pnpm run dev
```

### 生产模式

要在生产模式下运行前端和守护进程，请执行：

```bash
pnpm start
```

### 客户端请求

模拟 Minecraft 客户端访问任意服务端：

```bash
pnpm run mc:ping -- <host:port> --version 1.16.5
```

默认输出到 `test.json`。也可以通过环境变量指定：

```bash
MC_HOST=bgp.mortar.top MC_PORT=25565 MC_VERSION=1.16.5 MC_OUT=test.json pnpm run mc:ping
```

## 配置

项目的配置通过配置文件进行管理：

1. **配置文件**：项目的配置文件位于 `data/config.toml` 中。您可以根据需要修改这些配置，以适应不同的环境和需求。
   - `server.port`: Minecraft TCP 端口，默认 `25565`
   - `server.web_port`: Web 控制台端口，默认 `24680`
   - `data/offset.fn.js`: 偏移函数脚本，服务端启动时自动读取/写入

## 使用方式

本 web 控制台提供了一个直观的界面，用于管理和监控 Minecraft 服务器的状态。以下是如何使用此控制台的步骤：

1. **访问控制台**：在浏览器中输入部署此应用的服务器地址，即可访问 web 控制台。

2. **编辑偏移值**：在控制台的偏移区域，您可以直接编辑当前的偏移值（`offset`）。该值以 JSON 格式展示，确保您输入的是有效的 JSON 数据。

3. **提交偏移值**：编辑完成后，点击“提交偏移”按钮以更新服务器上的偏移值。如果输入的数据格式不正确，将收到“不符合json文本！”的错误提示。如果数据未发生变化，将提示“没有发生变化”。

4. **重置偏移值**：若需撤销对偏移值的更改，点击“重置偏移”按钮。系统将恢复到您最近一次提交的偏移值。

5. **查看服务器列表**：控制台还展示了当前的服务器列表（`serverList`），以 JSON 格式呈现，让您能够快速查看当前伪造的服务器状态。

通过这个控制台，用户可以轻松地管理 Minecraft 服务器的偏移值和查看服务器状态，实现对服务器状态的实时监控和调整。

## 贡献

欢迎通过 Pull Requests 或 Issues 来贡献您的代码或提出您的建议。

## 许可信息

[待添加]

---

感谢您对本项目的关注，希望它能帮助您更好地了解和使用Minecraft List Ping协议
