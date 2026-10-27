// Whether a person's message to a bot can be answered right now (the maintainer,
// 2026-10-27): when it certainly cannot (the engine is not connected for this
// person, the computer or the local server that serves its model is down),
// the composer does not send and says why in one line, with the one thing to
// do. Anything uncertain sends as before, so nobody is blocked by a guess.
// Pure: the harness (server/index.ts, GET /api/bots/<id>/send-state) passes what it
// knows; the clients ask again while blocked, so the composer comes back on
// its own once the cause is fixed.

export type SendBlockReason = "engine_not_connected" | "computer_offline" | "local_server_offline" | "owner_computer_offline";

export type SendBlockAction =
  /** Connect this engine (Settings > Engines). */
  | { kind: "connect"; instanceId: string; engine: string }
  /** Nothing to change here: try again once the computer or server is back. */
  | { kind: "retry" };

export interface SendBlock {
  reason: SendBlockReason;
  /** The English line, for clients that do not word `reason` themselves. */
  message: string;
  action: SendBlockAction;
  /** The engine's display name, or the owner's for owner_computer_offline. */
  name?: string;
}

/** How the computer-shared model behind a bot is doing, as the server last
 * heard from that computer. "unknown" for any other model. */
export type LocalReach = "ok" | "computer_offline" | "server_offline" | "unknown";

export interface SendStateInput {
  /** Auto picks an engine per turn: never blocked here. */
  auto: boolean;
  engine: { instanceId: string; name: string } | null;
  /** The engine refuses this person (no sign-in, no key, not given) and no
   * model of theirs takes its place. */
  accessRefused: boolean;
  /** The owner pays and the model is on the owner's computer, offline now. */
  ownerComputerOffline?: { ownerName: string } | null;
  local: LocalReach;
}

export function sendBlockFor(input: SendStateInput): SendBlock | null {
  if (input.auto || !input.engine) return null;
  if (input.ownerComputerOffline) {
    const owner = input.ownerComputerOffline.ownerName.trim();
    return {
      reason: "owner_computer_offline", ...(owner ? { name: owner } : {}),
      message: `${owner ? `${owner}'s` : "The bot owner's"} computer, which serves this bot's model, is offline. Try again once it is back.`,
      action: { kind: "retry" },
    };
  }
  if (input.local === "computer_offline") {
    return {
      reason: "computer_offline",
      message: "The computer that serves this bot's local model is offline or asleep. Open Sagax on it, then try again.",
      action: { kind: "retry" },
    };
  }
  if (input.local === "server_offline") {
    return {
      reason: "local_server_offline",
      message: "The local model is not responding: its server on that computer is stopped. Start it, then try again.",
      action: { kind: "retry" },
    };
  }
  if (input.accessRefused) {
    const { instanceId, name } = input.engine;
    return {
      reason: "engine_not_connected", name,
      message: `${name} is not connected for you. Connect ${name} to talk to this bot.`,
      action: { kind: "connect", instanceId, engine: name },
    };
  }
  return null;
}
