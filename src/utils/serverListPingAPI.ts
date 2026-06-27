import net, { Socket } from "net";
import dns from "dns";
import { Buffer } from "buffer";
import log from "@utils/logger";
import varint from "varint";
import { encodeProtocol, protocol2Version, buildChatComponent } from "@utils/protocol-utils";
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

  fallback.description = buildChatComponent([
    { text: "Mortar", bold: true, color: "aqua" },
    { text: " 全服在线人数统计", bold: true, color: "gold" },
    {
      text: "\n暂无可用服务器",
      italic: true,
      underlined: true,
      color: "gray",
    },
  ]);

  return fallback;
}

function hasCompleteVarInt(buffer: Buffer, offset: number): boolean {
  for (let i = offset; i < buffer.length && i < offset + 5; i++) {
    if ((buffer[i] & 0x80) === 0) {
      return true;
    }
  }
  return false;
}

class MinecraftProtocolHandler {
  private socket: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private state: "HANDSHAKE" | "STATUS" | "LOGIN" = "HANDSHAKE";
  private protocolVersion: number = 765; // 默认协议版本，在 Handshake 中更新

  constructor(socket: Socket) {
    this.socket = socket;
  }

  // 处理接收到的数据包
  async handlePacket(data: Buffer): Promise<void> {
    try {
      // 累加接收到的数据
      this.buffer = Buffer.concat([new Uint8Array(this.buffer), new Uint8Array(data)]);

      // 处理旧版本协议
      if (this.buffer.length > 0 && this.buffer[0] === 0xfe) {
        log.info(
          `旧版本协议请求(<=1.6)，来自: ${this.socket.remoteAddress}，暂不响应`
        );
        this.socket.destroy();
        return;
      }

      // 循环处理缓冲区中所有完整的数据包
      while (true) {
        if (!hasCompleteVarInt(this.buffer, 0)) {
          break; // 数据不够解析 Packet Length，继续等待
        }

        const lengthVarInt = varint.decode(new Uint8Array(this.buffer), 0);
        // @ts-ignore
        const lengthBytes = varint.decode.bytes;
        const packetLength = lengthVarInt; // 实际包体长度

        if (this.buffer.length < lengthBytes + packetLength) {
          break; // 包体未完全接收，退出循环等待
        }

        // 截取当前完整的包
        const packet = this.buffer.subarray(0, lengthBytes + packetLength);
        
        // 移出当前已处理的包
        this.buffer = this.buffer.subarray(lengthBytes + packetLength);

        // 调度处理完整包
        await this.processPacket(packet);

        if (this.socket.destroyed) {
          break;
        }
      }
    } catch (err) {
      log.error("处理数据包出错:", err);
      this.socket.destroy();
    }
  }

  // 内部包处理逻辑
  private async processPacket(packet: Buffer): Promise<void> {
    // 解析数据包
    const { length, packetID } = decodePacketID(packet);

    log.debug(
      `[TCP] 收到数据包: ID=0x${packetID.value.toString(16).padStart(2, "0")}, 长度=${packet.length} 字节, State=${this.state}`
    );

    if (this.state === "HANDSHAKE") {
      if (packetID.value === 0x00) {
        await this.handleHandshake(packet);
      } else {
        log.warn(`在 HANDSHAKE 状态收到非 0x00 包: 0x${packetID.value.toString(16)}`);
        this.socket.destroy();
      }
    } else if (this.state === "STATUS") {
      if (packetID.value === 0x00) {
        // Status Request (0x00)
        log.info(`处理状态查询请求，来自: ${this.socket.remoteAddress}`);
        await this.handleStatusRequest(this.protocolVersion);
      } else if (packetID.value === 0x01) {
        // Ping Request (0x01)
        await this.handlePingRequest(packet);
      } else {
        log.warn(`在 STATUS 状态收到未知包: 0x${packetID.value.toString(16)}`);
        this.socket.destroy();
      }
    } else if (this.state === "LOGIN") {
      if (packetID.value === 0x00) {
        // Login Start (0x00)
        log.info(`收到 Login Start 包，来自: ${this.socket.remoteAddress}`);
        await this.handleLoginRequest();
        this.socket.destroy();
      } else {
        log.warn(`在 LOGIN 状态收到未知包: 0x${packetID.value.toString(16)}`);
        this.socket.destroy();
      }
    }
  }

  // 处理Ping请求
  private async handlePingRequest(data: Buffer): Promise<void> {
    log.info(
      `Ping请求，来自: ${this.socket.remoteAddress}:${this.socket.remotePort}`
    );
    // Ping请求只需原样返回数据
    this.socket.write(new Uint8Array(data));
    log.info(
      `已向 ${this.socket.remoteAddress}:${this.socket.remotePort} 发送 Ping 响应，数据大小: ${data.length} 字节`
    );
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

      const protocolVal = protocolVersion.value;
      this.protocolVersion = protocolVal; // 保存客户端实际请求的协议号
      const mcVersion = protocol2Version(protocolVal);
      if (mcVersion) {
        log.info(
          `收到Handshake请求，状态值: ${nextState.value}, 地址: ${address}:${port}, 协议版本: ${protocolVal} (已识别为 Minecraft ${mcVersion})`
        );
      } else {
        log.warn(
          `收到Handshake请求，状态值: ${nextState.value}, 地址: ${address}:${port}, 协议版本: ${protocolVal} (未知的协议版本，反查失败)`
        );
      }

      // 根据状态值处理
      switch (nextState.value) {
        case 0x01: // 状态查询
          this.state = "STATUS";
          break;
        case 0x02: // 登录请求
          this.state = "LOGIN";
          break;
        default:
          log.warn(`未知下一状态值: ${nextState.value}`);
          this.socket.destroy();
      }
    } catch (err) {
      log.error("处理Handshake出错:", err);
      this.socket.destroy();
    }
  }

  // 处理状态查询请求
  private async handleStatusRequest(protocolVersion: number): Promise<void> {
    try {
      // 从API获取服务器列表
      const rawHost =
        config.server.web_host || config.server.host || "localhost";
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
      const jsonStr = JSON.stringify(responsePayload);
      
      // 避免 base64 图片刷屏控制台，复制一份用于日志输出，并截断 favicon
      const logPayload = { ...responsePayload } as any;
      if (logPayload.favicon && typeof logPayload.favicon === "string") {
        logPayload.favicon = logPayload.favicon.substring(0, 50) + "... (truncated)";
      }
      log.debug(`[TCP] 发送 Status 响应 JSON: ${JSON.stringify(logPayload)}`);

      const responsePacket = createServerStatusPacket(
        Buffer.from(jsonStr)
      );

      this.socket.write(new Uint8Array(responsePacket));
      log.info(
        `已向 ${this.socket.remoteAddress} 发送 Status 响应包，数据大小: ${responsePacket.length} 字节`
      );
    } catch (err) {
      log.error("处理状态查询请求出错:", err);
      this.socket.destroy();
    }
  }

  // 处理登录请求
  private async handleLoginRequest(): Promise<void> {
    try {
      // 创建断开连接数据包
      const disconnectPacket = createLoginDisconnectPacket(this.socket);
      this.socket.write(new Uint8Array(disconnectPacket));
      log.info(
        `已向 ${this.socket.remoteAddress} 发送 Login Disconnect 响应包，数据大小: ${disconnectPacket.length} 字节`
      );
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
  return new Promise<ServerStatus>(async (resolve, reject) => {
    let targetHost = serverAddress;
    let targetPort = parseInt(serverPort, 10);

    // 如果是域名且端口是默认的 25565，则尝试解析 SRV 记录
    const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(serverAddress) || serverAddress.includes(":");
    if (!isIp && targetPort === 25565) {
      try {
        const srvAddress = await new Promise<{ name: string; port: number }[]>((res) => {
          dns.resolveSrv(`_minecraft._tcp.${serverAddress}`, (err, addresses) => {
            if (err) res([]);
            else res(addresses);
          });
        });
        if (srvAddress && srvAddress.length > 0) {
          const first = srvAddress[0];
          targetHost = first.name;
          targetPort = first.port;
          log.info(`解析 SRV 记录成功: _minecraft._tcp.${serverAddress} -> ${targetHost}:${targetPort}`);
        }
      } catch (err) {
        // 忽略 SRV 解析错误，降级使用默认连接
      }
    }

    log.info(`正在获取 ${targetHost}:${targetPort} ${version} 服务器状态`);
    const client = new net.Socket();

    client.connect(targetPort, targetHost, () => {
      const handshakePacket = createHandshakePacket(
        serverAddress, // 握手包中的 host 依然填原始域名（供Bungee/Velocity虚拟主机路由）
        targetPort,
        version
      );
      client.write(new Uint8Array(handshakePacket));

      const statusRequestPacket = createStatusRequestPacket();
      client.write(new Uint8Array(statusRequestPacket));
    });

    let buffer = Buffer.alloc(0);
    client.on("data", (data) => {
      buffer = Buffer.concat([new Uint8Array(buffer), new Uint8Array(data)]);
      if (!hasCompleteVarInt(buffer, 0)) {
        return;
      }
      let varint = readVarInt(buffer, 0);
      if (buffer.length < varint.offset + varint.value) {
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

    const timeoutMs = config.server.timeout
      ? Number.parseInt(config.server.timeout, 10)
      : 600;
    const finalTimeout = Number.isFinite(timeoutMs) ? timeoutMs : 600;

    client.setTimeout(finalTimeout, () => {
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
