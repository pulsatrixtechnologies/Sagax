// @vitest-environment happy-dom
// 2026-10-28: a newer app against an older server. The server without the
// task list route answers "no route" (404), or refuses a member's session on
// the admin scope (403). The panel says the list comes with the server
// update, never the red error. The background brief does the same.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { BackgroundBriefCard } from "./BackgroundBriefCard";
import { BotTaskSection } from "./BotTaskSection";

let host: HTMLDivElement;
let root: Root;

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("bot task list against an older server", () => {
  it("says the list comes with the server update on the older server's 404", async () => {
    vi.stubGlobal("fetch", answer(404, { error: "no route: GET /api/bots/bot-1/task-list" }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-tasks-needs-update]")?.textContent).toBe("Available after the server update.");
    expect(host.textContent).not.toContain("The task list could not be loaded.");
    expect(host.querySelector(".text-danger")).toBeNull();
  });

  it("says the same for a member's session the older server refuses on the admin scope", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "forbidden: this session lacks the admin scope" }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.querySelector("[data-bot-tasks-needs-update]")).not.toBeNull();
    expect(host.querySelector(".text-danger")).toBeNull();
  });

  it("shows an empty list on the current server, and keeps the error for a real failure", async () => {
    vi.stubGlobal("fetch", answer(200, { tasks: [] }));
    await mount(createElement(BotTaskSection, { botId: "bot-1" }));
    expect(host.textContent).toContain("No tasks.");
    expect(host.querySelector(".text-danger")).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    vi.stubGlobal("fetch", answer(500, { error: "boom" }));
    await mount(createElement(BotTaskSection, { botId: "bot-2" }));
    expect(host.querySelector(".text-danger")?.textContent).toBe("The task list could not be loaded.");
  });
});

describe("background brief against an older server", () => {
  it("says the brief comes with the server update, with no error line", async () => {
    vi.stubGlobal("fetch", answer(404, { error: "no route: GET /api/bots/bot-1/background-brief" }));
    await mount(createElement(BackgroundBriefCard, { botId: "bot-1" }));
    expect(host.querySelector("[data-brief-needs-update]")?.textContent).toBe("Available after the server update.");
    expect(host.querySelector("[role=alert]")).toBeNull();
  });
});
