import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const LIGHT = ["pulsatrix-light", "atelier", "lagoon", "linen", "daylight", "retro98", "meadow"];

function skinBlock(id: string): string {
  const match = new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no skin block for ${id}`);
  return match[1]!;
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("mascot plinth tokens", () => {
  it("every light skin sets a plinth and a shadow colour, and the white character clears 3:1 on the plinth", () => {
    const white = /white:\s*"(#[0-9a-fA-F]{6})"/.exec(read("shared/mascot-colors.ts"))?.[1];
    expect(white).toBeTruthy();
    for (const id of LIGHT) {
      const block = skinBlock(id);
      const plinth = /--color-mascot-plinth:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
      expect(plinth, `${id} plinth`).toBeTruthy();
      expect(block, `${id} shadow`).toMatch(/--mascot-shadow-color:\s*rgba\(/);
      expect(block, `${id} wide shadow`).toMatch(/--mascot-shadow-wide:\s*rgba\(/);
      expect(ratio(white!, plinth!), `${id} white on plinth`).toBeGreaterThanOrEqual(3);
    }
  });

  it("dark skins take no shadow and a plinth lighter than their card", () => {
    expect(css).toMatch(/--mascot-filter:\s*none;/);
    expect(css).toMatch(/\[data-skin\]\s*\{\s*--color-mascot-plinth:\s*color-mix\(in srgb, #ffffff 9%, var\(--color-card\)\)/);
    const group = /:is\(([^)]*)\)\s*\{\s*--mascot-filter:\s*drop-shadow/.exec(css)?.[1] ?? "";
    for (const id of LIGHT) expect(group).toContain(`[data-skin="${id}"]`);
    expect(group.match(/data-skin=/g)?.length).toBe(LIGHT.length);
  });

  it("the shadow reaches every character root", () => {
    expect(css).toMatch(/:is\(\.shape-mascot, \[data-owl\], \.bunbu-mascot, \.trombi-avatar\)\s*\{\s*filter:\s*var\(--mascot-filter, none\)/);
  });
});

describe("mascot plinth wrappers", () => {
  it("the bot panel preview and the empty-conversation hero wear the plinth", () => {
    expect(read("src/components/BotProfileAvatarCard.tsx")).toMatch(/crop === "mascot" && "mascot-plinth p-2"/);
    expect(read("src/components/ChatView.tsx")).toMatch(/className="mascot-plinth p-3"><BotAvatar/);
  });

  it("the editor's character, shape and skin thumbnails get the plinth through their data attributes", () => {
    for (const selector of [
      "[data-mascot-look-editor] [data-character-option] > span:first-child",
      "[data-mascot-look-editor] .skin-card > span:first-child",
      "[data-mascot-look-editor] [data-character-shape]",
    ]) {
      expect(css).toContain(selector);
    }
    const editor = read("src/components/floating-bots/MascotLookEditor.tsx");
    for (const hook of ["data-mascot-look-editor", "data-character-option", "data-character-shape", "skin-card"]) expect(editor).toContain(hook);
  });

  it("the plinth class keeps its disc and hairline", () => {
    const rule = /\.mascot-plinth\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/border-radius:\s*9999px/);
    expect(rule).toMatch(/background-color:\s*var\(--color-mascot-plinth\)/);
    expect(rule).toMatch(/outline:\s*1px solid/);
  });

  it("motion is untouched: no animation or transition is added by the plinth rules", () => {
    const tail = css.slice(css.indexOf("/* ── Mascot plinth"));
    expect(tail).not.toMatch(/animation|transition/);
  });
});
