// @vitest-environment happy-dom
// The reaction picker (quick row, search) and the chips under a message
// (count, mine, toggle, who reacted, a bot with its mascot).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("searches the built-in set by words, and Enter picks the first", async () => {
    const { onPick, onClose } = await renderPicker();
    await type("rock");
    expect(results()).toEqual(["🚀"]);
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onPick).toHaveBeenCalledWith("🚀");
    expect(onClose).toHaveBeenCalled();
    await type("zzzz-nothing");
    expect(host.textContent).toContain("No emoji found");
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
    const tip = chip("👍").parentElement!.querySelector("[data-reaction-tip]")!;
    expect([...tip.querySelectorAll("[data-reaction-actor]")].map((row) => row.textContent)).toEqual(["ZSZachary Sellam", "MYou"]);
  });

  it("shows a bot's reaction like anyone's, with its mascot in the tooltip", async () => {
    await renderChips(vi.fn(), true);
    expect(chip("✅").getAttribute("aria-label")).toBe("Cryptic reacted with ✅");
    const row = chip("✅").parentElement!.querySelector('[data-reaction-actor="bot:cryptic"]')!;
    expect(row.textContent).toContain("Cryptic");
    // the mascot, not initials
    expect(row.querySelector("svg, img, canvas")).not.toBeNull();
    expect(host.querySelector('[data-testid="reaction-chips"]')!.className).toContain("justify-end");
  });

  it("draws nothing without reactions, and reads a legacy list", async () => {
    await act(async () => root.render(createElement(ReactionChips, { reactions: undefined, selfIds: [ME], onToggle: () => {}, end: false })));
    expect(host.innerHTML).toBe("");
    await act(async () => root.render(createElement(ReactionChips, { reactions: [{ emoji: "👍", by: "user" }], selfIds: ["user"], onToggle: () => {}, end: false })));
    expect(chip("👍").getAttribute("aria-pressed")).toBe("true");
  });
});
