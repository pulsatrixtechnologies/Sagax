// "Me joindre" on the bot's Overview (2026-10-26): each channel with its
// switch, the number field for a text, Telegram's link step, the hours.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { reachMeFrom } from "@/lib/reach-me";
import { BotReachMeCard, type ReachMeActions } from "./BotReachMe";

const actions: ReachMeActions = { onSave: async () => ({ ok: true }), onTelegramConnect: async () => ({ ok: true }), onTelegramDisconnect: async () => {} };
const render = (response: unknown) => renderToStaticMarkup(createElement(BotReachMeCard, { view: reachMeFrom(response), actions }));

describe("Reach me card", () => {
  it("lists every channel, push on by default, WhatsApp later", () => {
    const html = render({ saved: false, settings: { channels: ["push"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 } } });
    expect(html).toContain("Reach me");
    for (const id of ["push", "sms", "teams", "telegram", "whatsapp"]) expect(html).toContain(`data-reach-channel="${id}"`);
    expect(html).toContain("On your 2 paired phones");
    expect(html).toMatch(/data-reach-channel="whatsapp"[\s\S]*Coming later/);
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
