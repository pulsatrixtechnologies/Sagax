import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { browserAvailable, type FeatureFlagConfig } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { visibilityState: "visible" });
  const view = { current: "browser" };
  vi.stubGlobal("localStorage", { getItem: () => view.current });
  return { config: {} as FeatureFlagConfig & { cloudHome?: boolean }, view };
});
// These cover the Advanced panel; ComputerPanel.simple.test.ts covers Simple.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { config: { box: { configured: false }, ...fixture.config }, instances: [], computerControl: {}, screens: {}, routines: [], routineRuns: [] },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { ComputerPanel } from "./ComputerPanel";
import { BrowserPanel } from "./BrowserPanel";

afterAll(() => vi.unstubAllGlobals());
const bot = { id: "browser-fixture", name: "Browser fixture", modelSelection: { instanceId: "fixture" } } as Bot;
const render = (config: FeatureFlagConfig & { cloudHome?: boolean }, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(ComputerPanel, { bot: { ...bot, browser } }));
};

// Sagax 0.1.0 (8a563e929) dropped the Browser view from the Computer panel:
// the panel shows the computer only. The install and repair states live in
// BrowserPanel, rendered on its own here.
const renderBrowser = (config: FeatureFlagConfig & { cloudHome?: boolean }, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(BrowserPanel, { bot: { ...bot, browser } }));
};

describe("Browser panel installation access", () => {
  const missing = { kind: "unavailable", installable: true } as const;

  it("shows the real install panel before the engine is available", () => {
    const config = { features: { browser: true }, browserEngine: missing };
    expect(renderBrowser(config)).toContain("Install the browser engine");
    expect(browserAvailable(config)).toBe(false);
  });

  it("never opens a browser view inside the Computer panel", () => {
    expect(render({ features: { browser: true }, browserEngine: missing })).not.toContain("Install the browser engine");
    expect(render({ features: { browser: true }, browserEngine: { kind: "engine" } }, true)).not.toContain("Loading browser…");
  });

  it("keeps the per-bot opt-in gate", () => {
    const markup = renderBrowser({ features: { browser: true }, browserEngine: missing }, false);
    expect(markup).not.toContain("Install the browser engine");
    expect(markup).toContain("Enable the browser in this bot’s profile");
  });

  it("does not offer an install on unsupported hosts and still shows a ready engine", () => {
    expect(renderBrowser({ features: { browser: true }, browserEngine: { kind: "unavailable", installable: false } })).not.toContain("Install the browser engine");
    // A ready browser waits for the owner check before opening a live stream.
    expect(renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine" } })).toContain("Loading browser…");
  });

  it("keeps Chrome setup failure and progress visible even when the binary exists", () => {
    const failed = renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine", installError: "Chrome download failed" } });
    expect(failed).toContain("Chrome download failed");
    expect(failed).toContain("Retry browser installation");
    const installing = renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine", installing: true } });
    expect(installing).toContain("Installing…");
    expect(installing).toContain('disabled=""');
  });
});

describe("Computer panel on a narrow screen", () => {
  it("covers the window below md instead of docking a 400px column", () => {
    // A phone reaches this panel through the browser (remote access). Docked
    // at its stored width it pushed the chat to zero and ran off the right
    // edge, where `body { overflow: hidden }` cut it off. Below md it takes
    // the window like the settings and inspector panels do; the inline width
    // still sizes it beside the chat on wider screens.
    const markup = render({});
    const aside = /<aside class="([^"]*)"/.exec(markup)!;
    expect(aside[1].split(" ")).toEqual(expect.arrayContaining(["max-md:absolute", "max-md:inset-0", "max-md:z-40", "max-md:w-full!"]));
    // Nothing to drag against when the panel is the whole window.
    const separator = /<div role="separator"[^>]*class="([^"]*)"/.exec(markup)!;
    expect(separator[1].split(" ")).toContain("max-md:hidden");
  });
});

describe("Computer panel header", () => {
  it("names its icon-only close button", () => {
    expect(render({})).toContain(`aria-label="${t("computer.close")}"`);
  });
});
