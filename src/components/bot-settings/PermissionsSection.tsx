// Permissions: how autonomously this bot acts — the approval level (ask /
// auto / full / custom), review-routine approvals, whether it asks before
// contacting other bots, and whether it is its person's Primary Bot
// (formerly Chief of Staff). Moved from SettingsPanel.tsx (Chief of Staff ~720-755,
// Ask-before-contacting ~757-776, Approval level ~990-1010, Review routine
// approvals ~1013-1050).
//
// The Auto branch of LocalComputerAutoWarning (choosing Auto while
// bot.computer === "local") and the FullAccessWarning live here with their
// triggers; the Works-on-picker branch (turning computer to "local" while
// already on Auto) stays with AccessSection, next to that picker. The
// warnings remember which bot they were opened for, so a bot switch while
// one is up never applies the choice to the newly selected bot.
import { useEffect, useState } from "react";
import { Star } from "lucide-react";

import { canEditBotField, canStepPrimary } from "@/lib/bot-capabilities";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { fullAccessNeedsConfirmation, orgFullAccessFor } from "@/lib/full-access";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { api, useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import { DEFAULT_OUTBOUND_POLICY, type OutboundPolicy } from "../../../shared/outbound";
import { ApprovalModeSelector } from "../ApprovalModeSelector";
import { CommandAllowlistDialog } from "../CommandAllowlistDialog";
import { FullAccessWarning } from "../FullAccessWarning";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { Switch } from "../SettingsPrimitives";
import { ManagedTeamsSettings } from "./ManagedTeamsSettings";
import { ProposalStatus } from "./ProposalStatus";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";

export function PermissionsSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const advanced = useAdvancedMode();
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName, currentChief } = derived;
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { draft } = useBotEditor();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [fullAccessTarget, setFullAccessTarget] = useState<string | null>(null);
  const [allThreads, setAllThreads] = useState(true);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string } | null>(null);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  // Taking the role and leaving it go through the owner's own route (one
  // per person). A draft still patches, because the bot does not exist yet;
  // an organization member never sees the switch while drafting (create
  // refuses chiefOfStaff).
  const togglePrimary = () => {
    setPrimaryError(null);
    if (draft) return patch({ chiefOfStaff: !bot.chiefOfStaff });
    const method = bot.chiefOfStaff ? "DELETE" : "POST";
    void api<{ bot: Bot }>(`/api/bots/${bot.id}/primary`, { method })
      .then((response) => dispatch({ type: "botPatched", bot: response.bot }))
      .catch((error: unknown) => setPrimaryError(error instanceof Error ? error.message : String(error)));
  };
  // Organization server: the owner sets Full as the bot's default (its new
  // threads and routines) over HTTP while the organization allows it.
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = state.config?.viewer?.principalId ?? null;
  const orgFullAccess = draft ? undefined : orgFullAccessFor(perspicaxOrg, bot, viewerId);
  const setApprovalMode = (mode: ApprovalMode) => {
    if (bot.busy || mode === approvalMode) return;
    if (mode === "full" && orgFullAccess !== undefined) {
      if (orgFullAccess !== "allowed") return;
      if (fullAccessNeedsConfirmation(bot, viewerId, true)) setFullAccessTarget(bot.id);
      else dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: "full", organizationFullAccess: true } });
      return;
    }
    if (mode === "full") {
      setAllThreads(true);
      setFullAccessTarget(bot.id);
      return;
    }
    if (mode === "auto" && bot.computer === "local") {
      setLocalAutoWarning(bot.id);
      return;
    }
    patch({ approvalMode: mode });
  };
  const showPrimary = canStepPrimary(state.config, bot, { draft });
  const showApproval = canEditBotField(state.config, bot, "approvalMode", { draft });
  const showContact = canEditBotField(state.config, bot, "approvePeerComms", { draft });
  const showTeams = canEditBotField(state.config, bot, "managedSections", { draft });
  const showOutbound = canEditBotField(state.config, bot, "outbound", { draft });
  // Simple keeps the approval level and hides the rest. Values stay.
  const showPrimaryUi = advanced && showPrimary;
  const showContactUi = advanced && showContact;
  const showOutboundUi = advanced && showOutbound;
  if (!showPrimaryUi && !showApproval && !showContactUi && !showOutboundUi) return null;

  return (
    <div className="flex flex-col gap-4">
      {showPrimaryUi && <div
        className={cn(
          "rounded-xl border border-hairline/40 p-4",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
            <Star size={17} className="text-orange-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{t("botPanel.permissions.primary")}</div>
            <div className="text-[11.5px] text-ink-secondary">{t("botPanel.permissions.one")}</div>
          </div>
          <Switch
            checked={Boolean(bot.chiefOfStaff)}
            aria-label={t("botPanel.permissions.primary")}
            disabled={!bot.chiefOfStaff && !canCoordinate}
            onClick={togglePrimary}
            title={!bot.chiefOfStaff && !canCoordinate ? t("botPanel.permissions.cannotContact") : undefined}
            className="disabled:cursor-not-allowed"
          />
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          {bot.chiefOfStaff && !canCoordinate
            ? t("botPanel.permissions.holdsRole")
            : bot.chiefOfStaff
              ? t("botPanel.permissions.isPrimary", { team: sectionName })
              : !canCoordinate
                ? t("botPanel.permissions.chooseProvider")
                : currentChief
                  ? t("botPanel.permissions.handOver", { name: currentChief.name })
                  : t("botPanel.permissions.makePrimary")}
        </div>
        {primaryError && <div role="alert" className="mt-2 text-[12px] text-danger">{primaryError}</div>}
        <ProposalStatus bot={bot} kind="chief" />
        {showTeams && bot.chiefOfStaff && <ManagedTeamsSettings
          key={bot.id + JSON.stringify(bot.managedSections ?? [])}
          name={bot.name} ownTeam={bot.section?.trim() || ""}
          teams={["", ...(state.sections ?? []), ...[...state.bots, ...state.groups].map(member => member.section?.trim() || "")]}
          allowed={bot.managedSections ?? []}
          onSave={managedSections => patch({ managedSections, acknowledgePeerScope: true })}
        />}
        {showTeams && bot.chiefOfStaff && <ProposalStatus bot={bot} kind="owner" />}
      </div>}

      {showContactUi && <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline/40 p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{t("botPanel.permissions.ask")}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {bot.approvePeerComms
              ? t("botPanel.permissions.askOn")
              : t("botPanel.permissions.askOff")}
          </div>
          <ProposalStatus bot={bot} kind="owner" />
        </div>
        <Switch
          checked={Boolean(bot.approvePeerComms)}
          aria-label={t("botPanel.permissions.ask")}
          disabled={!bot.approvePeerComms && !canCoordinate}
          onClick={() => patch({ approvePeerComms: !bot.approvePeerComms })}
          title={!bot.approvePeerComms && !canCoordinate ? t("botPanel.permissions.cannotContact") : undefined}
          className="disabled:cursor-not-allowed"
        />
      </div>}

      {showApproval && <div className="rounded-xl border border-hairline/40 p-4">
        <div className="text-[13px] font-medium text-ink">{t("botPanel.permissions.approval")}</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">
          {draft ? t("botPanel.permissions.approvalDraft") : t("botPanel.permissions.approvalHelp")}
        </div>
        <ProposalStatus bot={bot} kind="owner" />
        <div className="mt-3">
          <ApprovalModeSelector
            approvalMode={bot.approvalMode}
            autoApprove={bot.autoApprove}
            providerName={engine?.displayName ?? bot.name}
            driverKind={engine?.driverKind ?? ""}
            onSelect={setApprovalMode}
            menuDirection="down"
            wide
            disabled={Boolean(bot.busy)}
            trustedModesAvailable={trustedModesAvailable}
            orgFullAccess={orgFullAccess}
            onManageCommandAllowlist={advanced && !draft && ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name }) : undefined}
          />
        </div>
        {!draft && advanced && approvalMode === "full" && trustedModesAvailable && <button
          type="button" disabled={Boolean(bot.busy)}
          className="mt-3 text-[13px] text-ink-secondary hover:text-ink hover:underline disabled:opacity-40"
          onClick={() => { setAllThreads(true); setFullAccessTarget(bot.id); }}
        >{t("botPanel.permissions.applyFull")}</button>}
        {!draft && advanced && ownerOrAdmin === true && <button
          type="button"
          className="mt-3 block text-[13px] text-ink-secondary hover:text-ink hover:underline"
          onClick={() => setCommandAllowlistTarget({ botId: bot.id, botName: bot.name })}
        >{t("commandAllowlist.manage")}</button>}
      </div>}

      {commandAllowlistTarget && <CommandAllowlistDialog
        key={commandAllowlistTarget.botId}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      {!draft && showOutboundUi && <OutboundControl key={bot.id} bot={bot} onChange={(outbound) => patch({ outbound })} />}
      <LocalComputerAutoWarning
        open={localAutoWarning !== null}
        onCancel={() => setLocalAutoWarning(null)}
        onConfirm={() => {
          const target = localAutoWarning;
          setLocalAutoWarning(null);
          if (!target) return;
          dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "auto", acknowledgeLocalAuto: true } });
        }}
      />
      <FullAccessWarning
        open={fullAccessTarget !== null}
        scope={orgFullAccess !== undefined ? "organization" : "bot"}
        allThreads={allThreads}
        onAllThreadsChange={draft || orgFullAccess !== undefined ? undefined : setAllThreads}
        onCancel={() => setFullAccessTarget(null)}
        onConfirm={() => {
          const target = fullAccessTarget;
          setFullAccessTarget(null);
          if (!target) return;
          if (orgFullAccess !== undefined) {
            dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "full", confirmFullAccess: true, organizationFullAccess: true } });
            return;
          }
          dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "full", confirmFullAccess: true, applyToAllThreads: allThreads } });
        }}
      />
    </div>
  );
}

/** Sending on the person's behalf. Separate from the approval level on
 * purpose: Full access does not bypass it, so it cannot live inside that
 * selector without implying it does. Today's count comes from the harness,
 * which is the only thing that knows what actually went out. */
function OutboundControl({ bot, onChange }: { bot: Bot; onChange: (policy: OutboundPolicy) => void }) {
  const policy = bot.outbound ?? DEFAULT_OUTBOUND_POLICY;
  const [today, setToday] = useState<number | null>(null);
  const [capDraft, setCapDraft] = useState(String(policy.dailyCap));

  useEffect(() => {
    setCapDraft(String(policy.dailyCap));
  }, [policy.dailyCap]);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/bots/${bot.id}/outbound`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { today?: number } | null) => {
        if (alive && body && typeof body.today === "number") setToday(body.today);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot.id, bot.outbound]);

  const commitCap = () => {
    const parsed = Number(capDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      setCapDraft(String(policy.dailyCap));
      return;
    }
    if (parsed !== policy.dailyCap) onChange({ policy: policy.policy, dailyCap: parsed });
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("botPanel.permissions.outbound")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {t("botPanel.permissions.outboundHelp")}
      </div>
      <div className="mt-3 flex gap-1 rounded-lg bg-inset p-0.5">
        {(
          [
            ["ask", "botPanel.permissions.askEvery", "botPanel.permissions.askEveryHint"],
            ["allow", "botPanel.permissions.allowDaily", "botPanel.permissions.allowDailyHint"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            title={t(hint)}
            type="button"
            aria-pressed={policy.policy === value}
            onClick={() => {
              if (value !== policy.policy) onChange({ policy: value, dailyCap: policy.dailyCap });
            }}
            className={cn(
              "flex-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
              policy.policy === value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {policy.policy === "allow" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-ink-secondary">
          <label className="flex items-center gap-2">
            {t("botPanel.permissions.upTo")}
            <input
              type="number"
              min={1}
              max={1000}
              value={capDraft}
              onChange={(event) => setCapDraft(event.target.value)}
              onBlur={commitCap}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              aria-label={t("botPanel.permissions.dailyLimit")}
              className="w-20 rounded-md bg-inset px-2 py-1 text-[13px] text-ink tabular-nums outline-none focus:ring-1 focus:ring-accent"
            />
            {t("botPanel.permissions.aDay")}
          </label>
          <span className="tabular-nums">
            {today === null ? "" : t("botPanel.permissions.usedToday", { today: String(today), cap: String(policy.dailyCap) })}
          </span>
        </div>
      )}
    </div>
  );
}
