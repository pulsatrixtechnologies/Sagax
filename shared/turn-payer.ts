// Who pays for a shared bot's replies on an organization server (2026-10-26,
// issue #1137). Each bot carries the choice, and a group may override it for
// one of its bots:
//
//   - "owner": the bot's owner pays for everyone who writes to it. The
//     owner's engine, subscription, key or the local model of the owner's
//     computer serve the turn, so the person who writes needs none of them.
//   - "speaker": each person pays for their own messages (the rule since
//     2026-10-01). When the bot's engine cannot run for that person, the bot
//     answers with that person's default model (their first starred model
//     they can run).
//
// Default when the bot has no choice of its own: "owner" when the bot runs on
// a local model of its owner's computer, or on an engine its owner is signed
// in to with their own subscription; otherwise "speaker" (unchanged).
//
// Routines are not concerned: they always run on the owner's credentials.
// Who pays never changes who reads what: a private conversation stays its
// person's, and no credential of the owner's ever reaches the person who
// writes (the turn runs on the server; engine connectors of the owner's
// account are never mounted for someone else).

export type TurnPayerMode = "owner" | "speaker";

export const TURN_PAYER_MODES: readonly TurnPayerMode[] = ["owner", "speaker"];

export function isTurnPayerMode(value: unknown): value is TurnPayerMode {
  return value === "owner" || value === "speaker";
}

/** The facts the default reads. */
export interface TurnPayerDefaultFacts {
  /** The bot's model is a local model of its owner's computer. */
  ownerLocalModel: boolean;
  /** The owner is signed in to the bot's engine with their own subscription. */
  ownerSubscription: boolean;
}

/** The default of a bot that has no choice of its own. */
export function defaultTurnPayerMode(facts: TurnPayerDefaultFacts): TurnPayerMode {
  return facts.ownerLocalModel || facts.ownerSubscription ? "owner" : "speaker";
}

/** The mode a turn uses: the group's override for this bot, then the bot's
 * own choice, then the default. */
export function effectiveTurnPayerMode(input: { group?: unknown; bot?: unknown; fallback: TurnPayerMode }): TurnPayerMode {
  if (isTurnPayerMode(input.group)) return input.group;
  if (isTurnPayerMode(input.bot)) return input.bot;
  return input.fallback;
}
