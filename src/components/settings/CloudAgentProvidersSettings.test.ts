import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

import { CloudAgentProvidersSettings } from "./CloudAgentProvidersSettings";

describe("CloudAgentProvidersSettings", () => {
  it("shows loading before providers load", () => {
    const html = renderToStaticMarkup(createElement(CloudAgentProvidersSettings));
    expect(html).toContain("Loading cloud agent keys");
  });
});
