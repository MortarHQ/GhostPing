import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_URL =
  process.env.GHOSTPING_MANIFEST_URL ||
  "https://raw.githubusercontent.com/MortarHQ/GhostPing/master/docs/releases/versions.json";
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.GHOSTPING_MANIFEST_TIMEOUT_MS || "5000",
  10,
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function color(text: string, code: string): string {
  if (!COLOR_ENABLED) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

function formatPrefix(level: "info" | "warn" | "error" | "success"): string {
  const base = color("[update-check]", ANSI.dim);
  if (level === "warn") {
    return `${base} ${color("WARN", ANSI.yellow)}`;
  }
  if (level === "error") {
    return `${base} ${color("ERROR", ANSI.red)}`;
  }
  if (level === "success") {
    return `${base} ${color("OK", ANSI.green)}`;
  }
  return `${base} ${color("INFO", ANSI.cyan)}`;
}

function logInfo(message: string): void {
  console.log(`${formatPrefix("info")} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${formatPrefix("success")} ${message}`);
}

function logWarn(message: string): void {
  console.warn(`${formatPrefix("warn")} ${message}`);
}

function logError(message: string): void {
  console.warn(`${formatPrefix("error")} ${message}`);
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  suffix: string;
}

function parseVersion(version: string): ParsedVersion | null {
  const trimmed = String(version || "").trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    suffix: match[4] || "",
  };
}

function compareVersion(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) {
    return 0;
  }
  if (av.major !== bv.major) {
    return av.major > bv.major ? 1 : -1;
  }
  if (av.minor !== bv.minor) {
    return av.minor > bv.minor ? 1 : -1;
  }
  if (av.patch !== bv.patch) {
    return av.patch > bv.patch ? 1 : -1;
  }

  if (!av.suffix && bv.suffix) {
    return 1;
  }
  if (av.suffix && !bv.suffix) {
    return -1;
  }
  return 0;
}

function toTag(version: string): string {
  const text = String(version || "").trim();
  if (!text) {
    return text;
  }
  return text.startsWith("v") ? text : `v${text}`;
}

async function readCurrentVersion(): Promise<string> {
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return String(parsed.version || "").trim();
}

interface Manifest {
  latest?: string;
  [key: string]: unknown;
}

async function fetchManifest(): Promise<Manifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Number.isFinite(REQUEST_TIMEOUT_MS) ? REQUEST_TIMEOUT_MS : 5000);

  try {
    const res = await fetch(MANIFEST_URL, {
      signal: controller.signal,
      headers: {
        "user-agent": "ghostping-update-check",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as Manifest;
  } finally {
    clearTimeout(timer);
  }
}

async function checkUpdate(): Promise<void> {
  logInfo(`正在检查更新清单：${MANIFEST_URL}`);
  const currentVersion = await readCurrentVersion();
  const manifest = await fetchManifest();
  const latestVersion = String(manifest?.latest || "").trim();

  if (!latestVersion) {
    logWarn("manifest 中缺少有效的 latest 字段。");
    return;
  }

  const compared = compareVersion(latestVersion, currentVersion);
  if (compared > 0) {
    logWarn(
      `发现新版本：当前 ${toTag(currentVersion)}，最新 ${toTag(latestVersion)}。`,
    );
    return;
  }

  if (compared === 0) {
    logSuccess(`当前已是最新版本：${toTag(currentVersion)}。`);
    return;
  }

  logInfo(
    `当前版本 ${toTag(currentVersion)} 高于清单 latest ${toTag(latestVersion)}。`,
  );
}

function spawnBackgroundCheck(): void {
  try {
    // 直接启动自身，使用 --import tsx 运行 TS 文件
    const child = spawn(process.execPath, ["--import", "tsx", __filename, "--run"], {
      cwd: repoRoot,
      stdio: "inherit",
      detached: true,
      env: process.env,
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`无法启动后台更新检查：${message}`);
  }
}

async function run(): Promise<void> {
  const background = process.argv.includes("--background");
  if (background) {
    spawnBackgroundCheck();
    return;
  }

  try {
    await checkUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`更新检查失败（不会中断启动）：${message}`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`未处理异常（不会中断启动）：${message}`);
  process.exit(0);
});
