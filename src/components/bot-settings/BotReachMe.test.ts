// "Me joindre" on the bot's Overview (2026-10-26): each channel with its
// switch, the number field for a text, Telegram's link step, WhatsApp's
// setup, the hours.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { reachMeFrom } from "@/lib/reach-me";
import { BotReachMeCard, type ReachMeActions } from "./BotReachMe";

const actions: ReachMeActions = { onSave: async () => ({ ok: true }), onTelegramConnect: async () => ({ ok: true }), onTelegramDisconnect: async () => {} };
const render = (response: unknown) => renderToStaticMarkup(createElement(BotReachMeCard, { view: reachMeFrom(response), actions }));

describe("Reach me card", () => {
  it("lists every channel, push on by default", () => {
    const html = render({ saved: false, settings: { channels: ["push"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 } } });
    expect(html).toContain("Reach me");
    for (const id of ["push", "sms", "teams", "telegram", "whatsapp"]) expect(html).toContain(`data-reach-channel="${id}"`);
    expect(html).toContain("On your 2 paired phones");
    expect(html).toMatch(/data-reach-channel="whatsapp"[\s\S]*your own WhatsApp Business number/);
    expect(html).not.toContain("Coming later");
    expect(html).toContain("Any time.");
  });
  it("a text shows the person's own number; a channel not ready says why", () => {
    const html = render({ saved: true, settings: { channels: ["sms", "teams"], smsNumber: "+15145550123", hours: { always: true } }, channels: { sms: { ready: false, reason: "no line" }, teams: { ready: true } } });
    expect(html).toContain('value="+15145550123"');
    expect(html).toContain("Needs your Perspicax Voice line");
  });
  it("Telegram: the token field, then the bot's name once connected, never an id", () => {
    expect(render({ saved: true, settings: { channels: ["telegram"], hours: { always: true } }, channels: { telegram: { ready: false } } })).toContain('type="password"');
    const done = render({ saved: true, settings: { channels: ["telegram"], hours: { always: true } }, channels: { telegram: { ready: true, connected: true, username: "my_sagax_bot" } } });
    expect(done).toContain("@my_sagax_bot connected.");
  });
  it("WhatsApp: the person's own Meta app fields, then the code step, then their masked number; never a token or an id", () => {
    const fresh = render({ saved: true, settings: { channels: ["whatsapp"], hours: { always: true } }, channels: { whatsapp: { ready: false, webhookPublic: true } } });
    expect(fresh).toContain("data-reach-whatsapp-connect");
    expect((fresh.match(/type="password"/g) ?? []).length).toBe(2);
    expect(fresh).toContain("Phone Number ID");
    const linking = render({ saved: true, settings: { channels: ["whatsapp"], hours: { always: true } }, channels: { whatsapp: {
      ready: false, linking: true, displayNumber: "+1 555-010-0000", verifiedName: "Example Shop", linkUrl: "https://wa.me/15550100000?text=SAGAX%20K7Q2WX", linkCode: "K7Q2WX",
      webhookUrl: "https://bots.example.test/reach-me/whatsapp/rmwa_abcdefghijklmnopqrstuvwx", verifyToken: "verify-token-fixture", webhookPublic: true, replies: true, hasAppSecret: true,
    } } });
    expect(linking).toContain("Example Shop (+1 555-010-0000)");
    expect(linking).toContain("SAGAX K7Q2WX");
    expect(linking).toContain('href="https://wa.me/15550100000?text=SAGAX%20K7Q2WX"');
    // the webhook address and verify token are behind Copy, never shown
    expect(linking).toContain('data-reach-whatsapp-copy="url"');
    expect(linking).not.toContain("rmwa_abcdefghijklmnopqrstuvwx");
    expect(linking).not.toContain("verify-token-fixture");
    const done = render({ saved: true, settings: { channels: ["whatsapp"], hours: { always: true } }, channels: { whatsapp: {
      ready: true, connected: true, displayNumber: "+1 555-010-0000", number: "***0123", templateName: "sagax_card", templateLanguage: "fr", webhookPublic: false, hasAppSecret: true,
    } } });
    expect(done).toContain("+1 555-010-0000 writes to your number ***0123.");
    expect(done).toContain('value="sagax_card"');
    expect(done).toContain("no public address for WhatsApp");
    expect(done).not.toContain("data-reach-not-ready");
  });
  it("hours: the zone and each range's days and times", () => {
    const html = render({ saved: true, settings: { channels: ["push"], hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] } }, channels: {} });
    expect(html).toContain('value="America/Toronto"');
    expect(html).toContain('value="08:00"');
    expect(html).toContain('value="18:00"');
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(5);
  });
  it("renders nothing while loading or on a bad answer", () => {
    expect(render(null)).toBe("");
    expect(render({ nope: true })).toBe("");
  });
});
