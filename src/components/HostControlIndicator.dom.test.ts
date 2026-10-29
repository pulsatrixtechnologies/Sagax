// @vitest-environment happy-dom
// A bot controlling this computer's own screen (2026-10-28): the banner names
// it, Stop is the ordinary task stop, and a server that never drives its own
// screen (or a member) is not asked again. The activity line reads in the
// person's language.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { HostControlIndicator, hostControlText } from "./HostControlIndicator";
import { HOST_CONTROL_NOTICE } from "../../shared/host-control";
import { isTechnicalNoticeName } from "../../shared/chat-notices";

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
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("this computer's banner", () => {
  it("names the bot, never its id, and Stop stops its task", async () => {
    let bots = [{ id: "bot-1", name: "Nova", threadId: "thread-1" }];
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/bots/bot-1/interrupt") { bots = []; return {}; }
      return { bots };
    });
    act(() => root.render(createElement(HostControlIndicator)));
    await flush();
    const banner = container.querySelector("[data-host-control-indicator]");
    expect(banner?.textContent).toContain("Nova is controlling this computer");
    expect(banner?.textContent).not.toContain("bot-1");
    expect(fixture.api).toHaveBeenCalledWith("/api/computer/host-control", expect.anything());
    await act(async () => { (banner!.querySelector("button") as HTMLButtonElement).click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/bot-1/interrupt", expect.objectContaining({ method: "POST", body: JSON.stringify({ threadId: "thread-1" }) }));
    expect(container.querySelector("[data-host-control-indicator]")).toBeNull();
  });

  it("shows nothing when no bot holds the screen", async () => {
    fixture.api.mockResolvedValue({ bots: [] });
    act(() => root.render(createElement(HostControlIndicator)));
    await flush();
    expect(container.querySelector("[data-host-control-indicator]")).toBeNull();
  });

  it("stops asking a server that never drives its own screen", async () => {
    vi.useFakeTimers();
    try {
      fixture.api.mockRejectedValue(Object.assign(new Error("never"), { status: 404 }));
      act(() => root.render(createElement(HostControlIndicator)));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(fixture.api).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("keeps the conversation's line and words the banner per bot", () => {
    expect(isTechnicalNoticeName(HOST_CONTROL_NOTICE)).toBe(false);
    expect(hostControlText([{ name: "Nova" }, { name: "Orion" }])).toBe("Nova is controlling this computer · Orion is controlling this computer");
  });
});
