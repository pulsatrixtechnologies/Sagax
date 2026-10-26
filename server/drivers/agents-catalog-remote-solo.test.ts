// Remote sessions need Perspicax: a solo server shows no remote tool to a bot,
// an organization server (Perspicax tools mounted) keeps them.
import { describe, expect, it } from "vitest";
import { availableTools, catalogProfileFromEnv, REMOTE_SESSION_TOOL_NAMES } from "./agents-catalog.ts";

const names = (env: NodeJS.ProcessEnv) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", ...env })).map((tool) => tool.name);

describe("remote tools by server kind", () => {
  it("hides every remote tool on a solo server", () => {
    const solo = names({});
    for (const name of REMOTE_SESSION_TOOL_NAMES) expect(solo).not.toContain(name);
    expect(solo.some((name) => name.startsWith("remote_support_"))).toBe(false);
  });

  it("offers them on an organization server linked to Perspicax", () => {
    const org = names({ SAGAX_PERSPICAX_TOOLS: "1" });
    for (const name of REMOTE_SESSION_TOOL_NAMES) expect(org).toContain(name);
    expect(org).toContain("remote_support_open");
  });
});
