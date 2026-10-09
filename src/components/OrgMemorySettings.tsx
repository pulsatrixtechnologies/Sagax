// Settings > Memory (desktop): the organization memory of Perspicax cached
// on this computer, for Obsidian (Perspicax lot A.4). The vault lives under
// Application Support, out of iCloud Drive, OneDrive and Time Machine, and
// is erased when the organization is disconnected or Perspicax refuses the
// token. The work is the main process's (electron/org-memory-cache.mjs);
// this page connects, syncs, shows the pending review items, writes the
// recommended .obsidian folder and opens the vault in Obsidian.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  orderedItems,
  orgMemoryPhase,
  suggestedServer,
  tiersNeedingAttention,
  tokenPageUrl,
  type OrgMemoryBridge,
  type OrgMemoryItem,
  type OrgMemoryState,
  type OrgMemoryTier,
} from "@/lib/org-memory";
import type { LocaleKey } from "@/locales";
import { SettingRow } from "./SettingsPrimitives";

const PUSH_KEY: Record<string, LocaleKey> = {
  direct: "settings.memory.push.direct",
  auto: "settings.memory.push.auto",
  review: "settings.memory.push.review",
};
const STATUS_KEY: Record<OrgMemoryTier["status"], LocaleKey> = {
  cloned: "settings.memory.status.cloned",
  pushed: "settings.memory.status.pushed",
  "up-to-date": "settings.memory.status.up-to-date",
  refused: "settings.memory.status.refused",
  conflict: "settings.memory.status.conflict",
  error: "settings.memory.status.error",
};
const STATE_KEY: Record<OrgMemoryItem["state"], LocaleKey> = {
  pending: "settings.memory.state.pending",
  approved: "settings.memory.state.approved",
  refused: "settings.memory.state.refused",
  returned: "settings.memory.state.returned",
  expired: "settings.memory.state.expired",
};

const inputClass = "mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[14px] text-ink disabled:opacity-50";

export function OrgMemorySettings() {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.orgMemory;
  const org = usePerspicaxOrg();
  if (!bridge) {
    return <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.memory.desktopOnly")}</p>;
  }
  return <OrgMemoryPanel bridge={bridge} issuer={org?.org.identity.issuer ?? null} />;
}

export function OrgMemoryPanel({ bridge, issuer, initial = null }: { bridge: OrgMemoryBridge; issuer: string | null; initial?: OrgMemoryState | null }) {
  const [state, setState] = useState<OrgMemoryState | null>(initial);
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [action, setAction] = useState<null | "connect" | "sync" | "erase" | "obsidian">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    let alive = true;
    void bridge.state().then((s) => { if (alive) setState(s); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);

  const run = async (kind: NonNullable<typeof action>, work: () => Promise<OrgMemoryState | boolean>) => {
    setAction(kind);
    setError(null);
    try {
      const next = await work();
      if (typeof next === "object") setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAction(null);
    }
  };

  const phase = orgMemoryPhase(state);
  const address = server || suggestedServer(issuer);
  const tokenPage = tokenPageUrl(state?.server ?? address);
  const attention = tiersNeedingAttention(state);
  const items = orderedItems(state?.pending ?? []);

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.memory.intro")}</p>
      {state?.cloudFolder && <p role="alert" className="text-[13px] text-danger">{t("settings.memory.cloudFolder", { place: state.cloudFolder })}</p>}
      {state?.lastError && <p role="alert" className="text-[13px] text-warning">{state.lastError}</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}

      {phase === "disconnected" ? (
        <form
          className="rounded-[14px] border-[0.5px] border-border p-3.5 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("connect", () => bridge.connect({ server: address, token }).then((s) => { setToken(""); return s; }));
          }}
        >
          <label className="block text-[13px]">
            {t("settings.memory.server")}
            <input type="url" value={address} onChange={(e) => setServer(e.target.value)} placeholder="https://pulsatrix.example.com"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={action !== null} className={inputClass} />
          </label>
          <label className="block text-[13px]">
            {t("settings.memory.token")}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pxat1."
              spellCheck={false} disabled={action !== null} className={inputClass} />
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-secondary">
            {t("settings.memory.tokenHint")}{" "}
            {tokenPageUrl(address) && (
              <button type="button" className="text-accent hover:underline" onClick={() => void openExternalLink(tokenPageUrl(address) as string)}>
                {t("settings.memory.tokenPage")}
              </button>
            )}
          </p>
          <button type="submit" className="ui-button" disabled={action !== null || !address || !token}>
            {action === "connect" ? t("settings.memory.connecting") : t("settings.memory.connect")}
          </button>
        </form>
      ) : (
        <div className="rounded-[14px] border-[0.5px] border-border py-1">
          <SettingRow
            title={t("settings.memory.sync")}
            subtitle={state?.lastSyncAt ? t("settings.memory.lastSync", { when: new Date(state.lastSyncAt).toLocaleString() }) : t("settings.memory.neverSynced")}
          >
            <button type="button" className="ui-button" disabled={action !== null || state?.busy} onClick={() => void run("sync", () => bridge.sync())}>
              {action === "sync" || state?.busy ? t("settings.memory.syncing") : t("settings.memory.syncNow")}
            </button>
          </SettingRow>
          <SettingRow title={t("settings.memory.pending")} subtitle={t("settings.memory.pendingHint")}>
            <span className="text-[13px] tabular-nums">{t("settings.memory.pendingCount", { count: String(state?.pendingCount ?? 0) })}</span>
          </SettingRow>
          <SettingRow title={t("settings.memory.obsidian")} subtitle={state?.obsidianConfigured ? t("settings.memory.obsidianReady") : t("settings.memory.obsidianHint")}>
            <div className="flex flex-wrap gap-2">
              {!state?.obsidianConfigured && (
                <button type="button" className="ui-button" disabled={action !== null || !state?.cloned} onClick={() => void run("obsidian", () => bridge.writeObsidianConfig())}>
                  {t("settings.memory.obsidianConfig")}
                </button>
              )}
              <button type="button" className="ui-button" disabled={action !== null || !state?.cloned} onClick={() => void run("obsidian", () => bridge.openInObsidian())}>
                {t("settings.memory.openInObsidian")}
              </button>
            </div>
          </SettingRow>
          <SettingRow title={t("settings.memory.folder")} subtitle={<span className="break-all font-mono text-[11.5px]">{state?.vault}</span>}>
            {confirmErase ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-button text-danger" disabled={action !== null}
                  onClick={() => { setConfirmErase(false); void run("erase", () => bridge.erase()); }}>
                  {t("settings.memory.eraseConfirm")}
                </button>
                <button type="button" className="ui-button" onClick={() => setConfirmErase(false)}>{t("settings.memory.cancel")}</button>
              </div>
            ) : (
              <button type="button" className="ui-button text-danger" disabled={action !== null} onClick={() => setConfirmErase(true)}>
                {t("settings.memory.erase")}
              </button>
            )}
          </SettingRow>
        </div>
      )}

      {phase !== "disconnected" && (state?.tiers.length ?? 0) > 0 && (
        <ul className="space-y-1 text-[13px]" aria-label={t("settings.memory.tiers")}>
          {state?.tiers.map((tier) => (
            <li key={tier.name}>
              <span className="font-medium">{tier.label}</span>{" "}
              <span className="text-ink-secondary">({tier.name}, {t(PUSH_KEY[tier.push] ?? PUSH_KEY.review)})</span>{": "}
              <span className={attention.includes(tier) ? "text-warning" : "text-ink-secondary"}>{t(STATUS_KEY[tier.status] ?? STATUS_KEY.error)}</span>
              {tier.messages.length > 0 && (
                <ul className="ml-4 list-disc text-[12px] text-ink-secondary">
                  {tier.messages.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {phase !== "disconnected" && items.length > 0 && (
        <ul className="space-y-1 text-[13px]" aria-label={t("settings.memory.pending")}>
          {items.map((item, i) => (
            <li key={item.id ?? i}>
              <span className={item.state === "refused" ? "text-danger" : item.state === "pending" ? "text-warning" : "text-ink-secondary"}>{t(STATE_KEY[item.state] ?? STATE_KEY.pending)}</span>{" "}
              {item.title} <span className="text-ink-secondary">({item.tier}{item.edit_of ? `, ${t("settings.memory.edit")}` : ""})</span>
              {item.reason && <span className="text-ink-secondary">: {item.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {phase !== "disconnected" && tokenPage && (
        <p className="text-[11.5px] text-ink-secondary">
          <button type="button" className="text-accent hover:underline" onClick={() => void openExternalLink(tokenPage)}>{t("settings.memory.tokenPage")}</button>
        </p>
      )}
    </div>
  );
}
