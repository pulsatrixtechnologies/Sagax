// @vitest-environment happy-dom
// A confidential thread's row wears the lock and the word, in the sidebar
// and in the header's thread picker; Settings > Organisation's default is
// one switch for admins.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: fixture.api }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/perspicax-org")>(), loadPerspicaxOrg: vi.fn(async () => null) }));

const { SidebarThreadRow } = await import("./SidebarThreadRow");
const { OrgConfidentialThreadsDefault } = await import("./settings/OrgConfidentialThreadsDefault");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const row = (confidential: boolean) => createElement(SidebarThreadRow, {
  task: { threadId: "t1", title: "Payroll", ...(confidential ? { confidential: true as const } : {}) },
  ownerId: "bot", current: false, locale: "en",
  onSelect: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
});

describe("the sidebar row of a confidential thread", () => {
  it("shows the lock badge and says so in its tooltip", () => {
    act(() => root.render(row(true)));
    const badge = container.querySelector("[data-confidential-badge]");
    expect(badge?.textContent).toBe("Confidential");
    expect(badge?.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(container.querySelector('[data-sidebar-thread-row="t1"]')!.getAttribute("title")).toContain("Confidential");
  });

  it("an ordinary row has no badge", () => {
    act(() => root.render(row(false)));
    expect(container.querySelector("[data-confidential-badge]")).toBeNull();
  });
});

describe("Settings > Organisation: new threads confidential by default", () => {
  it("saves the switch with the setting's name", async () => {
    fixture.api.mockResolvedValue({ settings: { confidentialThreadsByDefault: true } });
    act(() => root.render(createElement(OrgConfidentialThreadsDefault, { initial: false })));
    expect(container.querySelector("[data-org-confidential-default]")!.getAttribute("data-org-confidential-default")).toBe("off");
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); });
    expect(fixture.api).toHaveBeenCalledWith("/api/org/settings", { method: "PATCH", body: JSON.stringify({ confidentialThreadsByDefault: true }) });
    expect(container.querySelector("[data-org-confidential-default]")!.getAttribute("data-org-confidential-default")).toBe("on");
  });
});
