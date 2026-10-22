// The bot's own email address on its profile (B21, contract C of
// 2026-10-21): the address with a Copy button, the one-line rule, the
// admin's off state, and nothing at all when no address is available.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { botInboundMailFrom } from "@/lib/bot-inbound-mail";
import { BotEmailAddressCard } from "./BotEmailAddress";

const render = (mail: Parameters<typeof BotEmailAddressCard>[0]["mail"]) => renderToStaticMarkup(createElement(BotEmailAddressCard, { mail }));

describe("Bot email address", () => {
  it("shows the address, a Copy button and the rule", () => {
    const html = render({ available: true, address: "cryptic@bots.example.org", enabled: true });
    expect(html).toContain("Email address");
    expect(html).toContain("cryptic@bots.example.org");
    expect(html).toContain('aria-label="Copy email address"');
    expect(html).toContain("Mail received at this address only wakes a routine (Bot email trigger).");
    expect(html).not.toContain("Turned off by the administrator");
    expect(html).toContain('data-bot-email-address=""');
  });

  it("says when the administrator turned it off", () => {
    const html = render({ available: true, address: "ember@bots.example.org", enabled: false });
    expect(html).toContain("ember@bots.example.org");
    expect(html).toContain("Turned off by the administrator");
  });

  it("renders nothing when unavailable, loading or empty", () => {
    expect(render({ available: false, address: null, enabled: false })).toBe("");
    expect(render(null)).toBe("");
    expect(render({ available: true, address: null, enabled: true })).toBe("");
  });

  it("reads only the contract's answer", () => {
    expect(botInboundMailFrom({ available: true, address: "a@b.example", enabled: true })).toEqual({ available: true, address: "a@b.example", enabled: true });
    expect(botInboundMailFrom({ available: true, address: "a@b.example", enabled: false })).toEqual({ available: true, address: "a@b.example", enabled: false });
    for (const bad of [null, undefined, "x", [], { available: "true", address: "a@b.example", enabled: true }, { available: true, address: 7, enabled: true }, { available: true, address: "not an address", enabled: true }, { available: false, address: "a@b.example", enabled: true }]) {
      expect(botInboundMailFrom(bad), JSON.stringify(bad)).toEqual({ available: false, address: null, enabled: false });
    }
  });
});
