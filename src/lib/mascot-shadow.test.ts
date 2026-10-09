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

describe("mascot drop shadow", () => {
  it("every light skin sets a strong enough shadow colour and a wide one", () => {
    for (const id of LIGHT) {
      const block = skinBlock(id);
      const alpha = /--mascot-shadow-color:\s*rgba\([^)]*,\s*([\d.]+)\)/.exec(block)?.[1];
      expect(alpha, `${id} shadow`).toBeTruthy();
      expect(Number(alpha), `${id} shadow alpha`).toBeGreaterThanOrEqual(0.3);
      expect(block, `${id} wide shadow`).toMatch(/--mascot-shadow-wide:\s*rgba\(/);
    }
  });

  it("dark skins take no shadow; light skins take a silhouette drop-shadow", () => {
    expect(css).toMatch(/--mascot-filter:\s*none;/);
    const group = /:is\(([^)]*)\)\s*\{\s*--mascot-filter:\s*drop-shadow/.exec(css)?.[1] ?? "";
    for (const id of LIGHT) expect(group).toContain(`[data-skin="${id}"]`);
    expect(group.match(/data-skin=/g)?.length).toBe(LIGHT.length);
  });

  it("the shadow reaches every character root", () => {
    expect(css).toMatch(/:is\(\.shape-mascot, \[data-owl\], \.bunbu-mascot, \.shiba-mascot, \.frog-mascot, \.trombi-avatar\)\s*\{\s*filter:\s*var\(--mascot-filter, none\)/);
  });
});

describe("no disc behind the mascot", () => {
  it("no plinth class, token or wrapper remains", () => {
    expect(css).not.toMatch(/plinth/);
    expect(read("src/components/BotProfileAvatarCard.tsx")).not.toMatch(/plinth/);
    expect(read("src/components/ChatView.tsx")).not.toMatch(/plinth/);
    expect(read("scripts/check-skin-contrast.mjs")).not.toMatch(/plinth/);
  });

  it("the editor thumbnails have no mascot background rule", () => {
    expect(css).not.toContain("[data-mascot-look-editor] [data-character-option] > span:first-child");
    expect(css).not.toContain("[data-mascot-look-editor] [data-character-shape]");
  });

  it("motion is untouched: no animation or transition in the shadow rules", () => {
    const tail = css.slice(css.indexOf("/* ── Mascot shadow"), css.indexOf("/* Window drag regions"));
    expect(tail).not.toMatch(/animation|transition/);
  });
});
