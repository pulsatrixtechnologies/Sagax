import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ draft: false }));
vi.mock("./BotEditorContext", () => ({ useBotEditor: () => fixture }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { personalSettings: true } }, dispatch: vi.fn() }) }));
vi.mock("@/lib/viewer-bot-overrides", () => ({
  viewerLocalBotSettings: () => true, useViewerBotOverride: () => undefined, saveViewerBotOverride: vi.fn(),
}));
vi.mock("../settings/VoiceProviderSettings", () => ({ VoiceProviderSettings: () => createElement("div", { "data-personal-provider": "" }) }));
vi.mock("../VoiceSettings", () => ({ VoiceSettings: () => createElement("div", { "data-bot-wide-voice": "" }) }));
const { VoiceSection } = await import("./VoiceSection");
const bot = { id: "shared-bot", name: "Example bot" } as Bot;

it("lets a reader choose their voice without editing a shared bot's switches", () => {
  fixture.draft = false;
  const html = renderToStaticMarkup(createElement(VoiceSection, {
    bot, derived: { canEdit: () => false, patch: vi.fn() } as never,
  }));
  expect(html).toContain("data-personal-provider");
  expect(html).not.toContain("data-bot-wide-voice");
});

it("does not send personal preferences to an unsaved creation draft", () => {
  fixture.draft = true;
  const html = renderToStaticMarkup(createElement(VoiceSection, {
    bot, derived: { canEdit: () => false, patch: vi.fn() } as never,
  }));
  expect(html).not.toContain("data-personal-provider");
});
