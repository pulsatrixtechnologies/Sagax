// Emoji reactions in the transcript (shared/reactions.ts): the chips under a
// message and who counts as "me" on them.
//
// A chip is one emoji with its count, highlighted when the viewer is among
// the people who put it there; its tooltip names them all, bots included.
// The viewer is the id the server keys them by: their principal id (the
// read receipts' `self`, or the config's viewer). A reaction stored before
// the current shape names its person "user": the desktop's owner on a
// personal server.
import { useCallback, type Dispatch } from "react";

import { t } from "@/lib/i18n";
import { viewerActorId } from "@/lib/viewer";
import { api, type Action, type ConfigStatus, type Message } from "@/state/store";
import { normalizeReactions, type MessageReaction, type ReactionActor } from "../../shared/reactions";

export interface ReactionChip {
  emoji: string;
  count: number;
  mine: boolean;
  actors: ReactionActor[];
}

/** Who the viewer is on a reaction: the read receipts' `self` when known,
 * the config's viewer, and for the desktop's owner the legacy "user". */
export function reactionSelfIds(config: ConfigStatus | null | undefined, readSelf?: string | null): string[] {
  const ids = new Set<string>();
  if (readSelf) ids.add(readSelf.trim().toLowerCase());
  const viewer = viewerActorId(config);
  if (viewer) ids.add(viewer);
  // a stored `{ by: "user" }` was the desktop's owner
  if (!config?.viewer || config.viewer.operator) ids.add("user");
  return [...ids];
}

/** The chips of one message, in the order the emojis first landed. */
export function reactionChips(raw: unknown, selfIds: readonly string[]): ReactionChip[] {
  const self = new Set(selfIds);
  return normalizeReactions(raw).map((reaction) => ({
    emoji: reaction.emoji,
    count: reaction.actors.length,
    mine: reaction.actors.some((actor) => self.has(actor.id)),
    actors: reaction.actors,
  }));
}

/** The emojis the viewer has on a message. */
export function myReactions(raw: unknown, selfIds: readonly string[]): string[] {
  return reactionChips(raw, selfIds).filter((chip) => chip.mine).map((chip) => chip.emoji);
}

/** One actor as a chip's tooltip names them: "You", a person's name, a
 * bot's name. */
export function reactionActorName(actor: ReactionActor, selfIds: readonly string[]): string {
  if (selfIds.includes(actor.id)) return t("reactions.you");
  return actor.name || (actor.kind === "bot" ? t("reactions.aBot") : t("seen.someone"));
}

/** "Zachary Sellam and Cryptic reacted with 👍". */
export function reactionTooltip(chip: Pick<ReactionChip, "emoji" | "actors">, selfIds: readonly string[]): string {
  const names = chip.actors.map((actor) => reactionActorName(actor, selfIds));
  const list = names.length <= 1 ? names.join("") : t("reactions.list", { names: names.slice(0, -1).join(", "), last: names.at(-1)! });
  return t("reactions.tooltip", { names: list, emoji: chip.emoji });
}

/** Toggle the viewer's own reaction; the answer patches the message in the
 * store at once (the live frame then says the same). */
export async function toggleReaction(threadId: string, messageId: string, emoji: string): Promise<Message | null> {
  const body = await api<{ message?: Message }>(`/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
  return body?.message ?? null;
}

/** A toggle bound to one thread that also patches the store. Takes the
 * store's dispatch rather than reading the store, so a transcript row that
 * uses it does not re-render on every store change. */
export function useToggleReaction(threadId: string, dispatch: Dispatch<Action>): (messageId: string, emoji: string) => void {
  return useCallback((messageId: string, emoji: string) => {
    if (messageId.startsWith("optimistic-")) return;
    void toggleReaction(threadId, messageId, emoji)
      .then((message) => {
        if (message) dispatch({ type: "messagePatched", threadId, message });
      })
      .catch(() => { /* refused or offline: the chip stays as it was */ });
  }, [dispatch, threadId]);
}

export type { MessageReaction };
