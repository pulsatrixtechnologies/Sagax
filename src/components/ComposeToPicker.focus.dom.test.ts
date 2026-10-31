// @vitest-environment happy-dom
// Creating a group: after each bot or person selection the search field
// keeps focus so the next name can be typed without a click (#1797).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  bots: [] as Bot[],
  people: new Map<string, { principalId: string; name: string; login: string; role: string; disabled: boolean }>(),
}));

vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragStyle: undefined, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  useOrgPeople: () => fixture.people,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots, botCreationPending: false, config: null },
      dispatch: fixture.dispatch,
    }),
  };
});

import { ComposeToPicker } from "./ComposeToPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bot(id: string, name: string): Bot {
  return {
    id, threadId: id, name, title: "", description: "", notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "fake", model: "test" }, messages: [],
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fixture.dispatch.mockReset();
  fixture.bots = [bot("aurora", "Aurora"), bot("vega", "Vega")];
  fixture.people = new Map([
    ["pr_bob", { principalId: "pr_bob", name: "Bob", login: "bob", role: "member", disabled: false }],
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount() {
  act(() => root.render(createElement(ComposeToPicker, { onClose: vi.fn(), startInGroup: true })));
}

const search = () => host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const botRow = (id: string) => host.querySelector<HTMLButtonElement>(`[data-compose-bot="${id}"]`)!;
const personRow = (id: string) => host.querySelector<HTMLButtonElement>(`[data-compose-person="${id}"]`)!;

function pick(row: HTMLButtonElement) {
  act(() => {
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    row.click();
  });
}

describe("ComposeToPicker group search focus (#1797)", () => {
  it("keeps focus on the search field after selecting a bot", () => {
    mount();
    search().focus();
    expect(document.activeElement).toBe(search());
    pick(botRow("aurora"));
    expect(host.textContent).toContain("Aurora");
    expect(document.activeElement).toBe(search());
    pick(botRow("vega"));
    expect(document.activeElement).toBe(search());
  });

  it("keeps focus on the search field after selecting a person", () => {
    mount();
    search().focus();
    pick(personRow("pr_bob"));
    expect(host.querySelector('[aria-label*="Bob"]')).toBeTruthy();
    expect(document.activeElement).toBe(search());
  });
});
