// One engine's own access for the signed-in person on an organization server
// (Perspicax), drawn the same way in Settings > Model providers and in the
// model picker: one status line ("Pays with: ..."), one button ("Connect
// ChatGPT", "Connect Claude", ...) or "Connected" with Disconnect, and a small
// "Manage my keys in Perspicax" link while no subscription is signed in on an
// engine whose provider key a person can keep in Perspicax. The payer order
// itself stays the server's (server/engine-credentials.ts, `myTurns` on
// GET /api/me/engines); the subscription signs in through
// `/api/me/engines/<id>/login`, never the server's own engine login.
import { useState } from "react";
import { Check, ExternalLink, Loader2, LogOut } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { perspicaxKeysUrl, type MyEngine } from "@/lib/perspicax-org";
import { keyProviderDriver } from "@/lib/model-payers";
import { ClaudeSignIn } from "./ClaudeSignIn";
import { DeviceSignIn } from "./DeviceSignIn";
import { MyEngineAccess } from "./settings/MyEngines";

/** The name on the Connect button: the account people sign in with. */
export function connectName(engine: Pick<MyEngine, "driver" | "displayName">): string {
  switch (engine.driver) {
    case "codex": return "ChatGPT";
    case "claudeAgent": return "Claude";
    case "grokAgent": return "Grok";
    case "kimiAgent": return "Kimi";
    case "geminiAgent": return "Gemini";
    default: return engine.displayName;
  }
}

/** The one status line: what pays for the person's turns today. */
export function paysWithText(engine: Pick<MyEngine, "myTurns" | "installed">): string {
  if (!engine.installed) return t("myEngines.notInstalled");
  if (engine.myTurns === "subscription") return t("engineConnect.paysWith.subscription");
  if (engine.myTurns === "key") return t("engineConnect.paysWith.key");
  if (engine.myTurns === "org-key") return t("engineConnect.paysWith.orgKey");
  return t("engineConnect.notConnected");
}

export function EngineConnect({ engine, issuer, onChanged, className }: {
  engine: MyEngine;
  issuer: string;
  /** Reload the person's engines after a sign-in or sign-out. */
  onChanged: () => Promise<unknown> | void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loginBase = `/api/me/engines/${encodeURIComponent(engine.instanceId)}/login`;
  const name = connectName(engine);
  const { supported, signedIn } = engine.subscription;
  const keysApply = engine.installed && !signedIn && keyProviderDriver(engine.driver);

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`${loginBase}/sign-out`, { method: "POST", body: "{}" });
      await onChanged();
    } catch {
      setError(t("myEngines.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-engine-connect={engine.instanceId} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <p data-pays-with={engine.installed ? engine.myTurns : "not-installed"} className="text-[12px] text-ink-secondary">{paysWithText(engine)}</p>
      {engine.installed && supported && (signedIn ? (
        <div data-engine-connected className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{t("engineConnect.connected")}</span>
          <button type="button" disabled={busy} onClick={() => void disconnect()}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <LogOut size={12} aria-hidden="true" />}
            {t("engineConnect.disconnect")}
          </button>
        </div>
      ) : (
        <div data-engine-connect-button className="[&>div]:mt-0">
          {engine.driver === "claudeAgent"
            ? <ClaudeSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />
            : engine.driver === "codex"
              ? <DeviceSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />
              // Grok Build and Kimi Code: a device code on the provider's own page
              : <MyEngineAccess key={engine.instanceId} engine={engine} label={t("engineConnect.connect", { name })} onChanged={() => { void onChanged(); }} />}
        </div>
      ))}
      {keysApply && (
        <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener" data-engine-keys-link
          className="flex w-fit items-center gap-1 text-[11.5px] text-ink-secondary hover:text-ink hover:underline">
          {t("myEngines.manageKeys")} <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </section>
  );
}
