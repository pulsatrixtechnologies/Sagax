// The model picker on an organization server (Perspicax): who pays for this
// person's turns on the engine being browsed, in the server's order
// (src/lib/model-payers.ts), and the person's own subscription sign-in
// through the organization server (`/api/me/engines/<id>/login`). The
// server's own engine login is an admin setting in Settings and never
// signed in from here.
import { useState } from "react";
import { Check, Circle, ExternalLink, Loader2, LogOut } from "lucide-react";

import { api, type InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { answersForText, perspicaxKeysUrl, type MyEngine } from "@/lib/perspicax-org";
import { payerOrder, type PayerId } from "@/lib/model-payers";
import { ClaudeSignIn } from "./ClaudeSignIn";
import { CodexDeviceSignIn } from "./CodexDeviceSignIn";

const PAYER_LABEL: Record<PayerId, LocaleKey> = {
  subscription: "model.payer.subscription",
  ownerKey: "model.payer.ownerKey",
  server: "model.payer.server",
  orgKey: "model.payer.orgKey",
};

export function ModelPickerPayers({ engine, instance, issuer, admin, onChanged }: {
  engine: MyEngine;
  instance: InstanceInfo;
  issuer: string;
  admin: boolean;
  /** Reload the person's engines after a sign-in or sign-out. */
  onChanged: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const order = payerOrder(engine, { admin, serverSignedIn: instance.snapshot.authenticated !== false });
  const loginBase = `/api/me/engines/${encodeURIComponent(engine.instanceId)}/login`;
  const family = engine.driver === "claudeAgent" ? "Claude" : engine.driver === "codex" ? "OpenAI" : engine.displayName;

  const signOut = async () => {
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

  const status = (id: PayerId, ready: boolean): string => {
    if (id === "subscription") return ready ? t("model.payer.signedIn") : t("model.payer.notSignedIn");
    if (id === "ownerKey") return ready ? t("model.payer.keySet") : t("model.payer.keyMissing");
    if (id === "server") return ready ? t("model.payer.serverReady") : t("model.payer.serverMissing");
    return ready ? t("model.payer.orgKeyOn") : t("model.payer.orgKeyOff");
  };

  return (
    <section data-model-payers aria-labelledby="model-payers-title" className="rounded-xl border border-hairline/40 bg-control/30 p-3">
      <h3 id="model-payers-title" className="text-[12.5px] font-semibold text-ink">{t("model.payer.title")}</h3>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("model.payer.hint")}</p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {order.rows.map((row, index) => {
          const current = order.current === row.id;
          return (
            <li key={row.id} data-payer={row.id} data-payer-ready={row.ready} aria-current={current ? "true" : undefined}
              className={cn("flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px]", current && "bg-success/10")}>
              <span className="mt-px w-4 shrink-0 text-right text-[11px] tabular-nums text-ink-tertiary">{index + 1}.</span>
              {row.ready
                ? <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                : <Circle size={12} className="mt-1 shrink-0 text-ink-tertiary" aria-hidden="true" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-ink">{t(PAYER_LABEL[row.id], { name: family })}</span>
                <span className="text-[11.5px] text-ink-secondary">{status(row.id, row.ready)}</span>
              </span>
              {current && <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[10.5px] font-medium text-success">{t("model.payer.current")}</span>}
              {row.id === "ownerKey" && (
                <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener"
                  className="flex shrink-0 items-center gap-1 text-[11.5px] text-accent hover:underline">
                  {t("myEngines.manageKeys")} <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
              {row.id === "subscription" && row.ready && (
                <button type="button" disabled={busy} onClick={() => void signOut()}
                  className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
                  {busy ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <LogOut size={11} aria-hidden="true" />}
                  {t("myEngines.signOut")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p data-answers-for={engine.answersFor} className="mt-2 text-[11.5px] text-ink-secondary">{answersForText(engine)}</p>
      {!order.current && engine.installed && <p role="status" className="mt-1 text-[11.5px] text-warning">{t("model.payer.none")}</p>}
      {engine.installed && engine.subscription.supported && !engine.subscription.signedIn && (
        <div data-model-personal-sign-in className="mt-3 border-t border-hairline/40 pt-3">
          <div className="text-[12.5px] font-medium text-ink">{t("model.payer.signInTitle", { name: family })}</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("model.payer.signInHint")}</p>
          {engine.driver === "claudeAgent"
            ? <ClaudeSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />
            : <CodexDeviceSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
