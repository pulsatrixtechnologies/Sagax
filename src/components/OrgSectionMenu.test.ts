// The sidebar section menu, in Grok Bot's sections (JC, 2026-10-16):
// Rename, Move up, Move down | Collapse or Expand all | Delete in red.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OrgSectionMenuItems, orgSectionMenuItems, type OrgSectionMenuActions } from "./OrgSectionMenu";

const actions = (): OrgSectionMenuActions => ({
  onRename: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onCollapseAll: vi.fn(), onExpandAll: vi.fn(), onDelete: vi.fn(),
});
const sections = (html: string) => html.split('role="separator"').map((part) =>
  [...part.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1]!.replace(/<[^>]+>/g, "")));

describe("the section menu", () => {
  it("sets organize, fold and Delete apart, Delete last in red", () => {
    const items = orgSectionMenuItems({ named: true, canMoveUp: true, canMoveDown: true, anyExpanded: true });
    const html = renderToStaticMarkup(createElement(OrgSectionMenuItems, { items, actions: actions() }));
    expect(sections(html)).toEqual([["Rename…", "Move up", "Move down"], ["Collapse all"], ["Delete section"]]);
    expect(html).toMatch(/<button[^>]*text-danger[^>]*>(?:(?!<\/button>).)*Delete section<\/button>$/);
  });

  it("draws no divider before the first item when General has nothing to rename", () => {
    const items = orgSectionMenuItems({ named: false, canMoveUp: false, canMoveDown: false, anyExpanded: false });
    const html = renderToStaticMarkup(createElement(OrgSectionMenuItems, { items, actions: actions() }));
    expect(html).not.toContain('role="separator"');
  });
});
