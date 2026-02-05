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

const PUBLIC_DIR = path.join(process.cwd(), "public");
const offsetCache: JsonRecord = {};
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

  const allServer = await getServerStatuses();

  const sample: { name: String; id: String }[] = [];
  for (const server of allServer) {
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

  const resInfo = {};
  Object.assign(resInfo, originInfo, offsetCache);
  sendJson(res, 200, resInfo);
}

function handleOffsetGet(res: ServerResponse) {
  sendJson(res, 200, offsetCache);
}

async function handleOffsetPut(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJsonBody(req);
    Object.keys(offsetCache).forEach((key) => {
      delete offsetCache[key];
    });
    Object.assign(offsetCache, body);
    res.statusCode = 200;
    res.end();
  } catch (err) {
    sendJson(res, 400, { error: "Invalid JSON payload" });
  }
}

function handleOffsetTestPut(res: ServerResponse) {
  Object.keys(offsetCache).forEach((key) => {
    delete offsetCache[key];
  });
  Object.assign(offsetCache, { test: "hello world!" });
  sendJson(res, 200, { ok: true });
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
      handleOffsetGet(res);
      return;
    }
    if (pathname === "/offset" && method === "PUT") {
      await handleOffsetPut(req, res);
      return;
    }
    if (pathname === "/offset/testput" && method === "GET") {
      handleOffsetTestPut(res);
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
