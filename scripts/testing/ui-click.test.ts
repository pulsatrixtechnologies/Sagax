import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clickByAccessibleNameJs, openProfileAria, overlaysOpenJs } from "./ui-click.ts";

describe("renderer e2e click helpers", () => {
  it("uses the possessive profile aria from chat.openProfileAria", () => {
    expect(openProfileAria("Quill")).toBe("Open Quill's profile");
    expect(openProfileAria("Quill")).not.toBe("Open Quill profile");
  });

  it("embeds the accessible name in a DOM click that bypasses hit-testing", () => {
    const source = clickByAccessibleNameJs("Open Quill's profile");
    expect(source).toContain("Open Quill's profile");
    expect(source).toContain(".click()");
    expect(source).toContain("aria-label");
  });

  it("prefers a visible match inside the top dialog over the first node in the page", () => {
    const source = clickByAccessibleNameJs("Create team");
    expect(source).toContain("Create team");
    expect(source).toContain("[role=dialog]");
    expect(source).toContain("data-bot-catalog-modal");
    expect(source).toContain("getBoundingClientRect");
  });

  it("treats the bot catalog modal as an overlay that covers the sidebar", () => {
    expect(overlaysOpenJs()).toContain("data-bot-catalog-modal");
    expect(overlaysOpenJs()).toContain("[role=dialog]");
  });
});

describe("openNewBotDialog reuse", () => {
  it("reuses an open dialog only when Create bot is on it", () => {
    const src = readFileSync(new URL("./compose-flow.ts", import.meta.url), "utf8");
    expect(src).toContain('trim() === "Create bot"');
    expect(src).toContain("createBotReady");
    expect(src).toContain('snap.includes("Create bot")');
  });
});
