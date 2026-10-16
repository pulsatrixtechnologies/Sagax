// Settings > Security (wave 2, package E): the person's security keys and
// passkeys, and which approvals need one (shared/step-up.ts). Each person's
// own, on an organization server too. Taking a protection away (a class, a
// key) asks the key itself: the server refuses it otherwise, and the store's
// `api` runs that step-up and sends the change again.
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { registerSecurityKey, securityKeysUsable } from "@/lib/step-up-client";
import { api } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { STEP_UP_CLASSES, type SecurityKeysState, type StepUpClass } from "../../shared/step-up";
import { DescribedRow, FIELD, PILL, PRIMARY_PILL, SettingsGroup, SwitchRow } from "./SettingsPrimitives";

const CLASS_LABEL: Record<StepUpClass, LocaleKey> = {
  destructive: "security.class.destructive",
  irreversible: "security.class.irreversible",
  money: "security.class.money",
  "external-send": "security.class.externalSend",
  "always-grant": "security.class.alwaysGrant",
  "publish-page": "security.class.publishPage",
  "rule-change": "security.class.ruleChange",
};

const CLASS_HINT: Record<StepUpClass, LocaleKey> = {
  destructive: "security.class.destructive.hint",
  irreversible: "security.class.irreversible.hint",
  money: "security.class.money.hint",
  "external-send": "security.class.externalSend.hint",
  "always-grant": "security.class.alwaysGrant.hint",
  "publish-page": "security.class.publishPage.hint",
  "rule-change": "security.class.ruleChange.hint",
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SecurityKeySettings() {
  const [state, setState] = useState<SecurityKeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const usable = securityKeysUsable();

  const load = useCallback(async () => {
    try {
      setState(await api<SecurityKeysState>("/api/security-keys"));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<SecurityKeysState | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      if (next) setState(next);
      else await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (name: StepUpClass, on: boolean) => {
    if (!state) return;
    const classes = on ? [...state.classes, name] : state.classes.filter((value) => value !== name);
    void run(() => api<SecurityKeysState>("/api/security-keys/classes", { method: "PUT", body: JSON.stringify({ classes }) }));
  };

  const add = () => void run(async () => {
    await registerSecurityKey(name.trim() || t("security.keys.defaultName"));
    setName("");
  });

  const remove = (id: string) => void run(() => api<SecurityKeysState>(`/api/security-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({}) }));

  const hasKey = Boolean(state?.keys.length);
  const date = (at: number) => new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(at));
  const keyHere = state?.rpId ? state.keys.some((key) => key.rpId === state.rpId) : hasKey;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-settings-card="security">
      <p className="px-1 text-[12px] leading-relaxed text-ink-secondary">{t("security.intro")}</p>
      {error && <p role="alert" className="px-1 text-[12px] text-danger">{error}</p>}
      {state?.unreadable && <p role="alert" className="px-1 text-[12px] text-danger">{t("security.unreadable")}</p>}

      <SettingsGroup title={t("security.keys.title")} groupId="security.keys">
        {state?.keys.map((key) => (
          <DescribedRow
            key={key.id}
            rowId={`security-key-${key.id.slice(0, 12)}`}
            icon={<KeyRound size={14} />}
            label={key.name}
            description={[
              key.deviceType === "multiDevice" ? t("security.keys.passkey") : t("security.keys.hardware"),
              t("security.keys.added", { when: date(key.createdAt) }),
              key.lastUsedAt ? t("security.keys.lastUsed", { when: date(key.lastUsedAt) }) : null,
              state.rpId && key.rpId !== state.rpId ? t("security.keys.otherAddress", { address: key.rpId }) : null,
            ].filter(Boolean).join(" · ")}
          >
            <button type="button" className={PILL} disabled={busy} aria-label={t("security.keys.removeNamed", { name: key.name })} onClick={() => remove(key.id)}>
              <Trash2 size={13} aria-hidden="true" /> {t("security.keys.remove")}
            </button>
          </DescribedRow>
        ))}
        {state && !state.keys.length && <DescribedRow label={t("security.keys.none")} rowId="security-keys-none" />}
        <DescribedRow
          label={t("security.keys.add")}
          rowId="security-keys-add"
          description={!usable || !state?.rpId && !window.ogb?.securityKey ? t("security.stepUp.noAddress") : t("security.keys.addHint")}
        >
          <input
            className={`${FIELD} w-[180px]`}
            value={name}
            maxLength={80}
            placeholder={t("security.keys.namePlaceholder")}
            aria-label={t("security.keys.name")}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className={PRIMARY_PILL} disabled={busy || !usable} onClick={add}>
            {t("security.keys.addButton")}
          </button>
        </DescribedRow>
      </SettingsGroup>

      <SettingsGroup title={t("security.classes.title")} groupId="security.classes">
        <div className="flex flex-col gap-3 px-3.5 py-2.5">
          <p className="text-[12px] leading-relaxed text-ink-secondary">{hasKey ? t("security.classes.intro") : t("security.classes.needKey")}</p>
          {hasKey && !keyHere && <p role="alert" className="text-[12px] text-warning">{t("security.classes.noKeyHere")}</p>}
          {STEP_UP_CLASSES.map((value) => (
            <SwitchRow
              key={value}
              label={t(CLASS_LABEL[value])}
              description={t(CLASS_HINT[value])}
              checked={Boolean(state?.classes.includes(value))}
              disabled={busy || !state || (!hasKey && !state.classes.includes(value))}
              onChange={(on) => toggle(value, on)}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
