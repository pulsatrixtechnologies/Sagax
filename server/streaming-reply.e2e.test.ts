// A reply streams to the clients as it is written (2026-10-29, "Show replies
// as they are written", src/components/LiveReply.tsx): the fake Claude CLI
// sends the answer word by word (text_delta frames, a real CLI's pacing);
// the client's event stream carries it as several content.delta frames
// before the settled message, the deltas add up to the final text, and the
// settled message is what the thread keeps. Real harness, throwaway home.
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireMessage } from "../shared/wire.ts";

const REPLY = "Voici le plan.\n\n| Étape | Durée |\n|---|---|\n| Tests | 2 h |\n\n```ts\nconst x = 1;\n```\n\n- un\n- deux";

it.skipIf(process.platform === "win32")("streams the reply in deltas before the settled message", async () => {
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "voice",
    FAKE_CLAUDE_VOICE_REPLY: REPLY,
    // slower than the bus's 50 ms merge, so the words reach the client apart
    FAKE_CLAUDE_TOKEN_MS: "90",
  });
  const url = fixture.info.url;
  const env = { SAGAX_URL: url };
  const controller = new AbortController();
  let raw = "";
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Scribe"], { env }) as { bot: { id: string; activeTaskId: string } };
    const threadId = bot.activeTaskId;
    const events = await fetch(`${url}/api/events`, { headers: { origin: url }, signal: controller.signal });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          raw += decoder.decode(value, { stream: true });
        }
      } catch { /* aborted at the end */ }
    })();
    const sent = await fetch(`${url}/api/bots/${bot.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ text: "Le plan ?", threadId }),
    });
    expect(sent.status).toBe(202);
    expect((await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30"], { env }) as { status: string }).status).toBe("settled");

    const thread = (await (await fetch(`${url}/api/threads/${threadId}/messages?limit=80`)).json() as { messages: WireMessage[] }).messages;
    const settled = thread.filter((row) => row.role === "bot" && row.kind === "text").at(-1);
    expect(settled?.text).toBe(REPLY);

    // the frames, in order, for this thread
    await expect.poll(() => raw.includes(`"id":"${settled!.id}"`), { timeout: 10_000 }).toBe(true);
    const frames = raw.split("\n").filter((line) => line.startsWith("data:")).flatMap((line) => {
      try { return [JSON.parse(line.slice(5).trim()) as Record<string, unknown>]; } catch { return []; }
    });
    const deltas: string[] = [];
    let beforeSettled = 0;
    for (const frame of frames) {
      const event = frame.event as { type?: string; threadId?: string; streamKind?: string; delta?: string } | undefined;
      if (frame.kind === "runtime" && event?.type === "content.delta" && event.threadId === threadId && event.streamKind === "assistant_text") {
        deltas.push(event.delta ?? "");
      }
      const message = frame.message as { id?: string } | undefined;
      if (frame.kind === "message" && message?.id === settled!.id) beforeSettled = deltas.length;
    }
    // several pieces, all of them before the settled message, adding up to it
    expect(beforeSettled).toBeGreaterThan(3);
    expect(deltas.length).toBe(beforeSettled);
    expect(deltas.join("")).toBe(REPLY);
  } finally {
    controller.abort();
    await fixture.close();
  }
}, 90_000);
