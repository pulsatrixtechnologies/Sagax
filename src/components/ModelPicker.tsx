// Compact model picker: providers live on a Cloud/Local rail. A ready
// provider shows one dropdown of its models under Cloud and Local
// (ModelDropdown); an installed engine that needs sign-in, or the bot's own
// engine when it needs setup, shows one focused action instead. Engines that
// are not installed and not in use stay in Settings. One mode: a model chosen
// in a thread runs that thread and becomes the bot's model.
// Reasoning effort rides along (EffortRow): model and effort are one choice to
// the person making it, so the chat header and the settings dialog render the
// same row and write through the same action.
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Info, KeyRound, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useStore, type Bot, type InstanceInfo, type ModelSelection } from "@/state/store";
import type { ModelVariantOption } from "../../shared/runtime-events";
import { isDesktopModelId, localModelRows, localRowUnavailable, refreshLocalModelsOnOpen, runsLoopbackModels } from "@/lib/local-models";
import { engineAllowed } from "../../shared/org-allowed-engines";
import { configuredModelInstances, isClaudeAccount, SIGN_IN_FAMILY_LABEL, signInFamily, splitEngineRail, type SignInFamily } from "@/lib/engine-rail";
import { useShowUnreadyProviders } from "@/lib/unready-providers-preference";
import { InstanceProviderMark } from "./ProviderIcons";
import { EngineSetup, EngineUpdateNotice, hasSavedApiKey, needsCli, needsSignIn } from "./EngineSetup";
import { EngineGroupLabel } from "./EngineGroupLabel";
import { ModelMenuItem, ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "./ModelMenu";
import { ChatGptPlanStatus } from "./ChatGptPlanStatus";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { reloadMyEngines, useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { orgEngineState } from "@/lib/model-payers";
import { ModelPickerPayers } from "./ModelPickerPayers";
import { OrgHostToolsNote, orgRefusesEngine } from "./OrgHostToolsNote";
import { COMPACT_SQUARE } from "@/lib/compact-chip";
import { saveViewerBotOverride } from "@/lib/viewer-bot-overrides";
import type { ViewerBotOverridePatch } from "../../shared/viewer-bot-overrides";
import { autoChipLabel, autoReasonSentence } from "@/lib/auto-model";
import { useAutoModelPreview } from "@/lib/auto-model-preview";
import { threadsOnOwnModel } from "../../shared/thread-model";
import { ThreadModelsLine } from "./ThreadModelsLine";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort, pickerEffortLevels, ULTRACODE_EFFORT } from "../../shared/ultracode-effort";

type ModelOption = InstanceInfo["models"]["options"][number];

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((option) => option.id === model)?.label ?? model;
}

/** Asked by the desktop mascot's balloon (FloatingBots.tsx): `detail.botId`'s composer chip opens its picker. */
export const COMPOSER_MODEL_EVENT = "omb:composer-model";

/**
 * What the composer's model chip reads for a bot (its model, and its effort
 * when set), for the desktop mascot's balloon, which shows the same chip.
 */
export function composerModelLabel(instances: readonly InstanceInfo[], selection: Bot["modelSelection"]): string {
  const active = instances.find((instance) => instance.instanceId === selection.instanceId);
  return [modelLabel(active, selection.model), selection.effort ? effortLabel(selection.effort) : ""].filter(Boolean).join(" ");
}

function modelProvider(instance: InstanceInfo | undefined, model: string): string | undefined {
  return instance?.models.options.find((option) => option.id === model)?.provider;
}

function saveViewerChoice(
  dispatch: (action: { type: "error"; message: string }) => void,
  botId: string,
  patch: ViewerBotOverridePatch,
): void {
  void saveViewerBotOverride(botId, patch).then((ok) => {
    if (!ok) dispatch({ type: "error", message: t("botPanel.viewerLocal.saveError") });
  });
}

export function engineStatus(instance: InstanceInfo): string {
  if (needsCli(instance)) return t("model.setupRequired");
  if (needsSignIn(instance)) return t("model.signInRequired");
  return instance.snapshot.version ?? t("model.ready");
}

/** Sign-in required, no access yet, or not installed: hidden in the rail unless the person asked to see them. */
export function providerRailUnready(instance: InstanceInfo, status?: { attention: boolean }): boolean {
  if (status) return status.attention;
  return needsCli(instance) || needsSignIn(instance);
}

/** A desktop bridge inject id (desk host, then ::, then the model). Organization mode shows only these in Custom. */
export function isDesktopLocalModel(id: string): boolean {
  return isDesktopModelId(id);
}

export { effortLabel };

/** How hard the bot thinks, for the engine it currently runs on. Rendered
 * both in the picker's popover and in the settings dialog's Model section so
 * the two cannot drift: one list of levels, one `setModel` dispatch.
 *
 * `undefined` ("Default") is not the `none` level: Default sends nothing and
 * lets the engine decide, `none` is a level the engine is told to use. Only
 * pi offers both, and dropping either would change what an existing bot
 * sends, so both stay and the tooltips say which is which. */
export function EffortRow({
  bot,
  threadId,
  updateBotDefault,
  viewerLocal = false,
  className,
  label,
  compact = false,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  /** Write this person's own effort. Do not patch the bot. */
  viewerLocal?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (instance?.capabilities?.modelVariants) {
    return <ModelVariantRow bot={bot} threadId={threadId} updateBotDefault={updateBotDefault} viewerLocal={viewerLocal} className={className} label={label} compact={compact} />;
  }
  const nativeLevels = instance?.capabilities?.effortLevels;
  // An engine with no levels gets no control at all, not an empty one.
  if (!nativeLevels?.length) return null;
  const levels = pickerEffortLevels(nativeLevels);

  if (compact) return (
    <label className={cn("flex items-center justify-between gap-3", className)}>
      {label}
      <select aria-label={t("model.effort.aria")} value={selection.effort ?? ""}
        onChange={(event) => {
          const effort = levels.find((level) => level === event.target.value);
          if (viewerLocal) {
            saveViewerChoice(dispatch, bot.id, { effort: effort ?? null });
            return;
          }
          dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
            selection: { ...selection, effort } });
        }}
        className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
        <option value="">{t("model.defaultTag")}</option>
        {levels.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
      </select>
    </label>
  );

  return (
    <div className={className}>
      {label}
      {/* wraps rather than dividing a fixed width: pi offers Default plus six
          levels, which a segmented control would squeeze in the popover */}
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.effort.aria")}>
        {[undefined, ...levels].map((level) => (
          <button
            key={level ?? "default"}
            type="button"
            aria-pressed={selection.effort === level}
            title={
              level === undefined
                ? t("model.effort.defaultTitle")
                : isUltracodeEffort(level)
                  ? t("model.effort.ultracodeHint")
                  : t("model.effort.levelTitle", { level: effortLabel(level) })
            }
            onClick={() => {
              if (viewerLocal) {
                saveViewerChoice(dispatch, bot.id, { effort: level ?? null });
                return;
              }
              dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } });
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              selection.effort === level && isUltracodeEffort(level)
                ? "ultracode-effort-chip ultracode-effort-chip-active"
                : selection.effort === level
                  ? "border-accent/60 bg-control text-ink"
                  : level === ULTRACODE_EFFORT
                    ? "ultracode-effort-option border-hairline/40 text-ink-secondary"
                    : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {level === undefined ? t("model.defaultTag") : effortLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

function variantLabel(option: ModelVariantOption): string {
  return option.id === "default" ? t("model.variant.openCodeDefault") : option.label;
}

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function ModelVariantRow({ bot, threadId, updateBotDefault, viewerLocal = false, className, label, compact = false }: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  viewerLocal?: boolean;
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
    if (viewerLocal) {
      saveViewerChoice(dispatch, bot.id, { variant: variant ?? null });
      return;
    }
    const { effort: _effort, variant: _variant, ...model } = selection;
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
      selection: { ...model, ...(variant !== undefined ? { variant } : {}) } });
  };
  if (compact) return (
    <div className={className}>
      <label className="flex items-center justify-between gap-3">
        {label}
        <select aria-label={t("model.variant.aria")} disabled={bot.busy}
          value={selection.variant === undefined ? "unset" : missing ? "missing" : String(options.findIndex((option) => option.id === selection.variant))}
          onChange={(event) => choose(options[Number(event.target.value)]?.id)}
          className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50">
          <option value="unset">{t("model.variant.session")}</option>
          {missing && <option value="missing" disabled>{selection.variant} ({unavailable ? t("model.variant.unavailableTag") : t("model.variant.unverifiedTag")})</option>}
          {options.map((option, index) => <option key={option.id} value={String(index)}>{variantLabel(option)}</option>)}
        </select>
      </label>
      {missing && <p className="mt-1 text-[11px] text-ink-secondary">{unavailable ? t("model.variant.unavailableShort") : t("model.variant.uncheckedShort")}</p>}
    </div>
  );
  return (
    <div className={className}>
      {label}
      {(selection.variant === undefined || missing) && (
        <p className="mt-2 text-[12px] text-ink-secondary">
          {unavailable ? t("model.variant.unavailable", { variant: selection.variant! })
            : missing ? t("model.variant.unchecked", { variant: selection.variant! }) : t("model.variant.none")}
          {current !== undefined && ` ${t("model.variant.sessionNow", { variant: variantLabel(options.find((option) => option.id === current) ?? { id: current, label: current }) })}`}
        </p>
      )}
      {selection.variant !== undefined && (
        <button type="button" disabled={bot.busy} onClick={() => choose()}
          title={t("model.variant.clearTitle")}
          className="mt-2 block text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink disabled:opacity-50">
          {t("model.variant.clear")}
        </button>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.variant.aria")}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={bot.busy}
              aria-pressed={selection.variant === option.id}
              title={t("model.variant.useTitle", { variant: variantLabel(option) })}
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

/** Once any key is saved, the keys shortcut is also the way to fix one. */
function apiKeysLabel(instances: InstanceInfo[]): string {
  return t(instances.some(hasSavedApiKey) ? "model.addOrChangeApiKeys" : "model.addApiKeys");
}

export function ModelEngineRail({ instances, selectedInstance, claudeInstance, openaiInstance, onSelect, onAddApiKeys, wide = false, statusOf, notAllowed, showUnready: showUnreadyProp, auto }: {
  instances: InstanceInfo[];
  /** The window's first mode: Auto, every allowed engine's models together. */
  auto?: { on: boolean; selected: boolean; onSelect: () => void };
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
  /** Organization server: a provider the organization does not allow,
   * listed once (the person connected it before) and never selectable. */
  notAllowed?: (instance: InstanceInfo) => boolean;
  /** Appearance setting: list sign-in required / no access in every group.
   * Off by default: they stay hidden. The picker passes the saved preference. */
  showUnready?: boolean;
}) {
  const showUnready = showUnreadyProp === true;
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
    const blocked = notAllowed?.(target) === true;
    const managedBy = blocked ? t("model.notAllowed")
      : target.policy ? t("policy.managedBy", { organization: target.policy.organizationName }) : undefined;
    const statusLabel = managedBy ?? status?.label ?? engineStatus(target);
    if (wide) return (
      <button
        type="button"
        key={instance.instanceId}
        data-rail-provider={family ?? instance.instanceId}
        data-rail-not-allowed={blocked || undefined}
        disabled={blocked}
        onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
          // the focus follows the choice, so only the selected mode looks selected
          event?.currentTarget.focus();
          onSelect(target);
        }}
        aria-label={managedBy ? `${label} · ${managedBy}` : label}
        aria-describedby={`model-rail-status-${instance.instanceId}`}
        aria-pressed={selected}
        className={cn("relative flex min-w-[9.5rem] shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left sm:min-w-0 sm:w-full",
          selected ? "bg-selected ring-1 ring-hairline/50" : "hover:bg-hover", managedBy && "opacity-50", blocked && "cursor-not-allowed hover:bg-transparent")}
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
        onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
          // the focus follows the choice, so only the selected mode looks selected
          event?.currentTarget.focus();
          onSelect(target);
        }}
        disabled={blocked}
        data-rail-not-allowed={blocked || undefined}
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
  const selectedFamily = signInFamily(selectedInstance);
  const isSelectedProvider = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    return family ? selectedFamily === family : instance.instanceId === selectedInstance?.instanceId;
  };
  const isUnready = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    const target = family ? opensOn[family] ?? instance : instance;
    return providerRailUnready(target, statusOf?.(target));
  };
  const renderGroup = (label: string, rows: InstanceInfo[], extra?: ReactNode, headingClass?: string) => {
    const visible = showUnready
      ? rows
      : rows.filter((instance) => !isUnready(instance) || isSelectedProvider(instance));
    if (visible.length === 0 && !extra) return null;
    const heading = headingClass
      ? <EngineGroupLabel className={headingClass}>{label}</EngineGroupLabel>
      : <EngineGroupLabel className="hidden px-2.5 pb-0.5 pt-2 text-[11.5px] normal-case tracking-normal first:pt-0.5 sm:block">{label}</EngineGroupLabel>;
    return (
      <Fragment key={`rail-${label}`}>
        {heading}
        {visible.map(railButton)}
        {extra}
      </Fragment>
    );
  };
  if (wide) {
    return (
      <nav aria-label={t("model.providers")} data-model-provider-column
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline/40 bg-panel p-2 mr-12 sm:mr-0 sm:w-56 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
        {auto && (
          <button
            type="button"
            data-rail-auto
            onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
              event?.currentTarget.focus();
              auto.onSelect();
            }}
            aria-pressed={auto.selected}
            aria-describedby="model-rail-status-auto"
            className={cn("relative flex min-w-[9.5rem] shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left sm:mb-1 sm:min-w-0 sm:w-full",
              auto.selected ? "bg-selected ring-1 ring-hairline/50" : "hover:bg-hover")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-inset text-ink">
              <Sparkles size={15} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-ink">{t("model.auto.label")}</span>
              <span id="model-rail-status-auto" data-rail-status className="flex items-center gap-1 truncate text-[11px] text-ink-secondary">
                {auto.on && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />}
                <span className="truncate">{auto.on ? t("model.auto.on") : t("model.auto.rail")}</span>
              </span>
            </span>
          </button>
        )}
        {renderGroup(t("model.rail.cloud"), subscription)}
        {renderGroup(t("model.rail.apiKeys"), api, onAddApiKeys && (
          <button type="button" data-rail-add-api-key onClick={onAddApiKeys}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">
            <Plus size={14} aria-hidden="true" /> {t("model.addApiKeys")}
          </button>
        ))}
        {renderGroup(t("model.rail.local"), local)}
      </nav>
    );
  }
  return (
    <div className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline/40 bg-panel p-2">
      {renderGroup(t("model.rail.cloud"), subscription, undefined, "px-0 pb-0.5 pt-0.5 text-center text-[9px]")}
      {renderGroup(t("model.rail.apiKeys"), api, onAddApiKeys && (
        <button
          type="button"
          data-rail-add-api-key
          onClick={onAddApiKeys}
          aria-label={apiKeysLabel(instances)}
          title={apiKeysLabel(instances)}
          className="flex size-9 items-center justify-center rounded-lg border border-dashed border-hairline text-ink-secondary hover:bg-control/60 hover:text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      ), cn("px-0 pb-0.5 text-center text-[9px] leading-tight", subscription.length > 0 ? "pt-2" : "pt-0.5"))}
      {renderGroup(t("model.rail.local"), local, undefined, "px-0 pb-0.5 pt-2 text-center text-[9px]")}
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


/** The window's rail entry that is not an engine: Auto. */
const AUTO_RAIL = "auto";

/** The composer's model menu: a popover above the chip, never wider than the window. */
const MENU_WIDTH = 340;

export function ModelPicker({
  bot,
  threadId,
  className,
  contained = false,
  inComposer = false,
  viewerLocal = false,
  label,
  windowOnly = false,
  onWindowClose,
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  /** Profile row: the label sits above the pill, which opens the model
   * window. The profile card already has Effort, so the window does not
   * repeat it. */
  contained?: boolean;
  /** Sit in the composer as a text row that opens the model menu. */
  inComposer?: boolean;
  /** Settings of a shared bot: save this person's model, not the owner's. */
  viewerLocal?: boolean;
  label?: ReactNode;
  /** No chip: the model window, open from the start (the sidebar's bot
   * menu opens it through ModelWindowHost). */
  windowOnly?: boolean;
  onWindowClose?: () => void;
}) {
  const { state, dispatch, refreshInstances, refreshModels: refreshInstanceModels } = useStore();
  // The model window (a modal like Settings) and the composer's model menu.
  const [open, setOpen] = useState(windowOnly);
  const [menu, setMenu] = useState(false);
  const motion = useMenuMotion(open && !bot.busy);
  const menuMotion = useMenuMotion(menu && !bot.busy);
  const [railId, setRailId] = useState<string | null>(null);
  const [autoInfo, setAutoInfo] = useState(false);
  const [menuAt, setMenuAt] = useState<{ right: number; bottom: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The bot's model just changed from this thread's picker: say how many
  // threads kept a model of their own, until the picker opens again.
  const [changedBotModel, setChangedBotModel] = useState(false);
  const refreshingRef = useRef(false);
  const lastClaudeIdRef = useRef<string | null>(null);
  const lastOpenaiIdRef = useRef<string | null>(null);
  // Organization server (Perspicax): each person pays with their own
  // subscription, their model key, or the organization key; the server's
  // local models are not offered (src/lib/model-payers.ts).
  const org = usePerspicaxOrg();
  const advanced = useAdvancedMode();
  const myEngines = useMyEngines();
  const showUnready = useShowUnreadyProviders();
  const orgMode = org !== null;
  const anyOpen = open || menu;

  const selection = bot.modelSelection;
  // Auto (docs/plans/2026-10-08-auto-model.md): the chip names what this
  // thread's last turn ran on, else what the next one would.
  const autoOn = selection.auto === true && !viewerLocal;
  const autoTask = state.bots?.find((candidate) => candidate.id === bot.id)?.tasks
    ?.find((task) => task.threadId === (threadId ?? bot.threadId));
  const autoPreview = useAutoModelPreview(bot.id, threadId, autoOn);
  const autoRecord = autoOn ? autoTask?.autoModel ?? autoPreview : null;
  const active = state.instances.find((instance) => instance.instanceId === selection.instanceId);
  const autoInstance = autoRecord ? state.instances.find((instance) => instance.instanceId === autoRecord.instanceId) ?? active : active;
  const configured = configuredModelInstances(state.instances, selection.instanceId);
  // Organization server: only the providers its admin allows in Perspicax
  // (allowedEngines; none set means every one). A provider the person
  // connected before it left the list shows once, disabled.
  const allowedEngines = orgMode ? state.config?.allowedEngines ?? null : null;
  const notAllowed = (instance: InstanceInfo) => orgMode && !engineAllowed(allowedEngines, instance.instanceId);
  const connectedByMe = (instance: InstanceInfo) => Boolean(myEngines?.some((engine) =>
    engine.instanceId === instance.instanceId && engine.subscription.signedIn));
  // An organization server offers an engine only when that engine's own
  // shell, file and web tools stay off the Sagax server. The bot's current
  // engine stays so its state is explained.
  const pickerInstances = orgMode
    ? configured.filter((instance) => (instance.instanceId === selection.instanceId || !orgRefusesEngine(instance)) &&
      (!notAllowed(instance) || connectedByMe(instance)))
    : configured;
  const selectable = pickerInstances.filter((instance) => !notAllowed(instance));
  const selectedVariantLabel = selection.variant === undefined ? undefined : variantLabel(
    active?.models.options.find((option) => option.id === selection.model)?.variants?.find((option) => option.id === selection.variant)
      ?? { id: selection.variant, label: selection.variant },
  );
  const claudeAccounts = selectable.filter(isClaudeAccount);
  const openaiAccounts = selectable.filter((instance) => signInFamily(instance) === "openai");
  const openaiRailInstance = openaiAccounts.find((instance) => instance.instanceId === lastOpenaiIdRef.current)
    ?? openaiAccounts.find((instance) => instance.instanceId === selection.instanceId) ?? openaiAccounts[0];
  const multipleClaudeAccounts = state.instances.filter(isClaudeAccount).length > 1;
  const showActiveAccount = (multipleClaudeAccounts && isClaudeAccount(active)) || Boolean(active?.snapshot.chatgptPlan);
  const claudeRailInstance = claudeAccounts.find((instance) => instance.instanceId === lastClaudeIdRef.current)
    ?? claudeAccounts.find((instance) => instance.instanceId === selection.instanceId) ?? claudeAccounts[0];
  // The window opens on Auto while the bot is on Auto, else on its engine.
  const autoPane = !viewerLocal && (railId ?? (autoOn ? AUTO_RAIL : null)) === AUTO_RAIL;
  const railInstance =
    selectable.find((instance) => instance.instanceId === (railId && railId !== AUTO_RAIL ? railId : selection.instanceId)) ?? selectable[0];
  const displayedInstanceId = railInstance?.instanceId;
  // Slice 4, organization server: who a bot on this engine can answer.
  const railEngine = myEngines?.find((engine) => engine.instanceId === displayedInstanceId) ?? null;
  // A routine's thread pays as the bot's owner (engine-credentials.ts).
  const routineThread = Boolean(orgMode && threadId && state.bots.find((candidate) => candidate.id === bot.id)?.tasks
    ?.some((task) => task.threadId === threadId && task.routineRunId));

  const closeWindow = () => {
    setOpen(false);
    if (windowOnly) onWindowClose?.();
  };
  const closeMenu = (refocus = false) => {
    setMenu(false);
    if (refocus) triggerRef.current?.focus();
  };

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
    if (!anyOpen) return;
    refreshLocalInstances();
    if (orgMode) void reloadMyEngines();
  }, [anyOpen, orgMode, refreshLocalInstances]);

  // Opening the picker looks for local models again (a server started after
  // launch), at most once per LOCAL_REFRESH_FRESH_MS. Solo probes this
  // machine through the engine's catalog; an organization server asks this
  // desktop app to probe the person's own computer.
  const railDriverKind = railInstance?.driverKind;
  const railNeedsSetup = Boolean(railInstance && (needsCli(railInstance) || railInstance.policy));
  useEffect(() => {
    if (!anyOpen || !displayedInstanceId) return;
    if (orgMode) {
      const bridgeRefresh = window.ogb?.serverMode?.refreshLocalModels;
      if (!bridgeRefresh) return;
      void refreshLocalModelsOnOpen({ key: "desktop", orgMode: true, bridgeRefresh, reload: refreshInstances });
      return;
    }
    if (railNeedsSetup || !runsLoopbackModels(railDriverKind)) return;
    void refreshLocalModelsOnOpen({ key: displayedInstanceId, orgMode: false, refreshModels: () => refreshInstanceModels(displayedInstanceId) });
  }, [anyOpen, displayedInstanceId, orgMode, railDriverKind, railNeedsSetup, refreshInstances, refreshInstanceModels]);

  useEffect(() => {
    if (!bot.busy) return;
    setMenu(false);
    if (!windowOnly) setOpen(false);
  }, [bot.busy, windowOnly]);

  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;
  // Escape closes the window. The window closes on its backdrop and keeps
  // Tab inside itself.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // A child dialog (the provider switch confirmation) owns its keys.
      if (event.defaultPrevented || document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeWindowRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The window takes focus when it opens and gives it back to the chip.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    const start = dialog?.querySelector<HTMLElement>('[data-model-provider-column] [aria-pressed="true"]') ?? dialog;
    start?.focus();
    return () => {
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    };
  }, [open]);

  // The menu: a click outside or a resize closes it; Escape anywhere in it
  // closes it and gives the focus back to the chip.
  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenu(false);
    };
    const resize = () => setMenu(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [menu]);

  const openApiKeys = () => {
    closeWindow();
    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
  };

  const selectRail = (instance: InstanceInfo) => {
    if (notAllowed(instance)) return;
    if (isClaudeAccount(instance)) lastClaudeIdRef.current = instance.instanceId;
    if (signInFamily(instance) === "openai") lastOpenaiIdRef.current = instance.instanceId;
    setRailId(instance.instanceId);
  };

  // A thread's picker knows whether the thread follows its bot's model
  // (absent from a server too old to say).
  const profile = state.bots.find((candidate) => candidate.id === bot.id) ?? bot;
  const follows = threadId ? profile.tasks?.find((task) => task.threadId === threadId)?.followsBotModel : undefined;
  const botModelInstance = state.instances.find((instance) => instance.instanceId === profile.modelSelection.instanceId);
  const botModelName = botModelInstance
    ? `${botModelInstance.displayName} · ${modelLabel(botModelInstance, profile.modelSelection.model)}`
    : profile.modelSelection.model;
  const ownModelThreads = threadsOnOwnModel(profile.modelSelection, profile.tasks ?? []).length;

  const closeAll = () => {
    setMenu(false);
    closeWindow();
  };

  /** Back onto the bot's model: the server keeps no model of the thread's
   * own for a pick that is the bot's. */
  const pickBotModel = () => {
    if (bot.busy) return;
    closeAll();
    if (follows !== false) return;
    dispatch({ type: "setModel", botId: bot.id, threadId: threadId ?? bot.threadId, updateBotDefault: false, selection: profile.modelSelection });
  };

  // One mode (JC, 2026-10-09): a model chosen here runs this thread and
  // becomes the bot's model, in one request (PATCH the thread with
  // updateBotDefault). Groups and new threads use the bot's model; existing
  // threads that follow the bot move with it, a thread on its own model
  // keeps it.
  const pick = (instance: InstanceInfo, model: string) => {
    if (bot.busy || instance.policy || notAllowed(instance)) return;
    const localRow = instance.models.options.find((option) => option.id === model && (option.local || isDesktopModelId(option.id)));
    if (localRow && localRowUnavailable(instance.driverKind, model, localRow.anthropic)) return;
    if (viewerLocal) {
      saveViewerChoice(dispatch, bot.id, { model: { instanceId: instance.instanceId, model } });
      closeAll();
      return;
    }
    dispatch({
      type: "setModel",
      botId: bot.id,
      threadId: threadId ?? bot.threadId,
      updateBotDefault: true,
      selection: modelSelectionForPick(selection, instance, model),
    });
    if (threadId) setChangedBotModel(true);
    closeAll();
  };

  // Auto keeps the engine and base model; choosing a model pins it. The
  // same one mode: the thread and the bot's default.
  const chooseAuto = () => {
    if (bot.busy || viewerLocal) return;
    closeAll();
    if (autoOn) return;
    dispatch({
      type: "setModel",
      botId: bot.id,
      threadId: threadId ?? bot.threadId,
      updateBotDefault: true,
      selection: { ...selection, auto: true },
    });
    if (threadId) setChangedBotModel(true);
  };

  // An engine's models under two headings. Local: models on this machine
  // (solo) or on the person's own computer (organization server), and a
  // local server's models (`server::model`). Cloud: everything else the
  // engine offers. On an organization server the server's own custom models
  // are never listed. A signed-out engine (solo) offers its local models
  // only: its cloud ones wait for the sign-in.
  const catalogOf = (instance: InstanceInfo) => {
    const options = instance.models.options;
    const localRows = localModelRows(options, orgMode);
    const localIds = new Set(localRows.map((option) => option.id));
    const isLocal = (option: ModelOption) => localIds.has(option.id) || Boolean(option.custom && option.id.includes("::"));
    const offered = orgMode ? options.filter((option) => !option.custom || isDesktopModelId(option.id)) : options;
    const localOptions = offered.filter(isLocal);
    const signInFirst = !orgMode && needsSignIn(instance);
    const unavailable = (id: string): string | undefined => {
      if (!localIds.has(id)) return undefined;
      const reason = localRowUnavailable(instance.driverKind, id, localRows.find((option) => option.id === id)?.anthropic);
      if (!reason) return undefined;
      return reason === "anthropic" ? t("model.localUnavailable.anthropic") : t("model.localUnavailable.engine", { engine: instance.displayName });
    };
    return {
      official: options.filter((option) => !option.custom),
      cloud: signInFirst ? [] : offered.filter((option) => !isLocal(option)),
      // Loaded local models first, as the old local list did.
      local: [...localOptions.filter((option) => option.loaded), ...localOptions.filter((option) => !option.loaded)],
      signInFirst,
      unavailable,
    };
  };

  // A row reads "name" then, muted, what a pick would run it with: the
  // provider (OpenRouter), the effort kept on the same engine, the variant
  // of the current model, Local. In a thread, the bot's own model is the
  // row above the engines ("<bot>'s model"), not a tag here.
  const modelRow = (instance: InstanceInfo, option: ModelOption, local: boolean, unavailable: string | undefined, saysLocal: boolean): ModelMenuRow => {
    const current = !autoOn && follows !== true && selection.instanceId === instance.instanceId && selection.model === option.id;
    const sameEngine = instance.instanceId === selection.instanceId;
    const variant = sameEngine && selection.model === option.id ? selectedVariantLabel : undefined;
    const effort = sameEngine && !instance.capabilities?.modelVariants && selection.effort ? effortLabel(selection.effort) : undefined;
    return {
      key: `${instance.instanceId}\u0000${option.id}`,
      kind: "model",
      instanceId: instance.instanceId,
      modelId: option.id,
      label: option.label,
      detail: [option.provider, variant ?? effort, local && saysLocal ? t("model.localGroup") : undefined].filter(Boolean).join(" · ") || undefined,
      tags: [
        option.id === instance.models.default ? t("model.defaultTag") : undefined,
        option.loaded ? t("model.loadedTag") : undefined,
      ].filter((tag): tag is string => Boolean(tag)),
      current,
      unavailable,
      keywords: instance.displayName,
    };
  };
  // Under an engine's own heading a local model says Local; under Cloud
  // and Local headings (the window's engine mode) the heading says it.
  const rowsOf = (instance: InstanceInfo, saysLocal: boolean) => {
    const catalog = catalogOf(instance);
    return {
      catalog,
      cloud: catalog.cloud.map((option) => modelRow(instance, option, false, undefined, saysLocal)),
      local: catalog.local.map((option) => modelRow(instance, option, true, catalog.unavailable(option.id), saysLocal)),
    };
  };

  // The rows above the engines: Auto (the bot's choice; a shared bot's
  // viewer pins their own model, the owner's Auto stays the owner's) and,
  // in a thread, the bot's own model.
  const autoShown = autoPreview ?? autoRecord;
  const topRows: ModelMenuRow[] = [
    ...(!viewerLocal ? [{
      key: "auto", kind: "auto" as const, label: t("model.auto.label"), current: autoOn,
      detail: autoOn && autoShown ? autoShown.modelLabel : t("model.auto.rowHint"),
    }] : []),
    ...(follows !== undefined ? [{
      key: "follow", kind: "follow" as const, label: t("model.useBotModel", { name: profile.name }),
      detail: modelLabel(botModelInstance, profile.modelSelection.model), keywords: botModelName, current: follows,
    }] : []),
  ];

  // The menu and the window's Auto mode list every engine the bot can use:
  // its own first, then the others the server allows. An engine to install
  // or blocked by a policy stays in the window; on an organization server
  // an engine nothing pays for yet stays there too, unless it is the bot's.
  const engineLabel = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    return family && selectable.filter((candidate) => signInFamily(candidate) === family).length === 1
      ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName;
  };
  const menuInstances = [
    ...selectable.filter((instance) => instance.instanceId === selection.instanceId),
    ...selectable.filter((instance) => instance.instanceId !== selection.instanceId),
  ].filter((instance) => {
    if (instance.policy || needsCli(instance)) return false;
    if (!orgMode || instance.instanceId === selection.instanceId) return true;
    const engine = myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
    return !engine || orgEngineState(engine) === "connected";
  });
  const allSections: ModelMenuSection[] = [
    { key: "top", rows: topRows },
    ...menuInstances.map((instance) => {
      const { catalog, cloud, local } = rowsOf(instance, true);
      return { key: instance.instanceId, label: engineLabel(instance), note: catalog.signInFirst ? t("model.signInRequired") : undefined, rows: [...cloud, ...local] };
    }),
  ];

  const onRow = (row: ModelMenuRow) => {
    if (row.kind === "auto") return chooseAuto();
    if (row.kind === "follow") return pickBotModel();
    const instance = state.instances.find((candidate) => candidate.instanceId === row.instanceId);
    if (instance && row.modelId !== undefined) pick(instance, row.modelId);
  };

  const orgStatusOf = (instance: InstanceInfo) => {
    const engine = myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
    if (!engine) return { label: engineStatus(instance), attention: needsCli(instance) };
    const state = orgEngineState(engine);
    return { label: t(`model.org.state.${state}`), attention: state !== "connected" };
  };

  // The idle tooltip's whole text, and the busy tooltip's first line.
  const summary = autoOn
    ? autoRecord ? autoReasonSentence(autoRecord) : autoChipLabel(null)
    : active
    ? `${active.displayName} · ${modelLabel(active, selection.model)}${
        modelProvider(active, selection.model) ? ` · ${modelProvider(active, selection.model)}` : ""
      }${selectedVariantLabel ? ` · ${selectedVariantLabel}` : advanced && selection.effort ? ` · ${t("model.effort.summary", { level: effortLabel(selection.effort) })}` : ""}`
    : selection.model;
  const followLine = follows === true ? `\n${t("model.followsBot", { name: profile.name })}` : follows === false ? `\n${t("model.ownModel")}` : "";

  // The composer chip reads the same in Simple and Advanced, effort included.
  const composerLabel = autoOn ? autoChipLabel(autoRecord) : [
    modelLabel(active, selection.model),
    selectedVariantLabel,
    !selectedVariantLabel && selection.effort ? effortLabel(selection.effort) : "",
  ].filter(Boolean).join(" ");

  const rememberActiveAccount = () => {
    if (active && isClaudeAccount(active)) lastClaudeIdRef.current = active.instanceId;
    if (active && signInFamily(active) === "openai") lastOpenaiIdRef.current = active.instanceId;
  };

  /** The model window, on Auto when the bot is on it, else on its engine. */
  const openWindow = () => {
    if (bot.busy) return;
    rememberActiveAccount();
    const initial = selectable.find((instance) => instance.instanceId === selection.instanceId) ?? selectable[0];
    setRailId(autoOn ? AUTO_RAIL : initial?.instanceId ?? null);
    setAutoInfo(false);
    setChangedBotModel(false);
    setMenu(false);
    setOpen(true);
  };
  const toggleWindow = () => (open ? closeWindow() : openWindow());

  const toggleMenu = () => {
    if (bot.busy) return;
    if (menu) {
      setMenu(false);
      return;
    }
    rememberActiveAccount();
    setRailId(null);
    setChangedBotModel(false);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect && typeof window.innerWidth === "number") {
      const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - 8));
      setMenuAt({ right, bottom: window.innerHeight - rect.top + 6 });
    } else setMenuAt(null);
    setMenu(true);
  };

  // the desktop mascot's model chip: the app comes forward and this chip's menu opens
  const toggleRef = useRef(toggleMenu);
  toggleRef.current = toggleMenu;
  useEffect(() => {
    if (!inComposer) return;
    const onModel = (event: Event) => {
      if ((event as CustomEvent<{ botId?: string }>).detail?.botId === bot.id) toggleRef.current();
    };
    window.addEventListener(COMPOSER_MODEL_EVENT, onModel);
    return () => window.removeEventListener(COMPOSER_MODEL_EVENT, onModel);
  }, [inComposer, bot.id]);

  const trigger = windowOnly ? null : inComposer ? (
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={toggleMenu}
      aria-expanded={menu && !bot.busy}
      aria-haspopup="listbox"
      title={bot.busy ? `${composerLabel}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${composerLabel}${followLine}`}
      className={cn(
        "flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
        isUltracodeEffort(selection.effort) && "ultracode-effort-chip",
      )}
    >
      <span className="truncate">{composerLabel}</span>
      <ChevronDown size={14} className={cn("shrink-0 transition-transform", menu && "rotate-180")} />
    </button>
  ) : (
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={toggleWindow}
      aria-expanded={open && !bot.busy}
      aria-haspopup="dialog"
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-hairline/40 bg-control/60 py-1 pl-2 pr-2.5 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control/60",
        // in a narrow chat header fold to a rounded square with just the
        // provider mark; the model name rides the tooltip (a bot with no
        // resolved engine keeps its label: the mark is what would hide it).
        // Multiple Claude accounts keep their name even in the compact chip.
        !contained && active && !showActiveAccount && COMPACT_SQUARE,
      )}
      title={bot.busy ? `${summary}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${summary}${followLine}`}
    >
      {autoInstance && <InstanceProviderMark instance={autoInstance} size={14} />}
      {!contained && active && showActiveAccount && (
        <span data-model-account-compact className="hidden max-w-20 truncate @max-4xl/chathead:inline">{active.displayName}</span>
      )}
      <span className={cn("flex min-w-0 items-center gap-1", !contained && active && "@max-4xl/chathead:hidden")}>
        <span className="max-w-[160px] truncate">
          {active && showActiveAccount && !autoOn && (
            <span data-model-account className="text-ink-secondary">{active.displayName} · </span>
          )}
          {autoOn ? <span data-model-auto-chip>{autoChipLabel(autoRecord)}</span> : modelLabel(active, selection.model)}
          {!autoOn && active && modelProvider(active, selection.model) && (
            <span className="text-ink-secondary"> · {modelProvider(active, selection.model)}</span>
          )}
        </span>
        {/* outside the truncating span: a long model name must not be what
            hides the effort the header exists to surface */}
        {selectedVariantLabel !== undefined ? (
          <span data-model-variant className="max-w-[120px] truncate text-ink-secondary">· {selectedVariantLabel}</span>
        ) : advanced && selection.effort && (
          <span
            data-model-effort
            className={cn("shrink-0", isUltracodeEffort(selection.effort) ? "ultracode-effort-chip" : "text-ink-secondary")}
          >
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

  // The provider's name and the refresh icon. Whether the person is
  // connected is said once, on the access card below (Connected and
  // Disconnect), and in the provider column.
  const header = railInstance && (
    <div className="shrink-0 pb-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 id="model-picker-title" className="truncate text-[16px] font-semibold text-ink">
            {signInFamily(railInstance) ? SIGN_IN_FAMILY_LABEL[signInFamily(railInstance)!] : railInstance.displayName}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1 pr-10">
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
      {railInstance.access === "api" && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{t("model.apiKeyHint")}</div>}
      {orgMode && orgRefusesEngine(railInstance) && <OrgHostToolsNote instance={railInstance} className="mt-2" />}
    </div>
  );

  // Auto is a mode of the window like an engine: one line on what it does,
  // the rest behind the info button, then every model of every engine.
  const autoHeader = (
    <div data-model-auto className="shrink-0 pb-1">
      <h2 id="model-picker-title" className="truncate pr-10 text-[16px] font-semibold text-ink">{t("model.auto.label")}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
        <span>{t("model.auto.short")}</span>
        <button type="button" data-model-auto-info aria-expanded={autoInfo} aria-label={t("model.auto.about")} title={t("model.auto.about")}
          onClick={() => setAutoInfo((shown) => !shown)}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
          <Info size={13} aria-hidden="true" />
        </button>
      </p>
      {autoInfo && <p data-model-auto-details className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">{t("model.auto.settings.body")}</p>}
      {autoOn && autoShown && (
        <p data-model-auto-reason className="mt-1.5 text-[12px] leading-relaxed text-ink">{autoReasonSentence(autoShown)}</p>
      )}
    </div>
  );

  const payers = orgMode && org && railInstance && railEngine && !railInstance.policy && (
    <ModelPickerPayers key={railInstance.instanceId} engine={railEngine} routine={routineThread}
      issuer={org.org.identity.issuer} onChanged={reloadMyEngines} />
  );

  const payersFirst = Boolean(railEngine && !routineThread && orgEngineState(railEngine) !== "connected");

  // The browsed engine's list, always open: the bot's model first (a
  // thread), then Cloud and Local.
  const railRows = railInstance ? rowsOf(railInstance, false) : null;
  const engineSections: ModelMenuSection[] = railRows ? [
    { key: "top", rows: topRows.filter((row) => row.kind === "follow") },
    { key: "cloud", label: t("model.rail.cloud"), rows: railRows.cloud },
    { key: "local", label: t("model.localGroup"), rows: railRows.local },
  ] : [];
  const railHasModels = Boolean(railRows && (railRows.cloud.length > 0 || railRows.local.length > 0));
  const official = railRows?.catalog.official ?? [];
  const signInFirst = Boolean(railRows?.catalog.signInFirst);

  const listSection = railInstance && (
    railInstance.policy ? (
      // The organisation does not allow this engine: shown, never pickable.
      <div data-policy-blocked className="min-h-0 flex-1 overflow-y-auto pb-3 pt-1 text-[12.5px] leading-relaxed text-ink-secondary">
        <p className="font-medium text-ink">{t("policy.managedBy", { organization: railInstance.policy.organizationName })}</p>
        <p className="mt-1">{t("policy.modelBlocked", { organization: railInstance.policy.organizationName })}</p>
      </div>
    ) : needsCli(railInstance) ? (
      <div className="min-h-0 pb-3 pt-1">
        <EngineSetup instance={railInstance} intent="cloud" />
        <p className="mt-2 text-center text-[11.5px] text-ink-tertiary">
          {official.length > 1 ? t("model.afterSetupMany", { count: official.length })
            : official.length === 1 ? t("model.afterSetupOne") : t("model.localSoon")}
        </p>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        {signInFirst && (
          <div className="min-h-0 pb-1 pt-1">
            <EngineSetup instance={railInstance} intent="cloud" />
            {railInstance.claudeAccount && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
                {railInstance.claudeAccount.signInShell === "powershell" && `${t("engines.account.powershell")} `}
                {t("engines.account.signInHint")}
              </p>
            )}
            <p className="mt-2 text-center text-[11.5px] text-ink-tertiary">
              {railInstance.snapshot.chatgptPlan ? t("engineSetup.chatgpt.modelsAfterSignIn")
                : official.length > 1 ? t("model.afterSetupMany", { count: official.length })
                : official.length === 1 ? t("model.afterSetupOne") : null}
            </p>
          </div>
        )}
        {advanced && !signInFirst && railInstance.snapshot.update && (
          <EngineUpdateNotice update={railInstance.snapshot.update} instance={railInstance} />
        )}
        {(railHasModels || follows !== undefined) && (
          <ModelSearchList key={railInstance.instanceId} variant="window" sections={engineSections} onPick={onRow} disabled={Boolean(bot.busy)} />
        )}
        {!railHasModels && !signInFirst && (
          <p className="py-2 text-[12.5px] text-ink-secondary">{orgMode ? t("model.org.noModels") : t("model.simple.noModels")}</p>
        )}
      </div>
    )
  );

  // Effort applies to the model this bot runs on now (its active engine,
  // not the provider being browsed), under the same one mode. `contained`
  // callers (the settings dialog) render their own EffortRow card, and two
  // copies of one control in one view read as a bug.
  const effortTitle = active?.capabilities?.modelVariants ? t("model.reasoning") : t("model.effort");
  const effort = advanced && !contained && (
    <EffortRow
      bot={bot}
      threadId={threadId}
      updateBotDefault={Boolean(threadId)}
      className="shrink-0"
      label={<span className="text-[12.5px] font-medium text-ink">{effortTitle}</span>}
    />
  );

  const footer = !advanced ? null : (
    <div className="flex shrink-0 border-t border-hairline/40">
      <button type="button" data-model-engines-link onClick={() => {
        closeWindow();
        dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
      }} className="flex-1 px-4 py-2.5 text-left text-[12px] text-ink-secondary hover:bg-control/60 hover:text-ink">
        {t("settings.engines.title")}
      </button>
      {/* A remote client's settings hide the keys section, so the
          shortcut would land somewhere else. */}
      {window.ogb?.remoteClient?.active !== true && (
        <button type="button" data-model-add-api-keys onClick={openApiKeys} className="flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[12px] text-ink-secondary hover:bg-control/60 hover:text-ink">
          <KeyRound size={12} aria-hidden="true" />
          {apiKeysLabel(pickerInstances)}
        </button>
      )}
    </div>
  );

  const railProps = {
    instances: pickerInstances, selectedInstance: autoPane ? undefined : railInstance, claudeInstance: claudeRailInstance,
    openaiInstance: openaiRailInstance, onSelect: selectRail,
    onAddApiKeys: advanced && window.ogb?.remoteClient?.active !== true ? openApiKeys : undefined,
    ...(orgMode && myEngines ? { statusOf: orgStatusOf } : {}),
    ...(orgMode ? { notAllowed } : {}),
    ...(!viewerLocal ? { auto: { on: autoOn, selected: autoPane, onSelect: () => setRailId(AUTO_RAIL) } } : {}),
    showUnready,
  };

  const modalPanel = (
    <div
      data-model-picker-backdrop
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && closeWindow()}
    >
      <div
        ref={dialogRef}
        data-model-picker-content
        data-model-pane={autoPane ? AUTO_RAIL : railInstance?.instanceId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={autoPane || railInstance ? "model-picker-title" : undefined}
        aria-label={autoPane || railInstance ? undefined : t("model.choose")}
        tabIndex={-1}
        {...motion.exitProps}
        className={cn(
          "relative flex w-full flex-col overflow-hidden border border-border bg-app outline-none sm:flex-row",
          "h-[min(88dvh,720px)] rounded-t-2xl sm:h-[min(640px,calc(100dvh-96px))] sm:w-[min(880px,calc(100vw-48px))] sm:rounded-[14px]",
          motion.className,
        )}
      >
        <button type="button" onClick={closeWindow} aria-label={t("model.close")}
          className="absolute right-2.5 top-2.5 z-20 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary">
          <X size={18} aria-hidden="true" />
        </button>
        {pickerInstances.length > 0 && <ModelEngineRail {...railProps} wide />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
            {autoPane ? (
              <>
                {autoHeader}
                <ModelSearchList key={AUTO_RAIL} variant="window" sections={allSections} onPick={onRow} disabled={Boolean(bot.busy)} />
                {effort}
              </>
            ) : railInstance ? (
              <>
                {header}
                {/* Nothing pays yet: how to fix that comes first. Otherwise
                    the choice does, and who pays follows. */}
                {payersFirst && payers}
                {listSection}
                {effort}
                {!payersFirst && payers}
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

  // The composer's menu (2026-10-12, JC: like Cursor's): search, Auto, every
  // engine's models, the effort, and Edit… for the whole window.
  const menuPanel = (
    <div
      ref={menuRef}
      data-model-menu
      role="dialog"
      aria-label={t("model.menu")}
      style={menuAt ? { right: menuAt.right, bottom: menuAt.bottom, width: MENU_WIDTH } : { width: MENU_WIDTH }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        closeMenu(true);
      }}
      {...menuMotion.exitProps}
      className={cn(
        "z-50 flex max-h-[min(560px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50",
        menuAt ? "fixed" : "absolute bottom-full right-0 mb-1.5",
        menuMotion.className,
      )}
    >
      <ModelSearchList variant="popover" autoFocus sections={allSections} onPick={onRow} onEscape={() => closeMenu(true)} disabled={Boolean(bot.busy)} />
      {advanced && (active?.capabilities?.effortLevels?.length || active?.capabilities?.modelVariants) ? (
        <div data-model-menu-effort className="border-t border-popover-hairline px-3.5 py-2">
          <EffortRow bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId)} compact
            label={<span className="shrink-0 text-[12.5px] text-popover-ink-secondary">{effortTitle}</span>} />
        </div>
      ) : null}
      <div className="border-t border-popover-hairline px-1.5 pt-1">
        <ModelMenuItem variant="popover" data-model-edit onClick={openWindow}>
          <span>{t("model.edit")}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
        </ModelMenuItem>
      </div>
    </div>
  );

  // Portalled like Settings: a translated sidebar or composer would
  // otherwise become the containing block. Without a document (static
  // rendering in tests) they render in place.
  const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));
  return (
    <div ref={rootRef} className={cn(contained ? "w-full" : "relative", className)}>
      {contained ? (
        <div className="flex w-full flex-col gap-3">
          {label}
          <div className="self-start">{trigger}</div>
        </div>
      ) : (
        trigger
      )}

      {menuMotion.shown && portal(menuPanel)}
      {motion.shown && portal(modalPanel)}
      {!contained && !windowOnly && changedBotModel && !anyOpen && ownModelThreads > 0 && (
        <div data-thread-models-notice role="status"
          className="absolute right-0 top-full z-30 mt-2 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-hairline/50 bg-card py-2 pl-3 pr-2 shadow-xl shadow-black/30">
          <ThreadModelsLine bot={profile} />
          <button type="button" aria-label={t("common.close")} onClick={() => setChangedBotModel(false)}
            className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control/60 hover:text-ink">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
