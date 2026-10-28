// @vitest-environment happy-dom
// #1098 (2026-10-28): Show tool calls is each person's own display choice on
// an organization server (/api/me/experimental), with no right to edit the
// installation; a solo server keeps the installation's switch (/api/config).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), config: {} as Record<string, unknown> }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));

import { ToolCallsRow } from "./AppearanceSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = async () => {
  const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
  act(() => toggle.click());
  await flush();
};

describe("Show tool calls", () => {
  it("is the person's own on an organization server, with no right to edit the installation", async () => {
    fixture.config = { personalSettings: true, features: { showToolCalls: false }, viewer: { role: "member", operator: false } };
    fixture.api.mockResolvedValue({ features: { showToolCalls: true } });
    act(() => root.render(createElement(ToolCallsRow)));
    await click();
    expect(fixture.api).toHaveBeenCalledWith("/api/me/experimental", { method: "PATCH", body: JSON.stringify({ features: { showToolCalls: true } }) });
    expect(fixture.api.mock.calls.some(([path, init]) => path === "/api/config" && init?.method === "PATCH")).toBe(false);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { features: { showToolCalls: true } } });
  });

  it("stays the installation's switch on a solo server", async () => {
    fixture.config = { features: { showToolCalls: true } };
    fixture.api.mockResolvedValue({ features: { showToolCalls: false } });
    act(() => root.render(createElement(ToolCallsRow)));
    await click();
    expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PATCH", body: JSON.stringify({ features: { showToolCalls: false } }) });
  });
});
