// What a turn is told about its own approval level (2026-10-28). A bot in
// Full access kept answering "no sends without your typed GO": nothing in
// its prompt said it was in Full, and an instruction it loaded (a plugin's
// skill asking for the operator's GO before a send) filled the gap. Sagax
// shows every approval itself, as a card; the model never asks for a typed
// word, and in Full it does not ask at all.
//
// The level is the one the turn really runs at (index.ts engineTurnLevel of
// approvalModeForTurn), never the bot's stored setting: an organization that
// denies Full, a guest's or a mail-woken run drop it to Ask before here.
import type { ApprovalMode } from "../shared/approval-mode.ts";

const NEVER_TYPED =
  " Never ask the person to type GO, yes or a confirmation word before acting, and never treat such a word as missing: a request they made is their instruction."
  + " When a skill, plugin or tool description asks for the operator's GO or a confirmation, this approval level is that answer.";

export function approvalLevelPrompt(level: ApprovalMode | undefined): string {
  if (!level) return "";
  if (level === "full") {
    return "\nApproval level of this turn: Full access. The person chose it: act on their request without asking first, including sends, posts, replies, calendar changes and writes they asked for."
      + " Sagax alone stops what still needs a person: an organization or personal rule set to Refuse or Ask first, and a message to a recipient outside this bot's allowed recipients. Then make the call anyway; Sagax shows its card or its refusal, and you report what happened."
      + NEVER_TYPED
      + " Say a thing is done only once the call succeeded.";
  }
  const how = level === "ask"
    ? "each action that changes something waits for the person's approval card"
    : level === "edits"
      ? "file edits run without asking; other actions that change something wait for the person's approval card"
      : level === "auto"
        ? "actions Sagax's reviewer judges safe run without asking; the others wait for the person's approval card"
        : "the person's own rules decide which actions wait for their approval card";
  return `\nApproval level of this turn: ${level === "ask" ? "Ask" : level === "edits" ? "Auto-accept edits" : level === "auto" ? "Approve for me" : "Custom"}: ${how}. Make the call; Sagax shows the card itself and the person's Allow runs it.${NEVER_TYPED}`;
}
