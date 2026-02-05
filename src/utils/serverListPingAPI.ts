import net, { Socket } from "net";
import { Buffer } from "buffer";
import log from "@utils/logger";
import varint from "varint";
import { encodeProtocol } from "@utils/protocol-utils";
import { config } from "../config/config_parser";
import { ServerStatus, VERSION } from "@declare/delcare_const";
import { getServerIcon } from "@utils/image-utils";

const SERVERLIST = "/serverlist";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildFallbackStatus(protocolVersion: number): ServerStatus {
  const fallback = JSON.parse(`{
    "version": {
        "name": "mortar",
        "protocol": ${protocolVersion}
    },
    "favicon": "${getServerIcon()}",
    "enforcesSecureChat": true,
    "description": [],
    "players": {
        "max": 0,
        "online": 0,
        "sample": []
    }
  }`) as ServerStatus;

  fallback.description = [
    "",
    { text: "Mortar", bold: true, color: "aqua" },
    { text: " 全服在线人数统计", bold: true, color: "gold" },
    {
      text: "\n暂无可用服务器",
      italic: true,
      underlined: true,
      color: "gray",
    },
  ];

  return fallback;
}

class MinecraftProtocolHandler {
  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  // 处理接收到的数据包
  async handlePacket(data: Buffer): Promise<void> {
    try {
      // 处理旧版本协议
      if (data[0] === 0xfe) {
        log.info(
          `旧版本协议请求(<=1.6)，来自: ${this.socket.remoteAddress}，暂不响应`
        );
        this.socket.destroy();
        return;
      }

      // 解析数据包
      const { length, packetID } = decodePacketID(data);

      log.debug(
        `收到数据包: ID=${packetID.value}, 长度=${data.length}, 数据=${data
          .toString("hex")
          .substring(0, 50)}...`
      );

      // 根据包ID分发处理
      switch (packetID.value) {
        case 0x01: // Ping请求
          await this.handlePingRequest(data);
          break;

        case 0x00: // Handshake或Status请求
          if (data.length === 2) {
            log.debug("收到Status Request，等待后续数据包");
            return; // 不处理空的状态请求，等待后续数据包
          }
          await this.handleHandshake(data);
          break;

        default:
          log.warn(`未知数据包类型: ${packetID.value}`);
          this.socket.destroy();
      }
    } catch (err) {
      log.error("处理数据包出错:", err);
      this.socket.destroy();
    }
  }

  // 处理Ping请求
  private async handlePingRequest(data: Buffer): Promise<void> {
    log.info(
      `Ping请求，来自: ${this.socket.remoteAddress}:${this.socket.remotePort}`
    );
    // Ping请求只需原样返回数据
    this.socket.write(new Uint8Array(data));
    this.socket.destroy(); // 完成后关闭连接
  }

  // 处理Handshake包
  private async handleHandshake(data: Buffer): Promise<void> {
    try {
      // 解析协议版本、地址、端口和下一状态
      const { length, packetID } = decodePacketID(data);

      // 安全检查: packetID
      if (packetID.offset >= data.length) {
        throw new Error("无效的数据包格式");
      }

      const protocolVersion = readVarInt(data, packetID.offset);

      // 安全检查: 协议版本
      if (protocolVersion.offset >= data.length) {
        throw new Error("协议版本偏移量超出范围");
      }

      const addressLength = readVarInt(data, protocolVersion.offset);

      // 安全检查: 地址长度
      if (
        addressLength.offset >= data.length ||
        addressLength.offset + addressLength.value > data.length
      ) {
        throw new Error("地址长度超出范围");
      }

      const address = data.toString(
        "utf-8",
        addressLength.offset,
        addressLength.offset + addressLength.value
      );

      const portOffset = addressLength.offset + addressLength.value;

      // 安全检查: 端口偏移量
      if (portOffset + 2 > data.length) {
        throw new Error("端口偏移量超出范围");
      }

      const port = data.readUInt16BE(portOffset);

      // 安全检查: 状态偏移量
      if (portOffset + 2 >= data.length) {
        throw new Error("状态偏移量超出范围");
      }

      const nextState = readVarInt(data, portOffset + 2);

      log.info(
        `收到Handshake请求，状态值: ${nextState.value}, 地址: ${address}:${port}, 协议版本: ${protocolVersion.value}`
      );

      // 根据状态值处理
      switch (nextState.value) {
        case 0x01: // 状态查询
          await this.handleStatusRequest(protocolVersion.value);
          break;
        case 0x02: // 登录请求
          await this.handleLoginRequest();
          this.socket.destroy(); // 登录请求处理完后关闭连接
          break;
        default:
          log.warn(`未知状态值: ${nextState.value}`);
          this.socket.destroy();
      }
    } catch (err) {
      log.error("处理Handshake出错:", err);
      this.socket.destroy();
    }
  }

  // 处理状态查询请求
  private async handleStatusRequest(protocolVersion: number): Promise<void> {
    log.info(`处理状态查询请求，来自: ${this.socket.remoteAddress}`);
    try {
      // 从API获取服务器列表
      const rawHost = config.server.host || "localhost";
      const fetchHost =
        rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
      const rawWebPort = config.server.web_port
        ? Number.parseInt(config.server.web_port, 10)
        : NaN;
      const webPort = Number.isFinite(rawWebPort)
        ? rawWebPort
        : Number.parseInt(config.server.port, 10) || 24680;
      const uri = `http://${fetchHost}:${webPort}${SERVERLIST}?protocolVersion=${protocolVersion}`;

      const requestInit = {
        headers: {
          "X-Forwarded-For": this.socket.remoteAddress,
        },
      } as RequestInit;

      const serverList = await fetch(uri, requestInit)
        .then((response) => response.json())
        .then((data) => data)
        .catch((error) => {
          log.error(import.meta.filename);
          log.error(error);
          return [];
        });

      const responsePayload = isRecord(serverList)
        ? serverList
        : buildFallbackStatus(protocolVersion);

      // 创建响应包并发送
      const responsePacket = createServerStatusPacket(
        Buffer.from(JSON.stringify(responsePayload))
      );

      this.socket.write(new Uint8Array(responsePacket));
    } catch (err) {
      log.error("处理状态查询请求出错:", err);
      this.socket.destroy();
    }
  }

  // 处理登录请求
  private async handleLoginRequest(): Promise<void> {
    log.info(`处理登录请求，来自: ${this.socket.remoteAddress}`);
    try {
      // 创建断开连接数据包
      const disconnectPacket = createLoginDisconnectPacket(this.socket);
      this.socket.write(new Uint8Array(disconnectPacket));
    } catch (err) {
      log.error("处理登录请求出错:", err);
      this.socket.destroy();
    }
  }
}

// 原有的Client类，保持不变
class Client {
  private host;
  private port;
  private version;
  constructor(host: string, port: string, version: VERSION) {
    this.host = host;
    this.port = port;
    this.version = version;
  }

  async getServerStatus(): Promise<ServerStatus> {
    return await getServerStatus(this.host, this.port, this.version);
  }
}

// 创建登录状态下的断开连接数据包
function createLoginDisconnectPacket(socket: net.Socket): Buffer {
  // 在登录状态下的断开连接包ID是0x00
  const packetID = Buffer.from([0x00]);

  // 使用更简单的方法处理Unicode转义
  function escapeUnicode(jsonStr: string) {
    return jsonStr.replace(/[\u0080-\uFFFF]/g, function (match) {
      return "\\u" + ("0000" + match.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  // 创建具有丰富格式的消息对象
  const messageObj = {
    text: "非游戏服务器\n",
    extra: [
      {
        text: "请选择其他服务器\n",
        bold: true,
        color: "red",
      },
      {
        text: `请求时间: ${new Date().toLocaleString()}\n`,
        color: "gray",
        italic: true,
      },
      {
        text: `请求IP: ${socket.remoteAddress}`,
        color: "gray",
        italic: true,
      },
    ],
  };

  // 先使用JSON.stringify，然后转换Unicode
  const jsonString = escapeUnicode(JSON.stringify(messageObj));

  // 编码字符串长度
  const messageLength = Buffer.from(varint.encode(jsonString.length));
  const messageBuffer = Buffer.from(jsonString, "utf8");

  const packet = Buffer.concat([
    new Uint8Array(packetID),
    new Uint8Array(messageLength),
    new Uint8Array(messageBuffer),
  ]);

  return createPacket(packet);
}

function getServerStatus(
  serverAddress: string,
  serverPort: string,
  version: VERSION = "1.16.5"
) {
  return new Promise<ServerStatus>((resolve, reject) => {
    log.info(`正在获取 ${serverAddress}:${serverPort} ${version} 服务器状态`);
    const client = new net.Socket();

    client.connect(parseInt(serverPort, 10), serverAddress, () => {
      const handshakePacket = createHandshakePacket(
        serverAddress,
        parseInt(serverPort, 10),
        version
      );
      client.write(new Uint8Array(handshakePacket));

      const statusRequestPacket = createStatusRequestPacket();
      client.write(new Uint8Array(statusRequestPacket));
    });

    let buffer = Buffer.alloc(0);
    client.on("data", (data) => {
      buffer = Buffer.concat([new Uint8Array(buffer), new Uint8Array(data)]);
      let varint = readVarInt(buffer, 0);
      if (buffer.length < varint.value) {
        return;
      } else {
        const res = parseServerStatusPacket(serverAddress, serverPort, buffer);
        resolve(res);
        client.destroy();
        log.info(
          `获取 ${serverAddress}:${serverPort} ${version} 服务器状态成功！`
        );
      }
    });

    client.on("error", (error) => {
      log.error("Error", error);
      reject(error);
    });

    client.on("close", () => {
      client.destroy();
      const msg = `${serverAddress}:${serverPort} ${version} 服务器关闭 跳过检测！`;
      reject(msg);
    });

    client.setTimeout(1000, () => {
      client.destroy();
      const msg = `${serverAddress}:${serverPort} ${version} 连接超时，跳过查询！`;
      reject(msg);
    });
  });
}

function createServerStatusPacket(jsonBuffer: Buffer) {
  const jsonPacket = createPacket(jsonBuffer);
  const varInt = Buffer.from(varint.encode(0));

  const buffer = Buffer.concat([
    new Uint8Array(varInt),
    new Uint8Array(jsonPacket),
  ]);

  return createPacket(buffer);
}

function parseServerStatusPacket(
  serverAddress: String,
  serverPort: String,
  packet: Buffer
) {
  const varInt1 = readVarInt(packet, 0);
  const varInt2 = readVarInt(packet, varInt1.offset);
  const varInt3 = readVarInt(packet, varInt2.offset);
  log.debug(
    JSON.stringify({
      title: { value: `${serverAddress}:${serverPort}` },
      varInt1,
      varInt2,
      varInt3,
    })
  );

  const jsonBuffer = packet.slice(
    varInt3.offset,
    varInt3.offset + varInt3.value
  );
  const jsonData = jsonBuffer.toString("utf-8");
  try {
    const jsonResponse = JSON.parse(jsonData);
    return jsonResponse;
  } catch (error) {
    return error;
  }
}

function createHandshakePacket(
  address: string,
  port: number,
  version: VERSION
): Buffer {
  const packetID = Buffer.from([0x00]);
  const protocolVersion = encodeProtocol(version, log);
  const addressBuf = createPacket(Buffer.from(address));
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  const state = Buffer.from([0x01]);

  const packet = Buffer.concat([
    new Uint8Array(packetID),
    new Uint8Array(protocolVersion),
    new Uint8Array(addressBuf),
    new Uint8Array(portBuf),
    new Uint8Array(state),
  ]);

  return createPacket(packet);
}

function createStatusRequestPacket(): Buffer {
  const packetID = Buffer.from([0x00]);
  const packet = Buffer.concat([new Uint8Array(packetID)]);
  return createPacket(packet);
}

function createPacket(data: Buffer): Buffer {
  const length = Buffer.from(varint.encode(data.length));
  const res = Buffer.concat([new Uint8Array(length), new Uint8Array(data)]);
  return res;
}

function decodePacketID(data: Buffer) {
  const length = readVarInt(data, 0);
  const packetID = readVarInt(data, length.offset);
  return { length, packetID };
}

function readVarInt(buffer: Buffer, offset: number) {
  if (offset >= buffer.length) {
    log.error(`offset:${offset} buffer:${buffer.toString("hex")}`);
    throw new Error("Invalid varint");
  }
  const result = varint.decode(new Uint8Array(buffer), offset);
  // @ts-ignore
  const newOffset = offset + varint.decode.bytes;

  return {
    value: result,
    offset: newOffset,
  };
}

// 导出需要的类和函数
export { MinecraftProtocolHandler, Client, decodePacketID };
