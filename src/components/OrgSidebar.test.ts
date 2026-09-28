import { createElement, type MouseEvent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: (() => undefined) as (action: unknown) => void,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, ...harness.state },
      dispatch: harness.dispatch,
    }),
  };
});

import { OrgSidebar, OrgSidebarNav } from "./OrgSidebar";
import { Sidebar } from "./Sidebar";
import { notifyOrgColumn, refreshOrgColumn } from "./org-column";

describe("OrgSidebar", () => {
  it("lists channels and direct bots under the organization", () => {
    const html = renderToStaticMarkup(createElement(OrgSidebar, {
      orgName: "GOX",
      channels: [{ id: "c1", name: "administration", preview: "Parfait." }],
      directs: [{ id: "b1", name: "Ara" }],
    }));
    expect(html).not.toContain("GOX");
    expect(html).toContain("administration");
    expect(html).not.toContain("Direct");
    expect(html).not.toContain("Ara");
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

const atlas = {
  id: "atlas",
  threadId: "thread-atlas",
  name: "Atlas",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "claude", model: "test" },
  messages: [],
} as Bot;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    json: async () => body,
  };
}

describe("Sidebar organization column", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    harness.state = {};
  });

  it("keeps the roster on 404 and shows the organization column on 200", async () => {
    harness.state = { bots: [atlas], groups: [] };
    harness.dispatch = () => {};
    vi.stubGlobal("window", {
      addEventListener() {},
      removeEventListener() {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {} });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValue(jsonResponse(404, {}) as Response);
    await refreshOrgColumn();
    const roster = renderToStaticMarkup(createElement(Sidebar, { open: true, onClose: () => {} }));
    expect(roster).toContain("Atlas");
    expect(roster).not.toContain("Direct");

    notifyOrgColumn("GOX");
    const created = renderToStaticMarkup(createElement(Sidebar, { open: true, onClose: () => {} }));
    expect(created).not.toContain("GOX");
    expect(created).not.toContain("Direct");
    expect(created).toContain("Atlas");

    fetchMock.mockResolvedValue(jsonResponse(404, {}) as Response);
    await refreshOrgColumn();
    fetchMock.mockResolvedValue(jsonResponse(200, { org: { name: "GOX" } }) as Response);
    await refreshOrgColumn();
    const loaded = renderToStaticMarkup(createElement(Sidebar, { open: true, onClose: () => {} }));
    expect(loaded).not.toContain("GOX");
    expect(loaded).not.toContain("Direct");
    expect(loaded).toContain("Atlas");
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
