export type PeerAction = "ask_bot" | "delegate_bot" | "send_to_bot" | "post_to_room";

/** Stable persisted grant for one peer action and one target — a bot for
 * ask_bot, delegate_bot and send_to_bot, the room for post_to_room. */
export function peerAllowKey(action: PeerAction, targetId: string): string {
  return `${action}:${targetId}`;
}
