import { describe, expect, it } from "vitest";
import type { BotActivityItem } from "@/lib/bot-activity";
import { buildTray, TRAY_MAX } from "./tray";

const item = (patch: Partial<BotActivityItem>): BotActivityItem => ({
  id: "thread:t1",
  kind: "session",
  botId: "ada",
  title: "Export report",
  status: "running",
  startedAt: 0,
  updatedAt: 0,
  threadId: "t1",
  parallel: true,
  canStop: true,
  ...patch,
});
const title = (tool: string) => `Needs you: ${tool}`;

describe("buildTray", () => {
  it("approvals first, then running work; ids are opaque, targets stay in the brain", () => {
    const { tray, targets } = buildTray({
      botId: "ada",
      list: { items: [item({}), item({ id: "thread:t2", threadId: "t2", status: "finished" })], subagents: [] },
      approvals: [{ threadId: "t9", requestId: "req-1", tool: "click", detail: "Click Export in Excel" }],
      loading: false,
      now: 65_000,
      title,
    });
    expect(tray.items.map((row) => [row.id, row.kind, row.title])).toEqual([["a0", "approval", "Needs you: click"], ["r0", "running", "Export report"]]);
    expect(tray.items[0]).toMatchObject({ detail: "Click Export in Excel", canStop: true, canOpen: true });
    expect(tray.items[1]).toMatchObject({ canStop: true, canOpen: true });
    expect(JSON.stringify(tray)).not.toContain("req-1");
    expect(JSON.stringify(tray)).not.toContain("t9");
    expect(targets.get("a0")).toEqual({ kind: "approval", botId: "ada", threadId: "t9", requestId: "req-1" });
    expect(targets.get("r0")).toEqual({ kind: "running", botId: "ada", threadId: "t1", canStop: true });
  });

  it("only running work: finished entries and a conversation's own turn stay out", () => {
    const { tray } = buildTray({
      botId: "ada",
      list: { items: [item({ status: "failed" }), item({ id: "thread:own", threadId: "own", parallel: false })], subagents: [] },
      approvals: [],
      loading: false,
      now: 0,
      title,
    });
    expect(tray.items).toEqual([]);
  });

  it("work the viewer may not stop or open has no Stop and no link", () => {
    const { tray } = buildTray({ botId: "ada", list: { items: [item({ canStop: false, threadId: undefined })], subagents: [] }, approvals: [], loading: false, now: 0, title });
    expect(tray.items[0]).toMatchObject({ canStop: false, canOpen: false });
  });

  it("loading only while there is nothing to show yet; at most TRAY_MAX rows", () => {
    expect(buildTray({ botId: "ada", list: null, approvals: [], loading: true, now: 0, title }).tray.loading).toBe(true);
    const many = Array.from({ length: TRAY_MAX + 3 }, (_, index) => ({ threadId: `t${index}`, requestId: `r${index}`, tool: "click", detail: "" }));
    const { tray } = buildTray({ botId: "ada", list: null, approvals: many, loading: true, now: 0, title });
    expect(tray.items).toHaveLength(TRAY_MAX);
    expect(tray.loading).toBe(false);
  });

  it("long texts are cut", () => {
    const { tray } = buildTray({ botId: "ada", list: null, approvals: [{ threadId: "t", requestId: "r", tool: "x".repeat(200), detail: "y ".repeat(200) }], loading: false, now: 0, title });
    expect(tray.items[0].title.length).toBeLessThanOrEqual(80);
    expect(tray.items[0].detail.length).toBeLessThanOrEqual(140);
  });
});
