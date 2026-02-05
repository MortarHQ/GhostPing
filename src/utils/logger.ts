import pino from "pino";
import pretty from "pino-pretty";
import dayjs from "dayjs";
import { spawnSync } from "child_process";
import { config } from "../config/config_parser";

function ensureUtf8Console() {
  if (process.platform !== "win32") {
    return;
  }
  if (!process.stdout.isTTY) {
    return;
  }
  try {
    spawnSync("cmd", ["/c", "chcp 65001 >nul"], { stdio: "ignore" });
  } catch {
    // Ignore console codepage errors.
  }
  try {
    process.stdout.setDefaultEncoding("utf8");
  } catch {
    // Ignore encoding errors.
  }
  try {
    process.stderr.setDefaultEncoding("utf8");
  } catch {
    // Ignore encoding errors.
  }
}

ensureUtf8Console();

const pinoConfig = {
  base: {
    pid: false,
  },
  level: config.server.logLevel || "info",
  timestamp: () => `,"time":"${dayjs().format()}"`,
} as pino.LoggerOptions;

const prettyStream = pretty({
  colorize: process.stdout.isTTY,
  sync: process.env.NODE_ENV === "test",
});

const log = pino(pinoConfig, prettyStream);

export default log;


