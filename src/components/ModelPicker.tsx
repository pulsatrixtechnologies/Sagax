// Compact model picker: providers live on a Cloud/Local rail. Ready engines
// show a short suggested list with search and an explicit all-models view;
// an installed engine that needs sign-in, or the bot's own engine when it
// needs setup, shows one focused action instead of a disabled wall. Engines
// that are not installed and not in use stay in Settings.
// Reasoning effort rides along (EffortRow): model and effort are one choice to
// the person making it, so the chat header and the settings dialog render the
// same row and write through the same action.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, KeyRound, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { useStore, currentTaskBot, type Bot, type InstanceInfo, type ModelSelection } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import type { ModelVariantOption } from "../../shared/runtime-events";
import { filterCustomModels, partitionCustomModels, suggestedModels } from "@/lib/custom-models";
import { configuredModelInstances, isClaudeAccount, isCustomOnly, SIGN_IN_FAMILY_LABEL, signInFamily, splitEngineRail, type SignInFamily } from "@/lib/engine-rail";
import { InstanceProviderMark } from "./ProviderIcons";
import { EngineSetup, EngineUpdateNotice, needsCli, needsSignIn } from "./EngineSetup";
import { EngineGroupLabel } from "./EngineGroupLabel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ChatGptPlanStatus } from "./ChatGptPlanStatus";
import { approvalModeFor, modelSwitchNeedsAsk } from "../../shared/approval-mode";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { myTurnsText, reloadMyEngines, useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { orgEngineState } from "@/lib/model-payers";
import { ModelPickerPayers } from "./ModelPickerPayers";
import { COMPACT_SQUARE } from "@/lib/compact-chip";

type ModelOption = InstanceInfo["models"]["options"][number];
const COMPACT_MODEL_COUNT = 5;

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((option) => option.id === model)?.label ?? model;
}

function modelProvider(instance: InstanceInfo | undefined, model: string): string | undefined {
  return instance?.models.options.find((option) => option.id === model)?.provider;
}

export function engineStatus(instance: InstanceInfo): string {
  if (needsCli(instance)) return t("model.setupRequired");
  if (needsSignIn(instance)) return t("model.signInRequired");
  return instance.snapshot.version ?? t("model.ready");
}

/** How long "Looking for local models…" may stay up. Opening the local list
 * re-probes local servers, and the answer rides on an engine status check
 * that can be slow; after this the list shows what it has, and a late answer
 * still lands when it arrives. */
export const LOCAL_PROBE_TIMEOUT_MS = 5_000;

/** Local servers (Ollama, LM Studio…) are otherwise probed only at startup,
 * after sign-in, or on refresh, so a model started since then would stay
 * invisible. Resolves when the refresh settles or the timeout passes, never
 * rejects: an offline app keeps its last known catalog. */
export function probeLocalModels(
  instanceId: string,
  refreshModels: (instanceId: string) => Promise<void>,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void refreshModels(instanceId)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Whether the rail's engine offers the way into local models. Claude runs
 * them through its own CLI, signed in or not, so its entry stays while none
 * have been found yet: opening it is what looks again. Other engines offer it
 * once they list a local model. */
export function offersLocalModels(instance: InstanceInfo | undefined, localCount: number): boolean {
  if (!instance) return false;
  return localCount > 0 || (instance.driverKind === "claudeAgent" && !needsCli(instance) && !instance.policy);
}

/** The others capitalize cleanly; "xhigh" would read "Xhigh". */
export function effortLabel(level: EffortLevel): string {
  return level === "xhigh" ? "X-High" : level[0].toUpperCase() + level.slice(1);
}

/** How hard the bot thinks, for the engine it currently runs on. Rendered
 * both in the picker's popover and in the settings dialog's Model section so
 * the two cannot drift: one list of levels, one `setModel` dispatch.
 *
 * `undefined` ("Default") is not the `none` level — Default sends nothing and
 * lets the engine decide, `none` is a level the engine is told to use. Only
 * pi offers both, and dropping either would change what an existing bot
 * sends, so both stay and the tooltips say which is which. */
export function EffortRow({
  bot,
  threadId,
  updateBotDefault,
  className,
  label,
  compact = false,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (instance?.capabilities?.modelVariants) {
    return <ModelVariantRow bot={bot} threadId={threadId} updateBotDefault={updateBotDefault} className={className} label={label} compact={compact} />;
  }
  const levels = instance?.capabilities?.effortLevels;
  // An engine with no levels gets no control at all, not an empty one.
  if (!levels?.length) return null;

  if (compact) return (
    <label className={cn("flex items-center justify-between gap-3", className)}>
      {label}
      <select aria-label="Reasoning effort" value={selection.effort ?? ""}
        onChange={(event) => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
          selection: { ...selection, effort: levels.find((level) => level === event.target.value) } })}
        className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
        <option value="">Default</option>
        {levels.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
      </select>
    </label>
  );

  return (
    <div className={className}>
      {label}
      {/* wraps rather than dividing a fixed width: pi offers Default plus six
          levels, which a segmented control would squeeze in the popover */}
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Reasoning effort">
        {[undefined, ...levels].map((level) => (
          <button
            key={level ?? "default"}
            type="button"
            aria-pressed={selection.effort === level}
            title={
              level === undefined
                ? "Send no effort level and let the provider decide"
                : `Ask for ${effortLabel(level)} reasoning effort`
            }
            onClick={() => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              selection.effort === level
                ? "border-accent/60 bg-control text-ink"
                : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {level === undefined ? "Default" : effortLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

function variantLabel(option: ModelVariantOption): string {
  return option.id === "default" ? "OpenCode default" : option.label;
}

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function ModelVariantRow({ bot, threadId, updateBotDefault, className, label, compact = false }: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = state.modelVariantSessions[threadId ?? bot.threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model ? session.variants : undefined;
  const options = reported?.options ?? instance.models.options.find((option) => option.id === selection.model)?.variants ?? [];
  if (!options.length && selection.variant === undefined) return null;
  const missing = selection.variant !== undefined && !options.some((option) => option.id === selection.variant);
  const unavailable = missing && reported !== undefined;
  const current = reported?.currentValue;
  const choose = (variant?: string) => {
    const { effort: _effort, variant: _variant, ...model } = selection;
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
      selection: { ...model, ...(variant !== undefined ? { variant } : {}) } });
  };
  if (compact) return (
    <div className={className}>
      <label className="flex items-center justify-between gap-3">
        {label}
        <select aria-label="Reasoning variant" disabled={bot.busy}
          value={selection.variant === undefined ? "unset" : missing ? "missing" : String(options.findIndex((option) => option.id === selection.variant))}
          onChange={(event) => choose(options[Number(event.target.value)]?.id)}
          className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50">
          <option value="unset">Use session setting</option>
          {missing && <option value="missing" disabled>{selection.variant} ({unavailable ? "unavailable" : "unverified"})</option>}
          {options.map((option, index) => <option key={option.id} value={String(index)}>{variantLabel(option)}</option>)}
        </select>
      </label>
      {missing && <p className="mt-1 text-[11px] text-ink-secondary">{unavailable ? "Saved variant is unavailable. Choose another or use the session setting." : "Saved variant has not been checked in this session."}</p>}
    </div>
  );
  return (
    <div className={className}>
      {label}
      {(selection.variant === undefined || missing) && (
        <p className="mt-2 text-[12px] text-ink-secondary">
          {unavailable ? `Saved variant “${selection.variant}” is unavailable. Choose an available variant.`
            : missing ? `Saved variant “${selection.variant}” has not been checked in this session.` : "No variant selected."}
          {current !== undefined && ` Session: ${variantLabel(options.find((option) => option.id === current) ?? { id: current, label: current })}.`}
        </p>
      )}
      {selection.variant !== undefined && (
        <button type="button" disabled={bot.busy} onClick={() => choose()}
          title="Send no variant selection; OpenCode keeps its session or configured setting"
          className="mt-2 block text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink disabled:opacity-50">
          Clear variant selection
        </button>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Reasoning variant">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={bot.busy}
              aria-pressed={selection.variant === option.id}
              title={`Use ${variantLabel(option)} for this model`}
              onClick={() => choose(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50",
                selection.variant === option.id ? "border-accent/60 bg-control text-ink" : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {variantLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Switching models must not carry an opaque variant from the previous model. */
export function modelSelectionForPick(selection: ModelSelection, instance: InstanceInfo, model: string): ModelSelection {
  const next: ModelSelection = { instanceId: instance.instanceId, model };
  if (instance.instanceId === selection.instanceId) {
    if (instance.capabilities?.modelVariants) {
      if (model === selection.model && selection.variant !== undefined) next.variant = selection.variant;
    } else if (selection.effort) next.effort = selection.effort;
  }
  return next;
}

function ModelRow({
  option,
  current,
  defaultId,
  onPick,
}: {
  option: ModelOption;
  current: boolean;
  defaultId: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-control/60",
        current && "bg-control",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{option.label}</span>
        {option.provider && (
          <span
            className="shrink-0 rounded bg-inset px-1.5 py-px text-[10px] text-ink-secondary"
            title={t("model.provider", { name: option.provider })}
          >
            {option.provider}
          </span>
        )}
        {option.id === defaultId && (
          <span className="shrink-0 rounded bg-inset px-1.5 py-px text-[10px] text-ink-secondary">Default</span>
        )}
        {option.loaded && (
          <span className="shrink-0 rounded bg-accent/10 px-1.5 py-px text-[10px] text-accent">Loaded</span>
        )}
      </span>
      {current && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  );
}

function ModelSearch({
  value,
  onChange,
  onEscape,
  local,
}: {
  value: string;
  onChange: (value: string) => void;
  onEscape: () => void;
  local: boolean;
}) {
  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 focus-within:border-focus">
        <Search size={13} className="shrink-0 text-ink-secondary" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            onEscape();
          }}
          placeholder={t("model.search")}
          aria-label={local ? t("model.searchLocal") : t("model.search")}
          className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </div>
    </div>
  );
}

export function ModelEngineRail({ instances, selectedInstance, claudeInstance, openaiInstance, onSelect, onAddApiKeys, wide = false, statusOf }: {
  instances: InstanceInfo[];
  selectedInstance?: InstanceInfo;
  /** The account a folded button opens on (the last one browsed). */
  claudeInstance?: InstanceInfo;
  openaiInstance?: InstanceInfo;
  onSelect: (instance: InstanceInfo) => void;
  /** Ends the API keys group with a way to add one; absent where Settings
   * has no keys section (a remote client). */
  onAddApiKeys?: () => void;
  /** The modal's provider column: each provider named, with its status. */
  wide?: boolean;
  /** The status a provider shows (an organization server answers per
   * person); defaults to the engine's own state. */
  statusOf?: (instance: InstanceInfo) => { label: string; attention: boolean };
}) {
  const firstOf: Record<SignInFamily, InstanceInfo | undefined> = {
    claude: instances.find((instance) => isClaudeAccount(instance) && instance.claudeAccount?.isDefault)
      ?? instances.find(isClaudeAccount),
    openai: instances.find((instance) => signInFamily(instance) === "openai"),
  };
  const opensOn: Record<SignInFamily, InstanceInfo | undefined> = { claude: claudeInstance, openai: openaiInstance };
  const providers = instances.filter((instance) => {
    const family = signInFamily(instance);
    return !family || instance === firstOf[family];
  });
  const { subscription, api, custom: local } = splitEngineRail(providers);
  const railButton = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    const target = family ? opensOn[family] ?? instance : instance;
    const selected = family ? signInFamily(selectedInstance) === family : instance.instanceId === selectedInstance?.instanceId;
    const label = family ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName;
    const status = statusOf?.(target);
    const attention = status ? status.attention : needsCli(target) || needsSignIn(target) || Boolean(target.snapshot.update);
    const managedBy = target.policy ? t("policy.managedBy", { organization: target.policy.organizationName }) : undefined;
    const statusLabel = managedBy ?? status?.label ?? engineStatus(target);
    if (wide) return (
      <button
        type="button"
        key={instance.instanceId}
        data-rail-provider={family ?? instance.instanceId}
        onClick={() => onSelect(target)}
        aria-label={managedBy ? `${label} · ${managedBy}` : label}
        aria-describedby={`model-rail-status-${instance.instanceId}`}
        aria-pressed={selected}
        className={cn("relative flex min-w-[9.5rem] shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left sm:min-w-0 sm:w-full",
          selected ? "bg-selected ring-1 ring-hairline/50" : "hover:bg-hover", managedBy && "opacity-50")}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-inset">
          <InstanceProviderMark instance={target} size={16} />
          {target.access === "api" && (
            <span data-rail-key-badge className="absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full bg-panel text-ink-secondary">
              <KeyRound size={9} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-ink">{label}</span>
          <span id={`model-rail-status-${instance.instanceId}`} data-rail-status className={cn("flex items-center gap-1 truncate text-[11px]", attention ? "text-warning" : "text-ink-secondary")}>
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", attention ? "bg-warning" : "bg-success")} />
            <span className="truncate">{statusLabel}</span>
          </span>
        </span>
      </button>
    );
    return (
      <button
        type="button"
        key={instance.instanceId}
        onClick={() => onSelect(target)}
        aria-label={managedBy ? `${label} · ${managedBy}` : label}
        aria-pressed={selected}
        title={`${label} · ${managedBy ?? engineStatus(target)}`}
        className={cn("relative flex size-9 items-center justify-center rounded-lg", selected ? "bg-control ring-1 ring-hairline/50" : "hover:bg-control/60", managedBy && "opacity-40")}
      >
        <InstanceProviderMark instance={target} size={18} />
        {/* the same provider can sit in Cloud and API keys: the key marks which */}
        {target.access === "api" && (
          <span data-rail-key-badge className="absolute bottom-0 left-0 flex size-3.5 items-center justify-center rounded-full bg-panel text-ink-secondary">
            <KeyRound size={9} aria-hidden="true" />
          </span>
        )}
        {attention && <span className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-warning ring-2 ring-panel" />}
      </button>
    );
  };
  if (wide) {
    const group = (label: string) => <EngineGroupLabel className="hidden px-2.5 pb-0.5 pt-2 text-[10px] first:pt-0.5 sm:block">{label}</EngineGroupLabel>;
    return (
      <nav aria-label={t("model.providers")} data-model-provider-column
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline/40 bg-panel p-2 mr-12 sm:mr-0 sm:w-56 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
        {subscription.length > 0 && group(t("model.rail.cloud"))}
        {subscription.map(railButton)}
        {(api.length > 0 || onAddApiKeys) && group(t("model.rail.apiKeys"))}
        {api.map(railButton)}
        {onAddApiKeys && (
          <button type="button" data-rail-add-api-key onClick={onAddApiKeys}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">
            <Plus size={14} aria-hidden="true" /> {t("model.addApiKeys")}
          </button>
        )}
        {local.length > 0 && group(t("model.rail.local"))}
        {local.map(railButton)}
      </nav>
    );
  }
  return (
    <div className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline/40 bg-panel p-2">
      {subscription.length > 0 && <EngineGroupLabel className="px-0 pb-0.5 pt-0.5 text-center text-[9px]">{t("model.rail.cloud")}</EngineGroupLabel>}
      {subscription.map(railButton)}
      {(api.length > 0 || onAddApiKeys) && <EngineGroupLabel className={cn("px-0 pb-0.5 text-center text-[9px] leading-tight", subscription.length > 0 ? "pt-2" : "pt-0.5")}>{t("model.rail.apiKeys")}</EngineGroupLabel>}
      {api.map(railButton)}
      {onAddApiKeys && (
        <button
          type="button"
          data-rail-add-api-key
          onClick={onAddApiKeys}
          aria-label={t("model.addApiKeys")}
          title={t("model.addApiKeys")}
          className="flex size-9 items-center justify-center rounded-lg border border-dashed border-hairline text-ink-secondary hover:bg-control/60 hover:text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      )}
      {local.length > 0 && <EngineGroupLabel className="px-0 pb-0.5 pt-2 text-center text-[9px]">{t("model.rail.local")}</EngineGroupLabel>}
      {local.map(railButton)}
    </div>
  );
}

export function ClaudeAccountSelect({ accounts, selectedId, onSelect }: {
  accounts: InstanceInfo[];
  selectedId: string;
  onSelect: (instance: InstanceInfo) => void;
}) {
  return (
    <label className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-ink-secondary">
      <span>{t("model.account")}:</span>
      <select
        aria-label={t("model.account")}
        value={selectedId}
        onChange={(event) => {
          const account = accounts.find((instance) => instance.instanceId === event.target.value);
          if (account) onSelect(account);
        }}
        className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus:border-accent/60 focus:outline-none"
      >
        {accounts.map((account) => <option key={account.instanceId} value={account.instanceId}>{account.displayName}</option>)}
      </select>
    </label>
  );
}

/** What Tab may land on inside the modal, in document order. */
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function ModelPicker({
  bot,
  threadId,
  className,
  contained = false,
  inComposer = false,
  label,
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  /** Profile row: the label sits beside the pill. The menu is still the
   * same modal as the composer. The profile card already has Effort, so
   * the modal does not repeat it. */
  contained?: boolean;
  /** Sit in the composer as a text row. */
  inComposer?: boolean;
  label?: ReactNode;
}) {
  const { state, dispatch, refreshInstances, refreshModels: refreshInstanceModels } = useStore();
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open && !bot.busy);
  const [railId, setRailId] = useState<string | null>(null);
  const [pane, setPane] = useState<"main" | "custom">("main");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [probingLocal, setProbingLocal] = useState<string | null>(null);
  const [scope, setScope] = useState<"bot" | "thread">("thread");
  const [pendingSwitch, setPendingSwitch] = useState<{ botId: string; threadId: string;
    selection: ModelSelection; updateBotDefault: boolean; name: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refreshingRef = useRef(false);
  const lastClaudeIdRef = useRef<string | null>(null);
  const lastOpenaiIdRef = useRef<string | null>(null);
  // Organization server (Perspicax): each person pays with their own
  // subscription, their model key, or the organization key; the server's
  // local models are not offered (src/lib/model-payers.ts).
  const org = usePerspicaxOrg();
  const advanced = useAdvancedMode();
  const myEngines = useMyEngines();
  const orgMode = org !== null;
  // Every opener uses the composer modal. An in-flow menu is clipped by
  // the profile sidebar (overflow-y-auto, a narrow column).
  const modal = true;

  const selection = bot.modelSelection;
  const active = state.instances.find((instance) => instance.instanceId === selection.instanceId);
  const configured = configuredModelInstances(state.instances, selection.instanceId);
  // An organization server offers an engine only when that engine's own
  // shell, file and web tools stay off the Sagax server. The bot's current
  // engine stays so its state is explained.
  const pickerInstances = orgMode
    ? configured.filter((instance) => instance.instanceId === selection.instanceId || instance.capabilities?.withholdsHostTools === true)
    : configured;
  const selectedVariantLabel = selection.variant === undefined ? undefined : variantLabel(
    active?.models.options.find((option) => option.id === selection.model)?.variants?.find((option) => option.id === selection.variant)
      ?? { id: selection.variant, label: selection.variant },
  );
  const claudeAccounts = pickerInstances.filter(isClaudeAccount);
  const openaiAccounts = pickerInstances.filter((instance) => signInFamily(instance) === "openai");
  const openaiRailInstance = openaiAccounts.find((instance) => instance.instanceId === lastOpenaiIdRef.current)
    ?? openaiAccounts.find((instance) => instance.instanceId === selection.instanceId) ?? openaiAccounts[0];
  const multipleClaudeAccounts = state.instances.filter(isClaudeAccount).length > 1;
  const showActiveAccount = (multipleClaudeAccounts && isClaudeAccount(active)) || Boolean(active?.snapshot.chatgptPlan);
  const claudeRailInstance = claudeAccounts.find((instance) => instance.instanceId === lastClaudeIdRef.current)
    ?? claudeAccounts.find((instance) => instance.instanceId === selection.instanceId) ?? claudeAccounts[0];
  const railInstance =
    pickerInstances.find((instance) => instance.instanceId === (railId ?? selection.instanceId)) ?? pickerInstances[0];
  const displayedInstanceId = railInstance?.instanceId;
  // Slice 4, organization server: who a bot on this engine can answer.
  const railEngine = myEngines?.find((engine) => engine.instanceId === displayedInstanceId) ?? null;
  // A routine's thread pays as the bot's owner (engine-credentials.ts).
  const routineThread = Boolean(orgMode && threadId && state.bots.find((candidate) => candidate.id === bot.id)?.tasks
    ?.some((task) => task.threadId === threadId && task.routineRunId));
  // A plan account discovers its allowed models only after sign-in. An empty
  // catalog must still lead to cloud sign-in, never local-model injection.
  const hasOfficialModels = Boolean(railInstance?.snapshot.chatgptPlan || railInstance?.models.options.some((option) => !option.custom));
  const customOnly = isCustomOnly(railInstance);
  useEffect(() => {
    if (orgMode) {
      setPane("main");
      return;
    }
    if (railId !== null && railId !== displayedInstanceId) {
      // A refresh can remove the provider being browsed. Reset its list, not
      // the saved model selection or the pane chosen when reopening the menu.
      setPane(customOnly || !hasOfficialModels ? "custom" : "main");
      setQuery("");
      setShowAll(false);
    } else if (customOnly || !hasOfficialModels) {
      setPane("custom");
    }
  }, [railId, displayedInstanceId, hasOfficialModels, customOnly, orgMode]);

  const refreshLocalInstances = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void refreshInstances()
      .catch(() => {
        // Keep the last known catalog when the app is temporarily offline.
      })
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, [refreshInstances]);

  const refreshModels = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const instanceId = displayedInstanceId;
    void refreshInstances()
      .then(() => instanceId ? refreshInstanceModels(instanceId) : undefined)
      .then(() => (orgMode ? reloadMyEngines() : undefined))
      .catch(() => {
        // Keep the last known catalog when the app is temporarily offline.
      })
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, [displayedInstanceId, orgMode, refreshInstanceModels, refreshInstances]);

  useEffect(() => {
    if (!open) return;
    refreshLocalInstances();
    if (orgMode) void reloadMyEngines();
  }, [open, orgMode, refreshLocalInstances]);

  useEffect(() => {
    if (bot.busy) setOpen(false);
  }, [bot.busy]);

  // Escape steps back (search, then the local list, then closes). The modal
  // closes on its backdrop and keeps Tab inside itself.
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const clickedNode = event.target instanceof Node ? event.target : null;
      if (!rootRef.current?.contains(clickedNode)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // A child dialog (the provider switch confirmation) owns its keys.
      if (event.defaultPrevented || document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (query) setQuery("");
        else if (pane === "custom" && railInstance?.models.options.some((option) => !option.custom)) setPane("main");
        else setOpen(false);
        return;
      }
      if (!modal || event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    if (!modal) window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, modal, pane, query, railInstance]);

  // The modal takes focus when it opens and gives it back to the chip.
  useEffect(() => {
    if (!open || !modal) return;
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    const start = dialog?.querySelector<HTMLElement>('[data-model-provider-column] [aria-pressed="true"]') ?? dialog;
    start?.focus();
    return () => {
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    };
  }, [open, modal]);

  const resetList = () => {
    setQuery("");
    setShowAll(false);
  };

  const openFor = (instance: InstanceInfo | undefined) => {
    const official = instance?.models.options.filter((option) => !option.custom) ?? [];
    const selectedIsCustom = instance?.models.options.some(
      (option) => option.id === selection.model && option.custom,
    );
    setPane(!orgMode && (selectedIsCustom || isCustomOnly(instance) || (official.length === 0 && !instance?.snapshot.chatgptPlan)) ? "custom" : "main");
    resetList();
  };

  const openLocalModels = (instance: InstanceInfo) => {
    if (orgMode) return;
    setPane("custom");
    resetList();
    if (needsCli(instance) || instance.policy || probingLocal === instance.instanceId) return;
    setProbingLocal(instance.instanceId);
    void probeLocalModels(instance.instanceId, refreshInstanceModels).then(() =>
      setProbingLocal((current) => (current === instance.instanceId ? null : current)));
  };

  const openApiKeys = () => {
    setOpen(false);
    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
  };

  const selectRail = (instance: InstanceInfo) => {
    if (isClaudeAccount(instance)) lastClaudeIdRef.current = instance.instanceId;
    if (signInFamily(instance) === "openai") lastOpenaiIdRef.current = instance.instanceId;
    setRailId(instance.instanceId);
    const official = instance.models.options.filter((option) => !option.custom);
    setPane(!orgMode && (isCustomOnly(instance) || (official.length === 0 && !instance.snapshot.chatgptPlan)) ? "custom" : "main");
    resetList();
  };

  const pick = (instance: InstanceInfo, model: string) => {
    if (bot.busy || instance.policy) return;
    const nextSelection = modelSelectionForPick(selection, instance, model);
    const updateBotDefault = !threadId || scope === "bot";
    const profile = state.bots.find((candidate) => candidate.id === bot.id) ?? bot;
    const targets = updateBotDefault ? [currentTaskBot(profile, threadId ?? bot.threadId), profile] : [bot];
    if (targets.some((target) => modelSwitchNeedsAsk(approvalModeFor(target),
      state.instances.find((candidate) => candidate.instanceId === target.modelSelection.instanceId)?.driverKind,
      instance.driverKind))) {
      setPendingSwitch({ botId: bot.id, threadId: threadId ?? bot.threadId,
        selection: nextSelection, updateBotDefault, name: modelLabel(instance, model) });
      setOpen(false);
      return;
    }
    dispatch({
      type: "setModel",
      botId: bot.id,
      threadId: threadId ?? bot.threadId,
      updateBotDefault,
      selection: nextSelection,
    });
    setOpen(false);
  };

  const official = railInstance?.models.options.filter((option) => !option.custom) ?? [];
  const custom = orgMode ? [] : railInstance?.models.options.filter((option) => option.custom) ?? [];
  const currentModel = selection.instanceId === railInstance?.instanceId ? selection.model : undefined;
  const filteredOfficial = filterCustomModels(official, query);
  const compactOfficial = railInstance
    ? suggestedModels(official, railInstance.models.default, currentModel, COMPACT_MODEL_COUNT)
    : [];
  // Simple stays on the short suggested list. Search and "show all" would
  // surface the rest of the catalog, which is an engine control.
  const shownOfficial = !advanced
    ? compactOfficial
    : query
      ? filteredOfficial
      : showAll
        ? official
        : compactOfficial;
  const filteredCustom = filterCustomModels(custom, query);
  const { pinned, rest } = partitionCustomModels(filteredCustom);
  // On an organization server the server's own sign-in is not the person's:
  // their payer order (below) says whether a turn can run, so only a
  // missing engine blocks the list.
  const blocked = railInstance
    ? orgMode || pane === "custom"
      ? needsCli(railInstance)
      : needsCli(railInstance) || needsSignIn(railInstance)
    : false;
  const canOpenCustom = Boolean(railInstance && !needsCli(railInstance));
  const canReturnToOfficial = official.length > 0 && !isCustomOnly(railInstance);
  const lookingForLocal = Boolean(railInstance && probingLocal === railInstance.instanceId);
  const lookingForLocalStatus = (
    <span role="status" className="flex items-center justify-center gap-2">
      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
      {t("model.lookingLocal")}
    </span>
  );
  const orgStatusOf = (instance: InstanceInfo) => {
    const engine = myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
    if (!engine) return { label: engineStatus(instance), attention: needsCli(instance) };
    const state = orgEngineState(engine);
    return { label: t(`model.org.state.${state}`), attention: state !== "connected" };
  };
  const railStatus = railInstance
    ? orgMode && railEngine ? orgStatusOf(railInstance) : { label: pane === "custom" && !blocked && railInstance.access !== "api" ? t("model.localModels") : engineStatus(railInstance), attention: blocked }
    : null;

  const renderRow = (option: ModelOption) => (
    <ModelRow
      key={option.id}
      option={option}
      current={selection.instanceId === railInstance?.instanceId && selection.model === option.id}
      defaultId={railInstance?.models.default ?? ""}
      onPick={() => railInstance && pick(railInstance, option.id)}
    />
  );

  const composerLabel = [
    modelLabel(active, selection.model),
    selectedVariantLabel,
    !selectedVariantLabel && advanced && selection.effort ? effortLabel(selection.effort) : "",
  ].filter(Boolean).join(" ");

  const toggle = () => {
    if (bot.busy) return;
    if (active && isClaudeAccount(active)) lastClaudeIdRef.current = active.instanceId;
    if (active && signInFamily(active) === "openai") lastOpenaiIdRef.current = active.instanceId;
    const initial = pickerInstances.find((instance) => instance.instanceId === selection.instanceId) ?? pickerInstances[0];
    setRailId(initial?.instanceId ?? null);
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) openFor(initial);
      return next;
    });
  };

  const trigger = inComposer ? (
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={toggle}
      aria-expanded={open && !bot.busy}
      aria-haspopup="dialog"
      title={
        bot.busy
          ? t(threadId ? "model.threadBusy" : "model.busy")
          : composerLabel
      }
      className="flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="truncate">{composerLabel}</span>
      <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  ) : (
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={toggle}
      aria-expanded={open && !bot.busy}
      aria-haspopup="dialog"
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-hairline/40 bg-control/60 py-1 pl-2 pr-2.5 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control/60",
        // in a narrow chat header fold to a rounded square with just the
        // provider mark; the model name rides the tooltip (a bot with no
        // resolved engine keeps its label — the mark is what would hide it).
        // Multiple Claude accounts keep their name even in the compact chip.
        !contained && active && !showActiveAccount && COMPACT_SQUARE,
      )}
      title={
        bot.busy
          ? t(threadId ? "model.threadBusy" : "model.busy")
          : active
          ? `${active.displayName} · ${modelLabel(active, selection.model)}${
              modelProvider(active, selection.model) ? ` · ${modelProvider(active, selection.model)}` : ""
            }${selectedVariantLabel ? ` · ${selectedVariantLabel}` : advanced && selection.effort ? ` · ${effortLabel(selection.effort)} effort` : ""}`
          : selection.model
      }
    >
      {active && <InstanceProviderMark instance={active} size={14} />}
      {!contained && active && showActiveAccount && (
        <span data-model-account-compact className="hidden max-w-20 truncate @max-4xl/chathead:inline">{active.displayName}</span>
      )}
      <span className={cn("flex min-w-0 items-center gap-1", !contained && active && "@max-4xl/chathead:hidden")}>
        <span className="max-w-[160px] truncate">
          {active && showActiveAccount && (
            <span data-model-account className="text-ink-secondary">{active.displayName} · </span>
          )}
          {modelLabel(active, selection.model)}
          {active && modelProvider(active, selection.model) && (
            <span className="text-ink-secondary"> · {modelProvider(active, selection.model)}</span>
          )}
        </span>
        {/* outside the truncating span: a long model name must not be what
            hides the effort the header exists to surface */}
        {selectedVariantLabel !== undefined ? (
          <span data-model-variant className="max-w-[120px] truncate text-ink-secondary">· {selectedVariantLabel}</span>
        ) : advanced && selection.effort && (
          <span data-model-effort className="shrink-0 text-ink-secondary">
            · {effortLabel(selection.effort)}
          </span>
        )}
      </span>
      <ChevronDown
        size={14}
        className={cn(
          "text-ink-secondary transition-transform",
          open && "rotate-180",
          !contained && active && "@max-4xl/chathead:hidden",
        )}
      />
    </button>
  );

  const scopeControl = threadId && (
    <div className={cn("shrink-0", modal ? "" : "border-b border-hairline/40 px-3 py-2")}>
      {modal && <div className="mb-1.5 text-[12.5px] font-medium text-ink">{t("model.scope.title")}</div>}
      <div role="group" aria-label={t("model.scope.title")} className="flex flex-wrap gap-1">
        {(["thread", "bot"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}
            className={cn("rounded-lg px-2 py-1 text-[12px]", modal && "border border-hairline/40 px-2.5 py-1.5",
              scope === value ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60")}>
            {value === "bot" ? t("model.scope.bot") : t("model.scope.thread")}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-secondary">
        {scope === "bot" ? t("model.scope.botHint") : t("model.scope.threadHint")}
      </p>
    </div>
  );

  const header = railInstance && (
    <div className={cn("shrink-0", modal ? "pb-1" : "px-4 pb-2 pt-3.5")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 id={modal ? "model-picker-title" : undefined} className={cn("truncate font-semibold text-ink", modal ? "text-[16px]" : "text-[14px]")}>
            {signInFamily(railInstance) ? SIGN_IN_FAMILY_LABEL[signInFamily(railInstance)!] : railInstance.displayName}
          </h2>
          {railEngine && !modal && <div data-my-turns={railEngine.myTurns} className="truncate text-[11px] text-ink-secondary">{myTurnsText(railEngine)}</div>}
        </div>
        <div className={cn("flex shrink-0 items-center gap-1", modal && "pr-10")}>
          <button
            type="button"
            data-model-refresh
            disabled={refreshing}
            onClick={refreshModels}
            aria-label={
              refreshing
                ? t("model.refreshing", { name: railInstance.displayName })
                : t("model.refresh", { name: railInstance.displayName })
            }
            title={t("model.refreshTitle")}
            className="flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:cursor-wait disabled:opacity-70"
          >
            {refreshing ? (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={12} aria-hidden="true" />
            )}
          </button>
          {railStatus && (
            <span
              data-model-status
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                railStatus.attention ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
              )}
            >
              {railStatus.label}
            </span>
          )}
        </div>
      </div>
      {advanced && isClaudeAccount(railInstance) && claudeAccounts.length > 1 && (
        <ClaudeAccountSelect accounts={claudeAccounts} selectedId={railInstance.instanceId} onSelect={selectRail} />
      )}
      {advanced && signInFamily(railInstance) === "openai" && openaiAccounts.length > 1 && (
        <ClaudeAccountSelect accounts={openaiAccounts} selectedId={railInstance.instanceId} onSelect={selectRail} />
      )}
      {/* On an organization server this is the server's own account, not the person's. */}
      {!orgMode && railInstance.snapshot.authenticated && railInstance.snapshot.account && (
        <p className="mt-1 truncate text-[11px] text-ink-secondary" title={[railInstance.snapshot.account.email, railInstance.snapshot.account.organization].filter(Boolean).join(" · ")}>
          {[railInstance.snapshot.account.email, railInstance.snapshot.account.organization].filter(Boolean).join(" · ")}
        </p>
      )}
      {advanced && !orgMode && railInstance.snapshot.chatgptPlan && railInstance.snapshot.authenticated && (
        <ChatGptPlanStatus key={railInstance.instanceId} instanceId={railInstance.instanceId} />
      )}
      {railInstance.access === "api"
        ? <div className="mt-0.5 text-[11.5px] text-ink-secondary">{t("model.apiKeyHint")}</div>
        : pane === "custom" && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{t("model.localHint")}</div>}
      {advanced && orgMode && railInstance.capabilities?.withholdsHostTools !== true && (
        <p data-model-host-tools className="mt-2 text-[11.5px] leading-relaxed text-ink-tertiary">
          {t("model.org.hostTools", { name: railInstance.displayName })}
        </p>
      )}
    </div>
  );

  const payers = orgMode && org && railInstance && railEngine && !railInstance.policy && (
    <ModelPickerPayers key={railInstance.instanceId} engine={railEngine} routine={routineThread}
      issuer={org.org.identity.issuer} onChanged={reloadMyEngines} />
  );

  const payersFirst = Boolean(railEngine && !routineThread && orgEngineState(railEngine) !== "connected");

  const listSection = railInstance && (
    <>
      {pane === "custom" && canReturnToOfficial && (
        <button
          type="button"
          onClick={() => {
            setPane("main");
            resetList();
          }}
          className={cn("mb-1 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-secondary hover:bg-control/60", !modal && "mx-2")}
        >
          <ChevronLeft size={13} /> {t("model.backTo", { name: railInstance.displayName })}
        </button>
      )}

      {railInstance.policy ? (
        // The organisation does not allow this engine: shown, never pickable.
        <div data-policy-blocked className={cn("min-h-0 flex-1 overflow-y-auto pb-3 pt-1 text-[12.5px] leading-relaxed text-ink-secondary", !modal && "px-3")}>
          <p className="font-medium text-ink">{t("policy.managedBy", { organization: railInstance.policy.organizationName })}</p>
          <p className="mt-1">{t("policy.modelBlocked", { organization: railInstance.policy.organizationName })}</p>
        </div>
      ) : blocked ? (
        <div className={cn("min-h-0 pb-3 pt-1", modal ? "" : "flex-1 overflow-y-auto px-3")}>
          <EngineSetup instance={railInstance} intent={pane === "custom" ? "inject" : "cloud"} />
          {railInstance.claudeAccount && needsSignIn(railInstance) && pane !== "custom" && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
              {railInstance.claudeAccount.signInShell === "powershell" && `${t("engines.account.powershell")} `}
              {t("engines.account.signInHint")}
            </p>
          )}
          <p className="mt-2 text-center text-[11.5px] text-ink-tertiary">
            {railInstance.snapshot.chatgptPlan ? t("engineSetup.chatgpt.modelsAfterSignIn") : pane === "main" && official.length > 0
              ? official.length === 1
                ? t("model.afterSetupOne")
                : t("model.afterSetupMany", { count: official.length })
              : t("model.localSoon")}
          </p>
        </div>
      ) : (
        <>
          {advanced && ((pane === "main" && official.length > COMPACT_MODEL_COUNT) ||
            (pane === "custom" && custom.length > COMPACT_MODEL_COUNT)) && (
            <ModelSearch
              value={query}
              local={pane === "custom"}
              onChange={(value) => {
                setQuery(value);
                if (value) setShowAll(true);
              }}
              onEscape={() => {
                if (query) setQuery("");
                else if (pane === "custom" && canReturnToOfficial) setPane("main");
              }}
            />
          )}

          <div data-model-list className={cn(modal ? "pb-2" : "min-h-[min(180px,30dvh)] flex-1 overflow-y-auto px-2 pb-2")}>
            {pane === "main" ? (
              <>
                {advanced && railInstance.snapshot.update && (
                  <EngineUpdateNotice update={railInstance.snapshot.update} instance={railInstance} className="mx-1 mb-2" />
                )}
                <EngineGroupLabel className="px-2 pb-1 pt-0.5">
                  {query
                    ? t("model.results", { count: filteredOfficial.length })
                    : showAll
                      ? t("model.allModels", { count: official.length })
                      : t("model.suggested")}
                </EngineGroupLabel>
                {shownOfficial.map(renderRow)}
                {shownOfficial.length === 0 && (
                  <div className="px-2 py-5 text-center text-[12.5px] text-ink-secondary">
                    {query ? t("model.noMatch", { query: query.trim() }) : orgMode ? t("model.org.noModels") : t("model.noMatch", { query: "" })}
                  </div>
                )}
                {advanced && !query && !showAll && official.length > compactOfficial.length && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="mt-1 flex w-full items-center justify-between rounded-lg border-t border-hairline/40 px-2.5 py-2 text-[12.5px] font-medium text-ink-secondary hover:bg-control/60 hover:text-ink"
                  >
                    {t("model.showAll", { count: official.length })} <ChevronDown size={13} />
                  </button>
                )}
                {advanced && !query && showAll && official.length > COMPACT_MODEL_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAll(false)}
                    className="mt-1 w-full rounded-lg px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-control/60 hover:text-ink"
                  >
                    {t("model.showSuggested")}
                  </button>
                )}
              </>
            ) : (
              <>
                {lookingForLocal && custom.length > 0 && (
                  <div className="flex px-2 pb-1.5 pt-0.5 text-[11.5px] text-ink-secondary">{lookingForLocalStatus}</div>
                )}
                {pinned.length > 0 && (
                  <EngineGroupLabel className="px-2 pb-1 pt-0.5">{t("model.loadedNow")}</EngineGroupLabel>
                )}
                {pinned.map(renderRow)}
                {pinned.length > 0 && rest.length > 0 && (
                  <div className="mx-2 my-2 border-t border-hairline/40" role="separator" />
                )}
                {rest.map(renderRow)}
                {custom.length === 0 && (
                  <div className="mx-1 rounded-xl border border-dashed border-hairline/50 px-3 py-5 text-center">
                    {lookingForLocal ? (
                      <div className="text-[12.5px] text-ink-secondary">{lookingForLocalStatus}</div>
                    ) : (
                      <>
                        <div className="text-[12.5px] font-medium text-ink">{t("model.noLocal")}</div>
                        <div className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">
                          {t("model.noLocalHint")}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {custom.length > 0 && filteredCustom.length === 0 && (
                  <div className="px-2 py-5 text-center text-[12.5px] text-ink-secondary">
                    {t("model.noMatch", { query: query.trim() })}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  // Effort applies to the model this bot runs on now (its active engine,
  // not the provider being browsed). `contained` callers (the settings
  // dialog) render their own EffortRow card, and two copies of one control
  // in one view read as a bug.
  const effort = advanced && !contained && (
    <EffortRow
      bot={bot}
      threadId={threadId}
      updateBotDefault={Boolean(threadId && scope === "bot")}
      className="shrink-0"
      label={<span className="text-[12.5px] font-medium text-ink">{active?.capabilities?.modelVariants ? t("model.reasoning") : t("model.effort")}</span>}
    />
  );

  const localEntry = advanced && railInstance && (orgMode ? (
    <p data-model-local-hidden className="text-[11.5px] leading-relaxed text-ink-tertiary">{t("model.org.localHidden")}</p>
  ) : pane === "main" && offersLocalModels(railInstance, custom.length) && (
    <button
      type="button"
      data-model-local-entry
      aria-label={
        custom.length > 0
          ? t("model.useLocalCount", { count: custom.length })
          : t("model.useLocal")
      }
      disabled={!canOpenCustom}
      onClick={() => openLocalModels(railInstance)}
      className={cn("flex w-full shrink-0 items-center justify-between gap-2 border-t border-hairline/40 py-3 text-left text-[12.5px] font-medium text-ink hover:bg-control/60 disabled:cursor-not-allowed disabled:text-ink-secondary/40 disabled:hover:bg-transparent", modal ? "px-1" : "px-4")}
    >
      <span>{t("model.useLocal")}</span>
      <span className="flex items-center gap-2">
        {custom.length > 0 && (
          <span className="rounded-full bg-inset px-2 py-0.5 text-[10.5px] text-ink-secondary">
            {t("model.available", { count: custom.length })}
          </span>
        )}
        <ChevronRight size={14} className="text-ink-secondary" />
      </span>
    </button>
  ));

  const footer = !advanced ? null : (
    <div className="flex shrink-0 border-t border-hairline/40">
      <button type="button" data-model-engines-link onClick={() => {
        setOpen(false);
        dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
      }} className="flex-1 px-4 py-2.5 text-left text-[12px] text-ink-secondary hover:bg-control/60 hover:text-ink">
        {t("settings.engines.title")}
      </button>
      {/* A remote client's settings hide the keys section, so the
          shortcut would land somewhere else. */}
      {window.ogb?.remoteClient?.active !== true && (
        <button type="button" data-model-add-api-keys onClick={openApiKeys} className="flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[12px] text-ink-secondary hover:bg-control/60 hover:text-ink">
          <KeyRound size={12} aria-hidden="true" />
          {t("model.addApiKeys")}
        </button>
      )}
    </div>
  );

  const railProps = {
    instances: pickerInstances, selectedInstance: railInstance, claudeInstance: claudeRailInstance,
    openaiInstance: openaiRailInstance, onSelect: selectRail,
    onAddApiKeys: advanced && window.ogb?.remoteClient?.active !== true ? openApiKeys : undefined,
    ...(orgMode && myEngines ? { statusOf: orgStatusOf } : {}),
  };

  const modalPanel = (
    <div
      data-model-picker-backdrop
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div
        ref={dialogRef}
        data-model-picker-content
        role="dialog"
        aria-modal="true"
        aria-labelledby={railInstance ? "model-picker-title" : undefined}
        aria-label={railInstance ? undefined : t("model.choose")}
        tabIndex={-1}
        {...motion.exitProps}
        className={cn(
          "relative flex w-full flex-col overflow-hidden border border-border bg-app outline-none sm:flex-row",
          "h-[min(88dvh,720px)] rounded-t-2xl sm:h-[min(640px,calc(100dvh-96px))] sm:w-[min(880px,calc(100vw-48px))] sm:rounded-[14px]",
          motion.className,
        )}
      >
        <button type="button" onClick={() => setOpen(false)} aria-label={t("model.close")}
          className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary">
          <X size={18} aria-hidden="true" />
        </button>
        {pickerInstances.length > 0 && <ModelEngineRail {...railProps} wide />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
            {railInstance ? (
              <>
                {header}
                {/* Nothing pays yet: how to fix that comes first. Otherwise
                    the choice does, and who pays follows. */}
                {payersFirst && payers}
                {scopeControl}
                <div>
                  <div className="mb-1 text-[12.5px] font-medium text-ink">{t("model.models")}</div>
                  {listSection}
                </div>
                {effort}
                {!payersFirst && payers}
                {localEntry}
              </>
            ) : (
              <div className="py-5 pr-10 text-[13px] text-ink-secondary">{t("model.noProviders")}</div>
            )}
          </div>
          {footer}
        </div>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={cn(contained ? "w-full" : "relative", className)}>
      {contained ? (
        <div className="flex items-center justify-between gap-4">
          {label}
          {trigger}
        </div>
      ) : (
        trigger
      )}

      {motion.shown && (
        // Portalled like Settings: a translated sidebar or composer would
        // otherwise become the containing block. Without a document (static
        // rendering in tests) the dialog renders in place.
        typeof document === "undefined" ? modalPanel : createPortal(modalPanel, document.body)
      )}
      <ConfirmDialog
        open={pendingSwitch !== null}
        title={t("model.providerSwitch.title")}
        body={t(pendingSwitch?.updateBotDefault ? "model.providerSwitch.botBody" : "model.providerSwitch.threadBody", {
          model: pendingSwitch?.name ?? "",
        })}
        tone="neutral"
        confirmLabel={t("model.providerSwitch.confirm")}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (!pendingSwitch || bot.busy || pendingSwitch.botId !== bot.id || pendingSwitch.threadId !== (threadId ?? bot.threadId)) {
            setPendingSwitch(null); return;
          }
          dispatch({ type: "setModel", botId: pendingSwitch.botId, threadId: pendingSwitch.threadId,
            selection: pendingSwitch.selection, updateBotDefault: pendingSwitch.updateBotDefault,
            resetApprovalToAsk: true });
          setPendingSwitch(null);
        }}
      />
    </div>
  );
}
