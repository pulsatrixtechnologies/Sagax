// @vitest-environment happy-dom
// The Connect apps pill (2026-10-15, JC, after Grok Bot): under the last
// message, on the person's side, a wide pill then up to three app icons; it
// opens Connect apps on those apps. When it shows: connect-apps-signal.test.ts.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { initialState, reducer } from "@/state/store";
import { ConnectAppsPill, SidebarConnectApps, sidebarPillApps, type PillApp } from "./ConnectAppsPill";

const inventory = vi.hoisted(() => ({ services: {} as Record<string, { connected: boolean }> }));
vi.mock("./plugins/connected-apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plugins/connected-apps")>()),
  preloadConnectedApps: async () => ({ services: inventory.services, authoritative: true }),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: async () => ({ cards: [{ slug: "notion", label: "Notion", blurb: "", logo: null, domain: "notion.so" }] }),
}));

let root: Root | null = null;
const app = (slug: string, label: string): PillApp => ({ slug, label, logo: null, domain: `${slug}.com` });
const apps = [app("gmail", "Gmail"), app("notion", "Notion"), app("googledrive", "Google Drive"), app("slack", "Slack")];

function render(list: PillApp[], onOpen = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(ConnectAppsPill, { apps: list, onOpen })));
  return container;
}

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

describe("the Connect apps pill", () => {
  it("reads Connect apps with three app icons at most, on the person's side", () => {
    const container = render(apps);
    const pill = container.querySelector("[data-connect-apps-pill]")!;
    expect(pill.className).toContain("justify-end");
    const button = pill.querySelector("button")!;
    expect(button.textContent).toBe("Connect apps");
    expect(button.className).toContain("rounded-full");
    expect(button.querySelectorAll("img")).toHaveLength(3);
    expect(button.getAttribute("aria-label")).toBe("Connect apps: Gmail, Notion, Google Drive, Slack");
  });

  it("says Connecter des applications in French", () => {
    setLocale("fr");
    const container = render(apps.slice(0, 1));
    expect(container.querySelector("button")!.textContent).toBe("Connecter des applications");
  });

  it("opens Connect apps when clicked, and draws nothing without an app", () => {
    const onOpen = vi.fn();
    const container = render(apps, onOpen);
    flushSync(() => container.querySelector("button")!.click());
    expect(onOpen).toHaveBeenCalledOnce();
    root?.unmount();
    expect(render([]).querySelector("[data-connect-apps-pill]")).toBeNull();
  });
});

describe("the sidebar's Connect apps pill", () => {
  function renderSidebar(onOpen = vi.fn(), iconOnly = false) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => root!.render(createElement(SidebarConnectApps, { onOpen, iconOnly })));
    return container;
  }

  it("is the conversation's pill, full width, and opens Connect apps", () => {
    inventory.services = {};
    const onOpen = vi.fn();
    const container = renderSidebar(onOpen);
    const button = container.querySelector<HTMLButtonElement>("[data-sidebar-connect-apps]")!;
    expect(button.textContent).toBe("Connect apps");
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("w-full");
    expect(button.getAttribute("data-tour")).toBe("nav-apps");
    expect(button.querySelectorAll("img").length).toBeLessThanOrEqual(3);
    flushSync(() => button.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("says Connecter des applications in French", () => {
    setLocale("fr");
    const button = renderSidebar().querySelector("[data-sidebar-connect-apps]")!;
    expect(button.textContent).toBe("Connecter des applications");
    expect(button.getAttribute("aria-label")).toBe("Connecter des applications");
  });

  it("keeps an icon button in the collapsed rail", () => {
    setLocale("fr");
    const button = renderSidebar(vi.fn(), true).querySelector("[data-sidebar-connect-apps]")!;
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Connecter des applications");
  });

  it("shows the connected apps, three at most, else the usual suggestions", () => {
    expect(sidebarPillApps([], null).map((item) => item.slug)).toEqual(["gmail", "slack", "github"]);
    const cards = new Map([["notion", { slug: "notion", label: "Notion", blurb: "", logo: "https://logo/notion.png", domain: "notion.so" }]]);
    const shown = sidebarPillApps(["slack", "notion", "gmail", "asana"], cards);
    expect(shown.map((item) => item.slug)).toEqual(["asana", "gmail", "notion"]);
    expect(shown[2]).toMatchObject({ label: "Notion", logo: "https://logo/notion.png" });
  });
});

describe("opening Connect apps on the apps a conversation needs", () => {
  const closed = initialState;

  it("keeps the apps while the panel is open and forgets them when it closes", () => {
    const opened = reducer(closed, { type: "togglePlugins", open: true, surface: "apps", botId: "maya", focusApps: ["gmail", "notion"] });
    expect(opened).toMatchObject({ pluginsOpen: true, pluginsBotId: "maya", pluginsFocusApps: ["gmail", "notion"] });
    expect(reducer(opened, { type: "togglePlugins", open: true, surface: "mcp" }).pluginsFocusApps).toEqual(["gmail", "notion"]);
    expect(reducer(opened, { type: "togglePlugins", open: false }).pluginsFocusApps).toBeNull();
    expect(reducer(closed, { type: "togglePlugins", open: true }).pluginsFocusApps).toBeNull();
  });
});
