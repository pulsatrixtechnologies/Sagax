// A turn that could not run on an organization server (slice 3): the
// engine is not installed, no credentials serve the turn, or the provider
// refused the key. Since 2026-10-01 the person who speaks pays (the bot's
// owner for its routines), and the server sends the card to that person only
// (accessCardAudience in server/engine-access.ts): it speaks to them ("you"),
// with what to do (sign in with their own subscription, add their key in
// Perspicax) and, for an admin only, where the organization's key lives. The
// third-person lines remain for a viewer the card is not about (a card the
// server still shares: a refused organization key). Slice 6: a routine
// paused because it cannot act in its person's name; that person gets the
// button to reconnect their routines.
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

export interface AccessCardLines {
  text: string;
  hint?: string;
  detail?: string;
  /** Where the viewer adds their own key (Perspicax console). */
  link?: { href: string; label: string };
  /** The viewer can sign in with their own subscription for this engine
   * (Settings > Model providers > My subscriptions and keys). */
  signIn?: boolean;
  reconnect?: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** The card's lines for this viewer: the reason, then what the person whose
 * credentials the turn needed can do, or an admin. */
export function accessCardLines(access: WireAccessCard, viewer: AccessViewer): AccessCardLines {
  const owner = same(viewer.principalId, access.ownerPrincipalId);
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
  const engine = access.engine;
  // whose credentials the turn needed: the speaker, or the owner for a
  // routine; a card from before payerPrincipalId is the owner's (as on the server)
  const payer = access.payerPrincipalId || access.ownerPrincipalId;
  const mine = same(viewer.principalId, payer);
  const admin = viewer.admin ? { hint: t("access.noAccess.admin.orgKey") } : {};
  // the person it is about, an admin: the organization's key is theirs to set too
  const mineAdmin = viewer.admin ? { hint: t("access.noAccess.mine.admin") } : {};
  if (access.cause === "payer_disabled") {
    if (access.routine || access.payer === "owner") return { text: t(mine ? "access.payerDisabled.routineMine" : "access.payerDisabled.owner") };
    return mine ? { text: t("access.payerDisabled.speaker") } : { text: t("access.noAccess.other", { engine }) };
  }
  const own = {
    ...(access.keysUrl ? { link: { href: access.keysUrl, label: t("access.addKey") } } : {}),
    ...(access.subscriptionSignIn ? { signIn: true } : {}),
  };
  if (access.routine) {
    return mine
      ? { text: t("access.noAccess.routineMine", { engine }), ...mineAdmin, ...own }
      : { text: t("access.noAccess.routine", { engine }), ...admin };
  }
  if (mine) return { text: t("access.noAccess.mine", { engine }), ...mineAdmin, ...own };
  return { text: t("access.noAccess.other", { engine }), ...admin };
}

export function AccessCard({ access, viewer, onSignIn }: { access: WireAccessCard; viewer: AccessViewer; onSignIn?: () => void }) {
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
        {lines.hint && <span className="break-words text-[12px] text-ink-secondary">{lines.hint}</span>}
        {(lines.signIn && onSignIn) || lines.link ? (
          <div className="flex flex-wrap items-center gap-2">
            {lines.signIn && onSignIn && (
              <button type="button" className="ui-button min-h-[44px] w-fit md:min-h-0" onClick={onSignIn} data-access-sign-in>
                {t("access.signIn")}
              </button>
            )}
            {lines.link && (
              <a href={lines.link.href} target="_blank" rel="noreferrer noopener" className="break-words text-[12px] text-accent underline" data-access-add-key>{lines.link.label}</a>
            )}
          </div>
        ) : null}
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
