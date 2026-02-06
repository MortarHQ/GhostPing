import type { ServerStatus } from "@/types";

const API = {
  offset: "./offset",
  offsetTest: "./offset/testput",
  serverList: "./serverlist",
};

export async function getOffsetFn() {
  const res = await fetch(API.offset);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as { __fn__?: string };
}

export async function putOffsetFn(source: string) {
  const res = await fetch(API.offset, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ __fn__: source }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
}

export async function loadDemoFn() {
  const res = await fetch(API.offsetTest);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as { __fn__?: string };
}

export async function getServerList() {
  const res = await fetch(API.serverList);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ServerStatus;
}
