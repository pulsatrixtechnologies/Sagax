// Pending approval, ported from the upstream pattern: an approval does
// not sit in the transcript waiting to be noticed — it takes over the
// composer. The prompt is disabled, a strip above it says exactly what
// is being asked, and the send row is replaced by the decisions.
//
// Faithful details worth keeping: one at a time with an "n of N" counter,
// the detail printed raw in a monospace block that is NEVER truncated
// (it scrolls instead), and the buttons ordered least-destructive-last so
// the primary action sits under your thumb.
import { memo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { toolApprovalView, toolLabel } from "./ApprovalCard";
import { ApprovalHeading, TechnicalDetails } from "./ApprovalParts";
import { describeApproval, isTechnicalText } from "@/lib/approval-describe";
import { reviewedSkillSha256 } from "../../shared/skill-request";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";

interface ApprovalLabels {
  [tool: string]: LocaleKey;
}

export interface Pending {
  message: Message;
  requestId: string;
  tool: string;
  /** the narrow grant "always allow" writes, computed server-side */
  allowKey?: string;
  allowSession?: boolean;
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  detail: string;
  held?: string;
  heldCode?: string;
}

/** The persisted payload is the authoritative marker. Tool names are
 * provider-authored display strings and can collide with ours. */
export function isRoutineApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.routineRequest);
}

export function isSkillApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.skillRequest);
}

export function isProfileApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.profileRequest);
}

/** Open approvals on a thread, oldest first — answered/dismissed drop out. */
export function pendingApprovals(messages: Message[]): Pending[] {
  return messages
    // An expired proposal is terminal: it must not take over the composer
    // or offer its decision buttons anywhere.
    .filter((m) => m.kind === "options" && m.card?.requestId && m.card.tool && !m.card.answered && !m.card.dismissed && !m.card.expired)
    .map((m) => ({
      message: m,
      requestId: m.card!.requestId!,
      tool: m.card!.tool!,
      allowKey: m.card!.allowKey,
      allowSession: m.card!.allowSession,
      commandAllowlist: m.card!.commandAllowlist,
      detail: m.card!.subtitle,
      held: m.card!.held,
      heldCode: m.card!.heldCode,
    }));
}

/** Routine cards can carry every instruction the user asked for (up to
 * 20,000 characters). Calls should announce the concise, visible title and
 * let the user review those details on screen instead of reading them all. */
export function spokenApprovalPrompt(pending: Pending, requester: string): string {
  if (pending.message.card?.teamSetupRequest) return `${requester}: ${pending.message.card.title} Review the details and choose ${pending.message.card.options[0]} or Cancel.`;
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  if (isSkillRequest) {
    const updating = pending.message.card?.skillRequest?.action === "update";
    const title = pending.message.card?.title.trim() || t(
      updating ? "approval.voice.defaultUpdateSkill" : "approval.voice.defaultEnableSkill",
    );
    return t("approval.voice.skill", {
      requester,
      title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
      action: t(updating ? "approval.voice.actionUpdate" : "approval.voice.actionEnable"),
    });
  }
  if (isProfileRequest) {
    // pending.detail is the full subtitle — the whole diff for a soul
    // change. Speak the card's concise title instead, the same way the
    // routine/skill branches do, and let the user read the diff on screen.
    const title = pending.message.card?.title.trim() || t("approval.voice.defaultUpdateProfile");
    return t("approval.voice.profile", { requester, title });
  }
  if (!isRoutineRequest) {
    // pending.tool can be an ACP toolCall kind rather than a tool name —
    // speak the same verb phrase the card header shows, so voice never
    // reads "wants to other".
    // Raw JSON arguments are not read aloud: the plain summary is.
    const card = pending.message.card;
    const input = card?.toolInput ?? pending.detail;
    const tool = toolLabel(pending.tool, input, card?.toolHints);
    const detail = isTechnicalText(pending.detail)
      ? describeApproval(pending.tool, input, card?.toolHints).summary
      : pending.detail;
    return detail?.trim()
      ? t("approval.voice.command", { requester, tool, detail })
      : t("approval.voice.commandNoDetail", { requester, tool });
  }
  const title = pending.message.card?.title.trim() || t("approval.voice.defaultConfirmRoutine");
  return t("approval.voice.routine", {
    requester,
    title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
  });
}

function label(pending: Pending): string {
  if (pending.message.card?.teamSetupRequest) return pending.message.card.title;
  if (isSkillApproval(pending)) {
    return pending.message.card?.skillRequest?.action === "update"
      ? t("approval.label.updateSkill")
      : t("approval.label.enableSkill");
  }
  if (isProfileApproval(pending)) {
    return t("approval.label.confirmProfileChange");
  }
  if (isRoutineApproval(pending)) {
    return pending.message.card?.routineRequest?.operation.action === "create"
      ? t("approval.label.confirmRoutine")
      : t("approval.label.confirmRoutineChange");
  }
  const nice: ApprovalLabels = {
    Bash: "approval.label.commandRequested",
    shell: "approval.label.commandRequested",
    Read: "approval.label.fileReadRequested",
    Write: "approval.label.fileChangeRequested",
    Edit: "approval.label.fileChangeRequested",
    edit: "approval.label.fileChangeRequested",
  };
  const key = nice[pending.tool];
  return key ? t(key) : t("approval.label.requested");
}

/** The pending tool approvals that only read data: the stepper's "Allow
 * all" covers these and nothing else (never a proposal, a write, or a
 * command waiting for an organization admin). */
export function readOnlyApprovals(approvals: Pending[]): Pending[] {
  return approvals.filter((pending) => {
    const card = pending.message.card;
    if (!card || card.adminApproval) return false;
    if (card.routineRequest || card.skillRequest || card.profileRequest || card.teamSetupRequest || card.questionRequest) return false;
    return describeApproval(pending.tool, card.toolInput ?? card.subtitle, card.toolHints).risk === "read";
  });
}

/** Which of several pending approvals is on screen: the one picked by id,
 * else the oldest. Following the id (not a number) keeps the same request
 * in view when another one is answered and leaves the list. */
export function stepperIndex(approvals: Pending[], requestId: string | undefined): number {
  const at = requestId ? approvals.findIndex((pending) => pending.requestId === requestId) : -1;
  return at >= 0 ? at : 0;
}

function Stepper({ index, count, onPrevious, onNext }: { index: number; count: number; onPrevious?: () => void; onNext?: () => void }) {
  const button = "flex size-6 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-0.5" data-approval-stepper="">
      <button type="button" onClick={onPrevious} disabled={!onPrevious || index === 0} aria-label={t("approval.stepper.previous")} className={button}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span className="min-w-[3.5em] text-center text-[12px] tabular-nums text-ink-secondary" aria-live="polite">
        {t("approval.position", { index: index + 1, count })}
      </span>
      <button type="button" onClick={onNext} disabled={!onNext || index >= count - 1} aria-label={t("approval.stepper.next")} className={button}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export const PendingApprovalPanel = memo(function PendingApprovalPanel({
  pending,
  count,
  index,
  bot,
  onPrevious,
  onNext,
  allowAllReadOnly,
}: {
  pending: Pending;
  count: number;
  index: number;
  /** who asks, for the avatar and the "Name wants to" title */
  bot?: Bot;
  onPrevious?: () => void;
  onNext?: () => void;
  /** several read-only requests wait: allow them all at once */
  allowAllReadOnly?: { count: number; onAllow: () => void };
  /** The active locale. Not read here: it is the memo key, the same way the
   * transcript takes one. Every line in this panel comes from the catalog,
   * and nothing else about a pending approval changes with the language. */
  locale?: string;
}) {
  const heldNote = tFromServer(pending.heldCode, pending.held);
  const card = pending.message.card;
  const proposal = isSkillApproval(pending) || isRoutineApproval(pending) || isProfileApproval(pending) || Boolean(card?.teamSetupRequest);
  const view = !proposal && card ? toolApprovalView(card, bot?.name) : undefined;
  // never truncated: long commands wrap and scroll
  const visibleText = proposal ? pending.detail : pending.commandAllowlist?.command ?? view?.plain;
  return (
    <div
      role="region"
      aria-label={
        isSkillApproval(pending)
          ? t("approval.aria.pendingSkill")
          : isRoutineApproval(pending)
            ? t("approval.aria.pendingRoutine")
            : isProfileApproval(pending)
              ? t("approval.aria.pendingProfile")
              : t("approval.aria.pending")
      }
      className="px-4 pt-3"
    >
      <ApprovalHeading
        bot={bot}
        title={<span aria-live="polite">{view ? view.title : label(pending)}</span>}
        summary={view?.summary}
        risk={view?.risk}
        aside={count > 1 ? (
          <div className="flex flex-col items-end gap-0.5">
            <Stepper index={index} count={count} onPrevious={onPrevious} onNext={onNext} />
            {allowAllReadOnly && allowAllReadOnly.count > 1 && (
              <button
                type="button"
                onClick={allowAllReadOnly.onAllow}
                title={t("approval.action.allowAllReadOnlyHint")}
                className="rounded-md px-1 text-[12px] font-medium text-accent hover:underline"
              >
                {t("approval.action.allowAllReadOnly", { count: allowAllReadOnly.count })}
              </button>
            )}
          </div>
        ) : undefined}
      />
      {visibleText && (
        <pre
          tabIndex={0}
          aria-label={
            isSkillApproval(pending)
              ? t("approval.aria.reviewSkill")
              : isRoutineApproval(pending)
                ? t("approval.aria.reviewRoutine")
                : isProfileApproval(pending)
                  ? t("approval.aria.reviewProfile")
                  : t("approval.aria.reviewDetails")
          }
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
        >
          {visibleText}
        </pre>
      )}
      {card?.skillRequest && <SkillRequestPreview request={card.skillRequest} />}
      {heldNote && <div className="mt-2 text-[12px] text-warning">{heldNote}</div>}
      {view && (view.args || pending.tool) && (
        // keyed by request: stepping to another request starts collapsed
        <TechnicalDetails key={pending.requestId} tool={pending.tool} server={view.server} args={view.args} argsLabel={t("approval.aria.reviewDetails")} />
      )}
    </div>
  );
});

export function PendingApprovalActions({
  pending,
  threadId,
  bot,
  onCancelTurn,
}: {
  pending: Pending;
  threadId: string;
  /** who asked — "always allow" is remembered against them */
  bot?: Bot;
  onCancelTurn: () => void;
}) {
  const { dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  const isTeamSetup = Boolean(pending.message.card?.teamSetupRequest);
  const durableRequest = isRoutineRequest || isSkillRequest || isProfileRequest || isTeamSetup;
  const canRememberCommand = ownerOrAdmin === true && !durableRequest && !pending.allowKey && Boolean(pending.commandAllowlist);
  const reviewedSha256 = pending.message.card?.skillRequest
    ? reviewedSkillSha256(pending.message.card.skillRequest)
    : undefined;
  const decide = (behavior: "allow" | "deny", always = false, rememberCommand = false) =>
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: pending.requestId,
      behavior,
      message: behavior === "deny" ? "Denied by the user." : undefined,
      reviewedSha256: behavior === "allow" ? reviewedSha256 : undefined,
      // a harness-native card (peer comms) remembers a grant on the bot; a
      // provider's card hands the allow to the provider for its session
      alwaysAllow: always && bot && pending.allowKey ? { botId: bot.id, key: pending.allowKey } : undefined,
      always: always && !pending.allowKey && pending.allowSession ? true : undefined,
      rememberCommand: rememberCommand || undefined,
    });

  const base = "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors";
  const secondary = cn(base, "border border-hairline/50 text-ink hover:bg-control");
  // "Cancel turn" stops the whole reply: a quiet link, away from the answers
  const quiet = "rounded-md px-1 py-1 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline";
  // Organization server: a command on the server asked by a member's bot
  // waits for an organization admin; its owner can only stop the turn.
  if (pending.message.card?.adminApproval && ownerOrAdmin !== true) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-2">
        <button type="button" onClick={onCancelTurn} className={quiet}>
          {t("approval.action.cancelTurn")}
        </button>
        <span role="status" className="text-[12.5px] text-ink-secondary">{t("approval.waitingForAdmin")}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2">
      {!durableRequest && (
        <button type="button" onClick={onCancelTurn} className={quiet}>
          {t("approval.action.cancelTurn")}
        </button>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => decide("deny")}
          autoFocus={isTeamSetup}
          className={cn(base, "border border-danger/40 text-danger hover:bg-danger/10")}
        >
          {isRoutineRequest || isProfileRequest || isTeamSetup ? t("approval.action.cancel") : t("approval.action.deny")}
        </button>
        {!durableRequest && bot && pending.allowKey && (
          <button
            type="button"
            onClick={() => decide("allow", true)}
            title={t("approval.action.stopAsking", { name: bot.name, key: pending.allowKey })}
            className={secondary}
          >
            {t("approval.action.alwaysAllow")}
          </button>
        )}
        {!durableRequest && !pending.allowKey && !canRememberCommand && pending.allowSession && (
          <button
            type="button"
            onClick={() => decide("allow", true)}
            title={t("approval.action.alwaysAllowSessionHint")}
            className={secondary}
          >
            {t("approval.action.alwaysAllowSession")}
          </button>
        )}
        {canRememberCommand && pending.commandAllowlist && (
          <button
            type="button"
            onClick={() => decide("allow", false, true)}
            title={t("approval.action.alwaysAllowCommandHint", { cwd: pending.commandAllowlist.cwd })}
            className={secondary}
          >
            {t("approval.action.alwaysAllowCommand")}
          </button>
        )}
        <button
          type="button"
          onClick={() => decide("allow")}
          disabled={isSkillRequest && !reviewedSha256}
          className={cn(
            base,
            "bg-accent font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {isTeamSetup ? pending.message.card?.options[0] : isSkillRequest
            ? pending.message.card?.skillRequest?.action === "update"
              ? t("approval.action.update")
              : t("approval.action.enable")
            : isRoutineRequest || isProfileRequest
              ? t("approval.action.confirm")
              : t("approval.action.allowOnce")}
        </button>
      </div>
    </div>
  );
}

/** The composer's approval box: one request at a time, a "1 of 2"
 * stepper when several wait, and the decisions under it. */
export function PendingApprovalBox({
  approvals,
  threadId,
  botFor,
  onCancelTurn,
  locale,
  initialRequestId,
}: {
  approvals: Pending[];
  threadId: string;
  botFor: (pending: Pending) => Bot | undefined;
  onCancelTurn: () => void;
  locale?: string;
  initialRequestId?: string;
}) {
  const { dispatch } = useStore();
  const [requestId, setRequestId] = useState<string | undefined>(initialRequestId);
  const index = stepperIndex(approvals, requestId);
  const pending = approvals[index];
  if (!pending) return null;
  const readOnly = readOnlyApprovals(approvals);
  const go = (to: number) => setRequestId(approvals[to]?.requestId);
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-accent/40 bg-card">
      {/* locale: the panel is memoized and its other props do not
          change with the language (see MessagesList in ChatView) */}
      <PendingApprovalPanel
        pending={pending}
        count={approvals.length}
        index={index}
        bot={botFor(pending)}
        onPrevious={index > 0 ? () => go(index - 1) : undefined}
        onNext={index < approvals.length - 1 ? () => go(index + 1) : undefined}
        locale={locale}
        allowAllReadOnly={readOnly.length > 1
          ? {
              count: readOnly.length,
              onAllow: () => {
                for (const each of readOnly) dispatch({ type: "decideRequest", threadId, requestId: each.requestId, behavior: "allow" });
              },
            }
          : undefined}
      />
      <PendingApprovalActions
        pending={pending}
        threadId={threadId}
        bot={botFor(pending)}
        onCancelTurn={onCancelTurn}
      />
    </div>
  );
}
