// Team map, Automations, Connected apps and Templates: always-visible rows
// above the account row, icon buttons on the collapsed rail.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDays, Library, Network, Puzzle } from "lucide-react";
import { describe, expect, it } from "vitest";

import { SidebarPlaces, type SidebarPlace } from "./SidebarPlaces";
import { AppMarks } from "./SidebarAppMarks";

function places({ attention = false, active = "" } = {}): SidebarPlace[] {
  return [
    { key: "team-map", label: "Team map", icon: Network, active: active === "team-map", onSelect: () => {} },
    { key: "routines", tourId: "nav-automations", label: "Automations", icon: CalendarDays, attention, active: active === "routines", onSelect: () => {} },
    { key: "plugins", tourId: "nav-apps", label: "Connected apps", icon: Puzzle, trailing: createElement(AppMarks, { ringClassName: "ring-sidebar" }), onSelect: () => {} },
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
    // the Connected apps marks ride along, tinted until the row is hovered
    expect(html).toContain("footer-tint");
    expect(html).toContain("ring-sidebar");
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

  it("renders nothing without places", () => {
    expect(renderToStaticMarkup(createElement(SidebarPlaces, { places: [] }))).toBe("");
  });
});
