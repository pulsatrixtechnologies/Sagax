// This page's answerer for device settings (#1545, src/lib/device-settings.ts):
// the real bridge, storage and Settings helpers, wired once for the store.
import { DEVICE_PREFERENCE_KEYS } from "../../shared/settings-actions";
import { listAudioInputs, preferredAudioInputId, setPreferredAudioInputId } from "./audio-input";
import { createDeviceSettingsAnswerer, type DeviceEnv } from "./device-settings";
import { applyBotPreference } from "./user-preferences-sync";

type BotRow = { id: string; name: string; color?: string };

let answerer: ReturnType<typeof createDeviceSettingsAnswerer> | null = null;

/** The `device-settings` frame: answer the requests waiting on this person. */
export function receiveDeviceSettingsFrame(context: () => { bots: readonly BotRow[]; primary: { id: string } | null }): void {
  if (typeof window === "undefined") return;
  answerer ??= createDeviceSettingsAnswerer({
    fetch: window.fetch.bind(window),
    env: (): DeviceEnv => {
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      return {
        ogb: window.ogb,
        storage,
        isPreferenceKey: (key) => DEVICE_PREFERENCE_KEYS.has(key),
        applyPreference: applyBotPreference,
        setAppIcon: async (id) => {
          const { applyAppIconById } = await import("./app-icon-apply");
          const now = context();
          return applyAppIconById(id, { bots: now.bots as Parameters<typeof applyAppIconById>[1]["bots"], primary: now.primary });
        },
        audioInputs: listAudioInputs,
        preferredAudioInput: preferredAudioInputId,
        setPreferredAudioInput: setPreferredAudioInputId,
      };
    },
  });
  void answerer.receive();
}
