// A turn that could not run on an organization server (slice 3): the
// engine is not installed, no key serves this person, or the provider
// refused the key. Shown to everyone who sees the thread; the bot's owner
// and the organization's admins also get what to do about it.
import { KeyRound } from "lucide-react";

import { t } from "@/lib/i18n";
import type { WireAccessCard } from "../../shared/wire";

export type AccessViewer = { principalId: string | null; admin: boolean };

/** The card's lines for this viewer: the reason, then a hint for the
 * owner or an admin. */
export function accessCardLines(access: WireAccessCard, viewer: AccessViewer): { text: string; hint?: string; detail?: string } {
  const owner = Boolean(viewer.principalId && viewer.principalId.toLowerCase() === access.ownerPrincipalId.toLowerCase());
  if (access.reason === "engine_missing") {
    return { text: t("access.engineMissing", { engine: access.engine }), ...(owner && !viewer.admin ? { hint: t("access.engineMissing.owner") } : {}) };
  }
  if (access.reason === "key_refused") {
    return {
      text: t("access.keyRefused"),
      ...(viewer.admin ? { hint: t("access.keyRefused.admin") } : {}),
      ...((owner || viewer.admin) && access.detail ? { detail: access.detail } : {}),
    };
  }
  return {
    text: t("access.noAccess", { engine: access.engine }),
    ...(viewer.admin ? { hint: t("access.noAccess.admin") } : owner ? { hint: t("access.noAccess.owner") } : {}),
  };
}

export function AccessCard({ access, viewer }: { access: WireAccessCard; viewer: AccessViewer }) {
  const lines = accessCardLines(access, viewer);
  return (
    <div role="status" data-access-card={access.reason} className="flex w-fit max-w-full items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-[13px] text-ink">
      <KeyRound size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="break-words">{lines.text}</span>
        {lines.hint && <span className="break-words text-[12px] text-ink-secondary">{lines.hint}</span>}
        {lines.detail && <code className="break-words text-[11.5px] text-ink-secondary">{lines.detail}</code>}
      </div>
    </div>
  );
}
