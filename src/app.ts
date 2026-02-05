import fs from "fs";
import path from "path";
import os from "os";
import { IncomingMessage, ServerResponse } from "http";
import log from "@utils/logger";
import { config } from "./config/config_parser";
import { Client } from "@utils/serverListPingAPI";
import { ServerStatus, VERSION } from "@declare/delcare_const";
import { version2Protocol } from "@utils/protocol-utils";
import { getServerIcon } from "@utils/image-utils";

type JsonRecord = Record<string, unknown>;
type OffsetFunction = (origin: ServerStatus, servers: ServerStatus[]) => unknown;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const OFFSET_FILE = path.join(process.cwd(), "data", "offset.fn.js");
let offsetFunction: { source: string; fn: OffsetFunction } | null = null;
let offsetInitPromise: Promise<void> | null = null;
const clientsList: Client[] = config.server_list.map(
  (server) => new Client(server.host, server.port, server.version as VERSION)
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const DEFAULT_OFFSET_FUNCTION = `(origin, servers) => {
  const totals = servers.reduce(
    (acc, server) => {
      const players = server?.players || {};
      const online = typeof players.online === "number" ? players.online : 0;
      const max = typeof players.max === "number" ? players.max : 0;
      acc.online += online;
      acc.max += max;
      return acc;
    },
    { online: 0, max: 0 }
  );

  return {
    players: {
      online: totals.online,
      max: totals.max,
    },
    description: [
      "",
      { text: "Mortar", bold: true, color: "aqua" },
      { text: " 自定义偏移函数", bold: true, color: "gold" },
      {
        text: "\\n当前为函数模式展示",
        italic: true,
        underlined: true,
        color: "gray",
      },
    ],
  };
}`;

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const { origin, Origin, referer, Referer } = req.headers;
  let allowOrigin: string | undefined;
  if (process.env.NODE_ENV === "development") {
    allowOrigin = "*";
  } else {
    allowOrigin = (origin || Origin || referer || Referer) as
      | string
      | undefined;
  }

  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as JsonRecord;
  }
  throw new Error("Invalid JSON payload");
}

function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
) {
  let targetPath = pathname;
  if (targetPath === "/") {
    targetPath = "/index.html";
  }

  const relativePath = targetPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(filePath));

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const data = await fs.promises.readFile(filePath);
    res.end(data);
  } catch (err) {
    sendText(res, 404, "Not Found");
  }
}

function buildOriginInfo(
  servers: ServerStatus[],
  protocolVersion: number
): ServerStatus {
  const sample: { name: String; id: String }[] = [];
  for (const server of servers) {
    if (
      server &&
      server.players &&
      server.players.sample &&
      server.version &&
      server.version.name
    ) {
      server.players.sample.forEach((player: (typeof sample)[0]) => {
        player.name = `${player.name} -- ${server.version.name}`;
        sample.push(player);
      });
    }
  }

  const originInfo = JSON.parse(`{
    "version": {
        "name": "mortar",
        "protocol": ${protocolVersion}
    },
    "favicon": "${getServerIcon()}",
    "enforcesSecureChat": true,
    "description": [],
    "players": {
        "max": ${sample.length},
        "online": ${sample.length},
        "sample": ${JSON.stringify(sample)}
    }
  }`) as ServerStatus;

  originInfo.description = [
    "",
    { text: "Mortar", bold: true, color: "aqua" },
    { text: " 全服在线人数统计", bold: true, color: "gold" },
    {
      text: "\n这是你永远也不能到达的境地……",
      italic: true,
      underlined: true,
      color: "gray",
    },
  ];

  return originInfo;
}

function mergeOverride(origin: ServerStatus, override: unknown) {
  if (isRecord(override)) {
    return Object.assign({}, origin, override);
  }
  return origin;
}

function isValidServerStatus(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const version = value.version;
  const players = value.players;
  if (!isRecord(version) || !("protocol" in version) || !("name" in version)) {
    return false;
  }
  if (!isRecord(players) || !("max" in players) || !("online" in players)) {
    return false;
  }
  return "description" in value;
}

function compileOffsetFunction(source: string): OffsetFunction {
  const trimmed = source.trim().replace(/;+\s*$/, "");
  const attempts = [
    () =>
      new Function(
        "origin",
        "servers",
        `return (${trimmed})(origin, servers);`
      ) as OffsetFunction,
    () => new Function("origin", "servers", trimmed) as OffsetFunction,
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function applyOffset(origin: ServerStatus, servers: ServerStatus[]) {
  if (!offsetFunction) {
    return origin;
  }
  try {
    const result = offsetFunction.fn(origin, servers);
    return mergeOverride(origin, result);
  } catch (error) {
    log.error("偏移函数执行失败:", error);
    return origin;
  }
}

async function applyAndPersistOffset(
  source: string,
  options?: { persist?: boolean }
) {
  const fn = compileOffsetFunction(source);
  const sampleServers = await getServerStatuses();
  const originInfo = buildOriginInfo(
    sampleServers,
    version2Protocol("1.16.5")
  );
  const result = fn(originInfo, sampleServers);
  const merged = mergeOverride(originInfo, result);
  if (!isValidServerStatus(merged)) {
    throw new Error("偏移函数返回格式不正确");
  }
  offsetFunction = { source, fn };

  if (options?.persist !== false) {
    await fs.promises.mkdir(path.dirname(OFFSET_FILE), { recursive: true });
    await fs.promises.writeFile(OFFSET_FILE, source, "utf8");
  }
}

async function initOffsetFunction() {
  if (offsetInitPromise) {
    return offsetInitPromise;
  }

  offsetInitPromise = (async () => {
    let source: string | null = null;
    try {
      source = await fs.promises.readFile(OFFSET_FILE, "utf8");
    } catch {
      source = null;
    }

    if (!source || !source.trim()) {
      source = DEFAULT_OFFSET_FUNCTION;
      await fs.promises.mkdir(path.dirname(OFFSET_FILE), { recursive: true });
      await fs.promises.writeFile(OFFSET_FILE, source, "utf8");
    }

    try {
      await applyAndPersistOffset(source, { persist: false });
    } catch (error) {
      log.error("偏移函数初始化失败，已回退到默认函数:", error);
      await applyAndPersistOffset(DEFAULT_OFFSET_FUNCTION);
    }
  })();

  return offsetInitPromise;
}

async function getServerStatuses(): Promise<ServerStatus[]> {
  const promises = clientsList.map((client) =>
    client.getServerStatus().catch((err) => {
      log.error(`服务器状态查询错误: ${err}`);
      return null;
    })
  );

  const results = await Promise.all(promises);
  return results.filter((result) => result !== null) as ServerStatus[];
}

async function handleServer(req: IncomingMessage, res: ServerResponse) {
  try {
    const data = await getServerStatuses();
    sendJson(res, 200, data);
  } catch (error) {
    log.error("处理服务器状态请求时出错:", error);
    sendJson(res, 500, { error: "获取服务器状态时出错" });
  }
}

async function handleServerList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  let protocolVersion = Number.parseInt(
    url.searchParams.get("protocolVersion") || "",
    10
  );
  if (!protocolVersion) {
    protocolVersion = version2Protocol("1.16.5");
  }

  await initOffsetFunction();
  const allServer = await getServerStatuses();
  const originInfo = buildOriginInfo(allServer, protocolVersion);
  const resInfo = applyOffset(originInfo, allServer);
  sendJson(res, 200, resInfo);
}

async function handleOffsetGet(res: ServerResponse) {
  await initOffsetFunction();
  sendJson(res, 200, { "__fn__": offsetFunction?.source || "" });
}

async function handleOffsetPut(req: IncomingMessage, res: ServerResponse) {
  try {
    await initOffsetFunction();
    const body = await readJsonBody(req);
    const fnSource =
      typeof body.__fn__ === "string"
        ? body.__fn__
        : typeof body.fn === "string"
          ? body.fn
          : null;

    if (!fnSource) {
      sendJson(res, 400, { error: "请通过 __fn__ 或 fn 提供函数" });
      return;
    }

    await applyAndPersistOffset(fnSource);
    res.statusCode = 200;
    res.end();
  } catch (err) {
    sendJson(res, 400, { error: "Invalid JSON payload" });
  }
}

async function handleOffsetTestPut(res: ServerResponse) {
  try {
    await applyAndPersistOffset(DEFAULT_OFFSET_FUNCTION);
    sendJson(res, 200, { ok: true, "__fn__": DEFAULT_OFFSET_FUNCTION });
  } catch (error) {
    log.error("偏移函数测试设置失败:", error);
    sendJson(res, 500, { error: "偏移函数测试设置失败" });
  }
}

function handleHealth(res: ServerResponse) {
  const memoryUsage = process.memoryUsage();
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const idlePercentage = (totalIdle / totalTick) * 100;
  const usagePercentage = 100 - idlePercentage;

  sendJson(res, 200, {
    memory: {
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
    },
    cpu: {
      usage: `${usagePercentage.toFixed(2)}%`,
      cores: cpus.length,
    },
    uptime: `${os.uptime()} seconds`,
  });
}

export async function initOffsetStorage() {
  await initOffsetFunction();
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || "GET";

  try {
    if (method === "GET" && pathname === "/health") {
      handleHealth(res);
      return;
    }
    if (method === "GET" && pathname === "/server") {
      await handleServer(req, res);
      return;
    }
    if (method === "GET" && pathname === "/serverlist") {
      await handleServerList(req, res, url);
      return;
    }
    if (pathname === "/offset" && method === "GET") {
      await handleOffsetGet(res);
      return;
    }
    if (pathname === "/offset" && method === "PUT") {
      await handleOffsetPut(req, res);
      return;
    }
    if (pathname === "/offset/testput" && method === "GET") {
      await handleOffsetTestPut(res);
      return;
    }
    if (method === "GET" || method === "HEAD") {
      await serveStatic(req, res, pathname);
      return;
    }

    sendText(res, 405, "Method Not Allowed");
  } catch (error) {
    log.error("HTTP handler error:", error);
    sendJson(res, 500, { error: "Internal Server Error" });
  }
}

export default handleHttpRequest;
