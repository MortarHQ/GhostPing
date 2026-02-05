import { writeFileSync } from "fs";
import readline from "readline";
import { Client } from "@utils/serverListPingAPI";
import { VERSION } from "@declare/delcare_const";
import { config } from "./config/config_parser";

type Options = {
  host: string;
  port: string;
  version: VERSION;
  outFile: string;
};

function parseArgs(args: string[]): Partial<Options> {
  const options: Partial<Options> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--server" && args[i + 1]) {
      const value = args[i + 1];
      i += 1;
      const [host, port] = value.split(":");
      if (host) {
        options.host = host;
      }
      if (port) {
        options.port = port;
      }
      continue;
    }
    if (arg === "--version" && args[i + 1]) {
      options.version = args[i + 1] as VERSION;
      i += 1;
      continue;
    }
    if (arg === "--out" && args[i + 1]) {
      options.outFile = args[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !options.host) {
      const [host, port] = arg.split(":");
      options.host = host;
      if (port) {
        options.port = port;
      }
    }
  }

  return options;
}

function getDefaultOptions(): Options {
  const first = config.server_list[0];
  if (first?.host) {
    return {
      host: first.host,
      port: first.port || "25565",
      version: (first.version || "1.16.5") as VERSION,
      outFile: "test.json",
    };
  }
  return {
    host: "127.0.0.1",
    port: "25565",
    version: "1.16.5",
    outFile: "test.json",
  };
}

function resolveOptions(): { options: Partial<Options>; hasServerInput: boolean } {
  const defaults = getDefaultOptions();
  const envHost = process.env.MC_HOST;
  const envPort = process.env.MC_PORT;
  const envVersion = process.env.MC_VERSION;
  const envOut = process.env.MC_OUT;

  const parsed = parseArgs(process.argv.slice(2));
  const hasServerInput = Boolean(parsed.host || envHost);

  return {
    options: {
      host: parsed.host || envHost,
      port: parsed.port || envPort,
      version: (parsed.version || envVersion || defaults.version) as VERSION,
      outFile: parsed.outFile || envOut || defaults.outFile,
    },
    hasServerInput,
  };
}

async function promptServerAddress(): Promise<{ host: string; port: string } | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question =
    "请输入服务器地址 (host:port)，不含端口则默认 25565。输入 exit 退出：";

  return new Promise((resolve) => {
    rl.question(question, (input) => {
      rl.close();
      const trimmed = input.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }
      const lower = trimmed.toLowerCase();
      if (["exit", "quit", "end", "stop"].includes(lower)) {
        resolve(null);
        return;
      }
      const [host, port] = trimmed.split(":");
      if (!host) {
        resolve(null);
        return;
      }
      resolve({
        host,
        port: port || "25565",
      });
    });
  });
}

async function main() {
  const { options, hasServerInput } = resolveOptions();

  let host = options.host;
  let port = options.port;
  const version = options.version as VERSION;
  const outFile = options.outFile || "test.json";

  if (!hasServerInput) {
    const answer = await promptServerAddress();
    if (!answer) {
      console.log("未提供服务器地址，已退出。");
      process.exit(0);
    }
    host = answer.host;
    port = answer.port;
  }

  if (!host) {
    console.error("Missing server address.");
    console.error("Usage: pnpm run mc:ping -- <host:port> [--version 1.16.5]");
    process.exit(1);
  }

  const finalPort = port || "25565";
  const client = new Client(host, finalPort, version);
  const result = await client.getServerStatus();

  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(
    `Fetched status from ${host}:${finalPort} (${version}).`
  );
  console.log(`Output written to ./${outFile}`);
}

main().catch((error) => {
  console.error("Client request failed:", error);
  process.exit(1);
});
