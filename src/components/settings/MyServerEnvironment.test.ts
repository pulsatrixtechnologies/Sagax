// Settings > Organization > Your server environment, and the transcript
// label naming where a tool ran.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudBackendPicker } from "../CloudBackendPicker";
import { ToolActivity } from "../ToolActivity";
import { MyServerEnvironment } from "./MyServerEnvironment";

describe("Your server environment card", () => {
  it("shows status, resources, last use and the Reset button", () => {
    const markup = renderToStaticMarkup(createElement(MyServerEnvironment, {
      initial: {
        configured: true, state: "running", lastUsedAt: Date.UTC(2026, 9, 1, 12), workspaceBytes: 50 * 1048576, overQuota: false,
        limits: { memoryMb: 1024, cpus: 1, pids: 256, diskMb: 2048, tmpMb: 256 }, idleMinutes: 15, pendingDeletionAt: null,
      },
    }));
    expect(markup).toContain("Your server environment");
    expect(markup).toContain('data-server-environment="running"');
    expect(markup).toContain("1 CPU, 1024 MB memory, 2048 MB disk");
    expect(markup).toContain("50 MB");
    expect(markup).toContain("after 15 min");
    expect(markup).toContain(">Reset<");
  });

  it("says when the server has none, and disables Reset once the person is out", () => {
    expect(renderToStaticMarkup(createElement(MyServerEnvironment, { initial: { configured: false } }))).toContain("This server has no server environments.");
    const closed = renderToStaticMarkup(createElement(MyServerEnvironment, { initial: { configured: true, state: "stopped", pendingDeletionAt: 1, limits: null } }));
    expect(closed).toContain("Closed: you were signed out");
    expect(closed).toMatch(/<button[^>]*disabled=""[^>]*>Reset/);
  });
});

describe("where a tool ran", () => {
  it("labels server environment tools and desktop tools, and nothing else", () => {
    const sandbox = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-environment__run_command", ok: true } }));
    expect(sandbox).toContain('data-target="user-sandbox"');
    expect(sandbox).toContain("Your server environment");
    const desktop = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__computer__click", ok: true }, place: "local" }));
    expect(desktop).toContain("Your computer");
    expect(renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Bash", ok: true } }))).not.toContain("tool-target");
  });
});

describe("no per-bot VPS on an organization server", () => {
  it("offers only Boat there", () => {
    const org = renderToStaticMarkup(createElement(CloudBackendPicker, { value: "box", vpsSupported: true, organization: true, onChange: () => {} }));
    expect(org).not.toContain(">Self-hosted VPS<");
    const solo = renderToStaticMarkup(createElement(CloudBackendPicker, { value: "box", vpsSupported: true, onChange: () => {} }));
    expect(solo).toContain(">Self-hosted VPS<");
  });
});
