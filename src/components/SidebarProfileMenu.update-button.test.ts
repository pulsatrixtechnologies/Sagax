// A downloaded update puts a round cloud button at the right of the footer
// row; it opens the "Update ready" dialog. While the updater checks,
// downloads or fails, the row keeps its small badge and shows no button.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import type { UpdaterState } from "@/lib/updater";
import { resetAchievementsForTests } from "@/lib/achievements";

const fixture = vi.hoisted(() => ({ updater: null as UpdaterState | null }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => fixture.updater }));
vi.mock("@/lib/brand", () => ({ brand: () => ({ name: "Sagax" }) }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, config: { profile: { name: "Jean-Christophe Proulx" } } as AppState["config"] },
      dispatch: vi.fn(),
    }),
  };
});

import { showsUpdateButton, SidebarProfileMenu } from "./SidebarProfileMenu";

const button = (html: string) => /<button[^>]*data-sidebar-update=""[^>]*>/.exec(html)?.[0] ?? "";

function render(updater: UpdaterState | null, avatarOnly = false) {
  fixture.updater = updater;
  vi.stubGlobal("window", { ogb: { updater: { check: vi.fn(), install: vi.fn(), onState: vi.fn() } } });
  return renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly }));
}

beforeEach(() => resetAchievementsForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetAchievementsForTests();
});

describe("footer update button", () => {
  it("is shown for a downloaded update only", () => {
    expect(showsUpdateButton("downloaded")).toBe(true);
    for (const phase of ["idle", "checking", "downloading", "preparing", "installing", "error", "handed-off", "up-to-date"] as const) {
      expect(showsUpdateButton(phase)).toBe(false);
    }
    expect(showsUpdateButton(undefined)).toBe(false);
  });

  it("puts a round cloud button beside the name, labelled with the version", () => {
    const html = render({ status: "downloaded", version: "0.4.19" });
    const tag = button(html);
    expect(tag).toContain('aria-label="Version 0.4.19 ready · Restart"');
    expect(tag).toContain("rounded-full");
    expect(tag).toContain("flex-basis:2.75rem");
    expect(tag).not.toContain("data-wide");
    expect(html).toContain("lucide-cloud-download");
    // the name stays while the button is round, and the row's badge gives way
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).toContain("max-w-[240px]");
    expect(html.match(/lucide-arrow-down-to-line/g)).toBeNull();
  });

  it("leaves the avatar's dot to a failed update beside Connect apps", () => {
    const dot = (html: string) => /<span[^>]*class="absolute -right-0\.5 -top-0\.5[^"]*"/.exec(html)?.[0] ?? "";
    // the foot's own update button (SidebarUpdatePill) shows these
    expect(dot(render({ status: "downloaded", version: "0.5.21" }, true))).toBe("");
    expect(dot(render({ status: "downloading", version: "0.5.21", percent: 40 }, true))).toBe("");
    expect(dot(render({ status: "error", message: "offline" }, true))).toContain("bg-danger");
  });

  it("is absent while an update downloads, and on the collapsed rail", () => {
    expect(button(render({ status: "downloading", version: "0.4.19", percent: 40 }))).toBe("");
    expect(button(render({ status: "idle" }))).toBe("");
    expect(button(render({ status: "downloaded", version: "0.4.19" }, true))).toBe("");
  });
});
