// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityFixture } from "./capabilities.fixture";
import type { BotCapabilities } from "../../shared/capabilities";

const requests: Array<{ path: string; resolve: (data: BotCapabilities) => void }> = [];
vi.mock("@/state/store", () => ({
  api: (path: string) => new Promise<BotCapabilities>((resolve) => { requests.push({ path, resolve }); }),
}));
const { useBotCapabilities } = await import("./capabilities");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
function Probe({ botId, engine }: { botId: string | null; engine?: string }) {
  const { data, error } = useBotCapabilities(botId, { engine });
  return createElement("div", null, data?.items.map((item) => item.name).join(",") ?? error ?? "Loading");
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  requests.length = 0;
  document.body.innerHTML = "";
});

describe("the resolved capability list follows the selected bot", () => {
  it("clears a previous bot immediately and ignores its late response", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Probe, { botId: "first" })); });
    await act(async () => { root!.render(createElement(Probe, { botId: "second" })); });
    expect(requests.map(({ path }) => path)).toEqual(["/api/bots/first/capabilities", "/api/bots/second/capabilities"]);
    await act(async () => { requests[1]!.resolve(capabilityFixture({ botId: "second", items: [] })); });
    expect(host.textContent).toBe("");
    await act(async () => { requests[0]!.resolve(capabilityFixture()); });
    expect(host.textContent).toBe("");
    await act(async () => { root!.render(createElement(Probe, { botId: null })); });
    expect(host.textContent).toBe("Loading");
  });

  it("does not show a previous engine's receipts while its preview loads", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Probe, { botId: "first" })); });
    await act(async () => { requests[0]!.resolve(capabilityFixture()); });
    expect(host.textContent).toContain("Notion");
    await act(async () => { root!.render(createElement(Probe, { botId: "first", engine: "grok" })); });
    expect(host.textContent).toBe("Loading");
    expect(requests[1]!.path).toBe("/api/bots/first/capabilities?engine=grok");
  });
});
