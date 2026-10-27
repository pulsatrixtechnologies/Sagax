// @vitest-environment happy-dom
// Settings > Models and voice > Web search: the saved key is never shown, only
// its last four characters.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { WebSearchSettings } from "./WebSearchSettings";

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
const NONE = { provider: null, baseUrl: null, keyConfigured: false, last4: null, ready: false };

describe("web search in Settings", () => {
  it("shows nothing when the session has no person (401)", async () => {
    fixture.api.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    act(() => root.render(createElement(WebSearchSettings)));
    await flush();
    expect(container.textContent).toBe("");
  });

  it("shows the saved provider by its last four characters, never the key", async () => {
    fixture.api.mockResolvedValue({ provider: "brave", baseUrl: null, keyConfigured: true, last4: "abcd", ready: true });
    act(() => root.render(createElement(WebSearchSettings)));
    await flush();
    expect(container.querySelector('[data-web-search-form="brave"]')).not.toBeNull();
    expect(container.textContent).toContain("Brave Search, key ending in abcd");
    const key = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(key.value).toBe("");
    expect(container.textContent).toContain("Remove");
  });

  it("says there is none yet and opens no form before a provider is chosen", async () => {
    fixture.api.mockResolvedValueOnce(NONE);
    act(() => root.render(createElement(WebSearchSettings)));
    await flush();
    expect(container.textContent).toContain("None yet");
    expect(container.querySelector("[data-web-search-form]")).toBeNull();
  });
});
