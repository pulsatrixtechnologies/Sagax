import type { BotHost } from "./turn-route.ts";

export interface ApprovalViewer {
  userId: string;
  deviceId: string | null;
}

/** The owner's session. `deviceId` is null on the fleet host, and the
 * machine id when the turn runs on a worker. Channel members are not an
 * audience: `humanIds` is not an input. */
export function approvalAudience(input: {
  ownerUserId: string;
  host: BotHost;
}): { userId: string; deviceId: string | null } {
  if (input.host.kind === "machine") return { userId: input.ownerUserId, deviceId: input.host.deviceId };
  return { userId: input.ownerUserId, deviceId: null };
}

/** Fleet (`deviceId` null): the owner's userId. Machine: that userId only
 * when this session is the registered worker for that device. */
export function receivesApprovalCard(
  viewer: ApprovalViewer,
  audience: { userId: string; deviceId: string | null },
): boolean {
  if (!viewer.userId || viewer.userId !== audience.userId) return false;
  if (audience.deviceId === null) return true;
  return viewer.deviceId === audience.deviceId;
}

/** An answer counts only from `audience.userId`. Anyone else is refused
 * and the card is returned as it was, not applied. */
export function answerApproval<T>(input: {
  callerUserId: string;
  audience: { userId: string; deviceId: string | null };
  card: T;
}): { status: 403; card: T } | { status: 200; card: T } {
  if (input.callerUserId !== input.audience.userId) return { status: 403, card: input.card };
  return { status: 200, card: input.card };
}

function cardStillOpen(card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  const row = card as { answered?: unknown; dismissed?: unknown; expired?: unknown };
  return !row.answered && !row.dismissed && !row.expired;
}

/** The matching session keeps the card. Every other session does not get
 * the card. While it is still open they get `waiting-on-owner` and the
 * owner's name. */
export function approvalDelivery<T extends { card?: unknown }>(input: {
  audience: { userId: string; deviceId: string | null };
  viewer: ApprovalViewer;
  message: T;
  ownerName: string;
}): T | Omit<T, "card"> | (Omit<T, "card"> & { state: "waiting-on-owner"; ownerName: string }) {
  if (receivesApprovalCard(input.viewer, input.audience)) return input.message;
  const { card, ...rest } = input.message;
  if (!cardStillOpen(card)) return rest;
  return { ...rest, state: "waiting-on-owner", ownerName: input.ownerName };
}
