// The registry and the stylesheet are two halves of one contract: a skin listed
// here without a matching CSS block renders as whatever was active before, with
// no error anywhere. That failure is silent, so it gets a test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS, SKIN_IDS, DEFAULT_SKIN, visibleSkins } from "./skins";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
  "utf8",
);

const blocks = new Set(
  [...css.matchAll(/\[data-skin="([a-z0-9-]+)"\]/g)].map(([, id]) => id),
);

/** Splits a selector list on its top-level commas, not the ones inside :is() or :not(). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current];
}

describe("skins", () => {
  it("gives every registered skin a stylesheet block", () => {
    for (const id of SKIN_IDS) expect(blocks).toContain(id);
  });

  it("registers every stylesheet block", () => {
    // SAFETY: the assertion only fits toContain()'s parameter type — the
    // assertion IS the check, and an unregistered block fails the test.
    for (const id of blocks) expect(SKIN_IDS).toContain(id as (typeof SKIN_IDS)[number]);
  });

  it("defines the same tokens in every skin", () => {
    const tokensOf = (id: string) => {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
    };
    const reference = tokensOf(DEFAULT_SKIN);
    expect(reference.size).toBeGreaterThan(15);
    expect(reference).toContain("--color-composer-ring");
    for (const id of SKIN_IDS) {
      expect([...reference].filter((t) => !tokensOf(id).has(t))).toEqual([]);
    }
  });

  it("selects a code-only light or dark palette in every nearest skin", () => {
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const scheme = ["pulsatrix-light", "atelier", "lagoon", "linen", "daylight", "retro98"].includes(id) ? "light" : "dark";
      expect(body).toContain(`--code-color-scheme: ${scheme};`);
    }
    expect(css).toMatch(/\.chat-md \.shiki\s*\{\s*color-scheme:\s*var\(--code-color-scheme\);\s*\}/);
  });

  it("describes each skin exactly once", () => {
    expect(SKINS.map((s) => s.id).sort()).toEqual([...SKIN_IDS].sort());
    for (const skin of SKINS) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.tagline.length).toBeGreaterThan(0);
    }
  });

  it("keeps the secret retro98 skin out of the picker until this device unlocks it", () => {
    expect(visibleSkins(false).map((s) => s.id)).not.toContain("retro98");
    expect(visibleSkins(true).map((s) => s.id)).toContain("retro98");
    // a device already wearing it still sees its own skin
    expect(visibleSkins(false, "retro98").map((s) => s.id)).toContain("retro98");
    expect(visibleSkins(false).length).toBe(SKINS.length - 1);
  });

  it("scopes every rule of the retro98 structural layer to that skin", () => {
    const layer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/retro98.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...layer.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map(([, , sel]) => sel.trim());
    expect(selectors.length).toBeGreaterThan(20);
    for (const group of selectors) {
      if (/^(from|to|\d+%)/.test(group)) continue; // keyframe steps
      for (const selector of splitTopLevel(group)) expect(selector.trim()).toMatch(/^\[data-skin="retro98"\]/);
    }
  });
});
