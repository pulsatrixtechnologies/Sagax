import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolActivity } from "./ToolActivity";

describe("ToolActivity", () => {
  it("starts collapsed with an accessible status and escaped input/output", () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Bash", ok: true, input: "echo hi", output: "<script>unsafe()</script>" } }));
    expect(html).toContain("<details");
    expect(html).not.toContain(" open=");
    expect(html).toContain("Bash · Completed · Tool details");
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("echo hi");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("distinguishes pending, failed and unrecorded output", () => {
    const render = (ok?: boolean) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Read", ok } }));
    expect(render()).toContain("Waiting for the tool to finish");
    expect(render(false)).toContain("Failed");
    expect(render(false)).toContain("No output was recorded");
    expect(render(true)).toContain("No output was recorded");
  });
  it("shows a computer switch as a small chip, not a tool disclosure", () => {
    const chip = (target: string, ok?: boolean) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-computer__computer_select", ok, input: JSON.stringify({ target, reason: "her files" }) } }));
    expect(chip("this_computer", true)).toContain('data-testid="tool-computer-switch"');
    expect(chip("this_computer", true)).toContain("Working on: My computer");
    expect(chip("cloud", true)).toContain("Working on: Cloud");
    expect(chip("local_vm", true)).toContain("Working on: Local VM");
    expect(chip("this_computer", true)).not.toContain("<details");
    // a refused switch keeps its details (the reason it failed)
    expect(chip("this_computer", false)).toContain("<details");
  });
});
