import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { instances: [], selectedId: "pepper" }, dispatch: vi.fn() }),
}));

import type { BotActivityDetail, BotActivityItem } from "../../../shared/bot-activity";
import { ActivityList } from "./ActivitySection";
import { ActivityDetailBody } from "./ActivityDetailModal";
import { formatActivityDuration } from "@/lib/bot-activity";

const NOW = 1_800_000_000_000;
const running: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "pepper", botName: "Pepper", title: "Refactor the parser and split the lexer into its own module",
  status: "running", startedAt: NOW - 90_000, updatedAt: NOW, threadId: "t1", startedBy: { kind: "person", name: "Alice" }, childCount: 2,
};
const finished: BotActivityItem = { id: "run:r1", kind: "routine", botId: "pepper", title: "hourly-dispatch-board-1-si", status: "finished", startedAt: NOW - 600_000, endedAt: NOW - 540_000, updatedAt: NOW - 540_000, startedBy: { kind: "routine", name: "hourly-dispatch-board-1-si" } };
const failed: BotActivityItem = { id: "thread:t2", kind: "hop", botId: "pepper", title: "Check the build", status: "failed", startedAt: NOW - 50_000, endedAt: NOW - 40_000, updatedAt: NOW - 40_000, threadId: "t2", startedBy: { kind: "bot", name: "Echo" } };
const waiting: BotActivityItem = { ...running, id: "thread:t3", status: "waiting", childCount: undefined };

const list = (items: BotActivityItem[] | null, error = false) => renderToStaticMarkup(createElement(ActivityList, { items, error, onOpen: () => {} }));

describe("Coding list", () => {
  it("draws one rounded card per entry: icon by status, truncated title, status line, chevron", () => {
    const html = list([running, waiting, failed, finished]);
    expect(html.match(/data-activity-card=/g)).toHaveLength(4);
    expect(html).toContain('data-activity-icon="running"');
    expect(html).toContain("animate-spin");
    expect(html).toContain('data-activity-icon="waiting"');
    expect(html).toContain('data-activity-icon="failed"');
    expect(html).toContain('data-activity-icon="finished"');
    expect(html).toContain("truncate");
    expect(html).toContain("Running · 2 sub-agents");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Failed · from Echo");
    expect(html).toContain("Finished · Routine");
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain("rounded-xl");
  });

  it("says when there is nothing, when it loads and when it failed", () => {
    expect(list([])).toContain("Nothing yet.");
    expect(list(null)).toContain("Loading activity");
    expect(list(null, true)).toContain("Couldn&#x27;t load this bot&#x27;s activity.");
  });
});

const detail: BotActivityDetail = {
  ...running,
  engine: { instanceId: "claude", model: "claude-sonnet-5" },
  via: "subscription",
  payer: "speaker",
  steps: [
    { id: "s1", name: "mcp__sagax-desktop__shell", summary: "pnpm test", ok: true, at: NOW - 60_000, where: "computer" },
    { id: "s2", name: "Edit", at: NOW - 10_000, where: "server", files: ["src/lexer.ts"] },
  ],
  stepsTruncated: true,
  files: ["src/lexer.ts"],
  children: [{ id: "thread:c1", kind: "subagent", botId: "echo", botName: "Echo", title: "Write the lexer tests", status: "running", startedAt: NOW - 30_000, updatedAt: NOW - 30_000, threadId: "c1" }],
  canStop: true,
};
const body = (props: Partial<Parameters<typeof ActivityDetailBody>[0]>) => renderToStaticMarkup(createElement(ActivityDetailBody, {
  item: running, detail, error: false, now: NOW, onStop: () => {}, onOpenThread: () => {}, onOpenChild: () => {},
  engineName: (id) => (id === "claude" ? "Claude Code" : undefined), ...props,
}));

describe("activity detail modal", () => {
  it("shows status, times, duration, who started it, engine and payer", () => {
    const html = body({});
    expect(html).toContain("Refactor the parser");
    expect(html).toContain("Running");
    expect(html).toContain("Started");
    expect(html).toContain("1m");
    expect(html).toContain("Alice");
    expect(html).toContain("Claude Code · claude-sonnet-5");
    expect(html).toContain("Personal subscription");
  });

  it("lists the steps with where each ran, the files touched and the sub-agents", () => {
    const html = body({});
    expect(html).toContain('data-activity-step="mcp__sagax-desktop__shell"');
    expect(html).toContain('data-activity-where="computer"');
    expect(html).toContain("Your computer");
    expect(html).toContain("Server environment");
    expect(html).toContain("Older steps are in the conversation.");
    expect(html).toContain("src/lexer.ts");
    expect(html).toContain("Sub-agents");
    expect(html).toContain("Write the lexer tests");
  });

  it("offers Stop only while it runs and the viewer may stop it, and Open thread when it is theirs", () => {
    expect(body({})).toContain(">Stop<");
    expect(body({})).toContain("Open thread");
    expect(body({ detail: { ...detail, canStop: false } })).not.toContain(">Stop<");
    const done = { ...detail, status: "finished" as const, endedAt: NOW - 1_000 };
    expect(body({ item: { ...running, status: "finished" }, detail: done })).not.toContain(">Stop<");
    expect(body({ item: { ...running, status: "finished" }, detail: done })).toContain("Ended");
  });

  it("shows a routine run seen without its thread as status only", () => {
    const run: BotActivityDetail = { ...finished, steps: [], stepsTruncated: false, files: [], children: [], canStop: false };
    const html = body({ item: finished, detail: run });
    expect(html).toContain("only its status is shown");
    expect(html).toContain("Routine hourly-dispatch-board-1-si");
    expect(html).not.toContain("Open thread");
    expect(html).not.toContain("Steps");
  });

  it("shows the owner the access card of a run refused on her credentials, with its actions", () => {
    const refused: BotActivityDetail = {
      ...finished, status: "failed", steps: [], stepsTruncated: false, files: [], children: [], canStop: false,
      access: { reason: "no_access", engine: "Claude", botId: "pepper", ownerPrincipalId: "alice", payer: "owner", payerPrincipalId: "alice", routine: true, cause: "no_credentials", subscriptionSignIn: true, keysUrl: "https://px.example.test/console/me/keys" },
    };
    const html = body({ item: finished, detail: refused, viewer: { principalId: "alice", admin: true }, onSignIn: () => {} });
    expect(html).toContain("data-activity-access");
    expect(html).toContain('data-access-card="no_access"');
    expect(html).toContain("Your routine can&#x27;t run: you don&#x27;t have Claude access.");
    expect(html).toContain("data-access-sign-in");
    expect(html).toContain("Sign in with my subscription");
    expect(html).toContain('href="https://px.example.test/console/me/keys"');
    expect(html).toContain("Add my key in Perspicax");
    expect(html).toContain("the organization&#x27;s key in Settings &gt; Connections");
    expect(html).not.toContain("Open thread");
    // a run without a card shows none
    expect(body({ item: finished, detail: { ...refused, access: undefined } })).not.toContain("data-activity-access");
  });

  it("formats durations at a glance", () => {
    expect(formatActivityDuration(45_000)).toBe("45s");
    expect(formatActivityDuration(12 * 60_000)).toBe("12m");
    expect(formatActivityDuration(65 * 60_000)).toBe("1h 05m");
  });
});
