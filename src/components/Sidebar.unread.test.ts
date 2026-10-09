// An unread row reads like Messages or Slack: the name goes bold and the
// preview takes the primary text colour. No dot; the row keeps an
// accessible "Unread" label for screen readers.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as { bots?: Bot[]; groups?: Group[]; sections?: string[] } }));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => {
      const store = original.useStore();
      return { ...store, state: { ...store.state, ...fixture.state } };
    },
  };
});

import { StoreProvider } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});

const room = (id: string, extra: Partial<Group> = {}): Group => ({
  id, threadId: `t-${id}`, name: id, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [], ...extra,
});

const render = () => renderToStaticMarkup(
  createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
});

describe("sidebar unread rows", () => {
  it("bolds an unread bot, keeps the Unread label, and draws no dot", () => {
    fixture.state = { bots: [bot("quiet"), bot("loud", { unread: true })], groups: [], sections: [] };
    const html = render();
    expect(html).not.toContain("bg-unread");
    expect(html.match(/sr-only[^>]*>Unread threads</g)).toHaveLength(1);
    expect(html).toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*loud</);
    expect(html).not.toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*quiet</);
  });

  it("bolds an unread room and draws no dot", () => {
    fixture.state = { bots: [], groups: [room("read-room"), room("new-room", { unread: true })], sections: [] };
    const html = render();
    expect(html).not.toContain("bg-unread");
    expect(html.match(/sr-only[^>]*>Unread threads</g)).toHaveLength(1);
    expect(html).toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*new-room</);
    expect(html).not.toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*read-room</);
  });
});
