// A page in its own system window (src/lib/page-windows.ts): the desktop
// bridge is asked once per Open with the page's window id, never a window
// drawn inside the app; a browser gets a new tab on the same address.
import { afterEach, describe, expect, it, vi } from "vitest";

import { openPageInOwnWindow, pageIdOfWindow, pageWindowId } from "./page-windows";
import { isPageWindowId } from "@/components/artifacts/artifact-windows";

const page = { id: "abcdefgh12345678", botId: "bot1", title: "Bilan" };
const globals = globalThis as unknown as { window?: unknown };
afterEach(() => { delete globals.window; });

describe("page windows", () => {
  it("names a page's window so the artifact windows leave it alone", () => {
    expect(pageWindowId(page.id)).toBe("page:abcdefgh12345678");
    expect(isPageWindowId(pageWindowId(page.id))).toBe(true);
    expect(pageIdOfWindow("page:abcdefgh12345678")).toBe(page.id);
    expect(pageIdOfWindow("page:../x")).toBeNull();
    expect(pageIdOfWindow("art_1")).toBeNull();
  });

  it("desktop: Open asks the system window once with the page's id; asking again goes to the same id (one window per page)", async () => {
    const open = vi.fn(async () => "created" as const);
    globals.window = { ogb: { artifactWindow: { open } }, open: vi.fn() };
    expect(await openPageInOwnWindow(page)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ botId: "bot1", artifactId: "page:abcdefgh12345678", title: "Bilan" });
    open.mockResolvedValueOnce("focused" as never);
    expect(await openPageInOwnWindow(page)).toBe(true);
    expect(open.mock.calls.map((call) => (call as unknown as [{ artifactId: string }])[0].artifactId)).toEqual(["page:abcdefgh12345678", "page:abcdefgh12345678"]);
    expect((globals.window as { open: ReturnType<typeof vi.fn> }).open).not.toHaveBeenCalled();
  });

  it("a refusal is said as one", async () => {
    globals.window = { ogb: { artifactWindow: { open: async () => "refused" } } };
    expect(await openPageInOwnWindow(page)).toBe(false);
  });

  it("browser: a new tab on the window's address, never an inner panel", async () => {
    const open = vi.fn();
    globals.window = { open };
    expect(await openPageInOwnWindow(page)).toBe(true);
    expect(open).toHaveBeenCalledWith("/artifact-window#bot=bot1&artifact=page%3Aabcdefgh12345678", "_blank", "noopener");
  });

  it("no page is drawn in a window inside the app any more", async () => {
    const viewer = await import("@/components/PageViewer");
    expect("PageViewerDialog" in viewer).toBe(false);
  });
});
