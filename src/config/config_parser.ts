import fs from "fs";
import path from "path";
import { parse as parseToml } from "toml";

interface ServerListConfig {
  host: string;
  port: string;
  version: string;
  [key: string]: string; // 允许添加任意字符串键
}

interface ServerConfig {
  port: string;
  web_port?: string;
  web_host?: string;
  logLevel?: string;
  logFormat?: string;
  host?: string;
  [key: string]: string | undefined; // 允许添加任意字符串键
}

export interface ParsedConfig {
  server_list: ServerListConfig[];
  server: ServerConfig;
}

const DEFAULT_SERVER_CONFIG = {
  port: "25565", // 默认端口
  web_port: "24680", // 默认 web 端口
  logLevel: "info", // 默认日志级别
  logFormat: "combined", // 默认日志格式
  host: "0.0.0.0", // 默认主机
  web_host: "127.0.0.1", // web默认监听地址
  timeout: "600", // 默认探测超时时间 (毫秒)
};

function loadConfig(): ParsedConfig {
  const configDir = path.join(process.cwd(), "data");
  const configPath = path.join(configDir, "config.toml");

  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(configDir, { recursive: true });
    const defaultConfigContent = `# GhostPing 配置文件

[[server_list]]
# 要探测并代理的后端 Minecraft 服务器地址和端口
host = "fun.mortar.top"
port = "${DEFAULT_SERVER_CONFIG.port}"
version = "1.16.5"

# 更多服务器列表可参照以下格式添加：
# [[server_list]]
# host = "play.example.com"
# port = "${DEFAULT_SERVER_CONFIG.port}"
# version = "1.20.4"

[server]
# GhostPing 本地 TCP 代理监听地址与端口
host = "${DEFAULT_SERVER_CONFIG.host}"
port = "${DEFAULT_SERVER_CONFIG.port}"

# Web 控制台/API 监听地址与端口
web_host = "${DEFAULT_SERVER_CONFIG.web_host}"
web_port = "${DEFAULT_SERVER_CONFIG.web_port}"

# 日志级别 (debug, info, warn, error) 与格式 (combined, common)
logLevel = "${DEFAULT_SERVER_CONFIG.logLevel}"
logFormat = "${DEFAULT_SERVER_CONFIG.logFormat}"

# 探测后端服务器状态的超时时间（毫秒），超时会自动降级跳过，防止客户端等待过久而失败
timeout = "${DEFAULT_SERVER_CONFIG.timeout}"
`;
    fs.writeFileSync(configPath, defaultConfigContent, "utf-8");
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = parseToml(content) as Partial<ParsedConfig> & {
    server?: Record<string, unknown>;
    server_list?: unknown;
  };

  const parsedData: ParsedConfig = {
    server_list: [],
    server: { ...DEFAULT_SERVER_CONFIG },
  };

  const rawServer = parsed.server ?? {};
  for (const [key, value] of Object.entries(rawServer)) {
    if (typeof value === "string" || typeof value === "number") {
      parsedData.server[key] = String(value);
    }
  }

  const rawServerList = parsed.server_list;
  const serverListArray = Array.isArray(rawServerList)
    ? rawServerList
    : rawServerList
      ? [rawServerList]
      : [];

  for (const entry of serverListArray) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const host = candidate.host;
    const port = candidate.port;
    const version = candidate.version;
    if (!host || !port) {
      continue;
    }
    parsedData.server_list.push({
      host: String(host),
      port: String(port),
      version: version ? String(version) : "1.16.5",
    });
  }

  return parsedData;
}

export const config = loadConfig();
