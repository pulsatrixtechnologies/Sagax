// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Task } from "@/state/store";
import { connectorsCount, connectorsData } from "./connectors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = {
  at: 1,
  connectors: [
    { name: "Mail", source: "claude", state: "connected" },
    { name: "Drive", source: "claude", state: "reconnect" },
    { name: "grok.com", source: "grok", state: "connected" },
    { name: "workshop", source: "perspicax", state: "connected" },
    { name: "notes", source: "personal", state: "connected" },
    { name: "github", source: "server", state: "connected" },
    { name: "review", source: "plugin", state: "connected" },
  ],
};
const bot = { id: "dev", threadId: "t1", mcpServers: null } as unknown as Bot;
const task = { threadId: "t1", connectors: record } as unknown as Task;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("connectors card", () => {
  it("reads what the turn reached, every source, not the app-wide server list", () => {
    const data = connectorsData({ bot, task }, [{ name: "linear", enabled: true }]);
    expect(data?.configured).toBe(false);
    expect(data?.connectors.map((row) => row.source)).toEqual(["claude", "claude", "grok", "perspicax", "personal", "server", "plugin"]);
    expect(data?.connectors.some((row) => row.name === "linear")).toBe(false);
    expect(connectorsCount(data!)).toBe(7);
  });

  it("falls back to the bot's set servers before any recorded turn, and says so", () => {
    const data = connectorsData({ bot, task: { threadId: "t1" } as Task }, [{ name: "github", enabled: true }, { name: "off", enabled: false }, { name: "docs", enabled: true, auth: "expired" }]);
    expect(data).toEqual({ configured: true, claudeAccount: false, connectors: [
      { name: "github", source: "server", state: "connected" },
      { name: "docs", source: "server", state: "reconnect" },
    ] });
  });

  it("groups rows by source, shows the state, and links to Connect Apps", async () => {
    const dispatch = vi.fn();
    await act(async () => {
      const { devPodDefinitions } = await import("../registry");
      const pod = devPodDefinitions().find((entry) => entry.id === "connectors")!;
      root.render(createElement(pod.Body, { data: connectorsData({ bot, task }, null)!, ctx: { bot, task, messages: [], threadKey: "dev:t1", computerStart: undefined, dispatch } }));
    });
    // the one to reconnect is never hidden behind Show more
    expect(container.querySelector('[data-connector="Drive"]')!.getAttribute("data-connector-state")).toBe("reconnect");
    expect([...container.querySelectorAll("[data-connector-source]")].map((node) => node.getAttribute("data-connector-source")))
      .toEqual(["claude", "grok", "perspicax", "personal", "server"]);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connectors-more]")!.click(); });
    expect(container.querySelector('[data-connector-source="plugin"]')).not.toBeNull();
    expect(container.textContent).toContain(t("devPods.connectors.grokAccount"));
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connector-reconnect]")!.click(); });
    expect(dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, botId: "dev" });
  });
});
