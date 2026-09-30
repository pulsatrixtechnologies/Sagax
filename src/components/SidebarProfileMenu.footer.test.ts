// The footer row, the way Perspicax lays out its account footer: the avatar
// and the full name, one hover menu that also carries the sidebar's places.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { SidebarProfileMenu } from "./SidebarProfileMenu";

const place = (key: string, attention = false) => ({ key, label: key, attention, onSelect: () => {} });

beforeEach(() => {
  fixture.state = { config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"] };
  vi.stubGlobal("window", {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("sidebar footer row", () => {
  it("shows the avatar and the full name, tinted until hover, and anchors the tour", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("team-map"), place("routines")] }));
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).toContain('data-tour="tools"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("footer-tint");
    expect(html).toContain(">JP<");
    expect(html).not.toContain('data-testid="footer-attention"');
  });

  it("carries a place's attention dot while the menu is closed", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("routines", true)] }));
    expect(html).toContain('data-testid="footer-attention"');
  });

  it("falls back to the viewer's name for a member on a shared server", () => {
    fixture.state = { config: { viewer: { operator: false, principalId: "u1", email: "sam@example.com", name: "Sam Tremblay", role: "member", canCreateBots: false } } as AppState["config"] };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("team-map")] }));
    expect(html).toContain(">Sam Tremblay</span>");
  });

  it("keeps the avatar-only trigger for the collapsed rail, without the tour anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true }));
    expect(html).not.toContain('data-tour="tools"');
    expect(html).not.toContain(">Jean-Christophe Proulx</span>");
    expect(html).toContain('title="Jean-Christophe Proulx"');
  });
});
