import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import fr from "@/locales/fr.json";

import { BotEditorStore, type useStore } from "@/state/store";
import RetroAssistant, { GALLERY, assistantMenu } from "./RetroAssistant";
import { createRetroSounds, RETRO_SCORES } from "./sounds";

type StoreValue = ReturnType<typeof useStore>;

function render(props: Parameters<typeof RetroAssistant>[0]) {
  // SAFETY: the assistant reads only bots, selectedId and dispatch; a
  // partial store is enough for a static render.
  const value = { state: { bots: [], selectedId: null }, dispatch: () => undefined } as unknown as StoreValue;
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: createElement(RetroAssistant, props) }));
}

describe("RetroAssistant", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stands Trombi on the desk by default, as a labelled, draggable button", () => {
    const markup = render({});
    expect(markup).toContain('data-retro-owl=""');
    expect(markup).toContain('data-character="trombi"');
    expect(markup).toContain('class="r98-trombi r98t-pose-idle"');
    expect(markup).toContain('aria-label="Trombi, the retro assistant.');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain("data-owl=");
  });

  it("still offers the app's own owl when it was chosen", () => {
    const saved = JSON.stringify({ character: "owl", look: "gold" });
    vi.stubGlobal("localStorage", { getItem: () => saved, setItem: () => undefined, removeItem: () => undefined });
    const markup = render({});
    expect(markup).toContain('data-character="owl"');
    expect(markup).toContain("data-owl=");
    expect(markup).toContain('aria-label="Hibou 98, the retro assistant.');
  });

  it("marks reduced motion so every animation is switched off, Trombi included", () => {
    const still = render({ reducedMotion: true });
    expect(still).toContain("data-reduced");
    expect(still).toContain("r98t-still");
    const moving = render({ reducedMotion: false });
    expect(moving).not.toContain("data-reduced");
    expect(moving).not.toContain("r98t-still");
  });

  it("opens with nothing in the way: no balloon, menu or dialog before any interaction", () => {
    const markup = render({});
    expect(markup).not.toContain("r98-balloon");
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain("r98-window");
  });

  it("follows the app language it is given", () => {
    expect(render({ locale: "fr" })).toContain('lang="fr"');
  });
});

describe("assistant menu", () => {
  it("offers to detach only where the desktop app can host the window", () => {
    expect(assistantMenu(false, false).map((item) => item.id)).toEqual(["hide", "options", "gallery", "animate"]);
    expect(assistantMenu(true, false).map((item) => item.id)).toEqual(["hide", "options", "gallery", "animate", "detach"]);
  });

  it("offers to put it back once detached", () => {
    const ids = assistantMenu(true, true).map((item) => item.id);
    expect(ids).toContain("attach");
    expect(ids).not.toContain("detach");
  });

  it("has a French label for every entry", () => {
    for (const item of assistantMenu(true, false).concat(assistantMenu(true, true))) {
      expect(fr[item.label as keyof typeof fr], item.label).toBeTruthy();
    }
  });
});

describe("assistant gallery", () => {
  it("lists Trombi first, the owl looks, then the custom assistant", () => {
    expect(GALLERY[0]).toEqual({ kind: "trombi" });
    expect(GALLERY.at(-1)).toEqual({ kind: "custom" });
    expect(GALLERY.filter((entry) => entry.kind === "owl")).toHaveLength(8);
  });
});

describe("retro sounds", () => {
  const fakeContext = () => {
    const node = () => ({
      connect: (next: unknown) => next,
      start: vi.fn(),
      stop: vi.fn(),
      type: "",
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      Q: { value: 0 },
      buffer: null,
    });
    return {
      currentTime: 0,
      sampleRate: 8000,
      state: "running",
      destination: {},
      createOscillator: vi.fn(node),
      createGain: vi.fn(node),
      createBiquadFilter: vi.fn(node),
      createBufferSource: vi.fn(node),
      createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(8000) })),
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
  };

  it("creates no audio at all until the person has interacted", () => {
    const factory = vi.fn(() => fakeContext() as unknown as AudioContext);
    const sounds = createRetroSounds(() => true, factory);
    sounds.play("hello");
    expect(factory).not.toHaveBeenCalled();
    expect(sounds.unlocked()).toBe(false);
    sounds.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    sounds.play("hello");
  });

  it("plays synthesized notes only while the option is on", () => {
    const ctx = fakeContext();
    let on = false;
    const sounds = createRetroSounds(() => on, () => ctx as unknown as AudioContext);
    sounds.unlock();
    sounds.play("chime");
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    on = true;
    sounds.play("chime");
    expect(ctx.createOscillator).toHaveBeenCalledTimes(RETRO_SCORES.chime.length);
    sounds.play("whoosh");
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it("never throws when the platform has no audio", () => {
    const sounds = createRetroSounds(() => true, () => null);
    expect(() => {
      sounds.unlock();
      sounds.play("pop");
      sounds.close();
    }).not.toThrow();
  });
});
