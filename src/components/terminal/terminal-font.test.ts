import { describe, expect, it } from "vitest";

import { loadSymbolsFace, TERMINAL_FONT_FAMILY, TERMINAL_SYMBOLS_FAMILY, TERMINAL_SYMBOLS_RANGE } from "./terminal-font";

describe("terminal fonts", () => {
  it("puts the Nerd Font symbols before Monaco, whose own boxes would hide them", () => {
    const stack = TERMINAL_FONT_FAMILY.split(",").map((name) => name.trim());
    expect(stack.indexOf(`"${TERMINAL_SYMBOLS_FAMILY}"`)).toBeGreaterThanOrEqual(0);
    expect(stack.indexOf(`"${TERMINAL_SYMBOLS_FAMILY}"`)).toBeLessThan(stack.indexOf("Monaco"));
    expect(stack.at(-1)).toBe("monospace");
  });

  it("adds the bundled face and waits for it", async () => {
    const added: unknown[] = [];
    const loaded: string[] = [];
    class FakeFace {
      constructor(readonly family: string, readonly source: string, readonly descriptors?: { unicodeRange?: string }) {}
      load() {
        loaded.push(this.family);
        return Promise.resolve(this);
      }
    }
    await loadSymbolsFace({ fonts: { add: (face) => added.push(face) }, FontFaceCtor: FakeFace, url: "/assets/sym.woff2", timeoutMs: 1000 });
    expect(added).toHaveLength(1);
    expect((added[0] as FakeFace).source).toBe('url(/assets/sym.woff2) format("woff2")');
    expect(loaded).toEqual([TERMINAL_SYMBOLS_FAMILY]);
    // letters keep the system monospace font: only the icon ranges use it
    expect((added[0] as FakeFace).descriptors?.unicodeRange).toBe(TERMINAL_SYMBOLS_RANGE);
    expect(TERMINAL_SYMBOLS_RANGE).toContain("U+E000-F8FF");
  });

  it("opens the terminal anyway when the font fails or hangs", async () => {
    const fonts = { add: () => {} };
    class Failing { load() { return Promise.reject(new Error("404")); } }
    class Hanging { load() { return new Promise(() => {}); } }
    await expect(loadSymbolsFace({ fonts, FontFaceCtor: Failing, url: "x", timeoutMs: 1000 })).resolves.toBeUndefined();
    await expect(loadSymbolsFace({ fonts, FontFaceCtor: Hanging, url: "x", timeoutMs: 10 })).resolves.toBeUndefined();
  });
});
