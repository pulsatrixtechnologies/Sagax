// "Needs you" is the server's, shared by every device of the person
// (2026-10-29, owner report: the phone's Updates kept asks already answered
// on the Mac). Real server, scripted fake engine:
//
//   - a bot asks the person to approve a tool: its conversation waits on
//     them (activity waiting-on-you) and holds one open card
//   - answered from another device (the desktop's respond route), the card
//     closes and the conversation stops waiting on them in the same wire
//     every device reads (iOS Updates, widgets, badge), whatever path
//     settled it
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("an approval answered on the desktop no longer needs the person on any device", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const wire = async (botId: string) => ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((bot) => bot.id === botId);
  const task = async (botId: string, threadId: string) => ((await wire(botId))?.tasks as any[] | undefined)?.find((row) => row.threadId === threadId);
  const openCards = async (threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages?limit=100`)).body.messages as any[] ?? [])
    .filter((message) => message.kind === "options" && message.card?.requestId && !message.card.answered && !message.card.dismissed && !message.card.expired);
  try {
    const { bot } = await cli("new-bot", "--name", "Lister");
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [bot.id]: { script: [
        { key: "list", match: ["List the folder."], approve: { tool_name: "Bash", input: { command: "ls -la" } },
          reply: "LISTED: three files.", replyIfDenied: "LISTED: not allowed." },
      ] },
    }));
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "List the folder.");

    // It waits on the person, with one card to answer.
    await expect.poll(async () => (await task(bot.id, bot.activeTaskId))?.activity, { timeout: 30_000 }).toBe("waiting-on-you");
    const [card] = await openCards(bot.activeTaskId);
    expect(card, "one open card").toBeTruthy();

    // Answered on the desktop.
    const answered = await api("POST", `/api/threads/${bot.activeTaskId}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);

    // Every device reads the same answer: nothing open, nothing waiting.
    await expect.poll(async () => (await openCards(bot.activeTaskId)).length, { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => (await task(bot.id, bot.activeTaskId))?.activity, { timeout: 15_000 }).not.toBe("waiting-on-you");
    expect((await wire(bot.id)).activity).not.toBe("waiting-on-you");
  } finally {
    await fixture.close();
  }
}, 120_000);
