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
  logLevel?: string;
  logFormat?: string;
  host?: string;
  [key: string]: string | undefined; // 允许添加任意字符串键
}

export interface ParsedConfig {
  server_list: ServerListConfig[];
  server: ServerConfig;
}

function loadConfig(): ParsedConfig {
  const configPath = path.join(process.cwd(), "data", "config.toml");
  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = parseToml(content) as Partial<ParsedConfig> & {
    server?: Record<string, unknown>;
    server_list?: unknown;
  };

  const parsedData: ParsedConfig = {
    server_list: [],
    server: {
      port: "25565", // 默认端口
      web_port: "24680", // 默认 web 端口
      logLevel: "info", // 默认日志级别
      logFormat: "combined", // 默认日志格式
      host: "0.0.0.0", // 默认主机
    },
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
