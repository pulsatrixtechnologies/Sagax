// A turn that could not run on an organization server (slice 3): the
// engine is not installed, no key serves this person, or the provider
// refused the key. Shown to everyone who sees the thread; the bot's owner
// and the organization's admins also get what to do about it. Slice 6: a
// routine paused because it cannot act in its person's name; that person
// gets the button to reconnect their routines.
import { useState } from "react";
import { KeyRound } from "lucide-react";

import { t } from "@/lib/i18n";
import { startRoutineDelegation } from "@/lib/routine-delegation";
import type { WireAccessCard } from "../../shared/wire";

export type AccessViewer = { principalId: string | null; admin: boolean };

const ROUTINE_REASON_KEYS = {
  delegation_missing: "access.routineDelegation.reason.delegation_missing",
  delegation_ended: "access.routineDelegation.reason.delegation_ended",
  delegation_revoked: "access.routineDelegation.reason.delegation_revoked",
  person_out: "access.routineDelegation.reason.person_out",
  no_right: "access.routineDelegation.reason.no_right",
} as const;

/** The card's lines for this viewer: the reason, then a hint for the
 * owner or an admin. */
export function accessCardLines(access: WireAccessCard, viewer: AccessViewer): { text: string; hint?: string; detail?: string; link?: string; reconnect?: boolean } {
  const owner = Boolean(viewer.principalId && viewer.principalId.toLowerCase() === access.ownerPrincipalId.toLowerCase());
  if (access.reason === "routine_delegation") {
    const runAs = Boolean(viewer.principalId && access.runAsPrincipalId && viewer.principalId.toLowerCase() === access.runAsPrincipalId.toLowerCase());
    const reason = access.suspendReason;
    return {
      text: t("access.routineDelegation", { routine: access.routineName ?? "", person: access.runAsName || t("access.routineDelegation.someone") }),
      ...(reason ? { hint: t(ROUTINE_REASON_KEYS[reason]) } : {}),
      // A consent only helps when the delegation is what is missing.
      ...(runAs && reason !== "no_right" ? { reconnect: true } : {}),
    };
  }
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
  // Slice 4: the owner adds their own key in Perspicax (the card links there).
  if (owner && access.keysUrl) {
    return { text: t("access.noAccess", { engine: access.engine }), hint: t("access.noAccess.ownerKeys"), link: access.keysUrl };
  }
  return {
    text: t("access.noAccess", { engine: access.engine }),
    ...(viewer.admin ? { hint: t("access.noAccess.admin") } : owner ? { hint: t("access.noAccess.owner") } : {}),
  };
}

export function AccessCard({ access, viewer }: { access: WireAccessCard; viewer: AccessViewer }) {
  const lines = accessCardLines(access, viewer);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reconnect = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await startRoutineDelegation();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <div role="status" data-access-card={access.reason} className="flex w-fit max-w-full items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-[13px] text-ink">
      <KeyRound size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="break-words">{lines.text}</span>
        {lines.hint && (lines.link
          ? <a href={lines.link} target="_blank" rel="noreferrer noopener" className="break-words text-[12px] text-accent underline">{lines.hint}</a>
          : <span className="break-words text-[12px] text-ink-secondary">{lines.hint}</span>)}
        {lines.detail && <code className="break-words text-[11.5px] text-ink-secondary">{lines.detail}</code>}
        {lines.reconnect && (
          <button type="button" className="ui-button mt-1 min-h-[44px] w-fit md:min-h-0" disabled={busy} onClick={() => void reconnect()}>
            {t("access.routineDelegation.reconnect")}
          </button>
        )}
        {failed && <span role="alert" className="text-[12px] text-danger">{t("org.routineDelegation.error.generic", { code: "unavailable" })}</span>}
      </div>
    </div>
  );
}
