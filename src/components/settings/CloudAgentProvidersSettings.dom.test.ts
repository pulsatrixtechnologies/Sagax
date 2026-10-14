// @vitest-environment happy-dom
// Regression (2026-10-14): Settings showed the raw schema error
// [{"expected":"object","code":"invalid_type","path":["providers","codex"],...}]
// when the cloud agent keys could not be read. It now shows one sentence.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { CloudAgentProvidersSettings, useCloudAgentProviders } from "./CloudAgentProvidersSettings";

const ZOD = '[{"expected":"object","code":"invalid_type","path":["providers","codex"],"message":"Invalid input: expected object, received undefined"}]';

function Harness() {
  return createElement(CloudAgentProvidersSettings, { state: useCloudAgentProviders() });
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("cloud agent keys in Settings", () => {
  it("never shows a raw schema error when the keys cannot be loaded", async () => {
    fixture.api.mockRejectedValue(new Error(ZOD));
    act(() => root.render(createElement(Harness)));
    await flush();
    expect(container.textContent).toContain("Your cloud agent keys could not be loaded. Try again in a moment.");
    expect(container.textContent).not.toContain("invalid_type");
    expect(container.textContent).not.toContain("providers");
  });

  it("shows nothing when the session has no person (401)", async () => {
    fixture.api.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    act(() => root.render(createElement(Harness)));
    await flush();
    expect(container.textContent).toBe("");
  });

  it("lists the providers when none has a key, codex included", async () => {
    fixture.api.mockResolvedValue({ providers: [
      { provider: "cursor", label: "Cursor", configured: false },
      { provider: "claude", label: "Claude Code", configured: false },
      { provider: "codex", label: "Codex", configured: false },
    ] });
    act(() => root.render(createElement(Harness)));
    await flush();
    expect(container.querySelector('[data-cloud-provider="codex"]')).not.toBeNull();
    expect(container.querySelector("[data-cloud-agent-providers-error]")).toBeNull();
  });

  it("keeps a raw error from a save out of the page too", async () => {
    fixture.api.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (!init) return { providers: [{ provider: "codex", label: "Codex", configured: false }] };
      throw new Error(ZOD);
    });
    act(() => root.render(createElement(Harness)));
    await flush();
    // open the card, type a token, save
    act(() => { (container.querySelector('[data-settings-card="connections.cloudAgents"] button') as HTMLButtonElement).click(); });
    const input = container.querySelector('[data-cloud-provider="codex"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "tok"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { (container.querySelector('[data-cloud-provider="codex"] button') as HTMLButtonElement).click(); });
    await flush();
    expect(container.textContent).toContain("That did not work. Check the key and try again.");
    expect(container.textContent).not.toContain("invalid_type");
  });
});
