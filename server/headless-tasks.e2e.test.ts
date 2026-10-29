// `sagax team apply`, `task give` and `task wait` against a real isolated
// server running the fake engine: the server creates the team's bots, runs
// the task as a turn of the named bot in a conversation of its own, and
// `task wait` prints the bot's reply. Without a server, `task wait` says so.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "openmausbot.ts");
const run = promisify(execFile);

async function cli(dataDir: string, args: string[]): Promise<{ code: number; body: any }> {
  const env = { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: dataDir, USERPROFILE: dataDir };
  try {
    const { stdout } = await run(process.execPath, ["--experimental-strip-types", ENTRY, ...args, "--data-dir", dataDir], { env, timeout: 60_000 });
    return { code: 0, body: JSON.parse(stdout.trim().split("\n").pop()!) };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string };
    return { code: failed.code ?? -1, body: JSON.parse((failed.stdout ?? "{}").trim().split("\n").pop() || "{}") };
  }
}

describe.skipIf(process.platform === "win32")("headless team tasks through the isolated server", () => {
  it("applies a team, gives a task and waits for the bot's real reply", async () => {
    const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_REPLIES: JSON.stringify(["Three points: alpha, beta, gamma."]) });
    try {
      const dataDir = fixture.info.dataDir;
      const teamFile = join(dataDir, "team.json");
      writeFileSync(teamFile, JSON.stringify({ bots: [{ name: "Scribe", title: "Note taker" }] }));
      expect(await cli(dataDir, ["team", "apply", teamFile])).toEqual({ code: 0, body: { ok: true, bots: 1 } });

      // the server creates the bot of the applied team
      await expect.poll(async () => {
        const bots = await (await fetch(`${fixture.info.url}/api/bots`)).json() as any;
        const list = Array.isArray(bots) ? bots : bots.bots;
        return list.find((bot: any) => bot.name === "Scribe")?.title ?? null;
      }, { timeout: 15_000 }).toBe("Note taker");

      const given = await cli(dataDir, ["task", "give", "--bot", "Scribe", "--text", "Summarize the meeting"]);
      expect(given.code).toBe(0);
      expect(given.body).toMatchObject({ ok: true, state: "queued" });

      const waited = await cli(dataDir, ["task", "wait", given.body.id, "--timeout", "45"]);
      expect(waited.code).toBe(0);
      expect(waited.body).toMatchObject({ ok: true, state: "done", bot: "Scribe" });
      expect(waited.body.result).toContain("Three points: alpha, beta, gamma.");

      // the task ran in a conversation of its own, shown under the bot
      const bots = await (await fetch(`${fixture.info.url}/api/bots`)).json() as any;
      const scribe = (Array.isArray(bots) ? bots : bots.bots).find((bot: any) => bot.name === "Scribe");
      const task = (scribe.tasks ?? []).find((entry: any) => entry.threadId === waited.body.threadId);
      expect(task?.title).toBe("Task: Summarize the meeting");
      const transcript = await runControlOmb(["messages", "--bot", scribe.id, "--task", task.threadId, "--limit", "10", "--url", fixture.info.url]) as any;
      expect(transcript.messages.some((message: any) => message.role === "user" && message.text?.includes("Summarize the meeting"))).toBe(true);
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it("says no server runs instead of waiting in silence", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-headless-e2e-"));
    try {
      const teamFile = join(dataDir, "team.json");
      writeFileSync(teamFile, JSON.stringify({ bots: [{ name: "Scribe" }] }));
      expect((await cli(dataDir, ["team", "apply", teamFile])).code).toBe(0);
      const given = await cli(dataDir, ["task", "give", "--bot", "Scribe", "--text", "hi"]);
      const waited = await cli(dataDir, ["task", "wait", given.body.id, "--timeout", "30"]);
      expect(waited.code).toBe(3);
      expect(waited.body).toMatchObject({ ok: false, state: "no_server" });
      expect(waited.body.error).toMatch(/No Sagax server is running/);
    } finally {
      await removeTempDir(dataDir);
    }
  }, 60_000);
});
