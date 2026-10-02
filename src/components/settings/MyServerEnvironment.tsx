// Settings > Organization > Your server environment, on a server signed in
// with Perspicax: the person's own isolated Linux environment on the server,
// shared by all their bots (never one per bot). Status, resources, last use,
// and Reset (recreate it, erasing /workspace) after a confirmation.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { loadServerEnvironment, resetServerEnvironment, type ServerEnvironmentStatus } from "@/lib/server-environment";
import { Card } from "../SettingsPrimitives";

function formatDate(ms: number | null | undefined): string {
  if (!ms) return t("serverEnvironment.never");
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function formatMb(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  return String(Math.round(bytes / 1048576));
}

export function serverEnvironmentStateText(status: ServerEnvironmentStatus | null): string {
  if (!status) return "";
  if (!status.configured) return t("serverEnvironment.notConfigured");
  if (status.pendingDeletionAt) return t("serverEnvironment.closed");
  if (status.error === "egress_policy") return t("serverEnvironment.unavailable");
  switch (status.state) {
    case "running": return t("serverEnvironment.running");
    case "stopped": return t("serverEnvironment.stopped");
    case "paused": return t("serverEnvironment.paused");
    case "missing": return t("serverEnvironment.missing");
    default: return t("serverEnvironment.unavailable");
  }
}

export function MyServerEnvironment({
  initial = null,
  confirm = (text: string) => window.confirm(text),
}: {
  initial?: ServerEnvironmentStatus | null;
  confirm?: (text: string) => boolean;
}) {
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setStatus(await loadServerEnvironment());
    } catch {
      setStatus({ configured: true, state: "unavailable" });
    }
  };
  useEffect(() => { if (!initial) void load(); }, []);

  const reset = async () => {
    if (!confirm(t("serverEnvironment.reset.confirm"))) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await resetServerEnvironment());
    } catch {
      setError(t("serverEnvironment.reset.error"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const limits = status?.limits;
  const running = status?.state === "running";
  return (
    <Card cardId="organization.serverEnvironment" title={t("serverEnvironment.title")} summary={serverEnvironmentStateText(status)}>
      <div className="flex flex-col gap-3 text-[13px]" data-server-environment={status?.state ?? (status ? "off" : "loading")}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("serverEnvironment.help")}</p>
        {!status ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin text-ink-secondary" />
        ) : !status.configured ? (
          <p role="status" className="text-ink-secondary">{t("serverEnvironment.notConfigured")}</p>
        ) : (
          <>
            <p role="status" className={running ? "text-ink" : "text-ink-secondary"}>{serverEnvironmentStateText(status)}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              {limits && (
                <>
                  <dt className="text-ink-secondary">{t("serverEnvironment.resources")}</dt>
                  <dd className="text-ink">{t("serverEnvironment.resourcesValue", { cpus: limits.cpus, memory: limits.memoryMb, disk: limits.diskMb })}</dd>
                </>
              )}
              {status.workspaceBytes !== null && status.workspaceBytes !== undefined && (
                <>
                  <dt className="text-ink-secondary">{t("serverEnvironment.used")}</dt>
                  <dd className={status.overQuota ? "text-danger" : "text-ink"}>{t("serverEnvironment.usedValue", { used: formatMb(status.workspaceBytes) })}</dd>
                </>
              )}
              <dt className="text-ink-secondary">{t("serverEnvironment.lastUsed")}</dt>
              <dd className="text-ink">{formatDate(status.lastUsedAt)}</dd>
              {status.idleMinutes ? (
                <>
                  <dt className="text-ink-secondary">{t("serverEnvironment.idle")}</dt>
                  <dd className="text-ink">{t("serverEnvironment.idleValue", { minutes: status.idleMinutes })}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-button min-h-[44px] md:min-h-0"
                disabled={Boolean(status.pendingDeletionAt) || status.state === "unavailable"}
                onClick={() => { window.open(`/desktop-viewer#${new URLSearchParams({ target: "sandbox/me" })}`, "_blank", "noopener"); }}
              >
                {t("sandboxDesktop.show")}
              </button>
              <button
                type="button"
                className="ui-button min-h-[44px] text-danger md:min-h-0"
                disabled={busy || Boolean(status.pendingDeletionAt) || status.state === "unavailable"}
                onClick={() => void reset()}
              >
                {busy ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : null}
                {t("serverEnvironment.reset")}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
