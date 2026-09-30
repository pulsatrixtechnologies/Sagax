import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BotEditorStore, type useStore } from "@/state/store";
import RetroAssistant from "./RetroAssistant";
import { createRetroSounds, RETRO_SCORES } from "./sounds";

type StoreValue = ReturnType<typeof useStore>;

function render(props: Parameters<typeof RetroAssistant>[0]) {
  // SAFETY: the assistant reads only bots, selectedId and dispatch; a
  // partial store is enough for a static render.
  const value = { state: { bots: [], selectedId: null }, dispatch: () => undefined } as unknown as StoreValue;
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: createElement(RetroAssistant, props) }));
}

describe("RetroAssistant", () => {
  it("renders the app's own owl, as a labelled, draggable button", () => {
    const markup = render({});
    expect(markup).toContain('data-retro-owl=""');
    expect(markup).toContain("data-owl=");
    expect(markup).toContain('aria-label="Hibou 98, the retro assistant.');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it("marks reduced motion so every animation is switched off", () => {
    expect(render({ reducedMotion: true })).toContain("data-reduced");
    expect(render({ reducedMotion: false })).not.toContain("data-reduced");
  });

  it("opens with nothing in the way: no balloon, menu or dialog before any interaction", () => {
    const markup = render({});
    expect(markup).not.toContain("r98-balloon");
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain("r98-window");
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
