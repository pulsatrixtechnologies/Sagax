// The approval box: what the bot wants to do, and three ways to answer.
//
// Deliberately not the lettered A/B/C list the onboarding card uses — an
// approval is a decision about one concrete action, so it shows the tool
// and the actual command/path in monospace, and the choices carry their
// own behavior instead of being matched by their label text.
import { useState } from "react";
import { Check, ShieldCheck, Undo2, X } from "lucide-react";
import { api, ApiError, type Bot, type Message, type OptionCardData } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { ApprovalHeading, TechnicalDetails } from "@/components/ApprovalParts";
import { describeApproval, isTechnicalText, parseToolId, type ApprovalRisk, type ToolHints } from "@/lib/approval-describe";
import { composioActionPhrase, outboundSummary } from "@/lib/approval-summary";
import { niceDate, niceTime, scheduleLabel } from "@/lib/schedule-label";
import { cronScheduleLabel } from "../../shared/cron-label";
import { PROFILE_REQUEST_FIELDS, type ProfileRequestField } from "../../shared/profile-request";
import type { RoutineRequestSchedule } from "../../shared/routine-request";

interface ToolLabels {
  [tool: string]: LocaleKey;
}

const ROUTINE_SETTLED_LABEL = {
  create: "approval.status.routineScheduled",
  update: "approval.status.routineUpdated",
  pause: "approval.status.routinePaused",
  resume: "approval.status.routineResumed",
  run_now: "approval.status.routineRunQueued",
  delete: "approval.status.routineDeleted",
} as const;

const SKILL_SETTLED_LABEL = {
  create: "approval.status.skillEnabled",
  update: "approval.status.skillUpdated",
} as const;

const ROUTINE_APPLIED_LINE = {
  create: "approval.applied.routine.create",
  update: "approval.applied.routine.update",
  pause: "approval.applied.routine.pause",
  resume: "approval.applied.routine.resume",
  run_now: "approval.applied.routine.runNow",
  delete: "approval.applied.routine.delete",
} as const;

const SKILL_APPLIED_LINE = {
  create: "approval.applied.skill.create",
  update: "approval.applied.skill.update",
} as const;

const PROFILE_FIELD_LABEL: Record<ProfileRequestField, LocaleKey> = {
  name: "approval.applied.field.name",
  title: "approval.applied.field.title",
  description: "approval.applied.field.description",
  soul: "approval.applied.field.soul",
  cwd: "approval.applied.field.cwd",
  notifications: "approval.applied.field.notifications",
  speakReplies: "approval.applied.field.speakReplies",
};

/** What a settled approval card says happened, or undefined while it is
 * still open. The card's own status line and the sidebar row both read this,
 * so a chat that ends on the card never says one thing in each place. */
export function approvalCardOutcome(card: OptionCardData): string | undefined {
  if (card.expired === true) return t("approval.status.expired");
  if (!card.answered) return undefined;
  if (card.undone === true) return t("approval.status.undone");
  const isProposal = Boolean(card.routineRequest || card.skillRequest || card.profileRequest || card.modelRequest || card.teamSetupRequest);
  if (card.answered !== "allow") return isProposal ? t("approval.status.cancelled") : t("approval.status.denied");
  if (card.teamSetupRequest) return card.teamSetupRequest.deletion ? "Bot deleted" : "Team setup applied";
  const routineAction = card.routineRequest?.operation.action;
  if (routineAction) return t(ROUTINE_SETTLED_LABEL[routineAction]);
  const skillAction = card.skillRequest?.action;
  if (skillAction) return t(SKILL_SETTLED_LABEL[skillAction]);
  if (card.profileRequest) return t("approval.status.profileUpdated");
  if (card.modelRequest) return t("approval.status.modelChanged");
  if (card.routineRequest) return t("approval.status.routineConfirmed");
  if (card.skillRequest) return t("approval.status.skillConfirmed");
  return t("approval.status.allowed");
}

/** A permission ask stays in the chat only while it is still waiting.
 *  Allowed, denied, dismissed and expired asks leave the transcript.
 *  The message stays stored. A question or a quiz is not this card.
 *  A change that applied without a person is not an ask: it stays as its
 *  one line with Undo. */
export function approvalCardStaysInChat(
  card: Pick<OptionCardData, "requestId" | "tool" | "answered" | "expired" | "dismissed" | "autoApplied" | "held"> | undefined,
): boolean {
  if (!card?.requestId || !card.tool) return false;
  if (card.autoApplied === true && card.answered === "allow" && !card.held && card.dismissed !== true) return true;
  return !card.answered && card.expired !== true && card.dismissed !== true;
}

/** The tool's own name is noise to a human: Bash is "run a command",
 * mcp__perspicax_pulsatrix_flow_jc__cw_psa_schedule__query is "view the
 * schedule in ConnectWise PSA". `input` (the card's JSON arguments) lets a
 * generic tool (cw_psa__write) say what it writes. */
export function toolLabel(tool?: string, input?: string, hints?: ToolHints): string {
  if (!tool) return t("approval.tool.takeAction");
  const nice: ToolLabels = {
    Bash: "approval.tool.runCommand",
    Read: "approval.tool.readFile",
    Write: "approval.tool.writeFile",
    Edit: "approval.tool.editFile",
    WebFetch: "approval.tool.fetchWebPage",
    WebSearch: "approval.tool.searchWeb",
    schedule_routine: "approval.tool.scheduleRoutine",
    manage_routine: "approval.tool.changeRoutine",
    stage_skill: "approval.tool.enableSkill",
    update_skill: "approval.tool.updateSkill",
    update_profile: "approval.tool.updateProfile",
    // An ACP driver can know the protocol's toolCall kind but not the
    // tool's name, and sends the kind as the card's tool
    // (server/drivers/acp/core.ts). Kinds are not verb phrases —
    // "wants to other" reads as broken — so map every kind it can send
    // to a real phrase. "shell" is its name for execute; "tool" is its
    // fallback when an agent sends no kind at all — an unclassified call,
    // so it reads differently from "other", the agent's own generic kind.
    shell: "approval.tool.runCommand",
    edit: "approval.tool.editFile",
    read: "approval.tool.readFile",
    fetch: "approval.tool.fetchWebPage",
    delete: "approval.tool.deleteFile",
    think: "approval.tool.think",
    other: "approval.tool.takeAction",
    tool: "approval.tool.useTool",
  };
  const key = nice[tool];
  if (key) return t(key);
  const { server, name } = parseToolId(tool);
  // A Composio slug reads as a verb phrase: LINEAR_CREATE_LINEAR_COMMENT is
  // "create linear comment".
  const composio = composioActionPhrase(name);
  if (!server) return composio ?? name.replace(/_/g, " ");
  const described = describeApproval(tool, input, hints);
  const action = described.action ?? composio ?? name.replace(/_+/g, " ");
  return described.product ? t("approval.phrase.inProduct", { action, product: described.product }) : action;
}

/** What the card shows for a plain tool approval (not a proposal): a
 * title, a short summary, a risk chip, and the raw bits for the collapsed
 * technical details. A command or URL stays visible: it is what runs. */
export interface ToolApprovalView {
  title: string;
  summary?: string;
  risk?: ApprovalRisk;
  /** a command, URL or question: readable as is, shown under the title */
  plain?: string;
  server?: string;
  /** arguments for the details (pretty JSON when they are JSON) */
  args?: string;
}

export function toolApprovalView(card: OptionCardData, botName?: string): ToolApprovalView {
  const input = card.toolInput ?? card.subtitle;
  const described = describeApproval(card.tool, input, card.toolHints);
  const action = toolLabel(card.tool, input, card.toolHints);
  const title = botName
    ? t("approval.card.namedWantsTo", { name: botName, action })
    : t("approval.card.wantsTo", { action });
  const technical = isTechnicalText(card.subtitle);
  // A held outbound action reads as what it sends and where, the way the
  // phones show it, not as the slug the bot happened to call.
  const outbound = outboundSummary(card);
  return {
    title: outbound ? outbound.headline : title,
    summary: outbound?.summary || described.summary,
    risk: described.risk,
    plain: technical || !card.subtitle?.trim() ? undefined : card.subtitle,
    server: described.server,
    args: described.argsJson ?? (technical ? card.subtitle : undefined),
  };
}

/** When a routine runs, in the plain words the receipt line uses. Never a
 * raw cron expression: a schedule without a plain name says nothing. */
function plainWhen(schedule: RoutineRequestSchedule): string {
  if (schedule.type === "once") {
    return new Date(schedule.at).toDateString() === new Date().toDateString()
      ? t("approval.applied.today", { time: niceTime(schedule.at) })
      : `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  }
  if (schedule.type === "cron") {
    const label = cronScheduleLabel(schedule);
    return label.startsWith("Cron ") ? "" : label;
  }
  if (schedule.type === "interval") return scheduleLabel({ ...schedule, anchorAt: schedule.anchorAt ?? 0 });
  return scheduleLabel(schedule);
}

/** The one line a change that applied without a person reads as, and
 * whether its Undo can work (the card kept what Undo needs). */
export function appliedChange(card: OptionCardData, name: string): { line: string; canUndo: boolean } | undefined {
  const routine = card.routineRequest;
  if (routine) {
    const operation = routine.operation;
    const undo = routine.undo;
    const when = undo?.schedule && operation.action !== "pause" && operation.action !== "delete" && operation.action !== "run_now"
      ? plainWhen(undo.schedule)
      : "";
    const title = [
      undo?.name ?? (operation.action === "create" ? operation.routine.name : ""),
      operation.forBot ? t("approval.applied.forBot", { target: `@${operation.forBot.name}` }) : "",
    ].filter(Boolean).join(" · ") + (when ? `, ${when}` : "");
    const canUndo = operation.action === "create" ? Boolean(routine.resultId)
      : operation.action === "update" ? Boolean(undo?.before && undo.appliedUpdatedAt !== undefined)
        : operation.action === "pause" || operation.action === "resume" ? undo?.appliedUpdatedAt !== undefined
          : operation.action === "delete" ? Boolean(undo?.before)
            : false;
    return { line: t(ROUTINE_APPLIED_LINE[operation.action], { name, title }), canUndo };
  }
  const skill = card.skillRequest;
  if (skill) {
    return {
      line: t(SKILL_APPLIED_LINE[skill.action], { name, title: skill.name }),
      canUndo: skill.action === "create" || Boolean(skill.previous),
    };
  }
  const profile = card.profileRequest;
  if (profile) {
    const title = PROFILE_REQUEST_FIELDS.filter((field) => profile.changes[field] !== undefined)
      .map((field) => t(PROFILE_FIELD_LABEL[field])).join(", ");
    const line = profile.targetBotId === profile.botId
      ? t("approval.applied.profileOwn", { name, title })
      : t("approval.applied.profileOther", { name, target: `@${profile.targetName}`, title });
    return { line, canUndo: Boolean(profile.undo) };
  }
  const model = card.modelRequest;
  if (model) {
    const title = model.selection.model;
    const line = model.targetBotId === model.botId
      ? t("approval.applied.modelOwn", { name, title })
      : t("approval.applied.modelOther", { name, target: `@${model.targetName}`, title });
    return { line, canUndo: true };
  }
  return undefined;
}

/** A change the bot made without a person, as one plain line with Undo
 * instead of the approval box. The full card text stays one click away. */
function AppliedChangeLine({
  card,
  name,
  threadId,
  summary,
}: {
  card: OptionCardData;
  name: string;
  threadId?: string;
  summary: { line: string; canUndo: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string>();
  const undone = card.undone === true;
  const undo = () => {
    if (!threadId || !card.requestId || undoing) return;
    setUndoing(true);
    setError(undefined);
    api(`/api/threads/${threadId}/undo`, { method: "POST", body: JSON.stringify({ requestId: card.requestId }) })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiError && failure.body?.code === "changed-since"
          ? t("approval.applied.changedSince")
          : t("approval.applied.undoFailed", { error: failure instanceof Error ? failure.message : String(failure) }));
      })
      .finally(() => setUndoing(false));
  };
  return (
    <div className="w-full max-w-[840px] text-[13px] text-ink-secondary" data-applied-change={name}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {undone ? <Undo2 size={14} className="shrink-0" /> : <Check size={14} className="shrink-0 text-success" />}
        <span className="min-w-0 break-words">
          {summary.line}
          {undone && <span> · {t("approval.applied.undone")}</span>}
        </span>
        {!undone && summary.canUndo && threadId && (
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-inset disabled:opacity-60"
          >
            {undoing ? t("approval.applied.undoing") : t("approval.applied.undo")}
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="rounded-md px-1.5 py-0.5 text-ink-tertiary hover:bg-inset hover:text-ink-secondary"
        >
          {open ? t("approval.applied.hideDetails") : t("approval.applied.details")}
        </button>
      </div>
      {error && <div role="alert" className="mt-1 text-[12.5px] text-warning">{error}</div>}
      {open && (
        <pre
          tabIndex={0}
          aria-label={t("approval.aria.appliedDetails")}
          className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink"
        >
          {card.subtitle}
        </pre>
      )}
    </div>
  );
}

export function ApprovalCard({
  bot,
  message,
  threadId,
}: {
  /** who is asking, for the "Name wants to …" line */
  bot?: Pick<Bot, "name">;
  message: Message;
  /** the conversation the card is in, for Undo on a change that applied
   * without a person */
  threadId?: string;
}) {
  const card = message.card;
  if (!card) return null;
  // A change that applied without a person reads as one line with Undo.
  const applied = card.autoApplied === true && card.answered === "allow" && !card.held
    ? appliedChange(card, bot?.name ?? t("approval.someone"))
    : undefined;
  if (applied) return <AppliedChangeLine card={card} name={bot?.name ?? t("approval.someone")} threadId={threadId} summary={applied} />;
  const settled = card.answered;
  const expired = card.expired === true;
  // decided by voice on a Live call rather than tapped
  const byVoice = card.answeredBy?.via === "call" ? <span className="text-ink-tertiary">· {t("approval.status.byVoice")}</span> : null;
  const isRoutineRequest = Boolean(card.routineRequest);
  const isSkillRequest = Boolean(card.skillRequest);
  const isProfileRequest = Boolean(card.profileRequest);
  const isTeamSetup = Boolean(card.teamSetupRequest);
  const routineAction = card.routineRequest?.operation.action;
  const skillAction = card.skillRequest?.action;
  const heldNote = tFromServer(card.heldCode, card.held);
  const outcome = approvalCardOutcome(card);
  const displayTool = isRoutineRequest
    ? routineAction === "create" ? "schedule_routine" : "manage_routine"
    : isSkillRequest
      ? skillAction === "update" ? "update_skill" : "stage_skill"
    : isProfileRequest
      ? "update_profile"
    : card.tool;
  // A cross-bot profile card is shown in the PROPOSER's thread, so
  // "wants to update its profile" (fine for a bot editing itself) would
  // silently claim the proposer's own profile is changing. Name the actual
  // target whenever it differs from the proposer.
  const profileHeader = isProfileRequest && card.profileRequest
    ? card.profileRequest.targetBotId === card.profileRequest.botId
      ? t("approval.card.profileWantsToOwn", { name: bot?.name ?? t("approval.someone") })
      : t("approval.card.profileWantsToOther", {
          name: bot?.name ?? t("approval.someone"),
          target: card.profileRequest.targetName,
        })
    : undefined;

  const isProposal = isRoutineRequest || isSkillRequest || isProfileRequest || isTeamSetup;
  const view = isProposal ? undefined : toolApprovalView(card, bot?.name);
  const proposalTitle = isTeamSetup
    ? card.title
    : profileHeader ?? (bot
      ? t("approval.card.namedWantsTo", { name: bot.name, action: toolLabel(displayTool) })
      : t("approval.card.wantsTo", { action: toolLabel(displayTool) }));
  const open = !settled && !expired;

  return (
    <div
      data-tour={open ? "approval" : undefined}
      className={cn(
        "w-full max-w-[840px] rounded-2xl border bg-card px-4 py-3",
        open ? "border-accent/40" : "border-hairline/30 opacity-80",
      )}
    >
      <ApprovalHeading
        bot={bot}
        title={view ? view.title : proposalTitle}
        summary={view?.summary}
        risk={view?.risk}
      />

      {/* a proposal's text is what you confirm; a tool's command or URL is
          what runs. Raw JSON arguments stay behind the technical details. */}
      {(isProposal || view?.plain) && (
        <pre
          tabIndex={0}
          aria-label={
            isRoutineRequest
              ? t("approval.aria.routineDetails")
              : isSkillRequest
                ? t("approval.aria.skillDetails")
                : isProfileRequest
                  ? t("approval.aria.profileChange")
                  : t("approval.aria.details")
          }
          className={cn(
            "mt-2 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink",
            isProposal ? "max-h-40" : "max-h-24",
          )}
        >
          {isProposal ? card.subtitle : view?.plain}
        </pre>
      )}

      {card.skillRequest && <SkillRequestPreview request={card.skillRequest} />}

      {heldNote && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          {heldNote}
        </div>
      )}

      {/* The decision lives in the composer (one place to answer, and it
          can't be scrolled past); here we only record what happened. The
          technical details join the record once it is settled, so an open
          request is never shown twice in full. */}
      <div className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-secondary">
        {outcome ? (
          <>
            {settled === "allow" && !expired ? <Check size={14} className="text-success" /> : <X size={14} />} {outcome}
            {byVoice}
          </>
        ) : (
          <>
            <ShieldCheck size={14} className="text-accent" />
            {isProposal
              ? t("approval.status.waitingConfirmation")
              : card.adminApproval
                ? t("approval.waitingForAdmin")
                : t("approval.status.waitingAnswer")}
          </>
        )}
      </div>
      {view && !open && (view.args || card.tool) && (
        <TechnicalDetails tool={card.tool} server={view.server} args={view.args} />
      )}
    </div>
  );
}
