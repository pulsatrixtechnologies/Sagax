// The settings kept on this device, read and changed for a bot (#1545,
// shared/device-settings.ts, server/device-settings.ts).
//
// The server's `device-settings` frame says a request waits for this person:
// this module fetches the requests, does what Settings does here (the same
// bridge call, the same storage key) and answers. A setting this app does not
// keep (an iPhone setting, a desktop setting in a browser tab) answers
// `unsupported`, so the bot hears it from the app that does, or is told none
// does. Nothing secret ever leaves: a pairing code, a saved server's address
// book or a folder picker stay on screen.
import { DEVICE_SETTINGS_FRAME, type DeviceAnswer, type DeviceKind, type DeviceSettingRequestWire } from "../../shared/device-settings";

export const DEVICE_SETTINGS_PATH = "/api/me/device-settings/requests";
export { DEVICE_SETTINGS_FRAME };

type Ogb = NonNullable<Window["ogb"]>;
type CompanionLike = {
  state: () => Promise<{ enabled: boolean; devices?: Array<{ id: string; name: string; lastSeenAt?: number }>; pairing: { expiresAt: number } | null }>;
  start: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  pairing: (open: boolean) => Promise<{ pairing: { expiresAt: number } | null }>;
  revoke: (deviceId: string) => Promise<unknown>;
};

export interface DeviceEnv {
  /** The desktop app's bridge, absent in a browser tab. */
  ogb?: Ogb | undefined;
  storage: Pick<Storage, "getItem"> | null;
  /** A preference key a bot may set here (DEVICE_PREFERENCE_KEYS). */
  isPreferenceKey(key: string): boolean;
  /** Write a preference as Settings does (applyBotPreference). */
  applyPreference(key: string, value: string): void;
  /** Settings > Appearance > App icon: show this choice; the id now shown. */
  setAppIcon?(id: string): Promise<string>;
  audioInputs(): Promise<Array<{ id: string; label: string }>>;
  preferredAudioInput(): string | undefined;
  setPreferredAudioInput(id: string | null): void;
  /** #1545: secrets, done here so no value reaches a bot. Each may wait for
   * the person's security key on this screen. */
  exportVault?(format: string): Promise<number>;
  addSecurityKey?(name: string): Promise<void>;
  removeSecurityKey?(id: string): Promise<void>;
  setSecurityKeyClasses?(classes: string[]): Promise<void>;
}

/** How long an answer waits for a step the person finishes on screen (a key
 * to touch) before saying it started. */
export const ON_SCREEN_WAIT_MS = 3_500;

async function finishedOrStarted(work: Promise<string>, waitMs = ON_SCREEN_WAIT_MS): Promise<string> {
  // a failure after the answer was sent stays on the person's screen
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = new Promise<string>((resolve) => { timer = setTimeout(() => resolve("started: the person finishes it on their screen (security key or sign-in)"), waitMs); });
  try {
    return await Promise.race([work, started]);
  } finally {
    clearTimeout(timer);
  }
}

const bool = (value: string | undefined): boolean | null => value === "true" ? true : value === "false" ? false : null;
const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);
const fail = (device: DeviceKind, error: string): DeviceAnswer => ({ device, error: error.slice(0, 300) });

/** The updater's current state: its first callback, or nothing in time. */
function updaterState(updater: NonNullable<Ogb["updater"]>): Promise<Parameters<Parameters<NonNullable<Ogb["updater"]>["onState"]>[0]>[0] | null> {
  return new Promise((resolve) => {
    let stop: (() => void) | undefined;
    let done = false;
    const finish = (value: Parameters<typeof resolve>[0]) => { if (done) return; done = true; resolve(value); queueMicrotask(() => stop?.()); };
    const timer = setTimeout(() => finish(null), 1_500);
    stop = updater.onState((state) => { clearTimeout(timer); finish(state); });
    if (done) stop();
  });
}

/** One request, answered the way this app's Settings screen would. */
export async function answerDeviceRequest(request: Pick<DeviceSettingRequestWire, "op" | "key" | "value">, env: DeviceEnv): Promise<DeviceAnswer> {
  const device: DeviceKind = env.ogb ? "desktop" : "web";
  const { op, key, value } = request;
  const unsupported: DeviceAnswer = { device, unsupported: true };
  const ogb = env.ogb;
  try {
    // a preference kept in this app's storage
    if (env.isPreferenceKey(key)) {
      if (op === "set") {
        if (typeof value !== "string") return fail(device, "No value to set.");
        env.applyPreference(key, value);
      }
      return { device, value: env.storage?.getItem(key) ?? null };
    }
    switch (key) {
      case "device.openAtLogin": {
        const bridge = ogb?.openAtLogin;
        if (!bridge) return unsupported;
        if (op === "set") {
          if (value !== "on" && value !== "off") return fail(device, "value is on or off.");
          return { device, value: (await bridge.set(value)).choice };
        }
        return { device, value: (await bridge.get()).choice };
      }
      case "device.updateChannel":
      case "device.updateWhenAway": {
        const updater = ogb?.updater;
        if (!updater) return unsupported;
        if (key === "device.updateChannel") {
          if (op === "set") {
            if (value !== "stable" && value !== "nightly") return fail(device, "value is stable or nightly.");
            const next = updater.setChannel ? await updater.setChannel(value) : updater.setPrereleases ? await updater.setPrereleases(value === "nightly") : null;
            if (!next) return unsupported;
            return { device, value: next.channel ?? (next.allowPrerelease ? "nightly" : "stable") };
          }
          const state = await updaterState(updater);
          return { device, value: state ? state.channel ?? (state.allowPrerelease ? "nightly" : "stable") : null };
        }
        if (op === "set") {
          const on = bool(value);
          if (on === null || !updater.setAutoInstallAway) return on === null ? fail(device, "value is true or false.") : unsupported;
          return { device, value: String((await updater.setAutoInstallAway(on)).autoInstallWhenAway === true) };
        }
        const state = await updaterState(updater);
        return { device, value: state ? String(state.autoInstallWhenAway === true) : null };
      }
      case "device.appIcon": {
        const bridge = ogb?.appIcon;
        if (!bridge) return unsupported;
        if (op === "set") {
          if (typeof value !== "string" || !value || !env.setAppIcon) return fail(device, "value is an app icon's id.");
          return { device, value: await env.setAppIcon(value) };
        }
        return { device, value: (await bridge.get()).id ?? "sagax" };
      }
      case "device.microphone": {
        const inputs = await env.audioInputs();
        if (op === "set") {
          if (typeof value !== "string" || !value) return fail(device, "value is a microphone's id or name, or default.");
          if (value === "default") {
            env.setPreferredAudioInput(null);
          } else {
            const wanted = value.trim().toLowerCase();
            const input = inputs.find((row) => row.id === value) ?? inputs.find((row) => row.label.trim().toLowerCase() === wanted);
            if (!input) return fail(device, "No such microphone on this device (get lists them).");
            env.setPreferredAudioInput(input.id);
          }
        }
        return { device, value: JSON.stringify({ selected: env.preferredAudioInput() ?? "default", inputs }) };
      }
      case "device.keepAwake": {
        const bridge = ogb?.routines;
        if (!bridge) return unsupported;
        if (op === "set") {
          const on = bool(value);
          if (on === null) return fail(device, "value is true or false.");
          return { device, value: String((await bridge.keepAwake(on)).keepAwake) };
        }
        return { device, value: String((await bridge.wakeState()).keepAwake) };
      }
      case "device.remoteAccess":
      case "device.pairing":
      case "device.pairedDeviceRemove": {
        const companion = (ogb as { companion?: CompanionLike } | undefined)?.companion;
        if (!companion) return unsupported;
        if (op === "set") {
          if (key === "device.pairedDeviceRemove") {
            if (typeof value !== "string" || !value) return fail(device, "value is a paired device's id.");
            await companion.revoke(value);
          } else {
            const on = bool(value);
            if (on === null) return fail(device, "value is true or false.");
            if (key === "device.remoteAccess") await (on ? companion.start() : companion.stop());
            else await companion.pairing(on);
          }
        }
        const state = await companion.state();
        // the pairing code stays on screen: only whether it is open
        if (key === "device.pairing") return { device, value: JSON.stringify({ open: state.pairing !== null, ...(state.pairing ? { expiresAt: state.pairing.expiresAt } : {}) }) };
        return { device, value: JSON.stringify({ enabled: state.enabled, devices: (state.devices ?? []).map((row) => ({ id: row.id, name: row.name, ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt } : {}) })) }) };
      }
      case "device.computerSharing": {
        const sharing = ogb?.computerSharing;
        const environments = ogb?.environments;
        if (!sharing || !environments) return unsupported;
        const servers = (await environments.state()).environments.filter((row) => row.kind !== "local");
        if (op === "set") {
          let change: { server?: unknown; revoke?: unknown; terminal?: unknown; computer?: unknown; folders?: unknown };
          try {
            change = JSON.parse(value ?? "") as typeof change;
          } catch {
            return fail(device, "value is {server, terminal?, computer?, folders?: [{path, write}]} or {server, revoke: true}.");
          }
          const server = servers.find((row) => row.id === change.server);
          if (!server) return fail(device, "No such saved server (get lists them).");
          if (change.revoke === true) {
            await sharing.revoke(server.id);
          } else {
            const current = await sharing.state(server.id);
            // a folder is added by the person's own folder picker; a bot keeps,
            // removes or changes the ones already shared
            let folders = current.folders;
            if (Array.isArray(change.folders)) {
              const asked = change.folders as Array<{ path?: unknown; write?: unknown }>;
              if (asked.some((row) => !current.folders.some((folder) => folder.path === row.path))) return fail(device, "A new folder is added by the person with Choose a folder; a bot keeps, removes or changes the shared ones.");
              folders = current.folders.filter((folder) => asked.some((row) => row.path === folder.path))
                .map((folder) => ({ ...folder, write: asked.find((row) => row.path === folder.path)?.write === true }));
            }
            const saved = await sharing.save(server.id, {
              folders,
              terminal: typeof change.terminal === "boolean" ? change.terminal : current.terminal,
              computer: typeof change.computer === "boolean" ? change.computer : current.computer,
            });
            if (!saved) return fail(device, "The change was not confirmed on this computer.");
          }
        }
        const rows = await Promise.all(servers.map(async (row) => {
          const state = await sharing.state(row.id).catch(() => null);
          return { server: row.id, name: row.name, ...(state ? { enabled: state.enabled, connected: state.connected === true, terminal: state.terminal, computer: state.computer, folders: state.folders.map((folder) => ({ name: folder.name, path: folder.path, write: folder.write })) } : {}) };
        }));
        return { device, value: JSON.stringify(rows) };
      }
      case "device.serverMode": {
        const bridge = ogb?.serverMode;
        if (!bridge) return unsupported;
        if (op === "set") {
          if (value !== "leave") return fail(device, "value is leave.");
          return { device, value: JSON.stringify(await bridge.leave()) };
        }
        const state = await bridge.state();
        return { device, value: JSON.stringify(state.active ? { active: true, name: state.label || state.name, origin: state.origin } : { active: false }) };
      }
      // #1545: secrets, in the person's own app
      case "device.vaultExport": {
        if (!env.exportVault || op !== "set") return unsupported;
        if (typeof value !== "string" || !value) return fail(device, "value is an export format.");
        const exportVault = env.exportVault;
        return { device, value: await finishedOrStarted(exportVault(value).then((count) => `saved on this device: ${count} item(s)`)) };
      }
      case "device.securityKeyAdd":
      case "device.securityKeyRemove":
      case "device.securityKeyClasses": {
        if (op !== "set") return unsupported;
        if (key === "device.securityKeyAdd") {
          if (!env.addSecurityKey) return unsupported;
          return { device, value: await finishedOrStarted(env.addSecurityKey(value || "Security key").then(() => "added")) };
        }
        if (key === "device.securityKeyRemove") {
          if (!env.removeSecurityKey) return unsupported;
          if (!value) return fail(device, "value is a key's id.");
          return { device, value: await finishedOrStarted(env.removeSecurityKey(value).then(() => "removed")) };
        }
        if (!env.setSecurityKeyClasses) return unsupported;
        let classes: unknown;
        try {
          classes = JSON.parse(value ?? "");
        } catch {
          classes = null;
        }
        if (!Array.isArray(classes) || classes.some((name) => typeof name !== "string")) return fail(device, "value is the list of classes.");
        return { device, value: await finishedOrStarted(env.setSecurityKeyClasses(classes as string[]).then(() => "saved")) };
      }
      default:
        return unsupported;
    }
  } catch (error) {
    return fail(device, error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "") : String(error));
  }
}

export interface DeviceAnswererDeps {
  fetch: typeof fetch;
  env: () => DeviceEnv;
}

/** Fetch the requests waiting on this person and answer each once. */
export function createDeviceSettingsAnswerer(deps: DeviceAnswererDeps) {
  const seen = new Set<string>();
  let running: Promise<void> | null = null;
  let again = false;

  async function pass(): Promise<void> {
    let requests: DeviceSettingRequestWire[] = [];
    try {
      const response = await deps.fetch(DEVICE_SETTINGS_PATH, { credentials: "same-origin", signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return;
      const body = await response.json() as { requests?: DeviceSettingRequestWire[] };
      requests = Array.isArray(body.requests) ? body.requests : [];
    } catch {
      return;
    }
    for (const request of requests) {
      if (!request || typeof request.id !== "string" || seen.has(request.id)) continue;
      seen.add(request.id);
      const answer = await answerDeviceRequest(request, deps.env());
      try {
        await deps.fetch(`${DEVICE_SETTINGS_PATH}/${encodeURIComponent(request.id)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(answer),
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        /* the bot hears that no app answered in time */
      }
    }
    if (seen.size > 200) seen.clear();
  }

  /** The frame arrived: answer, once at a time; a frame during a pass runs another. */
  function receive(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  return { receive };
}

export { text as deviceValueText };
