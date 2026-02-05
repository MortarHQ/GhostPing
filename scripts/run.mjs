import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

const args = process.argv.slice(2);
let entry = "";
let env = "";
let watch = false;
const passThrough = [];
let sawSeparator = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (sawSeparator) {
    passThrough.push(arg);
    continue;
  }
  if (arg === "--") {
    sawSeparator = true;
    continue;
  }
  if (arg === "--env") {
    env = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg === "--entry") {
    entry = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg === "--watch") {
    watch = true;
    continue;
  }
  if (!entry && !arg.startsWith("-")) {
    entry = arg;
    continue;
  }

  passThrough.push(arg);
}

if (!entry) {
  console.error("Missing entry file. Usage: node scripts/run.mjs --env <env> <entry>");
  process.exit(1);
}

if (env) {
  process.env.NODE_ENV = env;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const entryPath = path.isAbsolute(entry) ? entry : path.resolve(repoRoot, entry);

if (!existsSync(entryPath)) {
  console.error(`Entry not found: ${entryPath}`);
  process.exit(1);
}

const run = async () => {
  if (watch) {
    const cliPath = path.resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "watch",
        "--clear-screen=false",
        entryPath,
        ...(passThrough.length ? ["--", ...passThrough] : []),
      ],
      {
        stdio: "inherit",
        env: process.env,
      },
    );

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.on("SIGINT", () => forwardSignal("SIGINT"));
    process.on("SIGTERM", () => forwardSignal("SIGTERM"));

    await new Promise((resolve) => {
      child.on("exit", (code) => {
        process.exit(code ?? 0);
        resolve();
      });
    });

    return;
  }

  process.argv = [process.argv[0], entryPath, ...passThrough];
  await tsImport(pathToFileURL(entryPath).href, import.meta.url);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
