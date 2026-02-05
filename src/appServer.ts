import http from "http";
import net from "net";
import { pathToFileURL } from "url";
import log from "@utils/logger";
import { config } from "./config/config_parser";
import { MinecraftProtocolHandler } from "@utils/serverListPingAPI";
import handleHttpRequest, { initOffsetStorage } from "./app";

export type ServerHandles = {
  tcpServer: net.Server;
  httpServer: http.Server;
  tcpHost: string;
  httpHost: string;
  tcpPort: number;
  httpPort: number;
};

function createTcpServer() {
  return net.createServer((socket) => {
    const protocolHandler = new MinecraftProtocolHandler(socket);
    const onData = (data: Buffer) => {
      protocolHandler.handlePacket(data).catch((err) => {
        log.error("处理数据包时出错:", err);
        socket.destroy();
      });
    };

    socket.on("data", onData);

    socket.on("error", (err) => {
      log.error(`Socket错误: ${err.message}`);
      socket.destroy();
    });

    socket.on("close", () => {
      log.debug(`连接已关闭: ${socket.remoteAddress}:${socket.remotePort}`);
    });
  });
}

function createHttpServer() {
  const httpServer = http.createServer(handleHttpRequest);
  httpServer.on("clientError", (err, socket) => {
    log.warn(`HTTP client error: ${err.message}`);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  return httpServer;
}

export function startServers(options?: {
  tcpHost?: string;
  httpHost?: string;
  tcpPort?: number;
  httpPort?: number;
}): Promise<ServerHandles> {
  const tcpHost = options?.tcpHost ?? config.server.host ?? "0.0.0.0";
  const httpHost = options?.httpHost ?? config.server.web_host ?? "127.0.0.1";
  const rawTcpPort =
    options?.tcpPort ?? Number.parseInt(config.server.port, 10);
  const rawHttpPort = options?.httpPort
    ? options.httpPort
    : config.server.web_port
      ? Number.parseInt(config.server.web_port, 10)
      : NaN;
  const tcpPort = Number.isFinite(rawTcpPort) ? rawTcpPort : 25565;
  const httpPort = Number.isFinite(rawHttpPort) ? rawHttpPort : 24680;

  const tcpServer = createTcpServer();
  const httpServer = createHttpServer();

  return new Promise((resolve, reject) => {
    let ready = 0;
    const onReady = () => {
      ready += 1;
      if (ready === 2) {
        resolve({ tcpServer, httpServer, tcpHost, httpHost, tcpPort, httpPort });
      }
    };

    const onError = (err: Error) => {
      tcpServer.off("listening", onReady);
      httpServer.off("listening", onReady);
      tcpServer.close();
      httpServer.close();
      reject(err);
    };

    tcpServer.once("error", onError);
    httpServer.once("error", onError);

    tcpServer.once("listening", onReady);
    httpServer.once("listening", onReady);

    tcpServer.listen(tcpPort, tcpHost);
    httpServer.listen(httpPort, httpHost);
  });
}

function isMainModule() {
  const mainPath = process.argv[1];
  if (!mainPath) {
    return false;
  }
  const normalizeUrl = (value: string) => value.split(/[?#]/)[0];
  return normalizeUrl(import.meta.url) === normalizeUrl(pathToFileURL(mainPath).href);
}

if (isMainModule()) {
  log.info("Starting server...");
  initOffsetStorage()
    .then(() => startServers())
    .then(({ tcpHost, httpHost, tcpPort, httpPort }) => {
      log.info(`TCP 已启动，监听 ${tcpHost}:${tcpPort}`);
      log.info(`HTTP 已启动，监听 http://${httpHost}:${httpPort}`);
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
