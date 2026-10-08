import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type Group, type Message } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));

import { Transcript } from "./GroupView";

const ADA = "pr_ada";
const BEN = "pr_ben";
const VIEWER = "pr_viewer";
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch", memberIds: ["cryptic"], humanIds: [ADA, BEN, VIEWER],
  defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, setupCompletedAt: 1, messages: [],
};
const cryptic = { id: "cryptic", name: "Cryptic", color: "green", threadId: "c-thread", messages: [] } as unknown as Bot;
const line = (id: string, at: number, patch: Partial<Message>): Message => ({ id, at, role: "user", kind: "text", text: id, ...patch });
const messages: Message[] = [
  line("mine", 1_000, {}),
  line("ada-says", 2_000, { sender: { id: ADA, name: "Ada" } }),
  line("bot-says", 3_000, { role: "bot", from: { botId: "cryptic", name: "Cryptic", color: "green" } }),
];

const render = (reads: Record<string, { messageId: string; at: number }>) => {
  vi.stubGlobal("window", { ogb: undefined });
  try {
    return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Transcript, {
      group: room, members: [cryptic], locale: "en", messages, transcript: messages, onReply: () => {},
      people: new Map(), reads, reader: VIEWER,
    })));
  } finally {
    vi.unstubAllGlobals();
  }
};
const rowAfter = (markup: string, messageId: string) => {
  const at = markup.indexOf(`data-mid="${messageId}"`);
  const next = markup.indexOf("data-mid=", at + 1);
  return markup.slice(at, next === -1 ? undefined : next);
};

describe("Transcript: seen by", () => {
  it("puts each reader under the last line they read, stacked, never the viewer", () => {
    const markup = render({
      [ADA]: { messageId: "bot-says", at: 3_500 },
      [BEN]: { messageId: "bot-says", at: 3_600 },
      "bot:cryptic": { messageId: "ada-says", at: 2_100 },
      [VIEWER]: { messageId: "bot-says", at: 3_700 },
    });
    expect(markup.match(/data-testid="seen-by"/g)).toHaveLength(2);
    const last = rowAfter(markup, "bot-says");
    expect(last).toContain(`data-seen-by="${ADA}"`);
    expect(last).toContain(`data-seen-by="${BEN}"`);
    expect(last.indexOf(ADA)).toBeLessThan(last.indexOf(BEN));
    expect(markup).not.toContain(`data-seen-by="${VIEWER}"`);
    // under someone else's line the row sits on their side
    expect(last).toMatch(/data-testid="seen-by" class="[^"]*justify-start/);
    // the bot read Ada's line: its row sits there
    expect(rowAfter(markup, "ada-says")).toContain('data-seen-by="bot:cryptic"');
    expect(rowAfter(markup, "mine")).not.toContain("seen-by");
  });

  it("sits under the viewer's own line on their side, with names in the tooltip", () => {
    const markup = render({ "bot:cryptic": { messageId: "mine", at: 1_100 } });
    const mine = rowAfter(markup, "mine");
    expect(mine).toMatch(/data-testid="seen-by" class="[^"]*justify-end/);
    expect(mine).toMatch(/title="Seen by Cryptic at [^"]+"/);
  });

  it("draws nothing without positions", () => {
    expect(render({})).not.toContain("seen-by");
  });
});
