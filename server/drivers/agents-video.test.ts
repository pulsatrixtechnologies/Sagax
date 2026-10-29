import { describe, expect, it } from "vitest";

import { availableTools, type CatalogProfile } from "./agents-catalog.ts";
import { callVideoTool, ENGINE_VIDEO_TOOLS, VIDEO_PROVIDER_GAP, VIDEO_TOOL_NAME } from "./agents-video.ts";
import { GROK_HOST_TOOL_NAMES, grokOrgAgentProfile } from "./host-tools.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, coordinating: true, ownThreadCreation: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

describe("make_video", () => {
  it("is on every catalog, including an organization-style turn and an external runtime", () => {
    for (const profile of [PROFILE, { ...PROFILE, externalRuntime: true }, { ...PROFILE, phoneTools: [] }]) {
      const tool = availableTools(profile).find((item) => item.name === VIDEO_TOOL_NAME);
      expect(tool?.description).toContain("image_to_video");
      expect(tool?.description).toContain("reference_to_video");
    }
  });

  it("reports the missing provider and does not start a shell", () => {
    const answer = callVideoTool({ prompt: "a short clip of rain on a window" });
    expect(answer).toEqual({ text: VIDEO_PROVIDER_GAP, isError: true });
    expect(answer.text).not.toMatch(/run_terminal|bash|spawn/i);
    expect(callVideoTool({}).isError).toBe(true);
    expect(callVideoTool({ prompt: "x", image: "y".repeat(501) }).isError).toBe(true);
  });

  it("keeps video and images on an organization profile and withholds the host tools", () => {
    const profile = grokOrgAgentProfile(undefined, true);
    expect(profile.tools).toEqual(expect.arrayContaining([...ENGINE_VIDEO_TOOLS, "image_gen", "image_edit"]));
    for (const name of ["run_terminal_command", "read_file", "write"]) {
      expect(GROK_HOST_TOOL_NAMES).toContain(name);
      expect(profile.tools).not.toContain(name);
    }
  });
});
