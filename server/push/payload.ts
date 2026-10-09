// What one push says: the APNs JSON body and its headers. The phone reads
// `kind`, `threadId`, `botId`, `groupId`, `personId` and `id` at the top
// level of the payload (ios/Sources/CompanionCore/PushPayload.swift), the
// same keys its local notifications carry, so a tap opens the same screen.
import { createHash } from "node:crypto";

export type PushKind = "message" | "nudge" | "approval" | "achievement" | "routine";

export const PUSH_KINDS: readonly PushKind[] = ["message", "nudge", "approval", "achievement", "routine"];

export interface PushMessage {
  kind: PushKind;
  /** The person it is for (principal id). */
  personId: string;
  title: string;
  body: string;
  threadId?: string;
  /** The bot, or for a conversation between people the group: what the
   * phone needs to open it. */
  botId?: string;
  groupId?: string;
  /** Who it comes from (a nudge, a message from a person). */
  fromId?: string;
  /** The event's own id (a nudge's id), for the phone's dedup. */
  id?: string;
  /** When it happened, milliseconds since 1970. */
  at: number;
  /** A string of the app's own catalog (ios/App/Localizable.xcstrings) the
   * phone shows in its language instead of `title` / `body`; `%@` takes the
   * args in order. */
  titleLocKey?: string;
  titleLocArgs?: string[];
  bodyLocKey?: string;
}

/** What this device's Settings > Notifications allow (sent by the phone
 * when it registers). All on unless the phone said otherwise. */
export interface DevicePushSettings {
  sound: boolean;
  badge: boolean;
  nudgeSound: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DevicePushSettings = Object.freeze({ sound: true, badge: true, nudgeSound: true });

/** The bundled wizz, converted for notifications (ios/App/nudge.caf). */
export const NUDGE_SOUND = "nudge.caf";

const TITLE_MAX = 120;
const BODY_MAX = 240;
/** APNs refuses a collapse id over 64 bytes. */
const COLLAPSE_MAX = 64;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** One conversation shows one notification: the newest replaces the last.
 * Mirrors `PushCollapse.identifier` on the phone. */
export function collapseId(message: Pick<PushMessage, "kind" | "threadId">): string {
  const key = message.threadId?.trim() ? `sagax.t.${message.threadId.trim()}` : `sagax.${message.kind}`;
  if (Buffer.byteLength(key) <= COLLAPSE_MAX) return key;
  return `sagax.h.${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

/** Priority 10 (at once, wakes the screen) for a nudge; 5 (when the phone
 * finds it convenient) for the rest. */
export function pushPriority(kind: PushKind): 5 | 10 {
  return kind === "nudge" ? 10 : 5;
}

export interface ApnsRequest {
  headers: Record<string, string>;
  body: string;
}

export function buildApnsRequest(input: {
  message: PushMessage;
  bundleId: string;
  settings?: Partial<DevicePushSettings>;
  /** Whether the person's synced "Notification sounds" is on. */
  personSound?: boolean;
  nowMs: number;
}): ApnsRequest {
  const { message } = input;
  const settings = { ...DEFAULT_DEVICE_SETTINGS, ...input.settings };
  const soundOn = settings.sound && input.personSound !== false;
  const sound = message.kind === "nudge"
    ? (settings.nudgeSound ? NUDGE_SOUND : soundOn ? "default" : undefined)
    : soundOn ? "default" : undefined;
  const alert: Record<string, unknown> = { title: clip(message.title, TITLE_MAX) || "Sagax", body: clip(message.body, BODY_MAX) };
  if (message.titleLocKey) {
    alert["title-loc-key"] = message.titleLocKey;
    if (message.titleLocArgs?.length) alert["title-loc-args"] = message.titleLocArgs.map((arg) => clip(arg, TITLE_MAX));
  }
  if (message.bodyLocKey) alert["loc-key"] = message.bodyLocKey;
  const aps: Record<string, unknown> = {
    alert,
    // the phone wakes in the background to count its unread (the badge)
    "content-available": 1,
    category: message.kind === "approval" ? "SAGAX_APPROVAL" : "SAGAX_UPDATE",
  };
  if (sound) aps.sound = sound;
  if (message.threadId) aps["thread-id"] = message.threadId;
  if (message.kind === "nudge" || message.kind === "approval") aps["interruption-level"] = "time-sensitive";
  const payload: Record<string, unknown> = { aps, kind: message.kind, at: message.at };
  if (message.threadId) payload.threadId = message.threadId;
  // NotificationTarget needs a bot id: a conversation between people is
  // found by its group, as a nudge's notification already does.
  const botId = message.botId?.trim() || message.groupId?.trim();
  if (botId) payload.botId = botId;
  if (message.groupId) payload.groupId = message.groupId;
  if (message.fromId) payload.fromId = message.fromId;
  if (message.id) payload.id = message.id;
  const headers: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-topic": input.bundleId,
    "apns-priority": String(pushPriority(message.kind)),
    "apns-collapse-id": collapseId(message),
    // a nudge is stale after a few minutes; the rest may wait a day
    "apns-expiration": String(Math.floor(input.nowMs / 1000) + (message.kind === "nudge" ? 5 * 60 : 24 * 60 * 60)),
  };
  return { headers, body: JSON.stringify(payload) };
}
