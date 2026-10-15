import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICON_CHOICES, DEFAULT_APP_ICON_ID, SAGAX_OWL_APP_ICON_ID } from "./app-icon-choices";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

const root = path.resolve(__dirname, "../..");

describe("app icon choices", () => {
  it("opens on the Pulsatrix logo: the default, the bundle's own icon", () => {
    const [first] = APP_ICON_CHOICES;
    expect(first.id).toBe(DEFAULT_APP_ICON_ID);
    expect(first.art).toEqual({ kind: "default" });
    expect((en as Record<string, string>)[first.labelKey]).toBe("Pulsatrix");
    expect((fr as Record<string, string>)[first.labelKey]).toBe("Pulsatrix");
    // the picker draws the default from /app-icon.svg, now the Pulsatrix mark on night blue
    const svg = fs.readFileSync(path.join(root, "public/app-icon.svg"), "utf8");
    expect(svg).toContain("Pulsatrix owl mark");
    expect(svg).toContain('fill="#3466DC"');
  });

  it("keeps the Sagax owl as an Owl choice, drawn from its own file", () => {
    const owl = APP_ICON_CHOICES.find((choice) => choice.id === SAGAX_OWL_APP_ICON_ID);
    expect(owl?.art.kind).toBe("image");
    expect(owl?.labelKey).toBe("floatingBots.mascot.owl");
    expect((fr as Record<string, string>)[owl!.labelKey]).toBe("Hibou");
    const src = owl?.art.kind === "image" ? owl.art.src : "";
    expect(src).toBe("/brand/sagax-owl-app-icon.svg");
    expect(fs.existsSync(path.join(root, "public", src))).toBe(true);
  });

  it("keeps the other choices, Blob included", () => {
    const ids = APP_ICON_CHOICES.map((choice) => choice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["owl:none", "owl:gold", "shape:sparkle", "glyph:shape", "glyph:spark", "glyph:cube", "trombi:classic", "bunbu:plain", "crab:plain"]) {
      expect(ids).toContain(id);
    }
    expect(APP_ICON_CHOICES.find((choice) => choice.id === "glyph:shape")?.labelKey).toBe("settings.appIcon.glyph.blob");
    expect(APP_ICON_CHOICES.filter((choice) => choice.art.kind === "default")).toHaveLength(1);
    for (const choice of APP_ICON_CHOICES) expect(choice.id).toMatch(/^[a-z0-9][a-z0-9:._-]{0,63}$/);
  });
});
