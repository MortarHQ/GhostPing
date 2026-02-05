import http from "http";
import net from "net";
import { pathToFileURL } from "url";
import log from "@utils/logger";
import { config } from "./config/config_parser";
import { MinecraftProtocolHandler } from "@utils/serverListPingAPI";
import handleHttpRequest from "./app";

export type UnifiedServer = {
  netServer: net.Server;
  httpServer: http.Server;
  host: string;
  port: number;
};

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "PRI",
];

function looksLikeHttp(data: Buffer) {
  if (data.length < 4) {
    return false;
  }
  const head = data.toString("ascii", 0, Math.min(data.length, 12));
  return HTTP_METHODS.some((method) => head.startsWith(`${method} `));
}

export function createUnifiedServer(): {
  netServer: net.Server;
  httpServer: http.Server;
} {
  const httpServer = http.createServer(handleHttpRequest);
  httpServer.on("clientError", (err, socket) => {
    log.warn(`HTTP client error: ${err.message}`);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  const netServer = net.createServer((socket) => {
    socket.once("data", (firstChunk) => {
      if (looksLikeHttp(firstChunk)) {
        socket.unshift(firstChunk);
        httpServer.emit("connection", socket);
        return;
      }

      const protocolHandler = new MinecraftProtocolHandler(socket);
      const onData = (data: Buffer) => {
        protocolHandler.handlePacket(data).catch((err) => {
          log.error("处理数据包时出错:", err);
          socket.destroy();
        });
      };

      onData(firstChunk);
      socket.on("data", onData);

      socket.on("error", (err) => {
        log.error(`Socket错误: ${err.message}`);
        socket.destroy();
      });

      socket.on("close", () => {
        log.debug(`连接已关闭: ${socket.remoteAddress}:${socket.remotePort}`);
      });
    });

    socket.on("error", (err) => {
      log.error(`Socket错误: ${err.message}`);
    });
  });

  return { netServer, httpServer };
}

export function startUnifiedServer(options?: {
  host?: string;
  port?: number;
}): Promise<UnifiedServer> {
  const host = options?.host ?? config.server.host ?? "0.0.0.0";
  const rawPort = options?.port ?? Number.parseInt(config.server.port, 10);
  const port = Number.isFinite(rawPort) ? rawPort : 25565;

  const { netServer, httpServer } = createUnifiedServer();

  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      netServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      netServer.off("error", onError);
      const addr = netServer.address();
      const actualPort =
        typeof addr === "string" ? port : addr?.port ?? port;
      resolve({ netServer, httpServer, host, port: actualPort });
    };

    netServer.once("error", onError);
    netServer.once("listening", onListening);
    netServer.listen(port, host);
  });
}

function isMainModule() {
  const mainPath = process.argv[1];
  if (!mainPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(mainPath).href;
}

if (isMainModule()) {
  log.info("Starting server...");
  startUnifiedServer()
    .then(({ host, port }) => {
      log.info(`TCP 已启动，监听 ${host}:${port}`);
      log.info(`HTTP 已启动，监听 http://${host}:${port}`);
    })
    .catch((err) => {
      log.error(`启动失败: ${err.message}`);
      process.exit(1);
    });

  process.on("uncaughtException", (err) => {
    log.error(`Uncaught Exception: ${err.message}`);
    console.trace(err);
  });
}
