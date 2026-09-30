// The sidebar's Perspicax mark: the console's own two files as images, the
// dark-ground one on a dark rail and the light-ground one on a light rail.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SKIN_IDS } from "@/lib/skins";
import { MARK_ON_DARK, MARK_ON_LIGHT, PulsatrixMark } from "./PulsatrixMark";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles.css"), "utf8");

describe("Perspicax mark", () => {
  it("draws both console files as plain images, one shown per skin, no mask", () => {
    const html = renderToStaticMarkup(createElement(PulsatrixMark, { size: 22 }));
    expect(html).toContain(`src="${MARK_ON_DARK}"`);
    expect(html).toContain(`src="${MARK_ON_LIGHT}"`);
    expect(html).toContain("pulsatrix-mark-on-dark");
    expect(html).toContain("pulsatrix-mark-on-light");
    expect(html).toContain('width="22"');
    expect(html).not.toMatch(/mask|bg-current/);
  });

  it("pins one file when the ground never changes", () => {
    const html = renderToStaticMarkup(createElement(PulsatrixMark, { size: 16, ground: "dark" }));
    expect(html).toContain(`src="${MARK_ON_DARK}"`);
    expect(html).not.toContain(MARK_ON_LIGHT);
    expect(html).not.toContain("pulsatrix-mark-on-");
  });

  it("shows the dark-ground file on the navy and dark rails, the light-ground one on light rails", () => {
    const light = new Set(["atelier", "lagoon", "linen", "daylight", "retro98"]);
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const onDark = light.has(id) ? "none" : "inline-block";
      const onLight = light.has(id) ? "inline-block" : "none";
      expect(body, id).toMatch(new RegExp(`--sidebar-mark-on-dark: ${onDark};`));
      expect(body, id).toMatch(new RegExp(`--sidebar-mark-on-light: ${onLight};`));
    }
  });

  it("ships the console's files verbatim, in colour", () => {
    const pub = join(here, "../../public");
    const dark = readFileSync(join(pub, MARK_ON_DARK), "utf8");
    const lightFile = readFileSync(join(pub, MARK_ON_LIGHT), "utf8");
    expect(dark).toContain('fill="#4f86f7"');
    expect(lightFile).toContain('fill="#0b1526"');
    expect(dark).not.toContain("currentColor");
  });
});
