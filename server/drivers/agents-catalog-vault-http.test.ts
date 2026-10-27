// vault_http_request is listed only when the harness says this bot may send
// an API key of the person here (SAGAX_VAULT_HTTP=1), never to an external
// runtime, and it carries no key argument.
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", ...env })).map((tool) => tool.name);

describe("vault_http_request in the catalog", () => {
  it("is shown only with the switch", () => {
    expect(names({})).not.toContain("vault_http_request");
    expect(names({ SAGAX_VAULT_HTTP: "0" })).not.toContain("vault_http_request");
    expect(names({ SAGAX_VAULT_HTTP: "1" })).toContain("vault_http_request");
    expect(names({ SAGAX_VAULT_HTTP: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("vault_http_request");
  });

  it("takes a handle, never a key", () => {
    const tool = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", SAGAX_VAULT_HTTP: "1" })).find((entry) => entry.name === "vault_http_request")!;
    const properties = Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(properties).toEqual(["handle", "method", "url", "headers", "body"]);
  });
});
