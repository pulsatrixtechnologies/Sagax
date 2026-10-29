// The look of a published page's reader (src/lib/page-look.ts,
// src/lib/page-look-sync.ts, 2026-10-29): what the person's app sends, what
// the server keeps, and what the bar is drawn with.
import { afterEach, describe, expect, it, vi } from "vitest";

import { holdContrast } from "./bot-accent-colors";
import { lookContentTokens, lookTokens, PAGE_LOOK_TOKENS, readerBarThemeCss, readerBarVars, sanitizePageLook } from "./page-look";
import { resetPageLookSync, sendPageLook } from "./page-look-sync";
import { fallbackWidgetTokens, WIDGET_THEME_TOKENS } from "./widget-kit";

const LIGHT = { "--color-panel": "#fbf7ee", "--color-ink": "#2b2418", "--color-accent": "#9a5b13", "--radius-xl": "14px" };
const DARK = { "--color-panel": "#1d1812", "--color-ink": "#f1e9da", "--color-accent": "#d9a441" };

describe("sanitizePageLook", () => {
  it("keeps the known tokens with safe values, sets each scheme's name", () => {
    const look = sanitizePageLook({ light: LIGHT, dark: DARK, skin: "atelier", botAccent: true });
    expect(look).toEqual({ light: { ...LIGHT, "--code-color-scheme": "light" }, dark: { ...DARK, "--code-color-scheme": "dark" }, skin: "atelier", botAccent: true });
  });

  it("drops what could leave the declaration, a resource or an unknown name", () => {
    const look = sanitizePageLook({ light: { ...LIGHT, "--color-card": "red;}</style>", "--color-raised": "url(x)", "--color-menu": "image-set(x)", "--evil": "#000" }, skin: "../x", botAccent: "yes" });
    expect(look!.light).toEqual({ ...LIGHT, "--code-color-scheme": "light" });
    expect(look!.skin).toBeUndefined();
    expect(look!.botAccent).toBeUndefined();
  });

  it("refuses nothing usable and anything too big", () => {
    for (const bad of [null, [], "x", {}, { light: { "--evil": "#000" } }, { light: { "--color-panel": "x".repeat(9000) } }]) expect(sanitizePageLook(bad)).toBeNull();
  });

  it("carries the content theme's tokens and the bar's own", () => {
    for (const name of WIDGET_THEME_TOKENS) expect(PAGE_LOOK_TOKENS).toContain(name);
    for (const name of ["--color-app", "--radius-xl", "--color-control"]) expect(PAGE_LOOK_TOKENS).toContain(name);
  });
});

describe("lookTokens", () => {
  it("the person's tokens over the fallback skin of the scheme", () => {
    const look = sanitizePageLook({ light: LIGHT, dark: DARK });
    expect(lookTokens(look, "light")["--color-panel"]).toBe("#fbf7ee");
    expect(lookTokens(look, "light")["--color-hairline"]).toBe(fallbackWidgetTokens("light")["--color-hairline"]);
    expect(lookTokens(look, "dark")["--color-accent"]).toBe("#d9a441");
    expect(lookTokens(null, "dark")["--color-panel"]).toBe(fallbackWidgetTokens("dark")["--color-panel"]);
  });

  it("a look with one scheme is worn in both", () => {
    const look = sanitizePageLook({ light: LIGHT });
    expect(lookTokens(look, "dark")["--color-panel"]).toBe("#fbf7ee");
  });

  it("the bot's color as the accent, held to 3:1 and 4.5:1 on the panel, only when chosen", () => {
    const on = sanitizePageLook({ light: LIGHT, dark: DARK, botAccent: true });
    expect(lookTokens(on, "light", "#ffd84d")["--color-accent"]).toBe(holdContrast("#ffd84d", "#fbf7ee", 3));
    expect(lookTokens(on, "light", "#ffd84d")["--color-accent-text"]).toBe(holdContrast("#ffd84d", "#fbf7ee", 4.5));
    expect(lookTokens(on, "dark", null)["--color-accent"]).toBe("#d9a441");
    const off = sanitizePageLook({ light: LIGHT, dark: DARK });
    expect(lookTokens(off, "light", "#ffd84d")["--color-accent"]).toBe("#9a5b13");
    expect(lookContentTokens(on, "#ffd84d").light["--color-accent"]).toBe(holdContrast("#ffd84d", "#fbf7ee", 3));
  });
});

describe("the bar's stylesheet", () => {
  it("light first, dark under the reader's system; square corners give square buttons", () => {
    const css = readerBarThemeCss(sanitizePageLook({ light: LIGHT, dark: DARK }));
    expect(css).toMatch(/^:root\{color-scheme:light;[^}]*--sb-bg:#fbf7ee[^}]*\}@media \(prefers-color-scheme:dark\)\{:root\{color-scheme:dark;[^}]*--sb-bg:#1d1812/);
    expect(css).toContain("--sb-pill:999px");
    expect(readerBarVars({ "--radius-xl": "0px" })["--sb-pill"]).toBe("0px");
    expect(css).not.toMatch(/[<>{}]\s*script|url\(/);
  });
});

describe("sendPageLook", () => {
  afterEach(() => resetPageLookSync());

  it("sends a look once, again only when it changes; stops when the server says it is not a person's", async () => {
    const put = vi.fn(async () => new Response("{}", { status: 200 }));
    const look = sanitizePageLook({ light: LIGHT })!;
    await sendPageLook(look, put);
    await sendPageLook(look, put);
    expect(put).toHaveBeenCalledTimes(1);
    await sendPageLook({ ...look, botAccent: true }, put);
    expect(put).toHaveBeenCalledTimes(2);
    const refused = vi.fn(async () => new Response("{}", { status: 403 }));
    await sendPageLook(sanitizePageLook({ dark: DARK }), refused);
    await sendPageLook(sanitizePageLook({ light: DARK }), refused);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("a failed send is tried again with the next change", async () => {
    const put = vi.fn(async () => new Response("{}", { status: 500 }));
    const look = sanitizePageLook({ light: LIGHT })!;
    await sendPageLook(look, put);
    await sendPageLook(look, put);
    expect(put).toHaveBeenCalledTimes(2);
  });
});
