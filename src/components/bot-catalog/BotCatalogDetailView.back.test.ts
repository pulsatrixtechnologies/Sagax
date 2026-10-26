// @vitest-environment happy-dom
// Browse Bots opened from Connect apps: the breadcrumb on a bot's page goes
// back to Browse Bots (one step) or to Connect apps (the first crumb).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "@/lib/bot-catalog";
import { BotCatalogDetailView } from "./BotCatalogDetailView";

const item = {
  kind: "bot", key: "bot:Pixel",
  entry: { id: "Pixel", name: "Pixel", title: "", description: "d", look: { color: "blue" }, owner: { principalId: "pr_1", name: "Ben" }, source: "mine", archived: false, primary: false },
} as unknown as CatalogItem;

function mount(props: { trail?: { label: string; onSelect: () => void }[]; onBack: () => void }) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(BotCatalogDetailView, { item, content: null, tab: "soul", onTab: () => {}, actions: null, ...props })));
  return { host, done: () => { root.unmount(); host.remove(); } };
}

describe("Browse Bots detail breadcrumb", () => {
  it("returns to Connect apps from the first crumb, to Browse Bots from the back button and the second crumb", () => {
    const toConnect = vi.fn();
    const onBack = vi.fn();
    const { host, done } = mount({ trail: [{ label: "Connect Apps", onSelect: toConnect }], onBack });
    host.querySelector<HTMLElement>('[data-breadcrumb-crumb="0"]')!.click();
    expect(toConnect).toHaveBeenCalledTimes(1);
    host.querySelector<HTMLElement>("[data-breadcrumb-back]")!.click();
    host.querySelector<HTMLElement>('[data-breadcrumb-crumb="1"]')!.click();
    expect(onBack).toHaveBeenCalledTimes(2);
    done();
  });

  it("opened alone keeps the plain back button", () => {
    const onBack = vi.fn();
    const { host, done } = mount({ onBack });
    expect(host.querySelector("[data-breadcrumb]")).toBeNull();
    host.querySelector<HTMLElement>("[data-catalog-back]")!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    done();
  });
});
