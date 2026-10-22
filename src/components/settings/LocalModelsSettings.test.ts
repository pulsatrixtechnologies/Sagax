// Settings > Computer: the loopback servers fold to one line, and the
// computer's activity never shows the platform or host name of a connection.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { DEFAULT_BOT_WORKPLACE } from "../../../shared/bot-workplace";

import { activityLine, BotWorkplaceSettings } from "./BotWorkplaceSettings";
import { endpointName, endpointsSummary, endpointStatus } from "./LocalModelsSettings";

const row = (label: string, port: number) => ({ id: label, label, baseUrl: `http://127.0.0.1:${port}/v1` });

describe("loopback servers summary", () => {
  it("counts the servers and names the first three", () => {
    const rows = [row("DwarfStar", 8002), row("llama-server", 9337), row("Bonsai", 9338), row("Ollama", 11434)];
    expect(endpointsSummary(rows)).toBe("4 local servers · DwarfStar, llama-server, Bonsai, …");
    expect(endpointsSummary([row("DwarfStar", 8002)])).toBe("1 local server · DwarfStar");
    expect(endpointsSummary([])).toBe("0 local servers");
  });

  it("names an unlabeled server by host and port", () => {
    expect(endpointName({ id: "", label: "", baseUrl: "http://localhost:1234/v1" })).toBe("localhost:1234");
  });
});

describe("loopback server probe status", () => {
  const ep = (id: string, port: number) => ({ id, label: id, baseUrl: `http://127.0.0.1:${port}/v1` });
  const published = [{ id: "desk8002", label: "DwarfStar", models: ["a", "b"] }];
  const probes = [
    { id: "desk8002", status: "answered" as const },
    { id: "desk8000", status: "needs_key" as const },
    { id: "desk9337", status: "offline" as const },
    { id: "desk9338", status: "empty" as const },
  ];

  it("shows the model count for an answering server and why the others are not listed", () => {
    expect(endpointStatus(ep("desk8002", 8002), published, probes)).toEqual({ tone: "ok", text: "2 models" });
    expect(endpointStatus(ep("desk8000", 8000), published, probes)).toEqual({ tone: "warn", text: "Reachable, needs an API key" });
    expect(endpointStatus(ep("desk9337", 9337), published, probes)).toEqual({ tone: "muted", text: "Not responding" });
    expect(endpointStatus(ep("desk9338", 9338), published, probes)).toEqual({ tone: "muted", text: "Running, no models" });
  });

  it("shows nothing for a server not probed yet (older desktop, or none connected)", () => {
    expect(endpointStatus(ep("desk1234", 1234), published, probes)).toBeNull();
    expect(endpointStatus(ep("desk8002", 8002), [], [])).toBeNull();
  });
});

describe("computer activity", () => {
  const status: DesktopBridgeStatus = {
    connected: true, tunnel: false, desktops: [], workplace: { ...DEFAULT_BOT_WORKPLACE },
    activity: [{ at: Date.UTC(2026, 9, 15, 19, 46), target: "user-desktop", kind: "connect" as const, detail: "darwin Some-Macbook.local", ok: true }],
  };

  it("hides the list by default behind a quiet link", () => {
    const markup = renderToStaticMarkup(createElement(BotWorkplaceSettings as (props: { status?: DesktopBridgeStatus }) => ReturnType<typeof BotWorkplaceSettings>, { status }));
    expect(markup).toContain('data-bot-activity="closed"');
    expect(markup).toContain("See activity");
    expect(markup).not.toContain("darwin");
    expect(markup).not.toContain("Some-Macbook");
  });

  it("never shows the platform or host name of a connection", () => {
    expect(activityLine(status.activity[0])).toBe("Computer connected · your computer");
    expect(activityLine({ ...status.activity[0], kind: "network", detail: "example.com:443" })).toBe("example.com:443 · your computer");
  });
});
