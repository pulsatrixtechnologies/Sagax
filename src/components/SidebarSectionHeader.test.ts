import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarSectionHeader } from "./SidebarSectionHeader";

describe("SidebarSectionHeader", () => {
  it("exposes collapse and keyboard reorder semantics without a fake grip button", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Work",
        collapsed: false,
        onToggle: () => {},
        reorderable: true,
        dragging: false,
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("Delete Work section");
    // sentence case (as upstream), a 12px regular label, no chevron
    expect(html).toContain(">Work</span>");
    expect(html).toContain("text-[12px] font-normal");
    expect(html).not.toContain("lucide-chevron");
    expect(html).not.toContain("uppercase");
  });

  it.each([false, true])("keeps delete off the heading and leaves the context menu, collapsed=%s", (collapsed) => {
    const onContextMenu = () => {};
    const element = SidebarSectionHeader({
      name: "Work",
      collapsed,
      onToggle: () => {},
      onContextMenu,
      reorderable: true,
      dragging: false,
    });
    const html = renderToStaticMarkup(element);

    expect(element.props.onContextMenu).toBe(onContextMenu);
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain("Delete Work section");
    expect(html).not.toContain("lucide-trash");
    expect(html).toContain(`aria-expanded="${!collapsed}"`);
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });

  it("renders collapsed attention signals in the heading", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: true,
        attention: { waiting: 1, unread: 2, working: 1 },
        onToggle: () => {},
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });

  it("shows what a folded section holds at the right, and nothing while open", () => {
    const header = (collapsed: boolean, count?: number) => renderToStaticMarkup(
      createElement(SidebarSectionHeader, { name: "Personnel", collapsed, count, onToggle: () => {}, reorderable: false, dragging: false }),
    );
    expect(header(true, 6)).toContain('<span data-section-count="" class="ml-auto shrink-0 text-[12px] leading-4 tabular-nums">6</span>');
    expect(header(false, 6)).not.toContain("data-section-count");
    expect(header(true, 0)).not.toContain("data-section-count");
    expect(header(true)).not.toContain("data-section-count");
  });

  it("retains the accessible attention summary when the heading cannot collapse", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: false,
        attention: { waiting: 1, unread: 2, working: 1 },
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).not.toContain("<button");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });
});
