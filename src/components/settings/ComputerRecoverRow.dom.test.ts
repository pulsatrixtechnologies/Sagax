// @vitest-environment happy-dom
// Parity R7 (system 6): Settings > Computer offers Recover for a stuck
// computer (Update now otherwise), asks first, then rebuilds it with the
// same route the phone uses (POST /api/computer/update, files kept).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) { super(message); }
  }
  return { api: fixture.api, ApiError };
});

import { ComputerRecoverRow } from "./ComputerRecoverRow";

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

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("ComputerRecoverRow", () => {
  it("recovers a stuck computer after the person confirms", async () => {
    fixture.api.mockResolvedValue({ configured: true, state: "running" });
    const confirm = vi.fn().mockResolvedValue(true);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "unavailable", problem: "unreachable" }, confirm })));
    expect(container.querySelector("[data-computer-action]")?.getAttribute("data-computer-action")).toBe("recover");
    expect(container.textContent).toContain("Recover");
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fixture.api).toHaveBeenCalledWith("/api/computer/update", { method: "POST", body: "{}" });
    // back to healthy: the row now offers Update now
    expect(container.querySelector("[data-computer-action]")?.getAttribute("data-computer-action")).toBe("update");
  });

  it("does nothing when the person says no", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "running" }, confirm })));
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("offers nothing for a computer that sleeps on purpose", async () => {
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "stopped" } })));
    expect(container.innerHTML).toBe("");
  });

  it("says why an update is refused: a bot works, or one already runs", async () => {
    const { ApiError } = await import("@/state/store") as unknown as { ApiError: new (m: string, s: number, b: Record<string, unknown>) => Error };
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/computer/update") throw new ApiError("busy", 409, { code: "computer_busy", error: "A bot is working" });
      return { configured: true, state: "running" };
    });
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "running" }, confirm: async () => true })));
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(container.querySelector("[role=alert]")?.textContent).toMatch(/bot is working/i);
  });

  it("shows nothing where there is no computer to care for", async () => {
    fixture.api.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    await act(async () => root.render(createElement(ComputerRecoverRow, {})));
    await flush();
    expect(container.innerHTML).toBe("");
  });
});
