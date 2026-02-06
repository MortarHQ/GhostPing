import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const semverTagPattern = /^v\d+\.\d+\.\d+$/;

function printUsage() {
  console.log("Usage: node .github/scripts/generate-version-manifest.mjs [--check] [--repo <owner/repo>] [--out <path>]");
}

function parseArgs(argv) {
  const parsed = {
    check: false,
    repo: process.env.GITHUB_REPOSITORY || "MortarHQ/GhostPing",
    out: path.join("docs", "releases", "versions.json"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }
    if (arg === "--repo") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--repo requires a value");
      }
      parsed.repo = value;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--out requires a value");
      }
      parsed.out = value;
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getSortedTags() {
  const raw = runGit(["tag", "--list", "--sort=-v:refname"]);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item && semverTagPattern.test(item));
}

function getTagCommit(tag) {
  return runGit(["rev-list", "-n", "1", tag]);
}

function getTagCommitDate(tag) {
  return runGit(["show", "-s", "--format=%cI", tag]);
}

function buildManifest(repo) {
  const tags = getSortedTags();
  const versions = {};

  for (const tag of tags) {
    const commit = getTagCommit(tag);
    versions[tag] = {
      tag,
      commit,
      zipball: `https://codeload.github.com/${repo}/zip/${commit}`,
      tarball: `https://codeload.github.com/${repo}/tar.gz/${commit}`,
    };
  }

  return {
    schemaVersion: 1,
    repository: repo,
    generatedAt: tags[0] ? getTagCommitDate(tags[0]) : null,
    latest: tags[0] || null,
    tags,
    versions,
  };
}

function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(process.cwd(), args.out);
  const manifest = buildManifest(args.repo);
  const rendered = renderManifest(manifest);

  if (args.check) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (existing !== rendered) {
      console.error(`Manifest out of date: ${outputPath}`);
      process.exit(1);
    }
    console.log(`Manifest is up to date: ${outputPath}`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, "utf8");
  console.log(`Generated ${outputPath} with ${manifest.tags.length} version(s).`);
}

main();
