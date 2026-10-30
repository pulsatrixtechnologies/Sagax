import { useEffect, useState } from "react";
import { routeMissingOnServer } from "@/lib/server-route";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { reloadMyEngines } from "@/lib/perspicax-org";
import type { ProviderAccountsView } from "../../shared/provider-accounts";

const CHANGED = "sagax:provider-accounts";
export const PROVIDER_ACCOUNTS_PATH = "/api/me/providers";

export function providerAccountsChanged() {
  window.dispatchEvent(new Event(CHANGED));
  void reloadMyEngines().catch(() => {});
}

export function useProviderAccounts() {
  const [view, setView] = useState<ProviderAccountsView | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let generation = 0;
    let live = true;
    const load = () => {
      const request = ++generation;
      api<ProviderAccountsView>(PROVIDER_ACCOUNTS_PATH).then((next) => {
        if (live && request === generation) { setView(next); setError(null); setUnavailable(null); }
      }, (failure: Error) => { if (live && request === generation) {
        if ((failure as Error & { body?: { code?: unknown } }).body?.code === "provider_accounts_update_required") { setUnavailable(t("providers.organizationUpdate")); setError(null); }
        else if (routeMissingOnServer(failure)) { setUnavailable(t("serverRoute.needsUpdate")); setError(null); }
        else { setError(failure.message); setUnavailable(null); }
      } });
    };
    load();
    window.addEventListener(CHANGED, load);
    return () => { live = false; window.removeEventListener(CHANGED, load); };
  }, []);
  return { view, error, unavailable };
}
