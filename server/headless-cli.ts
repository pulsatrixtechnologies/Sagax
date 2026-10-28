// Headless team commands. They read and write files in the data folder.
// They do not open a window and they do not start the server.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface HeadlessBot {
  name: string;
  title?: string;
}

export interface HeadlessTask {
  id: string;
  bot: string;
  text: string;
  state: "queued" | "done" | "failed";
  result?: string;
}

export function parseTeamFile(text: string): { ok: true; bots: HeadlessBot[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The team file is not JSON." };
  }
  const bots = (parsed as { bots?: unknown }).bots;
  if (!Array.isArray(bots) || bots.length === 0) return { ok: false, error: "The team file needs a bots list." };
  const out: HeadlessBot[] = [];
  for (const bot of bots) {
    if (!bot || typeof bot !== "object") return { ok: false, error: "Each bot needs a name." };
    const record = bot as { name?: unknown; title?: unknown };
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || name.length > 80) return { ok: false, error: "Each bot needs a name." };
    const title = typeof record.title === "string" ? record.title.trim() : "";
    out.push({ name, ...(title ? { title } : {}) });
  }
  return { ok: true, bots: out };
}

function teamPath(dir: string): string {
  return join(dir, "headless-team.json");
}

function queuePath(dir: string): string {
  return join(dir, "headless-tasks.json");
}

function readQueue(dir: string): HeadlessTask[] {
  try {
    const parsed = JSON.parse(readFileSync(queuePath(dir), "utf8")) as { tasks?: HeadlessTask[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

export function applyTeam(dir: string, bots: readonly HeadlessBot[]): { ok: true; bots: number } {
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(teamPath(dir), JSON.stringify({ bots }), { mode: 0o600 });
  return { ok: true, bots: bots.length };
}

export function giveTask(dir: string, bot: string, text: string): { ok: true; id: string; state: "queued" } {
  const saved = JSON.parse(readFileSync(teamPath(dir), "utf8")) as { bots?: HeadlessBot[] };
  if (!saved.bots?.some((entry) => entry.name === bot)) throw new Error("That bot is not in the applied team.");
  const task: HeadlessTask = { id: randomBytes(8).toString("hex"), bot, text, state: "queued" };
  const tasks = readQueue(dir);
  tasks.push(task);
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(queuePath(dir), JSON.stringify({ tasks }), { mode: 0o600 });
  return { ok: true, id: task.id, state: "queued" };
}

export function settleTask(dir: string, id: string, state: "done" | "failed", result: string): boolean {
  const tasks = readQueue(dir);
  const task = tasks.find((entry) => entry.id === id);
  if (!task) return false;
  task.state = state;
  task.result = result;
  writeFileAtomic(queuePath(dir), JSON.stringify({ tasks }), { mode: 0o600 });
  return true;
}

export async function waitTask(
  dir: string,
  id: string,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ ok: true; id: string; state: "done"; result: string } | { ok: false; id: string; state: "failed" | "timeout"; result?: string }> {
  const started = Date.now();
  for (;;) {
    const task = readQueue(dir).find((entry) => entry.id === id);
    if (task?.state === "done") return { ok: true, id, state: "done", result: task.result ?? "" };
    if (task?.state === "failed") return { ok: false, id, state: "failed", result: task.result };
    if (Date.now() - started >= timeoutMs) return { ok: false, id, state: "timeout" };
    await sleep(20);
  }
}
