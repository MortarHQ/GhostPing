import log from "@utils/logger";
import varint from "varint";
import { VERSION, VERSION_TO_PROTOCOL_MAP } from "@declare/delcare_const";

type Logger = typeof log;

/**
 * 将版本字符串转换为协议号
 * @param versionString Minecraft版本字符串
 * @param logger 可选的日志记录器
 * @returns 对应的协议号
 */
export function version2Protocol(
  versionString: VERSION,
  logger?: Logger
): number {
  if (versionString in VERSION_TO_PROTOCOL_MAP) {
    return VERSION_TO_PROTOCOL_MAP[versionString];
  } else {
    if (logger) {
      logger.warn(`不支持${versionString}，已自动替换成1.16.5`);
    }
    return VERSION_TO_PROTOCOL_MAP["1.16.5"];
  }
}

/**
 * 将协议号转换到VarInt字节码
 * @param versionString Minecraft版本字符串
 * @param logger 可选的日志记录器
 * @returns 包含VarInt编码的Buffer
 */
export function encodeProtocol(
  versionString: VERSION,
  logger?: Logger
): Buffer {
  const version = version2Protocol(versionString, logger);
  return Buffer.from(varint.encode(version));
}

/**
 * 获取所有支持的Minecraft版本
 * @returns 支持的版本列表
 */
export function getSupportedVersions(): VERSION[] {
  return Object.keys(VERSION_TO_PROTOCOL_MAP) as VERSION[];
}

/**
 * 检查版本是否受支持
 * @param version 要检查的版本
 * @returns 是否支持该版本
 */
export function isVersionSupported(version: string): boolean {
  return version in VERSION_TO_PROTOCOL_MAP;
}

/**
 * 获取版本的友好名称（用于显示）
 * @param version Minecraft版本
 * @returns 友好名称
 */
export function getVersionDisplayName(version: VERSION): string {
  return `Minecraft ${version}`;
}

/**
 * 获取默认版本
 * @returns 默认Minecraft版本
 */
export function getDefaultVersion(): VERSION {
  return "1.16.5";
}

/**
 * 将协议号反查为 Minecraft 版本字符串
 * @param protocol 协议号
 * @returns 对应的 Minecraft 版本字符串，如果未找到则返回 null
 */
export function protocol2Version(protocol: number): VERSION | null {
  for (const [ver, prot] of Object.entries(VERSION_TO_PROTOCOL_MAP)) {
    if (prot === protocol) {
      return ver as VERSION;
    }
  }
  return null;
}

export interface ChatComponentPart {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  color?: string;
}

export interface ChatComponent {
  text: string;
  extra?: ChatComponentPart[];
}

/**
 * 编排并构建符合 Minecraft 协议的 Chat Component 结构
 * @param parts 各个文本分片
 * @returns 格式化后的 Chat Component 对象
 */
export function buildChatComponent(parts: ChatComponentPart[]): ChatComponent {
  return {
    text: "",
    extra: parts,
  };
}
