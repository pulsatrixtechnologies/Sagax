// Emoji reactions on a message (docs/messages-reactions.md).
//
// A message keeps one entry per emoji, with everyone who put it there:
// `reactions: [{ emoji, actors: [{ id, kind, name }], at }]`. A person's id
// is their principal id (lowercase, as read receipts key it), a bot's is
// `bot:<botId>`; `at` is when the emoji first landed on the message, which
// orders the chips. The server is the only writer: a person toggles their
// own (POST /api/threads/<t>/messages/<m>/reactions), a bot uses
// react_to_message and remove_reaction. Messages stored before this shape
// carry `{ emoji, by }` entries ("user" or a bot id); normalizeReactions
// reads both.

export type ReactionActorKind = "person" | "bot";

export interface ReactionActor {
  id: string;
  kind: ReactionActorKind;
  name: string;
}

export interface MessageReaction {
  emoji: string;
  actors: ReactionActor[];
  /** When this emoji first landed on the message (ms). */
  at: number;
}

/** The quick picker, in order. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌"] as const;

/** Distinct emojis one message can carry; past that a new one is refused. */
export const MAX_REACTION_EMOJIS = 24;
/** UTF-16 length of one emoji sequence (a family or a flag with modifiers
 * fits; a sentence does not). */
const MAX_EMOJI_LENGTH = 32;

const BOT_PREFIX = "bot:";

export function botReactionActorId(botId: string): string {
  return `${BOT_PREFIX}${botId}`;
}

const EMOJI_SEQUENCE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}\p{Regional_Indicator}‍️⃣]+$/u;
const EMOJI_BASE = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/** The emoji a request names, trimmed, or null when it is not one emoji
 * sequence (text, markup, an empty string, something too long). */
export function reactionEmoji(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const emoji = raw.trim();
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) return null;
  if (!EMOJI_SEQUENCE.test(emoji) || !EMOJI_BASE.test(emoji)) return null;
  return emoji;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function actorOf(value: unknown): ReactionActor | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  const kind: ReactionActorKind = value.kind === "bot" || value.id.startsWith(BOT_PREFIX) ? "bot" : "person";
  return { id: value.id, kind, name: typeof value.name === "string" ? value.name : "" };
}

/** Who a legacy `{ emoji, by }` entry names. `by: "user"` was the person at
 * the desktop; `legacyUser` is who that is on this server, when known. */
function legacyActor(by: string, legacyUser?: ReactionActor): ReactionActor {
  if (by === "user") return legacyUser ?? { id: "user", kind: "person", name: "" };
  return { id: botReactionActorId(by), kind: "bot", name: by };
}

/** A message's reactions in the current shape, whatever was stored: merges
 * legacy entries by emoji, drops malformed ones and empty emojis, and keeps
 * one entry per actor per emoji. */
export function normalizeReactions(raw: unknown, legacyUser?: ReactionActor): MessageReaction[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageReaction[] = [];
  const byEmoji = new Map<string, MessageReaction>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const emoji = reactionEmoji(entry.emoji);
    if (!emoji) continue;
    const actors = Array.isArray(entry.actors)
      ? entry.actors.map(actorOf).filter((actor): actor is ReactionActor => actor !== null)
      : typeof entry.by === "string" && entry.by ? [legacyActor(entry.by, legacyUser)] : [];
    if (!actors.length) continue;
    let target = byEmoji.get(emoji);
    if (!target) {
      target = { emoji, actors: [], at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0 };
      byEmoji.set(emoji, target);
      out.push(target);
    }
    for (const actor of actors) {
      if (!target.actors.some((known) => known.id === actor.id)) target.actors.push(actor);
    }
  }
  return out;
}

export type ReactionMode = "toggle" | "add" | "remove";

/** One actor's change: toggle (the chip and the picker), add or remove (a
 * bot's tools). Returns the new list and what happened; `changed: false`
 * when nothing moved (adding twice, removing what is not there). An add
 * past MAX_REACTION_EMOJIS distinct emojis is `full`. */
export function applyReaction(
  reactions: readonly MessageReaction[],
  emoji: string,
  actor: ReactionActor,
  mode: ReactionMode,
  now: number,
): { reactions: MessageReaction[]; changed: boolean; added: boolean; full?: true } {
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
  const current = index >= 0 ? reactions[index]! : null;
  const has = Boolean(current?.actors.some((known) => known.id === actor.id));
  const add = mode === "add" || (mode === "toggle" && !has);
  if (add) {
    if (has) return { reactions: [...reactions], changed: false, added: false };
    if (!current) {
      if (reactions.length >= MAX_REACTION_EMOJIS) return { reactions: [...reactions], changed: false, added: false, full: true };
      return { reactions: [...reactions, { emoji, actors: [actor], at: now }], changed: true, added: true };
    }
    const next = reactions.map((reaction, at) => at === index ? { ...reaction, actors: [...reaction.actors, actor] } : reaction);
    return { reactions: next, changed: true, added: true };
  }
  if (!has) return { reactions: [...reactions], changed: false, added: false };
  const next = reactions
    .map((reaction, at) => at === index ? { ...reaction, actors: reaction.actors.filter((known) => known.id !== actor.id) } : reaction)
    .filter((reaction) => reaction.actors.length > 0);
  return { reactions: next, changed: true, added: false };
}

/** The emojis one actor has on a message. */
export function reactionsBy(reactions: readonly MessageReaction[], actorId: string): string[] {
  return reactions.filter((reaction) => reaction.actors.some((actor) => actor.id === actorId)).map((reaction) => reaction.emoji);
}
