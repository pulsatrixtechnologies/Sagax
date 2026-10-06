export type CloudVoiceProvider = "elevenlabs" | "fish" | "xai";
export type VoiceKeyDraft = { provider: CloudVoiceProvider | null; value: string };

/** Never expose a credential draft after the selected provider changes. */
export function voiceKeyDraftValue(draft: VoiceKeyDraft, provider: CloudVoiceProvider): string {
  return draft.provider === provider ? draft.value : "";
}

/** Thrown by Electron when the page is not the local server UI (server mode). */
export const LOCAL_CREDENTIAL_CHANNEL_REFUSAL = "only available while using the local server";

export type VoiceKeySaveStatus = { tts?: { configured?: boolean } };

export type VoiceKeySaveResult<Status extends VoiceKeySaveStatus> =
  | { ok: true; status: Status }
  | { ok: false; reason: "rejected"; message: string }
  | { ok: false; reason: "not-saved" };

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "").trim();
  return message || "Could not save the voice key";
}

/** The desktop credential channel answers only the local server page. */
export function localCredentialChannelRefused(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw.includes(LOCAL_CREDENTIAL_CHANNEL_REFUSAL);
}

/**
 * Save one cloud voice key. The desktop channel is tried first when this
 * page has it. Server mode refuses that channel, and the key then goes to
 * the API this page is already using. A response that still does not report
 * the key connected is not a save: the caller keeps the draft and shows the
 * error. The body is only `tts.<configField>`, never the bot xAI key.
 */
export async function saveCloudVoiceKey<Name extends string, Status extends VoiceKeySaveStatus>(
  input: { credential: Name; configField: string; key: string },
  io: {
    setCredential?: (name: Name, value: string) => Promise<Status>;
    putConfig: (body: { tts: Record<string, string> }) => Promise<Status>;
  },
): Promise<VoiceKeySaveResult<Status>> {
  const key = input.key.trim();
  if (!key) return { ok: false, reason: "not-saved" };
  let status: Status | undefined;
  if (io.setCredential) {
    try {
      status = await io.setCredential(input.credential, key);
    } catch (error) {
      if (!localCredentialChannelRefused(error)) {
        return { ok: false, reason: "rejected", message: errorMessage(error) };
      }
    }
  }
  if (status?.tts?.configured !== true) {
    try {
      status = await io.putConfig({ tts: { [input.configField]: key } });
    } catch (error) {
      return { ok: false, reason: "rejected", message: errorMessage(error) };
    }
  }
  if (status?.tts?.configured !== true) return { ok: false, reason: "not-saved" };
  return { ok: true, status };
}
