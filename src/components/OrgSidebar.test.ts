import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OrgSidebar, OrgSidebarNav } from "./OrgSidebar";

describe("OrgSidebar", () => {
  it("lists channels and direct bots under the organization", () => {
    const html = renderToStaticMarkup(createElement(OrgSidebar, {
      orgName: "GOX",
      channels: [{ id: "c1", name: "administration", preview: "Parfait." }],
      directs: [{ id: "b1", name: "Ara" }],
    }));
    expect(html).toContain("GOX");
    expect(html).toContain("administration");
    expect(html).toContain("Direct");
    expect(html).toContain("Ara");
    expect(html).not.toContain("Zephyr");
  });

  it("selects the channel group the same way a room row does", () => {
    const dispatch = vi.fn();
    let tree: ReactNode;
    function Rows() {
      tree = OrgSidebar({
        orgName: "GOX",
        channels: [{ id: "c1", name: "administration", preview: "Parfait." }],
        directs: [{ id: "b1", name: "Ara" }],
      });
      return tree;
    }
    renderToStaticMarkup(createElement(OrgSidebarNav, {
      dispatch,
      selectedId: null,
      children: createElement(Rows),
    }));
    const button = findButton(tree!, "data-sidebar-group-row", "c1");
    button?.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "c1" });
  });
});

function findButton(
  tree: ReactNode,
  attribute: string,
  value: string,
): { props: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void } } | undefined {
  if (!tree || typeof tree !== "object") return;
  if ("props" in tree && tree.props && typeof tree.props === "object") {
    const props = tree.props as { children?: ReactNode; [key: string]: unknown };
    if (props[attribute] === value) return tree as { props: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void } };
    const nested = Array.isArray(props.children) ? props.children : [props.children];
    for (const child of nested) {
      const found = findButton(child, attribute, value);
      if (found) return found;
    }
  }
}
