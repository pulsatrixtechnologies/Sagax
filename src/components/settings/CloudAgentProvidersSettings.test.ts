import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

import { CloudAgentProvidersSettings } from "./CloudAgentProvidersSettings";

const state = (over: Partial<Parameters<typeof CloudAgentProvidersSettings>[0]["state"]>) => ({ rows: null, error: null, refresh: async () => {}, ...over });

describe("CloudAgentProvidersSettings", () => {
  it("shows loading before providers load", () => {
    const html = renderToStaticMarkup(createElement(CloudAgentProvidersSettings, { state: state({}) }));
    expect(html).toContain("Loading cloud agent keys");
  });

  it("shows the sentence it was given, never a raw error", () => {
    const html = renderToStaticMarkup(createElement(CloudAgentProvidersSettings, { state: state({ error: "Your cloud agent keys could not be loaded." }) }));
    expect(html).toContain("data-cloud-agent-providers-error");
    expect(html).not.toContain("invalid_type");
  });

  it("lists a provider without a saved key as one to add", () => {
    const html = renderToStaticMarkup(createElement(CloudAgentProvidersSettings, { state: state({ rows: [
      { provider: "cursor", label: "Cursor", configured: true, last4: "1234" },
      { provider: "codex", label: "Codex", configured: false },
    ] }) }));
    expect(html).toContain('data-cloud-provider="cursor"');
    expect(html).toContain('data-cloud-provider="codex"');
    expect(html).toContain("1234");
  });
});
