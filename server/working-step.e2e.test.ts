// The working line's step, end to end (2026-10-29): a scripted fake engine
// starts a shell call and holds it; the client's event stream carries the
// running row with its step (Running scrape.py, the same key any engine
// would get), the working line reads it, and once the turn ends the row is
// settled and the line names nothing. Real harness, throwaway home.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { currentWorkingStep } from "../shared/working-step.ts";
import type { WireMessage } from "../shared/wire.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it.skipIf(process.platform === "win32")("streams the running call's step and drops it when the turn ends", async () => {
  const gates = mkdtempSync(join(tmpdir(), "sagax-working-step-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "slow",
    FAKE_CLAUDE_HOLD_AFTER_TOOL: "1",
    FAKE_CLAUDE_HOLD_TOOL: JSON.stringify({ name: "Bash", input: { command: "cd jobs && python3 scrape.py --since 2026-10-01" } }),
    FAKE_CLAUDE_SLOW_FINISH_GATE: gate,
  });
  const url = fixture.info.url;
  const env = { SAGAX_URL: url };
  const controller = new AbortController();
  const frames: string[] = [];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Stepper"], { env }) as { bot: { id: string; activeTaskId: string } };
    const threadId = bot.activeTaskId;
    // what a client hears while the turn runs
    const events = await fetch(`${url}/api/events`, { headers: { origin: url }, signal: controller.signal });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          frames.push(decoder.decode(value, { stream: true }));
        }
      } catch { /* aborted at the end */ }
    })();
    const messages = async (): Promise<WireMessage[]> =>
      (await (await fetch(`${url}/api/threads/${threadId}/messages?limit=80`)).json() as { messages: WireMessage[] }).messages;

    const sent = await fetch(`${url}/api/bots/${bot.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ text: "Run the scraper", threadId }),
    });
    expect(sent.status).toBe(202);

    // During the turn: the newest row is the running call, and the working
    // line names its step.
    await expect.poll(async () => currentWorkingStep((await messages()).at(-1)), { timeout: 20_000 })
      .toMatchObject({ key: "run", detail: "scrape.py" });
    const live = (await messages()).at(-1)!;
    expect(live.tool?.step).toEqual({ key: "run", detail: "scrape.py" });
    // the stream carried it to every client, never the command's arguments
    await expect.poll(() => frames.join("").includes("\"step\":{\"key\":\"run\",\"detail\":\"scrape.py\"}"), { timeout: 10_000 }).toBe(true);
    expect(JSON.stringify(live.tool?.step)).not.toContain("2026-10-01");

    // The turn ends: the call settles and the line names nothing any more.
    writeFileSync(gate, "go");
    expect((await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30"], { env }) as { status: string }).status).toBe("settled");
    const after = await messages();
    const call = after.find((row) => row.tool?.step?.key === "run");
    expect(call?.tool?.ok).toBe(true);
    expect(currentWorkingStep(call)).toBeNull();
    expect(currentWorkingStep(after.at(-1))).toBeNull();
  } finally {
    controller.abort();
    await fixture.close();
    await removeTempDir(gates);
  }
}, 90_000);
