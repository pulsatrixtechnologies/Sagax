// Settings > Organization > Your server environment, and the transcript
// label naming where a tool ran.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudBackendPicker } from "../CloudBackendPicker";
import { ToolActivity } from "../ToolActivity";
import { ServerEnvironmentCard } from "./OrgComputerSettings";

describe("Server environment card (Settings > Computer)", () => {
  it("shows one line, the state, resources, the screen button and Reset only behind the menu", () => {
    const markup = renderToStaticMarkup(createElement(ServerEnvironmentCard, {
      initial: {
        configured: true, state: "running", lastUsedAt: Date.UTC(2026, 9, 1, 12), workspaceBytes: 50 * 1048576, overQuota: false,
        limits: { memoryMb: 1024, cpus: 1, pids: 256, diskMb: 2048, tmpMb: 256 }, idleMinutes: 15, pendingDeletionAt: null,
      },
    }));
    expect(markup).toContain("Server environment");
    expect(markup).toContain('data-server-environment="running"');
    expect(markup).toContain("1 CPU, 1024 MB memory, 2048 MB disk");
    expect(markup).toContain("Show the screen");
    expect(markup).toContain('aria-label="More actions"');
    // Reset is in the closed "..." menu, and nothing opens a browser window.
    expect(markup).not.toContain(">Reset<");
    expect(markup).not.toContain("desktop-viewer");
  });

  it("says when the server has none, and words a closed environment", () => {
    expect(renderToStaticMarkup(createElement(ServerEnvironmentCard, { initial: { configured: false } }))).toContain("This server has no server environments.");
    const closed = renderToStaticMarkup(createElement(ServerEnvironmentCard, { initial: { configured: true, state: "stopped", pendingDeletionAt: 1, limits: null } }));
    expect(closed).toContain("Closed: you were signed out");
    expect(closed).toMatch(/<button[^>]*disabled=""[^>]*>Show the screen/);
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
