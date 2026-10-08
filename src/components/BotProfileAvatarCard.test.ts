import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";
import { BotProfileAvatarCard, editorDismissRoot } from "./BotProfileAvatarCard";
import { popoverClosesOnKey, popoverClosesOnPointer } from "@/hooks/use-popover-dismiss";
import MascotLookEditor from "./floating-bots/MascotLookEditor";

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

/** The Bot tab's content (loaded lazily in the popover). */
function renderEditor(bot: Bot) {
  return renderToStaticMarkup(createElement(MascotLookEditor, { bot, onPatch: vi.fn() }));
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

  it("still offers every bot color for the mascot, on its palette's tab", () => {
    for (const color of MAUS_COLOR_NAMES) {
      const markup = renderEditor(makeBot({ color }));
      expect(markup).toMatch(new RegExp(`aria-checked="true"[^>]*aria-label="Use ${color} mascot color"`));
    }
    expect(renderEditor(makeBot())).toMatch(/aria-checked="true"[^>]*aria-label="Use green mascot color"/);
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

describe("BotProfileAvatarCard skins and moves", () => {
  it("offers every skin with a live preview, by rarity, Classic chosen by default", () => {
    const markup = renderEditor(makeBot());
    expect(markup).toContain(">Skin<");
    for (const skin of ["none", "snowy", "barn", "carbon"]) {
      expect(markup).toContain(`data-mascot-skin-option="${skin}"`);
    }
    expect(markup).toContain('aria-checked="true" aria-label="Classic, Common"');
    expect(markup).toContain('aria-checked="false" aria-label="Snowy, Common"');
    const epic = renderEditor(makeBot({ mascotSkin: "lightning" }));
    expect(epic).toContain('aria-checked="true" aria-label="Lightning, Epic"');
    // the previews play their effects without joining the frame loop
    expect(epic).toMatch(/data-owl-skin="lightning" data-owl-fx="live"/);
    expect(renderEditor(makeBot({ mascotSkin: "frost" }))).toContain('aria-label="Ice, Rare"');
  });

  it("reflects a stored skin, and reads an unknown one as none", () => {
    expect(renderEditor(makeBot({ mascotSkin: "gold" }))).toContain('aria-checked="true" aria-label="Gold, Rare"');
    // SAFETY: a skin this build does not know can arrive from a newer client.
    expect(renderEditor(makeBot({ mascotSkin: "plasma" as Bot["mascotSkin"] }))).toContain(
      'aria-checked="true" aria-label="Classic, Common"',
    );
  });

  it("offers every wing move as a button with a readable label", () => {
    const markup = renderEditor(makeBot());
    expect(markup).toContain(">Moves<");
    for (const [move, label] of [
      ["spread-wings", "Spread wings"],
      ["flap", "Flap"],
      ["take-off", "Take off"],
      ["shake", "Ruffle"],
      ["hoot", "Hoot"],
    ]) {
      expect(markup).toContain(`data-character-move="${move}"`);
      expect(markup).toContain(`aria-label="Play the ${label} move"`);
    }
  });

  it("offers black among the colors, outlined so it reads on a dark card", () => {
    const markup = renderEditor(makeBot({ color: "black" }));
    expect(markup).toMatch(/aria-label="Use black mascot color"/);
    expect(markup).toContain("inset 0 0 0 1.5px");
  });

  it("hides skins and moves for a flat image", () => {
    const markup = renderCard(makeBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "rounded" }));
    expect(markup).not.toContain("data-mascot-skin-option");
    expect(markup).not.toContain("data-mascot-move");
  });
});

describe("avatar editor dismissal", () => {
  const node = (...inside: unknown[]) => ({ contains: (target: unknown) => target === undefined ? false : inside.includes(target) });
  const button = { id: "button", closest: () => null };
  const panel = { id: "panel" };
  const swatch = { id: "swatch", closest: () => null };
  const page = { id: "page", closest: () => null };
  const root = editorDismissRoot(
    { current: node(button) as unknown as Node },
    { current: node(panel, swatch) as unknown as Node },
  );

  it("closes on a press outside the panel and the avatar", () => {
    expect(popoverClosesOnPointer(page as unknown as EventTarget, root)).toBe(true);
  });

  it("stays open on the panel's controls and on the avatar button itself", () => {
    expect(popoverClosesOnPointer(swatch as unknown as EventTarget, root)).toBe(false);
    expect(popoverClosesOnPointer(panel as unknown as EventTarget, root)).toBe(false);
    expect(popoverClosesOnPointer(button as unknown as EventTarget, root)).toBe(false);
  });

  it("closes on Escape", () => {
    expect(popoverClosesOnKey({ key: "Escape", defaultPrevented: false, isComposing: false })).toBe(true);
  });

  it("is outside everywhere while the panel is closed", () => {
    const closed = editorDismissRoot({ current: null }, { current: null });
    expect(closed.contains(page)).toBe(false);
  });
});
