// SidebarPlaces lays out the rows it is given, as labels or as icon buttons.
// The product passes Connected apps and Browse Bots. This fixture still covers
// a four-row stack, including the attention dot and the tour anchors.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDays, LayoutGrid, Library, Network, Puzzle } from "lucide-react";
import { describe, expect, it } from "vitest";

import { PLACE_ROW, PLACES_DIVIDER, PLACES_STACK, SidebarPlaces, type SidebarPlace } from "./SidebarPlaces";

function places({ attention = false, active = "" } = {}): SidebarPlace[] {
  return [
    { key: "team-map", label: "Team map", icon: Network, active: active === "team-map", onSelect: () => {} },
    { key: "routines", tourId: "nav-automations", label: "Automations", icon: CalendarDays, attention, active: active === "routines", onSelect: () => {} },
    { key: "plugins", tourId: "nav-apps", label: "Connected apps", icon: Puzzle, onSelect: () => {} },
    { key: "templates", label: "Templates", icon: Library, onSelect: () => {} },
  ];
}

describe("sidebar places", () => {
  it("shows the four places as labelled rows, in order, under the tour's tools anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarPlaces, { places: places() }));
    expect(html).toContain('data-tour="tools"');
    const labels = [...html.matchAll(/data-sidebar-place="([^"]+)"/g)].map((match) => match[1]);
    expect(labels).toEqual(["team-map", "routines", "plugins", "templates"]);
    for (const label of ["Team map", "Automations", "Connected apps", "Templates"]) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('data-tour="nav-automations"');
    expect(html).toContain('data-tour="nav-apps"');
    // no brand marks beside Connected apps, and nothing tinted
    expect(html).not.toContain("<svg viewBox=\"0 0 48 48\"");
    expect(html).not.toContain("footer-tint");
    expect(html).not.toContain("ring-sidebar");
    // a 20px line icon on every row
    expect(html.match(/width="20"/g)).toHaveLength(4);
  });

  it("lights the open page and dots the place that needs attention", () => {
    const quiet = renderToStaticMarkup(createElement(SidebarPlaces, { places: places() }));
    expect(quiet).not.toContain("place-attention-");
    expect(quiet).not.toContain('aria-current="page"');
    const html = renderToStaticMarkup(createElement(SidebarPlaces, { places: places({ attention: true, active: "routines" }) }));
    expect(html).toContain('data-testid="place-attention-routines"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*data-sidebar-place="routines"|data-sidebar-place="routines"[^>]*aria-current="page"/);
  });

  it("turns into icon-only buttons with tooltips on the collapsed rail", () => {
    const html = renderToStaticMarkup(createElement(SidebarPlaces, { places: places({ attention: true }), iconOnly: true }));
    for (const label of ["Team map", "Automations", "Connected apps", "Templates"]) {
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`title="${label}"`);
      expect(html).not.toContain(`>${label}</span>`);
    }
    expect(html).not.toContain("footer-tint");
    expect(html).toContain('data-testid="place-attention-routines"');
    expect(html).toContain('data-tour="nav-apps"');
  });

  it("keeps every row at the same height, gap and hairline whether the sidebar is expanded or collapsed", () => {
    // Collapsing must not move an icon: pull out every class that sets a
    // vertical size or spacing and require the two layouts to agree.
    // (a row is a flex row, so its `gap-` is horizontal; the stack is a column)
    const vertical = (cls: string, gapIsVertical = true) => cls.split(/\s+/)
      .filter((c) => /^(-?m[tby]?|p[tby]?|min-h|max-h|h|gap-y|size|leading)-/.test(c) || (gapIsVertical && /^gap-\d/.test(c)))
      .sort().join(" ");
    const rows = (html: string) => [...html.matchAll(/<button[^>]*class="([^"]+)"[^>]*data-sidebar-place|<button[^>]*data-sidebar-place[^>]*class="([^"]+)"/g)].map((m) => vertical(m[1] ?? m[2], false));
    const stack = (html: string) => vertical(html.match(/data-sidebar-places[^>]*class="([^"]+)"|class="([^"]+)"[^>]*data-sidebar-places/)!.slice(1).find(Boolean)!);
    const divider = (html: string) => html.match(/<div[^>]*data-sidebar-foot-divider[^>]*>/)?.[0];
    const expanded = renderToStaticMarkup(createElement(SidebarPlaces, { places: places({ attention: true, active: "team-map" }) }));
    const collapsed = renderToStaticMarkup(createElement(SidebarPlaces, { places: places({ attention: true, active: "team-map" }), iconOnly: true }));
    expect(rows(expanded)).toHaveLength(4);
    expect(rows(collapsed)).toEqual(rows(expanded));
    for (const row of rows(expanded)) expect(row).toBe(vertical(PLACE_ROW));
    expect(stack(collapsed)).toBe(stack(expanded));
    expect(stack(expanded)).toBe(vertical(PLACES_STACK));
    // the hairline under the places, identical in both layouts
    expect(divider(expanded)).toBeDefined();
    expect(divider(collapsed)).toBe(divider(expanded));
    expect(divider(expanded)).toContain("bg-sidebar-hairline");
    expect(divider(expanded)).toContain(PLACES_DIVIDER);
  });

  it("marks the icons that animate on hover, and only those", () => {
    const html = renderToStaticMarkup(createElement(SidebarPlaces, { places: [
      { key: "plugins", label: "Connected apps", icon: Puzzle, animation: "puzzle", onSelect: () => {} },
      { key: "browse-bots", label: "Browse Bots", icon: LayoutGrid, animation: "grid", onSelect: () => {} },
      { key: "plain", label: "Plain", icon: Network, onSelect: () => {} },
    ] }));
    expect(html.match(/sidebar-place-icon/g)).toHaveLength(2);
    expect(html).toContain('data-place-anim="puzzle"');
    expect(html).toContain('data-place-anim="grid"');
    expect(html).toMatch(/<svg[^>]*data-place-anim="grid"[^>]*>(<rect[^>]*><\/rect>){4}<\/svg>/);
  });

  it("animates the icons only without reduced motion (system or app setting)", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    // every rule that plays the keyframes sits in a no-preference block
    const blocks = [...css.matchAll(/@media ([^{]*)\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)];
    const playing = blocks.filter((block) => /sidebar-place-(puzzle|grid)\b(?!\s*\{)/.test(block[2]!) && /animation:\s*sidebar-place-/.test(block[2]!));
    expect(playing.length).toBe(2);
    for (const block of playing) {
      expect(block[1]).toContain("prefers-reduced-motion: no-preference");
      // each selector also yields to the app's own reduced-motion switch
      for (const rule of block[2]!.matchAll(/([^{}]+)\{[^{}]*animation/g)) {
        expect(rule[1]).toContain(':root:not([data-reduced-motion="true"])');
      }
    }
    // and nowhere outside those blocks
    const outside = blocks.reduce((rest, block) => rest.replace(block[0], ""), css);
    expect(outside).not.toMatch(/animation:\s*sidebar-place-/);
  });

  it("renders nothing without places", () => {
    expect(renderToStaticMarkup(createElement(SidebarPlaces, { places: [] }))).toBe("");
  });
});
