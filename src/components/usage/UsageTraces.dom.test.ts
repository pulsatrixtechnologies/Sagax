// @vitest-environment happy-dom
// The per-job usage traces panel: it names each job by a human label, shows
// its time and cost, and never prints a raw UUID (the ids ride a Copy button
// only). Owner/admin gating is done by UsageSection; this covers the render.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UsageTraces } from "./UsageTraces";
import type { UsageJobTrace, UsageTraceList } from "@/lib/usage-trace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function job(over: Partial<UsageJobTrace> = {}): UsageJobTrace {
  return {
    jobId: "thr_9c2d|routine:r1",
    threadId: "thr_9c2d",
    botId: "bot_8f3a",
    botName: "Scout",
    triggerKey: "routine:r1",
    triggerLabel: "Routine: Morning digest",
    triggerKind: "routine",
    routineId: "r1",
    firstAt: "2026-10-22T12:00:00.000Z",
    lastAt: "2026-10-22T12:05:00.000Z",
    turns: 3,
    timedTurns: 3,
    durationMs: 12_000,
    input: 1200,
    output: 300,
    cachedInput: 900,
    costUsd: 0.042,
    estimatedUsd: null,
    unpriced: 0,
    models: ["claude-sonnet-5"],
    steps: [
      { at: "2026-10-22T12:00:00.000Z", model: "claude-sonnet-5", engine: "claudeAgent", input: 600, output: 150, cachedInput: 450, costUsd: 0.021, costSource: "reported", durationMs: 6000 },
      { at: "2026-10-22T12:05:00.000Z", model: "claude-sonnet-5", engine: "claudeAgent", input: 600, output: 150, cachedInput: 450, costUsd: 0.021, costSource: "reported", durationMs: 6000 },
    ],
    ...over,
  };
}

const list = (jobs: UsageJobTrace[], over: Partial<UsageTraceList> = {}): UsageTraceList => ({
  from: "2026-10-01", to: "2026-10-22", jobs,
  total: { jobs: jobs.length, turns: 3, durationMs: 12_000, costUsd: 0.042, estimatedUsd: null, unpriced: 0, input: 1200, output: 300 },
  truncated: false, ...over,
});

async function render(load: (range: { from: string; to: string }, paging?: { limit: number; offset: number }) => Promise<UsageTraceList>) {
  await act(async () => { root.render(createElement(UsageTraces, { load })); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("UsageTraces", () => {
  it("names the job by a human label and shows its time and cost", async () => {
    await render(() => Promise.resolve(list([job()])));
    const text = host.textContent ?? "";
    expect(text).toContain("Scout");
    expect(text).toContain("Routine: Morning digest");
    expect(text).toContain("12 s");
    expect(text).toContain("$0.04");
  });

  it("never prints a raw UUID; the ids are only on the Copy control", async () => {
    await render(() => Promise.resolve(list([job()])));
    // The visible text carries no raw id.
    const text = host.textContent ?? "";
    expect(text).not.toContain("thr_9c2d");
    expect(text).not.toContain("bot_8f3a");
    // The ids are available for a copy, in the control's tooltip.
    const copy = host.querySelector("button[title*='thr_9c2d']");
    expect(copy).not.toBeNull();
    expect(copy?.getAttribute("title")).toContain("bot_8f3a");
  });

  it("shows the unpriced count when no turn in the job was priced", async () => {
    await render(() => Promise.resolve(list([job({ costUsd: null, estimatedUsd: null, unpriced: 3 })])));
    expect(host.textContent ?? "").toContain("3 unpriced");
  });

  it("states the empty case", async () => {
    await render(() => Promise.resolve(list([])));
    expect(host.textContent ?? "").toContain("No job recorded");
  });

  // A fake paging server over 23 fictional jobs, newest first.
  const all = Array.from({ length: 23 }, (_, n) => job({ jobId: `j${n}`, botName: `Bot ${String(n).padStart(2, "0")}` }));
  const paged = (calls: Array<{ limit: number; offset: number } | undefined>) => (_r: unknown, paging?: { limit: number; offset: number }) => {
    calls.push(paging);
    const { limit, offset } = paging ?? { limit: 999, offset: 0 };
    return Promise.resolve({ ...list(all.slice(offset, offset + limit), { page: { offset, limit } }), total: { jobs: 23, turns: 69, durationMs: 3_725_000, costUsd: 1.5, estimatedUsd: null, unpriced: 0, input: 0, output: 0 } });
  };
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => { button.click(); });
    await act(async () => { await Promise.resolve(); });
  };

  it("shows ten jobs a page, the range and the whole period's time and cost on top", async () => {
    const calls: Array<{ limit: number; offset: number } | undefined> = [];
    await render(paged(calls));
    expect(calls[0]).toEqual({ limit: 10, offset: 0 });
    const text = host.textContent ?? "";
    expect(text).toContain("Bot 00");
    expect(text).toContain("Bot 09");
    expect(text).not.toContain("Bot 10");
    expect(text).toContain("1-10 of 23");
    expect(host.querySelector("[data-testid='usage-trace-total']")?.textContent).toContain("1 h 2 m");
    expect(host.querySelector("[data-testid='usage-trace-total']")?.textContent).toContain("$1.50");
  });

  it("goes to the next and previous page, disabling the ends", async () => {
    const calls: Array<{ limit: number; offset: number } | undefined> = [];
    await render(paged(calls));
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Previous")?.disabled).toBe(true);
    await click("Next");
    expect(calls.at(-1)).toEqual({ limit: 10, offset: 10 });
    expect(host.textContent ?? "").toContain("11-20 of 23");
    await click("Next");
    expect(host.textContent ?? "").toContain("21-23 of 23");
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Next")?.disabled).toBe(true);
    await click("Previous");
    expect(host.textContent ?? "").toContain("11-20 of 23");
  });

  it("slices an older server's full answer on the client", async () => {
    await render(() => Promise.resolve(list(all)));
    const text = host.textContent ?? "";
    expect(text).toContain("Bot 09");
    expect(text).not.toContain("Bot 10");
    expect(text).toContain("1-10 of 23");
  });
});
