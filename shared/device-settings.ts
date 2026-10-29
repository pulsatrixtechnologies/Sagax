// The settings kept only on the person's own device (#1545, 2026-10-28):
// "le bot lit ET change aussi les réglages gardés seulement sur l'appareil".
//
// A bot reads or changes them through sagax_settings; the server asks the
// person's open Sagax app (desktop or iPhone) and waits a few seconds for its
// answer (server/device-settings.ts). The live frame only says that a
// request waits for this person: each open app fetches the requests, does
// what its own Settings screen does, and answers. No app open: the bot is
// told so plainly, nothing is queued for later.
import { z } from "zod";

/** The live frame that tells a person's open apps to fetch their device
 * requests. It carries no data, only whom it is for. */
export const DEVICE_SETTINGS_FRAME = "device-settings";

/** The route sagax_settings replays with the person's session to read or
 * change one of these settings (server/routes/device-settings.ts). */
export const DEVICE_APPLY_PATH = "/api/me/device-settings/apply";

/** How long a bot's turn waits for the person's app to answer. */
export const DEVICE_SETTING_WAIT_MS = 5_000;

/** The settings that live in the app itself, not in a preference key: what
 * each one is and the value it takes. Preference keys (setPreference,
 * DEVICE_PREFERENCE_KEYS) travel the same way under their storage key. */
export const DEVICE_ONLY_SETTINGS = {
  // desktop app
  "device.openAtLogin": "enum:on|off",
  "device.updateChannel": "enum:stable|nightly",
  "device.updateWhenAway": "boolean",
  "device.appIcon": "string",
  "device.microphone": "string",
  "device.keepAwake": "boolean",
  "device.remoteAccess": "boolean",
  "device.pairing": "boolean",
  "device.pairedDeviceRemove": "string",
  "device.computerSharing": "object",
  "device.serverMode": "enum:leave",
  // iPhone app
  "device.haptics": "boolean",
  "device.nudgeHaptic": "boolean",
  // secrets, done in the person's own app so no value reaches a bot
  "device.vaultExport": "enum:chrome-csv|bitwarden-csv|bitwarden-json",
  "device.securityKeyAdd": "string",
  "device.securityKeyRemove": "string",
  "device.securityKeyClasses": "array",
} as const;
export type DeviceOnlySetting = keyof typeof DEVICE_ONLY_SETTINGS;

export function isDeviceOnlySetting(key: unknown): key is DeviceOnlySetting {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(DEVICE_ONLY_SETTINGS, key);
}

/** One request as the person's apps receive it. `value` is the new value as
 * text (JSON for an object), the way a preference is stored. */
export type DeviceSettingRequestWire = {
  id: string;
  op: "get" | "set";
  key: string;
  value?: string;
  botName: string;
  at: number;
};

export const DEVICE_KINDS = ["desktop", "ios", "web"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** An app's answer: the value it holds now (after a set, the new one), or
 * that it does not keep this setting, or why it could not. */
export const deviceAnswerSchema = z.object({
  device: z.enum(DEVICE_KINDS),
  value: z.string().max(16_000).nullable().optional(),
  unsupported: z.literal(true).optional(),
  error: z.string().trim().min(1).max(300).optional(),
}).strict();
export type DeviceAnswer = z.infer<typeof deviceAnswerSchema>;

export function deviceSettingsFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== DEVICE_SETTINGS_FRAME) return true;
  return payload.audience === (viewerId ?? localPersonId);
}

/** What the bot is told for each outcome, in plain words it can relay. */
export const DEVICE_NO_APP = "No Sagax app of the person is open right now (desktop or iPhone), so this setting kept on their device cannot be reached. Nothing changed. Ask them to open Sagax, then try again.";
export const DEVICE_TIMEOUT = "The person's open Sagax app did not answer in time (it may be asleep or offline). Nothing is known to have changed; try again in a moment.";
export const DEVICE_UNSUPPORTED = "None of the person's open Sagax apps keeps this setting (a desktop setting needs the desktop app, an iPhone setting the iPhone app).";
