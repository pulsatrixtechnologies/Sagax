// The device settings broker (#1545, shared/device-settings.ts): a bot's
// read or change of a setting kept on the person's own device, as a short
// request to their open Sagax apps and the first answer back.
//
// - A request belongs to one person. Only that person's own app sessions
//   (never a bot's act replay, never a short-lived copy) fetch and answer it
//   (server/routes/device-settings.ts).
// - It waits only while the turn waits (DEVICE_SETTING_WAIT_MS): nothing is
//   queued for an app that opens later, so a change never lands by surprise.
// - The first app that holds the setting answers; an app that does not keep
//   it says so, and when every open app said so the bot is told.
// - Nothing is written anywhere: requests and answers live in memory.
import { randomUUID } from "node:crypto";

import { DEVICE_SETTING_WAIT_MS, type DeviceAnswer, type DeviceKind, type DeviceSettingRequestWire } from "../shared/device-settings.ts";

export type DeviceSettingOutcome =
  | { status: "done"; device: DeviceKind; value: string | null }
  | { status: "no-app" }
  | { status: "unsupported" }
  | { status: "failed"; device: DeviceKind; error: string }
  | { status: "timeout" };

export interface DeviceSettingsBrokerDeps {
  now?: () => number;
  newId?: () => string;
  /** The person's open apps should fetch their requests (a live frame). */
  notify(person: string): void;
  /** How many of this person's apps hold a live stream now. */
  openApps(person: string): number;
}

type Pending = {
  person: string;
  wire: DeviceSettingRequestWire;
  /** The apps that may answer: the person's open streams when it was asked. */
  expected: number;
  answered: Set<string>;
  unsupported: number;
  error?: { device: DeviceKind; error: string };
  resolve: (outcome: DeviceSettingOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Requests one person may have waiting at once. */
const MAX_PENDING_PER_PERSON = 8;

export function createDeviceSettingsBroker(deps: DeviceSettingsBrokerDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const pending = new Map<string, Pending>();

  function settle(id: string, outcome: DeviceSettingOutcome): void {
    const row = pending.get(id);
    if (!row) return;
    pending.delete(id);
    clearTimeout(row.timer);
    row.resolve(outcome);
  }

  /** Ask the person's open apps; resolves with the first answer, or why none. */
  function ask(person: string, request: { op: "get" | "set"; key: string; value?: string; botName: string }, waitMs = DEVICE_SETTING_WAIT_MS): Promise<DeviceSettingOutcome> {
    const expected = deps.openApps(person);
    if (expected <= 0) return Promise.resolve({ status: "no-app" });
    if ([...pending.values()].filter((row) => row.person === person).length >= MAX_PENDING_PER_PERSON) {
      return Promise.resolve({ status: "failed", device: "web", error: "Too many device requests are waiting for this person; try again in a moment." });
    }
    const id = newId();
    const wire: DeviceSettingRequestWire = { id, op: request.op, key: request.key, ...(request.value !== undefined ? { value: request.value } : {}), botName: request.botName, at: now() };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const row = pending.get(id);
        if (!row) return;
        settle(id, row.error ? { status: "failed", ...row.error } : row.unsupported > 0 && row.unsupported >= row.answered.size && row.answered.size > 0 ? { status: "unsupported" } : { status: "timeout" });
      }, waitMs);
      timer.unref?.();
      pending.set(id, { person, wire, expected, answered: new Set(), unsupported: 0, resolve, timer });
      deps.notify(person);
    });
  }

  /** The requests waiting on this person that this app has not answered. */
  function pendingFor(person: string, appId: string): DeviceSettingRequestWire[] {
    return [...pending.values()].filter((row) => row.person === person && !row.answered.has(appId)).map((row) => row.wire);
  }

  /** One app's answer. Only the person the request belongs to answers it. */
  function answer(person: string, appId: string, id: string, input: DeviceAnswer): { ok: true } | { ok: false; status: number; error: string } {
    const row = pending.get(id);
    // someone else's request reads as no request at all
    if (!row || row.person !== person) return { ok: false, status: 404, error: "No such device request (it may have expired)." };
    if (row.answered.has(appId)) return { ok: true };
    row.answered.add(appId);
    if (input.error) {
      row.error ??= { device: input.device, error: input.error };
    } else if (input.unsupported) {
      row.unsupported += 1;
    } else {
      settle(id, { status: "done", device: input.device, value: input.value ?? null });
      return { ok: true };
    }
    // every open app answered without holding it: no need to wait longer
    if (row.answered.size >= row.expected) settle(id, row.error ? { status: "failed", ...row.error } : { status: "unsupported" });
    return { ok: true };
  }

  return { ask, pendingFor, answer, size: () => pending.size };
}

export type DeviceSettingsBroker = ReturnType<typeof createDeviceSettingsBroker>;
