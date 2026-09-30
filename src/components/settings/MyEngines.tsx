// Settings > Organization > My engines, on a server signed in with Perspicax
// (slice 4): for each engine, whether it is installed, who a bot of mine on
// it can answer (me only, also the people I share it with, nobody yet), my
// own subscription sign-in (Claude, Codex) and the link to my model keys in
// Perspicax. Keys are never set here: they live in Perspicax.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { answersForText, perspicaxKeysUrl, type MyEngine } from "@/lib/perspicax-org";
import { Card } from "../SettingsPrimitives";

interface LoginState {
  instanceId: string;
  flowId: string | null;
  authorizationUrl: string | null;
  userCode?: string;
  phase: string;
}


export function MyEngines({ issuer, initial = null }: { issuer: string; initial?: MyEngine[] | null }) {
  const [engines, setEngines] = useState<MyEngine[] | null>(initial);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      setEngines((await api<{ engines: MyEngine[] }>("/api/me/engines")).engines ?? []);
    } catch {
      setEngines([]);
    }
  };
  useEffect(() => {
    void load();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };
  const watch = (instanceId: string, flowId: string) => {
    stopPolling();
    poll.current = setInterval(() => {
      void api<{ auth: { phase: string } }>(`/api/me/engines/${instanceId}/login/status?flowId=${encodeURIComponent(flowId)}`)
        .then(({ auth }) => {
          if (auth.phase === "waiting") return;
          stopPolling();
          setLogin(null);
          if (auth.phase !== "succeeded") setError(t("myEngines.failed"));
          void load();
        })
        .catch(() => { stopPolling(); setLogin(null); setError(t("myEngines.failed")); });
    }, 1500);
  };

  const post = (instanceId: string, action: string, body: unknown = {}) =>
    api<{ auth?: LoginState }>(`/api/me/engines/${instanceId}/login/${action}`, { method: "POST", body: JSON.stringify(body) });

  const signIn = async (engine: MyEngine) => {
    setBusy(engine.instanceId);
    setError("");
    try {
      const { auth } = await post(engine.instanceId, "start");
      if (!auth || auth.phase === "succeeded") {
        await load();
        return;
      }
      setLogin({ ...auth, instanceId: engine.instanceId });
      if (auth.flowId) watch(engine.instanceId, auth.flowId);
    } catch {
      setError(t("myEngines.failed"));
    } finally {
      setBusy(null);
    }
  };
  const complete = async () => {
    if (!login?.flowId || !code.trim()) return;
    setBusy(login.instanceId);
    try {
      await post(login.instanceId, "complete", { flowId: login.flowId, code: code.trim() });
      setCode("");
    } catch {
      setError(t("myEngines.failed"));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!login) return;
    stopPolling();
    try { await post(login.instanceId, "cancel", { flowId: login.flowId }); } catch { /* the flow ends anyway */ }
    setLogin(null);
  };
  const signOut = async (engine: MyEngine) => {
    setBusy(engine.instanceId);
    try {
      await post(engine.instanceId, "sign-out");
      await load();
    } catch {
      setError(t("myEngines.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card cardId="organization.myEngines" title={t("myEngines.title")}>
      <div className="flex flex-col gap-3 text-[13px]" data-my-engines>
        <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener" className="ui-button flex w-fit items-center gap-1.5">
          <ExternalLink size={13} aria-hidden="true" />
          {t("myEngines.manageKeys")}
        </a>
        {engines === null ? (
          <Loader2 size={14} className="animate-spin text-ink-secondary" aria-hidden="true" />
        ) : (
          <ul className="flex flex-col divide-y divide-hairline/40">
            {engines.map((engine) => (
              <li key={engine.instanceId} className="flex min-w-0 flex-col gap-1.5 py-2" data-my-engine={engine.instanceId}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="truncate text-ink">{engine.displayName}</span>
                  {engine.installed && engine.subscription.supported && (
                    engine.subscription.signedIn ? (
                      <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void signOut(engine)}>{t("myEngines.signOut")}</button>
                    ) : (
                      <button type="button" className="ui-button" disabled={busy !== null || login !== null} onClick={() => void signIn(engine)}>
                        {busy === engine.instanceId ? <Loader2 size={12} className="animate-spin" /> : null}
                        {t("myEngines.signIn")}
                      </button>
                    )
                  )}
                </div>
                <span className="text-[12px] text-ink-secondary">{answersForText(engine)}</span>
                {engine.subscription.signedIn && <span className="text-[12px] text-ink-secondary">{t("myEngines.signedIn")}</span>}
                {login?.instanceId === engine.instanceId && (
                  <div className="flex flex-col gap-2 rounded-lg border border-hairline/40 p-3">
                    {login.userCode && <span className="font-mono text-[13px] text-ink">{t("myEngines.code", { code: login.userCode })}</span>}
                    {login.authorizationUrl && (
                      <a href={login.authorizationUrl} target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent underline">{t("myEngines.openLink")}</a>
                    )}
                    {!login.userCode && (
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                          placeholder={t("myEngines.pasteCode")}
                          aria-label={t("myEngines.pasteCode")}
                          className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink"
                        />
                        <button type="button" className="ui-button" disabled={!code.trim() || busy !== null} onClick={() => void complete()}>{t("myEngines.complete")}</button>
                      </div>
                    )}
                    <button type="button" className="ui-button w-fit" onClick={() => void cancel()}>{t("myEngines.cancel")}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
