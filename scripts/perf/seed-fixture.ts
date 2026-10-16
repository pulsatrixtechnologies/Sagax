#!/usr/bin/env -S node --experimental-strip-types
// Builds the data folder the interaction bench (interaction-bench.mjs) runs
// Sagax against: nine bots like a Grok Bot roster, a few threads, and one long
// thread (rich markdown replies) for the scroll scenario. Everything goes
// through the fake engine of the verification launcher: no user data, no
// provider, no network.
//
//   node --experimental-strip-types scripts/perf/seed-fixture.ts <out-dir> [--turns 120]
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { launchVerificationServer } from "../control-omb.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { turns: { type: "string", default: "120" } } });
const out = resolve(positionals[0] ?? "");
if (!positionals[0]) throw new Error("usage: seed-fixture.ts <out-dir> [--turns N]");
const turns = Number(values.turns);

const ROSTER: Array<{ name: string; title: string; section?: string }> = [
  { name: "Katarina", title: "ConnectWise Ops & MS 365", section: "My Team" },
  { name: "Ember", title: "Full Stack, Dev Ops & ITSec", section: "My Team" },
  { name: "Harrie", title: "Verificator", section: "My Team" },
  { name: "Vanessa", title: "Legal and marketing", section: "My Team" },
  { name: "SWAT", title: "Strategic Waste Abatement Team", section: "Built-in" },
  { name: "Bot Designer", title: "Designs bots", section: "Built-in" },
  { name: "DOGE", title: "Department of Efficiency", section: "Built-in" },
  { name: "Disk Saver", title: "Disk housekeeping", section: "Built-in" },
];

function reply(i: number): string {
  const parts = [
    `## Lot ${i}: verification\n\nI checked the **${i}th** batch against the ledger. Three items match, one needs a second look:`,
    `- Ticket #${1000 + i}: notes are in order\n- Ticket #${2000 + i}: time entry is *0.75 h*, expected 0.5 h\n- Ticket #${3000 + i}: closed`,
    "| Item | Status | Owner |\n|---|---|---|\n| Backup | ok | Ember |\n| Patch | pending | Harrie |\n| Report | ok | Katarina |",
    "```ts\nexport function total(entries: number[]) {\n  return entries.reduce((sum, value) => sum + value, 0);\n}\n```",
    `The remaining step is the follow-up with \`client-${i}\`; I will report back once it is done. ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(1 + (i % 4))}`,
  ];
  return parts.slice(0, 2 + (i % 4)).join("\n\n");
}

const replies = Array.from({ length: turns + 40 }, (_, i) => reply(i + 1));
const stateDir = join(out, "..", `.seed-state-${process.pid}`);
mkdirSync(stateDir, { recursive: true });
const server = await launchVerificationServer({
  ...process.env,
  FAKE_CLAUDE_REPLIES: JSON.stringify(replies),
  FAKE_CLAUDE_REPLY_STATE: join(stateDir, "reply-state"),
});
const { url, dataDir } = server.info;
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${url}${path}`, { ...init, headers: { "content-type": "application/json", origin: url } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<any>;
};
const settle = async (botId: string) => {
  for (let i = 0; i < 600; i++) {
    const { bots } = await api("/api/bots?messages=0");
    const bot = bots.find((b: any) => b.id === botId);
    if (bot && !bot.busy && bot.status !== "working" && !bot.working) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("turn did not settle");
};
const send = async (botId: string, threadId: string, text: string) => {
  await api(`/api/bots/${botId}/messages`, { method: "POST", body: JSON.stringify({ text, threadId }) });
  await new Promise((r) => setTimeout(r, 150));
  await settle(botId);
};

try {
  const bots: any[] = [];
  for (const entry of ROSTER) bots.push((await api("/api/bots", { method: "POST", body: JSON.stringify(entry) })).bot);
  // Short conversations everywhere, so every row has a preview.
  for (const bot of bots) await send(bot.id, bot.threadId, `Hello ${bot.name}, what is on your plate today?`);
  // The long thread, plus two short ones beside it, all on Harrie.
  const harrie = bots.find((b) => b.name === "Harrie");
  const second = (await api(`/api/bots/${harrie.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Second thread" }) })).task;
  for (let i = 0; i < 6; i++) await send(harrie.id, second.threadId, `Second thread question ${i + 1}`);
  const third = (await api(`/api/bots/${harrie.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Long thread" }) })).task;
  for (let i = 0; i < turns; i++) {
    await send(harrie.id, third.threadId, `Please verify lot ${i + 1} and tell me what changed since the last check.`);
    if (i % 20 === 0) console.error(`long thread: ${i}/${turns}`);
  }
  server.child.kill("SIGTERM");
  await new Promise((r) => server.child.once("exit", r));
  rmSync(out, { recursive: true, force: true });
  cpSync(dataDir, out, { recursive: true });
  writeFileSync(join(out, "perf-fixture.json"), JSON.stringify({ turns, bots: bots.map((b) => ({ id: b.id, name: b.name })), longThread: third.threadId, secondThread: second.threadId, harrie: harrie.id }, null, 2));
  console.log(JSON.stringify({ out, turns }));
} finally {
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
}
