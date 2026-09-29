import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

describe("BotProfileAvatarCard", () => {
  it("no longer offers a body picker: every bot is the owl", () => {
    for (const bot of [makeBot(), makeBot({ mascotBody: "star" })]) {
      const markup = renderCard(bot);
      expect(markup).toContain(">Bot<");
      expect(markup).not.toMatch(/aria-label="Use the [^"]+ body"/);
      expect(markup).not.toContain(">Body<");
    }
  });

  it("still offers every bot color for the mascot", () => {
    const markup = renderCard(makeBot());
    for (const color of MAUS_COLOR_NAMES) {
      expect(markup).toContain(`aria-label="Use ${color} mascot color"`);
    }
    expect(markup).toMatch(/aria-pressed="true"[^>]*aria-label="Use green mascot color"/);
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("offers the mascot back for every flat crop", () => {
    for (const crop of ["circle", "rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));

      expect(markup).not.toContain(">Body<");
      expect(markup).not.toContain("mascot color");
    }
  });
});
