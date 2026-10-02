import { describe, expect, it } from "vitest";

import { isViewersPrimaryBot, primaryBotChoices, viewerOwnsBot, withPrimaryBot } from "./primary-bot";

const bots = [
  { id: "cryptic", name: "Cryptic", chiefOfStaff: true },
  { id: "atlas", name: "Atlas" },
  { id: "zed", name: "Zed", title: "Researcher" },
  { id: "archived", name: "Archived", hidden: true },
  { id: "adas", name: "Ada's bot", ownerUserId: "ada" },
  { id: "adas-primary", name: "Ada's primary", ownerUserId: "ada", chiefOfStaff: true },
];

describe("Primary Bot rules in the app", () => {
  it("treats a bot without a recorded owner as the viewer's (solo server)", () => {
    expect(viewerOwnsBot({}, "pr_me")).toBe(true);
    expect(viewerOwnsBot({ ownerUserId: "local-owner" }, "pr_me")).toBe(true);
    expect(viewerOwnsBot({ ownerUserId: "PR_ME" }, "pr_me")).toBe(true);
    expect(viewerOwnsBot({ ownerUserId: "ada" }, "pr_me")).toBe(false);
  });

  it("shows the star on the viewer's own Primary Bot only", () => {
    expect(isViewersPrimaryBot(bots[0]!, "pr_me")).toBe(true);
    expect(isViewersPrimaryBot(bots[1]!, "pr_me")).toBe(false);
    expect(isViewersPrimaryBot(bots[5]!, "pr_me")).toBe(false);
    expect(isViewersPrimaryBot(bots[5]!, "ada")).toBe(true);
  });

  it("offers the viewer's own visible bots, never the current one, by name and search", () => {
    expect(primaryBotChoices(bots, "pr_me", "cryptic").map((bot) => bot.id)).toEqual(["atlas", "zed"]);
    expect(primaryBotChoices(bots, "pr_me", "cryptic", "research").map((bot) => bot.id)).toEqual(["zed"]);
    expect(primaryBotChoices(bots, "pr_me", "cryptic", "nobody")).toEqual([]);
    // Unrecorded owners read as the viewer's, like the sidebar; the server decides.
    expect(primaryBotChoices(bots, "ada", "adas-primary").map((bot) => bot.id)).toEqual(["adas", "atlas", "cryptic", "zed"]);
  });

  it("keeps one Primary Bot per person in the window, leaving other people's alone", () => {
    const next = withPrimaryBot(bots, { ...bots[1]!, chiefOfStaff: true });
    expect(next.find((bot) => bot.id === "cryptic")?.chiefOfStaff).toBe(false);
    expect(next.find((bot) => bot.id === "adas-primary")?.chiefOfStaff).toBe(true);
  });
});
