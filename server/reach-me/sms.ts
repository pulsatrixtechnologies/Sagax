// "Me joindre" by text message, through Perspicax Voice (2026-10-26):
// the person's own line (one number per person) texts the person's own
// number. Sagax never talks to Twilio.
//
// - Out: `voice_line` first (a read): the line must serve now and the
//   number the person typed in their setting must be one of the line's
//   VERIFIED callers (Perspicax shows them masked, ***1234; the number is
//   verified there by a texted code). Then `voice_sms { to, body }`. Both
//   through the Perspicax MCP with the person's own access (deps.voice),
//   never another person's.
// - Back: the person texts their line; Perspicax posts the text to Sagax
//   (POST /api/org/telephony/inbound, event `sms`, PR #1134) and that route
//   calls `reachMeSmsReply` (./inbound.ts) before any trigger: a text that
//   starts with an open code of the line's owner, from the number that code
//   went to, answers the card; anything else goes on to the bot's phone
//   triggers as before.
// - A text costs money: nothing here retries a send, and no reply gets an
//   answer by text.
import { maskNumber } from "../../shared/reach-me.ts";
import { composeReachText, type ReachChannel, type ReachOutbound, type ReachSendResult } from "./channel.ts";
import type { ReachMeStore } from "./store.ts";

export type VoiceAnswer = { ok: true; value: unknown } | { ok: false; error: string };

export interface ReachSmsDeps {
  settings: ReachMeStore;
  /** Perspicax is linked and the person has a Perspicax identity. */
  linked(person: string): boolean;
  /** One Perspicax Voice tool, with the person's own access. */
  voice(person: string, botId: string, tool: "voice_line" | "voice_sms", args: Record<string, unknown>): Promise<VoiceAnswer>;
}

interface LineView {
  active?: unknown;
  inactive_reason?: unknown;
  callers?: unknown;
}

/** Whether the line lists this number as one of the person's verified ones. */
export function lineVerifies(line: LineView | null | undefined, number: string): boolean {
  if (!line || !Array.isArray(line.callers)) return false;
  const masked = maskNumber(number);
  return line.callers.some((caller) => Boolean(caller) && typeof caller === "object"
    && (caller as { verified?: unknown }).verified === true
    && (caller as { number?: unknown }).number === masked);
}

export function createSmsChannel(deps: ReachSmsDeps): ReachChannel {
  return {
    id: "sms",
    status(person, botId) {
      if (!deps.linked(person)) return { ready: false, reason: "Text messages go through Perspicax Voice: this server is not linked to Perspicax." };
      if (!deps.settings.effective(person, botId).smsNumber) return { ready: false, reason: "Add your own phone number." };
      return { ready: true };
    },
    async send(out: ReachOutbound): Promise<ReachSendResult> {
      const number = deps.settings.effective(out.person, out.botId).smsNumber;
      if (!number) return { ok: false, reason: "no phone number" };
      const line = await deps.voice(out.person, out.botId, "voice_line", {});
      if (!line.ok) return { ok: false, reason: `Perspicax Voice unavailable (${line.error.slice(0, 120)})` };
      const view = (line.value && typeof line.value === "object" ? (line.value as { line?: LineView | null }).line : null) ?? null;
      if (!view) return { ok: false, reason: "no Perspicax Voice line yet" };
      if (view.active !== true) return { ok: false, reason: `the line does not serve now (${typeof view.inactive_reason === "string" ? view.inactive_reason : "inactive"})` };
      if (!lineVerifies(view, number)) return { ok: false, reason: `${maskNumber(number)} is not one of the line's verified numbers` };
      const sent = await deps.voice(out.person, out.botId, "voice_sms", { to: number, body: composeReachText(out) });
      if (!sent.ok) return { ok: false, reason: sent.error.slice(0, 160) };
      const value = sent.value as { sent?: unknown } | null;
      return value && value.sent === true ? { ok: true } : { ok: false, reason: "Perspicax did not send it" };
    },
  };
}
