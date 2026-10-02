// Engine slash commands end to end through the isolated launcher and the
// repository's fake Claude CLI: listed without a turn, passed through
// verbatim, Sagax winning a collision, and refused when the chat cannot run
// them (server/harness-commands.ts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonl = (path: string) => existsSync(path)
  ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

it("lists the engine's commands and passes a typed one through verbatim", async () => {
  const session = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_VERSION: "2.1.287" });
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const dataDir = session.info.dataDir;
    const prompts = join(dataDir, "prompts.jsonl");
    const probes = join(dataDir, "probe.json");
    const commands = join(dataDir, "commands.json");
    const fixture = JSON.parse(readFileSync(join(ROOT, "shared", "fixtures", "claude-initialize-commands.json"), "utf8"));
    writeFileSync(commands, JSON.stringify(fixture.response.response.commands));
    const wrapper = join(dataDir, "claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `Object.assign(process.env, ${JSON.stringify({ FAKE_CLAUDE_COMMANDS: commands, FAKE_CLAUDE_COMMANDS_DUMP: probes, FAKE_CLAUDE_PROMPTS: prompts })});`,
      'process.stdin.on("end", () => process.exit(0));',
      `await import(${JSON.stringify(pathToFileURL(join(ROOT, "server", "testing", "fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("/api/instances/claude", { cli: wrapper }, "PATCH");
    const bot = (await cli("new-bot", "--name", "Commander")).bot;
    const thread = bot.activeTaskId;
    const sent = () => jsonl(prompts).map((prompt) => {
      const content = prompt?.message?.content;
      return typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part.text ?? "").join("") : "";
    });
    const wait = async () => expect((await cli("wait", "--bot", bot.id, "--task", thread, "--timeout", "40")).status).toBe("settled");

    // Listed by the engine in the conversation's own folder, with no turn.
    const listed = await api(`/api/bots/${bot.id}/harness-commands?threadId=${thread}`, undefined, "GET");
    expect(listed.available).toBe(true);
    expect(listed.engine).toBe("claude");
    const names = listed.commands.map((command: any) => command.name);
    expect(names).toEqual(expect.arrayContaining(["compact", "pulsatrix-flow:using-px-flow", "mcp__github__review_pr", "deploy-notes"]));
    expect(listed.commands.find((command: any) => command.name === "model").unavailable).toBe("managed");
    expect(JSON.parse(readFileSync(probes, "utf8")).argv).toEqual(expect.arrayContaining(["--setting-sources", "project"]));
    expect(sent()).toEqual([]);

    // A first ordinary turn, then commands: each reaches the engine as typed.
    await api(`/api/bots/${bot.id}/messages`, { text: "hello there", threadId: thread });
    await wait();
    await api(`/api/bots/${bot.id}/messages`, { text: "/compact keep the plan", threadId: thread });
    await wait();
    await api(`/api/bots/${bot.id}/messages`, { text: "/engine:goal ship the release", threadId: thread });
    await wait();
    const turns = sent();
    expect(turns).toContain("/compact keep the plan");
    expect(turns).toContain("/goal ship the release");

    // What the chat cannot run is refused before it is recorded.
    await expect(api(`/api/bots/${bot.id}/messages`, { text: "/model opus", threadId: thread })).rejects.toThrow(/managed by Sagax/);
    const history = (await api(`/api/threads/${thread}/messages`, undefined, "GET")).messages.map((message: any) => message.text);
    expect(history).toContain("/compact keep the plan");
    expect(history).not.toContain("/model opus");

    // In a group a command reaches ONE bot: the one the message starts by
    // naming, even when the room answers with everyone.
    const helper = (await cli("new-bot", "--name", "Helper")).bot;
    const group = (await api("/api/groups", { name: "Ops", memberIds: [bot.id, helper.id], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } })).group;
    const groupListed = await api(`/api/bots/${helper.id}/harness-commands?groupId=${group.id}&threadId=${group.threadId}`, undefined, "GET");
    expect(groupListed.available).toBe(true);
    expect(groupListed.commands.map((command: any) => command.name)).toContain("compact");
    await expect(api(`/api/bots/${helper.id}/harness-commands?groupId=nope`, undefined, "GET")).rejects.toThrow(/no such group/);
    const before = sent().length;
    await api(`/api/groups/${group.id}/messages`, { text: "@Helper /compact keep what @Commander planned" });
    const roomReplies = async () => (await api(`/api/threads/${group.threadId}/messages`, undefined, "GET")).messages
      .filter((message: any) => message.role === "bot" && message.kind === "text");
    for (let tries = 0; tries < 200 && (await roomReplies()).length === 0; tries++) await new Promise((resolve) => setTimeout(resolve, 100));
    // let any other member that would (wrongly) answer show up
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const roomTurns = sent().slice(before);
    expect(roomTurns).toEqual(["/compact keep what @Commander planned"]);
    expect((await roomReplies()).map((message: any) => message.from?.botId)).toEqual([helper.id]);
    await expect(api(`/api/groups/${group.id}/messages`, { text: "@Helper /model opus" })).rejects.toThrow(/managed by Sagax/);
  } finally {
    await session.close();
  }
}, 120_000);
