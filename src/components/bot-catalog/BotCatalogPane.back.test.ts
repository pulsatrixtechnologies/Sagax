// @vitest-environment happy-dom
// Connect apps > Browse bots: the home of Browse Bots shows "‹ Connect Apps"
// and that crumb goes back (the pane is given the trail by the Connect apps window).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/state/store";
import { BotCatalogPane } from "./BotCatalogModal";

function mount(trail?: { label: string; onSelect: () => void }[]) {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(BotCatalogPane, { onClose: () => {}, backRef: { current: null }, trail }))));
  return { host, done: () => { root.unmount(); host.remove(); vi.unstubAllGlobals(); } };
}

describe("Browse Bots home inside Connect apps", () => {
  it("shows the breadcrumb and goes back to Connect apps", () => {
    const onSelect = vi.fn();
    const { host, done } = mount([{ label: "Connect Apps", onSelect }]);
    expect(host.querySelector("[data-bot-catalog-home] [data-breadcrumb]")).not.toBeNull();
    host.querySelector<HTMLElement>("[data-breadcrumb-back]")!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    done();
  });

  it("opened alone has no breadcrumb", () => {
    const { host, done } = mount();
    expect(host.querySelector("[data-bot-catalog-home]")).not.toBeNull();
    expect(host.querySelector("[data-breadcrumb]")).toBeNull();
    done();
  });
});
