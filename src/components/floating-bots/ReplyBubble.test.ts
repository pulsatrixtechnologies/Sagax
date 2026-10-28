import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPLY_FADE_MAX, REPLY_FADE_MIN, ReplyBubble, ReplyPill, replyFadeDelay, usesReplyBubble } from "./ReplyBubble";
import type { FloatingBalloon } from "./protocol";

const reply = (over: Partial<FloatingBalloon> = {}): FloatingBalloon => ({
  kind: "chat",
  text: "Bonjour **Owner**",
  streaming: false,
  truncated: false,
  open: "Ouvrir dans Sagax",
  close: "Fermer",
  asked: "Salut?",
  input: { label: "Message", placeholder: "Répondre…", send: "Envoyer" },
  ...over,
});
const noop = () => {};

describe("the mascot's reply, drawn like voice mode", () => {
  it("replaces the balloon for replies, thinking and errors, not for Trombi nor approvals", () => {
    expect(usesReplyBubble(reply(), false)).toBe(true);
    expect(usesReplyBubble(reply({ kind: "thinking" }), false)).toBe(true);
    expect(usesReplyBubble(reply({ kind: "error" }), false)).toBe(true);
    expect(usesReplyBubble(reply({ kind: "approval" }), false)).toBe(false);
    expect(usesReplyBubble(reply(), true)).toBe(false);
    expect(usesReplyBubble(null, false)).toBe(false);
  });

  it("fades a finished reply after a reading delay, never while it streams or thinks", () => {
    expect(replyFadeDelay(reply({ streaming: true }))).toBeNull();
    expect(replyFadeDelay(reply({ kind: "thinking" }))).toBeNull();
    expect(replyFadeDelay(reply({ text: "  " }))).toBeNull();
    const short = replyFadeDelay(reply({ text: "Ok" }))!;
    const long = replyFadeDelay(reply({ text: "mot ".repeat(60) }))!;
    expect(short).toBeGreaterThanOrEqual(REPLY_FADE_MIN);
    expect(long).toBeGreaterThan(short);
    expect(replyFadeDelay(reply({ text: "x".repeat(10_000) }))).toBe(REPLY_FADE_MAX);
  });

  it("draws a speech bubble, no modal: no dialog, title bar nor grip", () => {
    const html = renderToStaticMarkup(createElement(ReplyBubble, { name: "Pulsabot", balloon: reply(), onEvent: noop, hover: noop, below: false, held: false }));
    expect(html).toContain("data-reply-bubble");
    expect(html).toContain("fb-reply-tail");
    expect(html).toContain("<strong>Owner</strong>");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("fb-grip");
    expect(html).not.toContain("fb-head");
  });

  it("marks a faded bubble hidden", () => {
    const html = renderToStaticMarkup(createElement(ReplyBubble, { name: "Pulsabot", balloon: reply(), onEvent: noop, hover: noop, below: false, held: false, faded: true }));
    expect(html).toContain("data-faded");
    expect(html).toContain('aria-hidden="true"');
  });

  it("puts the input in a floating pill with 'Ouvrir dans Sagax' as an icon", () => {
    const html = renderToStaticMarkup(createElement(ReplyPill, { balloon: reply(), onEvent: noop, hover: noop, callLabel: "Appeler" }));
    expect(html).toContain("data-reply-pill");
    expect(html).toMatch(/data-reply-open=""[^>]*>|aria-label="Ouvrir dans Sagax"/);
    expect(html).toContain('title="Ouvrir dans Sagax"');
    expect(html).not.toContain(">Ouvrir dans Sagax<");
    expect(html).toContain('placeholder="Répondre…"');
    expect(html).toContain('aria-label="Appeler"');
  });
});
