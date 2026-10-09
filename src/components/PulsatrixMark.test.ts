// The sidebar Pulsatrix mark: the official inline SVG owl, white on dark rails,
// navy on light rails (one shown per skin).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SKIN_IDS } from "@/lib/skins";
import { PulsatrixMark } from "./PulsatrixMark";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles.css"), "utf8");

describe("Pulsatrix owl mark", () => {
  it("draws both colours as the inline SVG, one shown per skin, no raster", () => {
    const html = renderToStaticMarkup(createElement(PulsatrixMark, { size: 22 }));
    expect(html).toContain('data-pulsatrix-mark="dark"');
    expect(html).toContain('data-pulsatrix-mark="light"');
    expect(html).toContain("pulsatrix-mark-on-dark");
    expect(html).toContain("pulsatrix-mark-on-light");
    expect(html).toContain('viewBox="0 0 28 25"');
    expect(html).toContain('width="22"');
    expect(html).not.toMatch(/<img|\.png/);
  });

  it("pins one colour when the ground never changes", () => {
    const html = renderToStaticMarkup(createElement(PulsatrixMark, { size: 16, ground: "dark" }));
    expect(html).toContain('data-pulsatrix-mark="dark"');
    expect(html).not.toContain('data-pulsatrix-mark="light"');
    expect(html).not.toContain("pulsatrix-mark-on-");
  });

  it("shows the dark-ground file on the navy and dark rails, the light-ground one on light rails", () => {
    const light = new Set(["atelier", "lagoon", "linen", "daylight", "retro98", "meadow"]);
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const onDark = light.has(id) ? "none" : "inline-block";
      const onLight = light.has(id) ? "inline-block" : "none";
      expect(body, id).toMatch(new RegExp(`--sidebar-mark-on-dark: ${onDark};`));
      expect(body, id).toMatch(new RegExp(`--sidebar-mark-on-light: ${onLight};`));
    }
  });

  it("ships the official vector files under public/brand", () => {
    const brand = join(here, "../../public/brand");
    for (const f of ["pulsatrix-owl-mark-color.svg", "pulsatrix-owl-mark-color-tight.svg", "pulsatrix-owl-mark.svg"]) {
      expect(readFileSync(join(brand, f), "utf8")).toContain("<svg");
    }
  });
});
