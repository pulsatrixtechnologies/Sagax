import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolActivity } from "./ToolActivity";

describe("ToolActivity", () => {
  it("is a quiet step row: plain words, no frame, no monospace, no green check", () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Bash", ok: true, input: "{\"command\":\"echo hi\"}", durationMs: 2_100 } }));
    expect(html).toContain("data-step-row");
    expect(html).toContain('data-phase="done"');
    expect(html).toContain(">Ran a command<");
    expect(html).toContain(">echo hi<");
    expect(html).toContain(">2s<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Ran a command · Completed · Tool details");
    // the old pill: a bordered chip with the raw id in monospace and a green check
    expect(html).not.toContain("border border-hairline");
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("text-success");
    // collapsed: the detail is not drawn
    expect(html).not.toContain("tool-step-detail");
  });

  it("opens to the technical name, readable arguments and an escaped result", () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      tool: { name: "mcp__agents__coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1"], message: "check the logs" }), output: "<script>unsafe()</script>" },
      nameOf: (id: string) => (id === "b1" ? "Wren" : undefined),
      defaultOpen: true,
    }));
    expect(html).toContain(">Coordinated Wren<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("tool-step-detail");
    // the raw id lives only in the detail
    expect(html).toContain(">mcp__agents__coordinate_bots<");
    expect(html).toContain(">check the logs<");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    // the full JSON is folded, one click away, and copyable
    expect(html).toContain("Full JSON");
    expect(html).toContain("Copy JSON");
    expect(html).not.toContain('data-testid="tool-step-json"');
  });

  it("distinguishes running, failed and unrecorded output", () => {
    const render = (ok?: boolean) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Read", ok }, defaultOpen: true }));
    expect(render()).toContain('data-phase="running"');
    expect(render()).toContain("thinking-shimmer");
    expect(render()).toContain(">Reading a file<");
    expect(render()).toContain("Waiting for the tool to finish");
    expect(render(false)).toContain('data-phase="failed"');
    expect(render(false)).toContain("text-danger");
    expect(render(false)).toContain(">Could not read a file<");
    expect(render(false)).toContain("No output was recorded");
    expect(render(true)).toContain("No output was recorded");
    expect(render(true)).not.toContain("thinking-shimmer");
  });

  it("shows a computer switch as a small line, not a tool disclosure", () => {
    const chip = (target: string, ok?: boolean) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-computer__computer_select", ok, input: JSON.stringify({ target, reason: "her files" }) } }));
    expect(chip("this_computer", true)).toContain('data-testid="tool-computer-switch"');
    expect(chip("this_computer", true)).toContain("Workspace: My computer");
    expect(chip("cloud", true)).toContain("Workspace: Cloud");
    expect(chip("local_vm", true)).toContain("Workspace: Local VM");
    expect(chip("browser", true)).toContain("Workspace: Browser");
    expect(chip("browser", true)).toContain('data-target="browser"');
    expect(chip("this_computer", true)).not.toContain("data-step-row");
    // a refused switch keeps its details (the reason it failed)
    expect(chip("this_computer", false)).toContain("data-step-row");
  });
});
