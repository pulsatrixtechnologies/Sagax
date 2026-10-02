// The words for the state of a person's server environment (their own
// isolated Linux environment on an organization server, shared by all their
// bots). Its card lives in Settings > Computer (OrgComputerSettings.tsx).
import { t } from "@/lib/i18n";
import type { ServerEnvironmentStatus } from "@/lib/server-environment";

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
