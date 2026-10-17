import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

type SchemaTool = { name: string; description: string; inputSchema: { properties: Record<string, unknown> } };
const tools = (env: Record<string, string>) =>
  availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-create", ...env })) as unknown as SchemaTool[];
const createBot = (env: Record<string, string>) => tools(env).find((tool) => tool.name === "create_bot");

describe("create_bot for a bot that is not a Primary Bot (2026-10-17)", () => {
  it("is shown when the harness says the bot may create bots", () => {
    const tool = createBot({ SAGAX_CHIEF_OF_STAFF: "0", SAGAX_CREATE_BOTS: "1" });
    expect(tool).toBeDefined();
    expect(tool!.description).not.toContain("Primary Bot only");
    expect(tool!.description).toContain("only when they ask you for one in their own request");
    expect(tool!.description).toContain("A bot you create cannot create bots itself");
    // a suggestion nobody asked for stays the Primary Bot's
    expect(tool!.inputSchema.properties).not.toHaveProperty("suggestion");
    expect(Object.keys(tool!.inputSchema.properties)).toEqual(["name", "role", "instructions", "modelSelection", "cwd"]);
  });

  it("is not shown without the switch, and the other Primary-Bot-only tools never are", () => {
    expect(createBot({ SAGAX_CHIEF_OF_STAFF: "0" })).toBeUndefined();
    expect(createBot({ SAGAX_CHIEF_OF_STAFF: "0", SAGAX_CREATE_BOTS: "0" })).toBeUndefined();
    const names = tools({ SAGAX_CHIEF_OF_STAFF: "0", SAGAX_CREATE_BOTS: "1" }).map((tool) => tool.name);
    for (const chiefOnly of ["list_team_setup", "propose_team_setup", "propose_bot_deletion", "create_room", "manage_room", "retry_thread"]) {
      expect(names).not.toContain(chiefOnly);
    }
    // a standing external runtime never gets it
    expect(createBot({ SAGAX_EXTERNAL_RUNTIME: "1", SAGAX_CREATE_BOTS: "1" })).toBeUndefined();
  });

  it("leaves the Primary Bot's create_bot exactly as it was", () => {
    const chief = createBot({ SAGAX_CHIEF_OF_STAFF: "1" });
    expect(JSON.stringify(createBot({ SAGAX_CHIEF_OF_STAFF: "1", SAGAX_CREATE_BOTS: "1" }))).toBe(JSON.stringify(chief));
    expect(chief!.description).toContain("Primary Bot only");
    expect(chief!.inputSchema.properties).toHaveProperty("suggestion");
  });
});
