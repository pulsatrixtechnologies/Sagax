// The Android phones of each person that asked for pushes (FCM, 2026-10-26):
// one small JSON file per principal in `<data>/push-devices-android/`
// (mode 0600), next to the iOS store (./devices.ts). An FCM registration
// token addresses one app install, so it never reaches a log line
// (maskSecret) or another person's answer. A token belongs to one person at
// a time: a phone that signs in as someone else moves.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";

export const MAX_ANDROID_DEVICES_PER_PERSON = 10;

/** FCM registration tokens: url-safe base64 with a colon, about 160 characters today. */
export const FCM_TOKEN = /^[A-Za-z0-9_:-]{32,4096}$/;

const PERSON = /^[\w:.@-]{1,128}$/;

export interface AndroidPushDevice {
  token: string;
  platform: "android";
  appVersion: string;
  deviceName: string;
  registeredAt: number;
  updatedAt: number;
}

export const androidRegistrationSchema = z.object({
  token: z.string().trim().regex(FCM_TOKEN),
  platform: z.literal("android"),
  appVersion: z.string().trim().max(40).default(""),
  deviceName: z.string().trim().max(80).default(""),
}).strict();

export type AndroidPushRegistration = z.infer<typeof androidRegistrationSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  devices: z.array(z.object({
    token: z.string().regex(FCM_TOKEN),
    platform: z.literal("android"),
    appVersion: z.string(),
    deviceName: z.string(),
    registeredAt: z.number(),
    updatedAt: z.number(),
  })),
});

export interface AndroidPushDeviceStore {
  list(person: string): AndroidPushDevice[];
  register(person: string, input: AndroidPushRegistration): AndroidPushDevice;
  remove(person: string, token: string): boolean;
  /** FCM said the token is gone (404, UNREGISTERED): gone for whoever had it. */
  prune(token: string): boolean;
  removePerson(person: string): void;
}

const personKey = (person: string) => person.trim().toLowerCase();

export function createAndroidPushDeviceStore(dataDir: string, now: () => number = Date.now): AndroidPushDeviceStore {
  const dir = join(dataDir, "push-devices-android");
  let people: Map<string, AndroidPushDevice[]> | null = null;
  const fileOf = (person: string) => join(dir, `${person}.json`);

  const load = () => {
    if (people) return people;
    people = new Map();
    if (!existsSync(dir)) return people;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const person = name.slice(0, -5);
      if (!PERSON.test(person)) continue;
      try {
        const parsed = fileSchema.parse(JSON.parse(readFileSync(join(dir, name), "utf8")));
        if (parsed.devices.length) people.set(person, parsed.devices);
      } catch {
        console.warn(`push: ${name} in push-devices-android could not be read; ignored`);
      }
    }
    return people;
  };

  const save = (person: string, devices: AndroidPushDevice[]) => {
    const all = load();
    if (!devices.length) {
      all.delete(person);
      try { unlinkSync(fileOf(person)); } catch { /* already gone */ }
      return;
    }
    all.set(person, devices);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(fileOf(person), `${JSON.stringify({ version: 1, devices }, null, 2)}\n`, { mode: 0o600 });
  };

  const removeToken = (token: string, except?: string): boolean => {
    let removed = false;
    for (const [person, devices] of load()) {
      if (person === except) continue;
      const kept = devices.filter((device) => device.token !== token);
      if (kept.length !== devices.length) {
        save(person, kept);
        removed = true;
      }
    }
    return removed;
  };

  return {
    list(person) {
      return [...(load().get(personKey(person)) ?? [])];
    },
    register(person, input) {
      const key = personKey(person);
      if (!PERSON.test(key)) throw Object.assign(new Error("not a person"), { status: 403 });
      const at = now();
      removeToken(input.token, key);
      const devices = [...(load().get(key) ?? [])];
      const existing = devices.find((device) => device.token === input.token);
      const device: AndroidPushDevice = {
        token: input.token,
        platform: "android",
        appVersion: input.appVersion,
        deviceName: input.deviceName,
        registeredAt: existing?.registeredAt ?? at,
        updatedAt: at,
      };
      const next = devices.filter((entry) => entry.token !== input.token);
      next.push(device);
      next.sort((a, b) => a.updatedAt - b.updatedAt);
      while (next.length > MAX_ANDROID_DEVICES_PER_PERSON) next.shift();
      save(key, next);
      return { ...device };
    },
    remove(person, token) {
      const key = personKey(person);
      const devices = load().get(key) ?? [];
      const kept = devices.filter((device) => device.token !== token.trim());
      if (kept.length === devices.length) return false;
      save(key, kept);
      return true;
    },
    prune(token) {
      return removeToken(token.trim());
    },
    removePerson(person) {
      const key = personKey(person);
      if (load().has(key)) save(key, []);
    },
  };
}
