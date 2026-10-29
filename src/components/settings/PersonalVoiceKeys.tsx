// Settings > Models and voice > My voice keys (#1098, 2026-10-28): the
// person's own ElevenLabs, Fish Audio, xAI and OpenAI keys on an organization
// server. Theirs, no admin right: the server uses them for their own speech
// and voice notes, in place of the organization's key for the same engine
// (server/routes/person-voice-keys.ts). The organization's shared keys stay
// with engines.manage. A key is sent once and never comes back: only that
// one is saved and its last four characters.
//
// An older organization server has no such route (shared/server-features.ts):
// the group stays, disabled, with "Available after the server update." in
// place of a red error.
import { useEffect, useState } from "react";
import { Mic } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import { api } from "@/state/store";
import {
  PERSONAL_VOICE_KEY_LABELS,
  PERSONAL_VOICE_KEY_PROVIDERS,
  type PersonalVoiceKeyProvider,
  type PersonalVoiceKeysView,
} from "../../../shared/person-voice-keys";
import { DescribedRow, FIELD, FieldRow, PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

export const PERSONAL_VOICE_KEYS_PATH = "/api/me/voice-keys";

/** The grey line under the row: which of the person's keys are saved. */
export function personalVoiceKeysSummary(view: PersonalVoiceKeysView | null): string {
  const saved = view ? PERSONAL_VOICE_KEY_PROVIDERS.filter((provider) => view[provider]?.configured) : [];
  if (!saved.length) return t("voiceKeys.summary.none");
  return t("voiceKeys.summary.saved", { providers: saved.map((provider) => PERSONAL_VOICE_KEY_LABELS[provider]).join(", ") });
}

export function PersonalVoiceKeys() {
  const [view, setView] = useState<PersonalVoiceKeysView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [provider, setProvider] = useState<PersonalVoiceKeyProvider>("elevenlabs");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [routeMissing, setRouteMissing] = useState(false);
  const missing = useServerFeature("personalVoiceKeys") === "no";

  useEffect(() => {
    if (missing) return;
    let live = true;
    api<PersonalVoiceKeysView>(PERSONAL_VOICE_KEYS_PATH).then((next) => { if (live) setView(next); }).catch((failure) => {
      if (!live) return;
      // An older server without the route: the update brings it.
      if (featureMissingOnServer("personalVoiceKeys", failure)) { setRouteMissing(true); return; }
      // A solo server (404) or no person behind this session: nothing to show.
      setHidden(true);
    });
    return () => { live = false; };
  }, [missing]);

  if (hidden) return null;
  if (missing || routeMissing) {
    return (
      <div data-settings-card="connections.voiceKeys" data-personal-voice-keys="" data-needs-server-update="">
        <SettingsGroup title={t("voiceKeys.title")} groupId="voiceKeys">
          <DescribedRow label={t("voiceKeys.provider")} description={t("serverRoute.needsUpdate")} help={t("voiceKeys.help")} icon={<Mic size={14} />} rowId="voiceKeys.provider">
            <PillSelect<PersonalVoiceKeyProvider>
              value={provider}
              ariaLabel={t("voiceKeys.provider")}
              disabled
              options={PERSONAL_VOICE_KEY_PROVIDERS.map((id) => ({ value: id, label: PERSONAL_VOICE_KEY_LABELS[id] }))}
              onChange={() => {}}
            />
          </DescribedRow>
        </SettingsGroup>
      </div>
    );
  }

  const row = view?.[provider];
  const run = async (work: () => Promise<PersonalVoiceKeysView>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      setView(await work());
      setKey("");
      setNote({ text: done, error: false });
    } catch (failure) {
      if (featureMissingOnServer("personalVoiceKeys", failure)) { setRouteMissing(true); return; }
      setNote({ text: readableErrorMessage(failure, t("voiceKeys.error")), error: true });
    } finally {
      setBusy(false);
    }
  };
  const path = `${PERSONAL_VOICE_KEYS_PATH}/${provider}`;

  return (
    <div data-settings-card="connections.voiceKeys" data-personal-voice-keys="">
      <SettingsGroup title={t("voiceKeys.title")} groupId="voiceKeys">
        <DescribedRow
          label={t("voiceKeys.provider")}
          description={personalVoiceKeysSummary(view)}
          help={t("voiceKeys.help")}
          icon={<Mic size={14} />}
          rowId="voiceKeys.provider"
        >
          <PillSelect<PersonalVoiceKeyProvider>
            value={provider}
            ariaLabel={t("voiceKeys.provider")}
            disabled={busy || view === null}
            options={PERSONAL_VOICE_KEY_PROVIDERS.map((id) => ({ value: id, label: PERSONAL_VOICE_KEY_LABELS[id] }))}
            onChange={(next) => { setProvider(next); setKey(""); setNote(null); }}
          />
        </DescribedRow>
        <FieldRow
          label={t("voiceKeys.key", { provider: PERSONAL_VOICE_KEY_LABELS[provider] })}
          hint={row?.configured
            ? (row.last4 ? t("voiceKeys.key.savedLast4", { last4: row.last4 }) : t("voiceKeys.key.saved"))
            : t("voiceKeys.key.hint")}
          rowId="voiceKeys.key"
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
            data-voice-key-input={provider}
            placeholder={row?.configured ? t("voiceKeys.key.replace") : t("voiceKeys.key.placeholder")}
            value={key}
            disabled={busy || view === null}
            onChange={(event) => setKey(event.target.value)}
          />
        </FieldRow>
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
          <button
            type="button"
            className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0"
            disabled={busy || !key.trim()}
            onClick={() => void run(() => api<PersonalVoiceKeysView>(path, { method: "PUT", body: JSON.stringify({ key: key.trim() }) }), t("voiceKeys.saved"))}
          >
            {t("voiceKeys.save")}
          </button>
          {row?.configured && (
            <button
              type="button"
              className={cn(PILL, "text-danger")}
              disabled={busy}
              onClick={() => void run(() => api<PersonalVoiceKeysView>(path, { method: "DELETE" }), t("voiceKeys.removed"))}
            >
              {t("voiceKeys.remove")}
            </button>
          )}
        </div>
        {note && (
          <p role={note.error ? "alert" : "status"} className={cn("px-3.5 pb-2 text-[12px]", note.error ? "text-danger" : "text-ink-secondary")}>
            {note.text}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}
