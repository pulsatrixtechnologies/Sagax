// The approval box: what the bot wants to do, and three ways to answer.
//
// Deliberately not the lettered A/B/C list the onboarding card uses — an
// approval is a decision about one concrete action, so it shows the tool
// and the actual command/path in monospace, and the choices carry their
// own behavior instead of being matched by their label text.
import { Check, ShieldCheck, X } from "lucide-react";
import { type Bot, type Message, type OptionCardData } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { ApprovalHeading, TechnicalDetails } from "@/components/ApprovalParts";
import { describeApproval, isTechnicalText, parseToolId, type ApprovalRisk, type ToolHints } from "@/lib/approval-describe";

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

/** What a settled approval card says happened, or undefined while it is
 * still open. The card's own status line and the sidebar row both read this,
 * so a chat that ends on the card never says one thing in each place. */
export function approvalCardOutcome(card: OptionCardData): string | undefined {
  if (card.expired === true) return t("approval.status.expired");
  if (!card.answered) return undefined;
  const isProposal = Boolean(card.routineRequest || card.skillRequest || card.profileRequest || card.teamSetupRequest);
  if (card.answered !== "allow") return isProposal ? t("approval.status.cancelled") : t("approval.status.denied");
  if (card.teamSetupRequest) return card.teamSetupRequest.deletion ? "Bot deleted" : "Team setup applied";
  const routineAction = card.routineRequest?.operation.action;
  if (routineAction) return t(ROUTINE_SETTLED_LABEL[routineAction]);
  const skillAction = card.skillRequest?.action;
  if (skillAction) return t(SKILL_SETTLED_LABEL[skillAction]);
  if (card.profileRequest) return t("approval.status.profileUpdated");
  if (card.routineRequest) return t("approval.status.routineConfirmed");
  if (card.skillRequest) return t("approval.status.skillConfirmed");
  return t("approval.status.allowed");
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
  if (!server) return name.replace(/_/g, " ");
  const described = describeApproval(tool, input, hints);
  const action = described.action ?? name.replace(/_+/g, " ");
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
  return {
    title,
    summary: described.summary,
    risk: described.risk,
    plain: technical || !card.subtitle?.trim() ? undefined : card.subtitle,
    server: described.server,
    args: described.argsJson ?? (technical ? card.subtitle : undefined),
  };
}

export function ApprovalCard({
  bot,
  message,
}: {
  /** who is asking, for the "Name wants to …" line */
  bot?: Bot;
  message: Message;
}) {
  const card = message.card;
  if (!card) return null;
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
