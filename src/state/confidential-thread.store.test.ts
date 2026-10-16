// @vitest-environment happy-dom
// The store's confidential thread requests (src/lib/confidential-thread.ts):
// a new thread sends the kind the person picked (nothing when they picked
// the plain item, so the organization's default applies), and making one
// confidential sends the confirmation. Nothing ever sends it back off.
import { createElement, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, StoreProvider, useStore, type Action, type AppState, type Bot } from "./store";

const profile = (): Bot => ({
  id: "B", name: "B", threadId: "B-1", title: "", description: "", color: "green", unread: false, notifications: true,
  messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "B-1", title: "Existing", createdAt: 1 }],
});
class OfflineEvents { onopen = null; onerror = null; onmessage = null; close() {} }

const original = { bots: initialState.bots, selectedId: initialState.selectedId, activeView: initialState.activeView };
let host: HTMLDivElement;
let root: Root;
let seen: AppState;
let dispatch: Dispatch<Action>;
let requests: ReturnType<typeof vi.fn<typeof fetch>>;
function Probe() {
  const store = useStore();
  seen = store.state;
  dispatch = store.dispatch;
  return null;
}
const bodyOf = (path: string, method: string) => {
  const call = requests.mock.calls.find(([url, init]) => url === path && (init?.method ?? "GET") === method);
  return call ? JSON.parse(String(call[1]!.body)) as Record<string, unknown> : undefined;
};

beforeEach(() => {
  Object.assign(initialState, { bots: [profile()], selectedId: "B", activeView: "chat" });
  requests = vi.fn<typeof fetch>((path, init) => {
    if (path === "/api/bots/B/tasks/B-1" && init?.method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ task: { threadId: "B-1", title: "Existing", createdAt: 1, confidential: true } }), { status: 200 }));
    }
    return new Promise(() => {});
  });
  vi.stubGlobal("fetch", requests);
  vi.stubGlobal("EventSource", OfflineEvents);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  Object.assign(initialState, original);
  vi.unstubAllGlobals();
});

describe("confidential threads in the store", () => {
  it("a new confidential thread says so", async () => {
    flushSync(() => dispatch({ type: "newTask", botId: "B", confidential: true }));
    await vi.waitFor(() => expect(bodyOf("/api/bots/B/tasks", "POST")).toEqual({ confidential: true }));
  });

  it("an explicit ordinary thread says so, and the plain item leaves it to the default", async () => {
    flushSync(() => dispatch({ type: "newTask", botId: "B", confidential: false }));
    await vi.waitFor(() => expect(bodyOf("/api/bots/B/tasks", "POST")).toEqual({ confidential: false }));
    requests.mockClear();
    flushSync(() => dispatch({ type: "newTask", botId: "B" }));
    await vi.waitFor(() => expect(bodyOf("/api/bots/B/tasks", "POST")).toEqual({}));
  });

  it("making a thread confidential sends the confirmation and marks it", async () => {
    const done = vi.fn();
    flushSync(() => dispatch({ type: "makeTaskConfidential", botId: "B", threadId: "B-1", onDone: done }));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(bodyOf("/api/bots/B/tasks/B-1", "PATCH")).toEqual({ confidential: true, confirmConfidential: true });
    expect(seen.bots[0]!.tasks![0]!.confidential).toBe(true);
  });
});
