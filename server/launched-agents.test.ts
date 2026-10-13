import { describe, expect, it } from "vitest";

import { launchedAgentsForBot, type LaunchedAgentsDeps } from "./launched-agents.ts";

const NOW = 1_800_000_000_000;

function deps(overrides: Partial<LaunchedAgentsDeps> = {}): LaunchedAgentsDeps {
  return {
    launcherBotId: "chief",
    bots: () => [{ id: "scout", name: "Scout" }],
    tasks: () => [],
    messages: () => [],
    threadReadable: () => true,
    threadBusy: () => false,
    queued: () => false,
    now: () => NOW,
    ...overrides,
  };
}

describe("launchedAgentsForBot", () => {
  it("lists hidden peer threads this bot opened, newest and running first", () => {
    const list = launchedAgentsForBot(deps({
      tasks: (botId) => botId === "scout" ? [{
        threadId: "t1",
        title: "CI main au vert",
        createdAt: NOW - 60_000,
        updatedAt: NOW - 1_000,
        busy: true,
        hidden: true,
        openedBy: { botId: "chief", at: NOW - 60_000 },
      }] : [],
    }), "alice");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "thread:t1",
      targetBotId: "scout",
      targetBotName: "Scout",
      title: "Scout: CI main au vert",
      status: "running",
      threadId: "t1",
    });
  });

  it("attaches the newest pull request when the agent run failed", () => {
    const list = launchedAgentsForBot(deps({
      tasks: (botId) => botId === "scout" ? [{
        threadId: "t2",
        title: "Investigation",
        createdAt: NOW - 120_000,
        updatedAt: NOW - 2_000,
        hidden: true,
        openedBy: { botId: "chief", at: NOW - 120_000 },
        cwd: "/srv/repo",
      }] : [],
      inRepository: () => true,
      repository: () => ({ root: "/srv/repo", branch: "main", origin: { repo: "acme/app", url: "https://github.com/acme/app" } }),
      messages: () => [
        { role: "user", kind: "text" },
        { role: "bot", kind: "activity", tool: { name: "mcp__sagax__run_command", ok: true, summary: "gh pr create", output: "https://github.com/acme/app/pull/200\n" } },
        { role: "bot", kind: "text", turnSucceeded: false },
      ],
    }), undefined);
    expect(list[0]?.status).toBe("failed");
    expect(list[0]?.pullRequest).toEqual({ number: 200, url: "https://github.com/acme/app/pull/200" });
  });

  it("ignores visible threads and threads another bot opened", () => {
    const list = launchedAgentsForBot(deps({
      tasks: () => [
        { threadId: "a", title: "Visible", createdAt: NOW, hidden: undefined, openedBy: { botId: "chief", at: NOW } },
        { threadId: "b", title: "Other", createdAt: NOW, hidden: true, openedBy: { botId: "other", at: NOW } },
      ],
    }), undefined);
    expect(list).toEqual([]);
  });

  it("marks only coding agents as coding: a dispatch or bot-to-bot run is not code work", () => {
    const opened = (threadId: string, title: string) => ({
      threadId, title, createdAt: NOW - 60_000, updatedAt: NOW - 1_000, hidden: true as const, openedBy: { botId: "chief", at: NOW - 60_000 },
    });
    const list = launchedAgentsForBot(deps({
      bots: () => [{ id: "dispatch", name: "Dispatch" }, { id: "orion", name: "Orion" }, { id: "scout", name: "Scout" }],
      tasks: (botId) => botId === "dispatch" ? [opened("d1", "@Dispatch · agent")]
        : botId === "orion" ? [opened("o1", "@Cryptic · work")]
        : [opened("s1", "Split the lexer")],
      messages: (threadId) => threadId === "s1"
        ? [{ role: "user", kind: "text" }, { role: "bot", kind: "activity", tool: { name: "Bash", ok: true, input: { command: "git commit -m lexer" } } }, { role: "bot", kind: "text", turnSucceeded: true }]
        : [{ role: "user", kind: "text" }, { role: "bot", kind: "activity", tool: { name: "mcp__cw__ticket_search", ok: true } }, { role: "bot", kind: "text", turnSucceeded: true }],
    }), undefined);
    const byId = Object.fromEntries(list.map((item) => [item.id, item]));
    expect(byId["thread:s1"]?.coding).toBe(true);
    expect(byId["thread:d1"]?.coding).toBeUndefined();
    expect(byId["thread:o1"]?.coding).toBeUndefined();
    expect(byId["thread:o1"]?.title).toBe("Orion: @Cryptic · work");
  });

  it("a run a person stopped reads stopped, not failed", () => {
    const list = launchedAgentsForBot(deps({
      tasks: () => [{ threadId: "t3", title: "work", createdAt: NOW, hidden: true, openedBy: { botId: "chief", at: NOW } }],
      // stopDirectThreadByPerson marks the request; the interrupted turn's
      // terminal line then carries turnSucceeded: false
      messages: () => [
        { role: "user", kind: "text", requestCancelled: true },
        { role: "bot", kind: "text", turnSucceeded: false },
      ],
    }), undefined);
    expect(list[0]?.status).toBe("stopped");
  });
});
