// Server mode in Settings (src/lib/launch.ts, electron/environments.cjs).
// While the desktop app is locked to its organization's server, Settings >
// General shows that server in place of "This computer", with the one way
// out: Change, which signs out of the server (after a native confirmation)
// and returns to the launch screen. Sections about this computer itself say
// they are managed by the organization rather than offering a local setup.
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { serverModeBridge } from "@/lib/launch";
import { Card, SettingRow } from "./SettingsPrimitives";

export type ServerModeState = { active: false } | { active: true; name: string; origin: string };

/** Server mode as the desktop reports it; null in a browser, on another
 * page, and until the desktop answers. */
export function useServerMode(): ServerModeState | null {
  const bridge = typeof window === "undefined" ? null : serverModeBridge(window.ogb);
  const [state, setState] = useState<ServerModeState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.state().then((next) => { if (alive) setState(next); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);
  return bridge ? state : null;
}

function host(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Settings > General in server mode: the organization's server, and Change. */
export function ServerModeCard({ state }: { state: Extract<ServerModeState, { active: true }> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const leave = () => {
    const bridge = serverModeBridge(window.ogb);
    if (!bridge || busy) return;
    setBusy(true);
    setFailed(false);
    // The desktop asks for confirmation, signs out and leaves this page.
    void bridge.leave().catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  return (
    <div data-settings-card="general.serverMode" className="rounded-[14px] border-[0.5px] border-border py-1">
      <SettingRow
        title={t("settings.launch.title")}
        subtitle={<>
          <span className="block">{t("settings.serverMode.connected", { server: host(state.origin) })}</span>
          <span className="block">{t("settings.serverMode.botsOnServer")}</span>
        </>}
        message={failed ? <p role="alert" className="text-danger">{t("settings.serverMode.leaveFailed")}</p> : null}
      >
        <button type="button" onClick={leave} disabled={busy} className="ui-button">
          {t("settings.launch.change")}
        </button>
      </SettingRow>
    </div>
  );
}

/** A section about this computer while its bots run on the organization's
 * server: read-only, managed there. */
export function ManagedByOrganization({ cardId, title }: { cardId: string; title: string }) {
  return (
    <Card cardId={cardId} title={title} subtitle={t("settings.serverMode.managed")}>
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
        <Building2 size={13} aria-hidden="true" />
        {t("settings.serverMode.managedShort")}
      </span>
    </Card>
  );
}
