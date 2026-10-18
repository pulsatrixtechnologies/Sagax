// @vitest-environment happy-dom
// The reaction picker (quick row, search) and the chips under a message
// (count, mine, toggle, who reacted, a bot with its mascot).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEmojiCatalog } from "@/lib/emoji-catalog";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { ReactionChips, ReactionPicker } from "./Reactions";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const quick = () => [...host.querySelectorAll<HTMLElement>("[data-quick-reaction]")].map((button) => button.textContent);
const results = () => [...host.querySelectorAll<HTMLElement>("[data-emoji-result]")].map((button) => button.textContent);

describe("ReactionPicker", () => {
  async function renderPicker(onPick = vi.fn(), onClose = vi.fn()) {
    await act(async () => root.render(createElement("div", null, createElement(ReactionPicker, { onPick, onClose, align: "start", mine: ["👀"] }))));
    return { onPick, onClose };
  }
  const type = async (text: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  };

  it("offers the eight common reactions first, then the rest, with the search focused", async () => {
    await renderPicker();
    expect(quick()).toEqual(["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌"]);
    expect(host.querySelector('[data-quick-reaction="👀"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-quick-reaction="👍"]')!.getAttribute("aria-label")).toBe("React with 👍");
    expect(results()).not.toContain("👍");
    expect(results().length).toBeGreaterThan(20);
    expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
  });

  it("searches the full catalogue in English and French, and Enter picks the first", async () => {
    await loadEmojiCatalog();
    const { onPick, onClose } = await renderPicker();
    expect(host.querySelector("[data-emoji-catalog]")!.getAttribute("data-emoji-catalog")).toBe("full");
    await type("rocket");
    expect(results()[0]).toBe("🚀");
    await type("fusée");
    expect(results()).toContain("🚀");
    await type("fusee");
    expect(results()).toContain("🚀");
    await type("rocket");
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onPick).toHaveBeenCalledWith("🚀");
    expect(onClose).toHaveBeenCalled();
    await type("zzzz-nothing");
    expect(host.textContent).toContain("No emoji found");
  });

  it("browses the catalogue one category at a time", async () => {
    await loadEmojiCatalog();
    await renderPicker();
    const smileys = results();
    expect(smileys.length).toBeGreaterThan(100);
    expect(smileys).not.toContain("👍");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-emoji-group="9"]')!.click());
    expect(results()).toContain("🇨🇦");
    expect(results()).not.toContain("😀");
  });

  it("picks a quick reaction, and closes on Escape", async () => {
    const { onPick, onClose } = await renderPicker();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-quick-reaction="✅"]')!.click());
    expect(onPick).toHaveBeenCalledWith("✅");
    onClose.mockClear();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ReactionChips", () => {
  const ME = "pr_me";
  const cryptic = { id: "cryptic", name: "Cryptic", color: "green", threadId: "t", messages: [] } as unknown as Bot;
  const reactions = [
    { emoji: "👍", actors: [{ id: "pr_zach", kind: "person", name: "Zachary Sellam" }, { id: ME, kind: "person", name: "Me" }], at: 1 },
    { emoji: "✅", actors: [{ id: "bot:cryptic", kind: "bot", name: "Cryptic" }], at: 2 },
  ];
  async function renderChips(onToggle = vi.fn(), end = false) {
    await act(async () => root.render(createElement(ReactionChips, { reactions, selfIds: [ME], onToggle, end, bots: [cryptic] })));
    return onToggle;
  }
  const chip = (emoji: string) => host.querySelector<HTMLButtonElement>(`[data-reaction-chip="${emoji}"]`)!;
  // the tooltip shows on hover or focus, in a portal on document.body
  const tipOf = async (emoji: string) => {
    await act(async () => chip(emoji).parentElement!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
    return document.querySelector<HTMLElement>(`[data-reaction-tip-for="${emoji}"]`)!;
  };

  it("draws one chip per emoji with its count, highlighted when I reacted", async () => {
    await renderChips();
    expect(chip("👍").textContent).toBe("👍2");
    expect(chip("👍").getAttribute("aria-pressed")).toBe("true");
    expect(chip("👍").dataset.mine).toBe("true");
    expect(chip("✅").getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[data-testid="reaction-chips"]')!.className).toContain("justify-start");
  });

  it("toggles my own reaction on click", async () => {
    const onToggle = await renderChips();
    await act(async () => chip("✅").click());
    expect(onToggle).toHaveBeenCalledWith("✅");
  });

  it("names who reacted, me as You, in the label and the tooltip", async () => {
    await renderChips();
    expect(chip("👍").getAttribute("aria-label")).toBe("Zachary Sellam and You reacted with 👍");
    const tip = await tipOf("👍");
    expect([...tip.querySelectorAll("[data-reaction-actor]")].map((row) => row.textContent)).toEqual(["ZSZachary Sellam", "MYou"]);
  });

  it("shows a bot's reaction like anyone's, with its mascot in the tooltip", async () => {
    await renderChips(vi.fn(), true);
    expect(chip("✅").getAttribute("aria-label")).toBe("Cryptic reacted with ✅");
    const row = (await tipOf("✅")).querySelector('[data-reaction-actor="bot:cryptic"]')!;
    expect(row.textContent).toContain("Cryptic");
    // the mascot, not initials
    expect(row.querySelector("svg, img, canvas")).not.toBeNull();
    expect(host.querySelector('[data-testid="reaction-chips"]')!.className).toContain("justify-end");
  });

  it("draws the tooltip outside the row, above the chip, only while hovered or focused (JC, 2026-10-18)", async () => {
    await renderChips();
    expect(document.querySelector("[data-reaction-tip]")).toBeNull();
    const button = chip("👍");
    button.getBoundingClientRect = () => ({ left: 300, top: 400, right: 340, bottom: 424, width: 40, height: 24, x: 300, y: 400, toJSON: () => ({}) }) as DOMRect;
    const spies = [
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60),
    ];
    try {
      await act(async () => button.parentElement!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
      const tip = document.querySelector<HTMLElement>('[data-reaction-tip-for="👍"]')!;
      expect(tip.parentElement).toBe(document.body);
      expect(host.contains(tip)).toBe(false);
      expect(tip.dataset.side).toBe("above");
      expect(tip.style.top).toBe(`${400 - 4 - 60}px`);
      expect(tip.style.left).toBe("300px");
      await act(async () => button.parentElement!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
      expect(document.querySelector("[data-reaction-tip]")).toBeNull();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("draws nothing without reactions, and reads a legacy list", async () => {
    await act(async () => root.render(createElement(ReactionChips, { reactions: undefined, selfIds: [ME], onToggle: () => {}, end: false })));
    expect(host.innerHTML).toBe("");
    await act(async () => root.render(createElement(ReactionChips, { reactions: [{ emoji: "👍", by: "user" }], selfIds: ["user"], onToggle: () => {}, end: false })));
    expect(chip("👍").getAttribute("aria-pressed")).toBe("true");
  });
});
