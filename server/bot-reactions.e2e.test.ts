// A bot that answers with a reaction instead of words (react_to_message,
// shared/reactions.ts), through a real agents proxy and a scripted turn:
// the reaction lands on the person's message with the bot as the actor,
// the turn settles, and no reply bubble is written, empty or not.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

async function withScriptedServer(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  const planPath = join(session.info.dataDir, "room-plan.json");
  try {
    await test({
      cli,
      api,
      savePlan: (plan: Record<string, unknown>) => writeFileSync(planPath, JSON.stringify(plan)),
      evidence: () => existsSync(planPath + ".evidence.jsonl")
        ? readFileSync(planPath + ".evidence.jsonl", "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [],
      messages: async (threadId: string) => (await api("/api/threads/" + threadId + "/messages")).messages,
    });
  } finally {
    await session.close();
  }
}

it("a bot that only reacts settles its turn without a reply bubble", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Quiet bot")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👍" } }], reply: "" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Thanks, that is all.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");

  const turn = f.evidence().find((entry: any) => entry.botId === bot.id);
  expect(turn.evidence[0].result.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(["react_to_message", "remove_reaction"]));
  const step = turn.evidence.find((entry: any) => entry.step?.tool === "react_to_message");
  expect(step.response.result.isError).toBeFalsy();
  expect(step.response.result.content[0].text).toContain("Reacted 👍");

  const messages = await f.messages(bot.activeTaskId);
  const asked = messages.find((m: any) => m.role === "user" && m.text === "Thanks, that is all.");
  expect(asked.reactions).toEqual([{ emoji: "👍", actors: [{ id: `bot:${bot.id}`, kind: "bot", name: "Quiet bot" }], at: expect.any(Number) }]);
  // no bot line after it (only the greeting before): no empty bubble, no
  // "finished without a reply"
  const after = messages.slice(messages.indexOf(asked) + 1);
  expect(after.filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);
}), 60_000);

it("a bot reacts and still answers in words when it has something to say", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Looker")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👀" } }], reply: "Found it: the cache key was stale." } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Why is the build slow?");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const messages = await f.messages(bot.activeTaskId);
  expect(messages.find((m: any) => m.role === "user").reactions[0]).toMatchObject({ emoji: "👀", actors: [{ kind: "bot", name: "Looker" }] });
  const asked = messages.find((m: any) => m.role === "user");
  const after = messages.slice(messages.indexOf(asked) + 1);
  expect(after.filter((m: any) => m.role === "bot" && m.kind === "text").map((m: any) => m.text)).toEqual(["Found it: the cache key was stale."]);
}), 60_000);
