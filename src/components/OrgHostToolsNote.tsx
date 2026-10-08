// On an organization server: why an engine cannot run there (its own shell,
// file and web tools cannot be held back; shared/org-engines.ts). The same
// words as the server's 409 `host_tools`, on the engine card and in the
// model picker.
import type { InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { orgHostToolsReason, type OrgHostToolsReason } from "../../shared/org-engines";

const WHY_KEY = {
  "acp-ignores-selection": "model.org.hostToolsWhy.acpIgnoresSelection",
  "service-chosen-tools": "model.org.hostToolsWhy.serviceChosenTools",
  unverified: "model.org.hostToolsWhy.unverified",
} as const satisfies Record<OrgHostToolsReason, string>;

/** True when an organization server refuses this engine's turns. */
export function orgRefusesEngine(instance: Pick<InstanceInfo, "capabilities">): boolean {
  return instance.capabilities?.withholdsHostTools !== true;
}

export function orgHostToolsText(instance: Pick<InstanceInfo, "displayName" | "driverKind">): string {
  return `${t("model.org.hostTools", { name: instance.displayName })} ${t(WHY_KEY[orgHostToolsReason(instance.driverKind)])}`;
}

export function OrgHostToolsNote({ instance, className }: { instance: Pick<InstanceInfo, "displayName" | "driverKind" | "instanceId">; className?: string }) {
  return (
    <p data-model-host-tools={instance.instanceId} className={cn("text-[11.5px] leading-relaxed text-ink-tertiary", className)}>
      {orgHostToolsText(instance)}
    </p>
  );
}
