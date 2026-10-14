// @vitest-environment happy-dom
// The step rows of the thread: one look for a tool call, a folded run of
// them, the turn digest and the narration fold. Clicks are real here (the
// row has to open and close), so this mounts instead of rendering markup.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { ActivityRun } from "./ActivityRun";
import { DigestChip } from "./DigestChip";
import { ToolActivity } from "./ToolActivity";
import { TurnNarrationRun } from "./TurnNarrationRun";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mount(element: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  flushSync(() => (element as HTMLElement).click());
}

const step = (id: string, name: string, durationMs?: number, input?: string): Message => ({
  id, role: "bot", kind: "activity", at: 1, tool: { name, ok: true, durationMs, input },
});

describe("a tool step row", () => {
  it("opens under the row and closes again", () => {
    const node = mount(createElement(ToolActivity, { tool: { name: "WebSearch", ok: true, input: JSON.stringify({ query: "sagax" }), output: "3 results", durationMs: 1_500 } }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toContain("Searched the web");
    expect(row.textContent).toContain("2s");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(node.querySelector("[data-step-detail]")).toBeNull();
    click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const detail = node.querySelector("[data-step-detail]")!;
    expect(detail.textContent).toContain("WebSearch");
    expect(detail.textContent).toContain("sagax");
    expect(detail.textContent).toContain("3 results");
    // the JSON stays folded until asked for
    expect(node.querySelector('[data-testid="tool-step-json"]')).toBeNull();
    click(node.querySelector('[data-testid="tool-step-json-toggle"]'));
    expect(node.querySelector('[data-testid="tool-step-json"]')?.textContent).toContain("\"tool\": \"WebSearch\"");
    click(row);
    expect(node.querySelector("[data-step-detail]")).toBeNull();
  });
});

describe("a group of steps", () => {
  const steps = [step("a", "Read", 1_000), step("b", "Bash", 2_000), step("c", "mcp__x__cw_psa__find_tickets", 3_000)];
  const children = steps.map((message) => createElement(ToolActivity, { key: message.id, tool: message.tool! }));

  it("reads 'Used N tools' with the time they took, then lists each step as its own row", () => {
    const node = mount(createElement(ActivityRun, { messages: steps, children }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toContain("Used 3 tools");
    expect(row.textContent).toContain("6s");
    expect(node.querySelectorAll("[data-step-row]")).toHaveLength(1);
    click(row);
    const rows = node.querySelectorAll("[data-step-detail] [data-step-row]");
    expect(rows).toHaveLength(3);
    expect([...rows].map((entry) => entry.querySelector("[data-step-label]")?.textContent)).toEqual([
      "Read a file",
      "Ran a command",
      "Viewed tickets in ConnectWise PSA",
    ]);
  });

  it("opens by itself for a search hit inside it", () => {
    const node = mount(createElement(ActivityRun, { messages: steps, forceOpen: true, children }));
    expect(node.querySelectorAll("[data-step-detail] [data-step-row]")).toHaveLength(3);
  });
});

describe("the turn digest and the narration fold", () => {
  it("says what the turn did in words, with the detail one click away", () => {
    const message: Message = {
      id: "d", role: "bot", kind: "digest", at: 1, text: "Observed work",
      digest: {
        turnId: "t", botId: "b", threadId: "th", at: 1, durationMs: 12_000,
        tools: [{ name: "Bash", count: 1, failed: 0 }], toolCalls: 1,
        memory: [], reply: "", hookCoverage: "preview",
      },
    };
    const node = mount(createElement(DigestChip, { message }));
    const row = node.querySelector("button")!;
    expect(row.textContent).toContain("Used 1 tool");
    expect(row.textContent).not.toContain("Did 1 tool calls");
    click(row);
    expect(node.querySelector('[data-testid="digest-detail"]')?.textContent).toContain("Ran a command");
  });

  it("folds a turn's narration under one quiet row", () => {
    const node = mount(createElement(TurnNarrationRun, { label: "Worked for 12s", children: createElement("p", null, "first narration") }));
    expect(node.textContent).toContain("Worked for 12s");
    expect(node.textContent).not.toContain("first narration");
    click(node.querySelector("button"));
    expect(node.textContent).toContain("first narration");
  });
});
