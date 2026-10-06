import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { collapseBotExchanges } from "@/lib/bot-exchange";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { BotExchangeChip } from "./BotExchangeChip";

const NOTE = "[Message from @Cryptic, another bot in this Sagax workspace. Reply to them.]\n\nWhich database?";

beforeAll(() => {
  vi.stubGlobal("window", {});
  setLocale("en");
});
afterAll(() => vi.unstubAllGlobals());

function run() {
  const now = Date.now();
  const messages = [
    { id: "p", role: "user", kind: "text", text: NOTE, at: now, peerAsk: { botId: "cry", name: "Cryptic" } },
    { id: "r", role: "bot", kind: "text", text: "unRAID → Cryptic, pour info", at: now + 1000, requestMessageId: "p" },
  ] as Message[];
  const items = collapseBotExchanges(messages, {
    selfBotId: "un",
    self: { id: "un", name: "unRAID", color: "orange" },
  });
  const exchange = items.find((item) => item.kind === "exchange");
  if (!exchange || exchange.kind !== "exchange") throw new Error("expected a run");
  return exchange.run;
}

describe("BotExchangeChip", () => {
  it("draws a closed chip and hides the bot-to-bot bodies", () => {
    const markup = renderToStaticMarkup(createElement(BotExchangeChip, { run: run() }));
    expect(markup).toContain("Go to conversation");
    expect(markup).not.toContain("2 messages with");
    expect(markup).toContain("Cryptic");
    expect(markup).not.toContain("Which database?");
    expect(markup).not.toContain("pour info");
    expect(markup).not.toContain("bot-exchange-sheet");
    expect(markup).not.toContain("Close Chat");
  });

  it("goes to that bot's conversation instead of opening the sheet", () => {
    const onGo = vi.fn(() => true);
    let tree: ReactNode;
    function Capture() {
      tree = BotExchangeChip({ run: run(), onGo });
      return tree;
    }
    renderToStaticMarkup(createElement(Capture));
    const click = (node: ReactNode): boolean => {
      for (const child of Children.toArray(node)) {
        if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(child)) continue;
        if (typeof child.props.onClick === "function") {
          child.props.onClick();
          return true;
        }
        if (click(child.props.children)) return true;
      }
      return false;
    };
    expect(click(tree!)).toBe(true);
    expect(onGo).toHaveBeenCalledOnce();
  });

  it("opens the stored lines in the chat column, not over the viewport", () => {
    const markup = renderToStaticMarkup(createElement(BotExchangeChip, { run: run(), forceOpen: true }));
    expect(markup).toContain("bot-exchange-sheet");
    expect(markup).toContain('data-testid="bot-exchange-close"');
    expect(markup).toContain("Which database?");
    expect(markup).not.toContain("another bot in this Sagax");
    expect(markup).toContain("unRAID → Cryptic, pour info");
    expect(markup).toContain("Close Chat");
    expect(markup).toContain("Today");
    expect(markup).toContain(">unRAID<");
    expect(markup).toContain(">Cryptic<");
    expect(markup).toContain("absolute inset-0");
    expect(markup).not.toContain("fixed");
    expect(markup).not.toContain("document.body");
  });
});
