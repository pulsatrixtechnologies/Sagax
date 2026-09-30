import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { BotEditorStore, type useStore } from "@/state/store";
import { RetroStatusBar, RetroTop } from "./RetroChrome";
import { PIXEL_ICON_NAMES, PixelIcon } from "./pixel-icons";

type StoreValue = ReturnType<typeof useStore>;

function withStore(element: ReturnType<typeof createElement>, state: Record<string, unknown> = {}) {
  // SAFETY: the chrome reads bots, groups, selection, panel flags and connection only.
  const value = {
    state: { bots: [{ id: "b1", name: "Pepper", busy: false, hidden: false, tasks: [] }], groups: [], selectedId: "b1", connected: true, activeView: "chat", settingsOpen: false, inspectorOpen: false, ...state },
    dispatch: () => undefined,
  } as unknown as StoreValue;
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: element }));
}

describe("retro window chrome", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("draws a title bar naming the app and the open bot", () => {
    const markup = withStore(createElement(RetroTop, {}));
    expect(markup).toContain('class="r98w-titlebar"');
    expect(markup).toContain("Sagax - Pepper");
  });

  it("has a menu bar with File, Edit, View, Bots and Help, in the app language", () => {
    const en = withStore(createElement(RetroTop, {}));
    expect(en).toContain('role="menubar"');
    for (const menu of ["file", "edit", "view", "bots", "help"]) expect(en).toContain(`data-r98-menu="${menu}"`);
    setLocale("fr");
    const fr = withStore(createElement(RetroTop, {}));
    for (const label of ["ichier", "dition", "ffichage", "ots", "ide"]) expect(fr).toContain(label);
    expect(fr).toContain("Barre d&#x27;outils");
  });

  it("has a toolbar of labelled 16px icon buttons", () => {
    const markup = withStore(createElement(RetroTop, {}));
    expect(markup).toContain('role="toolbar"');
    const tools = markup.match(/class="r98w-tool"/g) ?? [];
    expect(tools.length).toBe(6);
    expect(markup).toContain('aria-label="New bot..."');
    expect(markup).toContain('aria-label="Side panel"');
  });

  it("keeps the macOS traffic lights clear of the title text", () => {
    const css = readFileSync(new URL("./retro-chrome.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.r98w-titlebar-mac \{[^}]*padding-left: 7\dpx/);
  });

  it("draws a status bar of sunken panes: status, model, spend", () => {
    const ready = withStore(createElement(RetroStatusBar));
    expect(ready).toContain("r98w-status-field");
    expect(ready).toContain("Ready");
    const working = withStore(createElement(RetroStatusBar), { bots: [{ id: "b1", name: "Pepper", busy: true, tasks: [] }] });
    expect(working).toContain("Pepper is working...");
    const offline = withStore(createElement(RetroStatusBar), { connected: false });
    expect(offline).toContain("Not connected");
  });
});

describe("pixel icons", () => {
  it("are 16 by 16 pixel maps", () => {
    for (const name of PIXEL_ICON_NAMES) {
      const markup = renderToStaticMarkup(createElement(PixelIcon, { name }));
      expect(markup, name).toContain('viewBox="0 0 16 16"');
      expect(markup, name).toContain('shape-rendering="crispEdges"');
      const rects = [...markup.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)"/g)];
      expect(rects.length, name).toBeGreaterThan(10);
      for (const [, x, y, w] of rects) {
        expect(Number(x) + Number(w), name).toBeLessThanOrEqual(16);
        expect(Number(y), name).toBeLessThan(16);
      }
    }
  });
});

/** Top-level commas only: `:is(a, b)` stays one selector. */
function splitSelectors(group: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of group) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out;
}

describe("retro skin scoping", () => {
  const files = ["../../styles/retro98.css", "./retro-chrome.css"];
  it("scopes every rule to the retro98 skin", () => {
    for (const file of files) {
      const css = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((match) => match[2].trim()).filter((selector) => selector && !/^(from|to|\d+%)/.test(selector));
      for (const group of selectors) {
        for (const selector of splitSelectors(group)) {
          expect(selector.trim(), `${file}: ${selector}`).toMatch(/^(\[data-skin="retro98"\]|\.r98-root)/);
        }
      }
    }
  });

  it("keeps the 98.css copyright notice", () => {
    const css = readFileSync(new URL("../../styles/retro98.css", import.meta.url), "utf8");
    expect(css).toContain("Copyright (c) 2020 Jordan Scales");
    expect(css).not.toMatch(/@font-face|\.woff/);
  });
});
