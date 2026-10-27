// The entry point other inbound routes call for "Me joindre" replies
// (2026-10-26). A text on the person's Perspicax Voice line reaches Sagax at
// POST /api/org/telephony/inbound (PR #1134, event `sms`); that route calls
// `reachMeSmsReply` with the line owner (the assertion's `sub`, already
// matched to the bot's owner there), the sender's number and the text,
// BEFORE it hands the text to the bot's phone triggers:
//
//   const reply = await reachMeSmsReply({ ownerPrincipalId, from, text });
//   if (reply.handled) return 202 { event, notice: false, reachMe: reply.outcome, ... }
//   // else: the triggers, as before
//
// `handled: false` means the text is not a reply to a card (no open code of
// that person, or not from the number that code went to): nothing changed.
import type { ReachReplyResult } from "./service.ts";

export interface ReachSmsInbound {
  /** The line owner's principal id on this server. */
  ownerPrincipalId: string;
  /** E.164, as Perspicax gives it. */
  from: string;
  /** The text, untrusted. */
  text: string;
}

type Handler = (input: ReachSmsInbound) => Promise<ReachReplyResult>;
let handler: Handler | null = null;

/** server/index.ts sets it once the reach-me service exists. */
export function setReachMeSmsHandler(next: Handler | null): void {
  handler = next;
}

/** A text on the person's line that may answer a card. Never throws. */
export async function reachMeSmsReply(input: ReachSmsInbound): Promise<ReachReplyResult> {
  if (!handler) return { handled: false, outcome: "no_code" };
  try {
    return await handler(input);
  } catch {
    return { handled: false, outcome: "no_code" };
  }
}
