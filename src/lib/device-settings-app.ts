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
        // #1545: secrets, the way Settings does them (the store's api asks the
        // person's key and sends again)
        exportVault: async (format) => {
          const vault = await import("./credential-vault");
          const transfer = await import("../../shared/credential-vault-transfer");
          if (!transfer.isVaultExportFormat(format)) throw new Error("Unknown export format.");
          const answer = await vault.exportCredentials(format);
          const file = transfer.exportVaultItems(answer.items, format);
          vault.downloadText(file.text, file.mime, vault.exportFileName(file.extension));
          return file.count;
        },
        addSecurityKey: async (name) => { await (await import("./step-up-client")).registerSecurityKey(name); },
        removeSecurityKey: async (id) => {
          const { api } = await import("@/state/store");
          await api(`/api/security-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({}) });
        },
        setSecurityKeyClasses: async (classes) => {
          const { api } = await import("@/state/store");
          await api("/api/security-keys/classes", { method: "PUT", body: JSON.stringify({ classes }) });
        },
      };
    },
  });
  void answerer.receive();
}
