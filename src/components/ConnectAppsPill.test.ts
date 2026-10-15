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
import { ConnectAppsPill, type PillApp } from "./ConnectAppsPill";

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
