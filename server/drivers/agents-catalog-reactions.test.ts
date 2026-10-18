// The reaction tools in the agents catalogue (react_to_message,
// remove_reaction; shared/reactions.ts): offered in every chat and room turn,
// with the short emoji list as the schema, and never on a live voice call.
import { describe, expect, it } from "vitest";
import { BOT_REACTIONS } from "../../shared/reactions.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })).map((tool) => tool.name);

describe("reaction tools", () => {
  it("are offered in a direct turn and a room turn, chief or not", () => {
    const envs: Array<Record<string, string>> = [{}, { SAGAX_ROOM_TURN: "1" }, { SAGAX_CHIEF_OF_STAFF: "1" }, { SAGAX_ROOM_TURN: "1", SAGAX_CHIEF_OF_STAFF: "1" }];
    for (const env of envs) {
      expect(names(env)).toEqual(expect.arrayContaining(["react_to_message", "remove_reaction"]));
    }
  });

  it("are not offered on a live voice call, where end_call is", () => {
    const onCall = names({ SAGAX_VOICE_CALL: "1" });
    expect(onCall).toContain("end_call");
    expect(onCall).not.toContain("react_to_message");
    expect(onCall).not.toContain("remove_reaction");
  });

  it("name the short emoji list in the schema", () => {
    const tool = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1" })).find((entry) => entry.name === "react_to_message")!;
    const emoji = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).emoji!;
    expect(emoji.enum).toEqual([...BOT_REACTIONS]);
    expect(tool.description).toContain("Never instead of an answer");
  });
});
