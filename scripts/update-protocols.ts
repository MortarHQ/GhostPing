import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/common/protocolVersions.json';
const targetJsonPath = path.resolve(__dirname, '../src/declare/protocols.json');

interface ProtocolEntry {
  minecraftVersion: string;
  version: number;
  dataVersion?: number;
  usesNetty?: boolean;
  majorVersion?: string;
  releaseType?: 'release' | 'snapshot' | string;
}

async function updateProtocols() {
  console.log("正在从 GitHub 官方源获取 Minecraft 协议版本信息...");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取失败，HTTP 状态码: ${res.status}`);
  }
  const data = (await res.json()) as ProtocolEntry[];
  
  const mappings: Record<string, number> = {};
  
  for (const entry of data) {
    // 仅保留正式版：要么 releaseType 为 'release'，或者 releaseType 不存在 (旧版本缺此字段)
    // 且版本名称符合数字加点格式 (例如 1.16.5, 26.2)
    const isRelease = entry.releaseType === 'release' || entry.releaseType === undefined;
    if (isRelease && /^\d+\.\d+(?:\.\d+)*$/.test(entry.minecraftVersion)) {
      mappings[entry.minecraftVersion] = entry.version;
    }
  }

  // 排序：版本号从新到旧 (降序)
  const sortedKeys = Object.keys(mappings).sort((a, b) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) {
        return bVal - aVal;
      }
    }
    return 0;
  });

  const sortedMappings: Record<string, number> = {};
  for (const key of sortedKeys) {
    sortedMappings[key] = mappings[key];
  }

  // 写入 JSON 文件
  fs.writeFileSync(targetJsonPath, JSON.stringify(sortedMappings, null, 2), 'utf-8');
  console.log(`成功保存了 ${sortedKeys.length} 个正式版协议映射至: ${targetJsonPath}`);
}

updateProtocols().catch((err) => {
  console.error("更新协议版本出错:", err);
  process.exit(1);
});
