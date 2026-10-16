import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, FilePen, Hand, ListChecks, Settings, ShieldCheck, TriangleAlert } from "lucide-react";
import { reportAchievement } from "@/lib/achievements";

import { approvalModeFor, hasNativeAutoReview, supportsApprovalMode, type ApprovalMode } from "../../shared/approval-mode";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { focusFirstMenuItem, moveMenuFocus } from "@/lib/menu-keys";
import type { LocaleKey } from "@/locales";
import type { OrgFullAccess } from "@/lib/full-access";

/** Keys, not labels — these are the words the held notes quote back to the
 * reader ("… so Approve for me stopped to ask"), and a label resolved in this
 * module-scope array would freeze the language the app booted in. */
const APPROVAL_MODE_KEYS: ReadonlyArray<{
  mode: ApprovalMode;
  labelKey: LocaleKey;
  chipKey: LocaleKey;
  descriptionKey: LocaleKey;
  Icon: typeof Hand;
}> = [
  { mode: "ask", labelKey: "approvalMode.ask.label", chipKey: "approvalMode.ask.chip", descriptionKey: "approvalMode.ask.desc", Icon: Hand },
  { mode: "edits", labelKey: "approvalMode.edits.label", chipKey: "approvalMode.edits.chip", descriptionKey: "approvalMode.edits.desc", Icon: FilePen },
  { mode: "auto", labelKey: "approvalMode.auto.label", chipKey: "approvalMode.auto.chip", descriptionKey: "approvalMode.auto.desc", Icon: ShieldCheck },
  // A warning sign, unlike the shields of the other levels: Full asks nothing.
  { mode: "full", labelKey: "approvalMode.full.label", chipKey: "approvalMode.full.chip", descriptionKey: "approvalMode.full.desc", Icon: TriangleAlert },
  { mode: "custom", labelKey: "approvalMode.custom.label", chipKey: "approvalMode.custom.chip", descriptionKey: "approvalMode.custom.desc", Icon: Settings },
];

export interface ApprovalModeOption {
  mode: ApprovalMode;
  label: string;
  chip: string;
  description: string;
  Icon: typeof Hand;
}

/** The levels, in the reader's language. A function rather than a
 * constant: it has to answer to the language in effect when it is called. */
export function approvalModeOptions(): ApprovalModeOption[] {
  return APPROVAL_MODE_KEYS.map(({ mode, labelKey, chipKey, descriptionKey, Icon }) => ({
    mode,
    label: t(labelKey),
    chip: t(chipKey),
    description: t(descriptionKey),
    Icon,
  }));
}

export function approvalModeOptionsFor(driverKind: string, trustedModesAvailable = true, orgFullAccess?: OrgFullAccess) {
  return approvalModeOptions()
    .filter((option) => supportsApprovalMode(driverKind, option.mode)
      // Antigravity has no native reviewer. Offer its explicit full-access
      // grant as Auto instead of a second choice that actually behaves as Ask.
      && (driverKind !== "antigravityAgent" || option.mode !== "auto")
      && (trustedModesAvailable || option.mode === "ask" || option.mode === "edits" || option.mode === "auto" ||
        // Organization server: the bot's owner sees Full (greyed when the
        // organization turned it off); Custom stays desktop only.
        (option.mode === "full" && orgFullAccess !== undefined && orgFullAccess !== "hidden")))
    .map((option) => {
      if (driverKind === "antigravityAgent" && option.mode === "full") {
        return {
          ...option,
          label: t("approvalMode.antigravity.label"),
          chip: t("approvalMode.auto.chip"),
          description: t("approvalMode.antigravity.desc"),
        };
      }
      return option.mode === "auto" && !hasNativeAutoReview(driverKind)
        ? { ...option, description: t("approvalMode.noNativeReview") }
        : option;
    });
}

export function approvalModeSelectionRequiresLocalDesktop(
  currentMode: ApprovalMode,
  trustedModesAvailable: boolean,
) {
  // A persisted bot can temporarily lose its provider instance. Custom still
  // cannot leave through HTTP in that state, so the lock follows the durable
  // mode rather than today's provider lookup.
  return currentMode === "custom" && !trustedModesAvailable;
}

/** How much this bot may do on its own. In the composer it is an icon
 * beside the message field that opens a menu: the five levels in Advanced,
 * the same two choices as the bot settings ("Ask me first", "Decide for
 * me") in Simple (JC, 2026-10-14). `wide` is the bot settings control: the
 * full menu in Advanced, the two stacked choices in Simple. */
export function ApprovalModeSelector({
  approvalMode,
  autoApprove,
  providerName,
  driverKind,
  onSelect,
  align = "left",
  menuDirection = "up",
  wide = false,
  disabled = false,
  trustedModesAvailable = true,
  orgFullAccess,
  onManageCommandAllowlist,
  variant = "icon",
  onDone,
}: {
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  providerName: string;
  driverKind: string;
  onSelect: (mode: ApprovalMode) => void;
  align?: "left" | "right";
  menuDirection?: "up" | "down";
  wide?: boolean;
  disabled?: boolean;
  trustedModesAvailable?: boolean;
  trustedModesNotice?: string;
  /** Organization server only (src/lib/full-access.ts). */
  orgFullAccess?: OrgFullAccess;
  onManageCommandAllowlist?: () => void;
  /** "row": a row of the composer's + menu (its levels open beside it). */
  variant?: "icon" | "row";
  /** Called once a choice is made, so the + menu around the row closes too. */
  onDone?: () => void;
}) {
  const row = variant === "row" && !wide;
  const advanced = useAdvancedMode();
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const savedMode = approvalModeFor({ approvalMode, autoApprove });
  // Old Antigravity Auto settings still ask. Do not display or silently grant
  // the new Auto/full-access behavior until the user explicitly selects it.
  const mode = driverKind === "antigravityAgent" && savedMode === "auto" ? "ask" : savedMode;
  const allOptions = approvalModeOptions();
  const current = approvalModeOptionsFor(driverKind).find((option) => option.mode === mode)
    ?? allOptions.find((option) => option.mode === mode)
    ?? allOptions[0];
  const visibleOptions = approvalModeOptionsFor(driverKind, trustedModesAvailable, orgFullAccess);
  // Full access granted, then brought back to Ask (an achievement on using it responsibly)
  const previousMode = useRef(savedMode);
  useEffect(() => {
    const before = previousMode.current;
    previousMode.current = savedMode;
    if (before === savedMode) return;
    if (savedMode === "full") reportAchievement("fullaccess.granted");
    else if (before === "full" && savedMode === "ask") reportAchievement("fullaccess.revoked");
  }, [savedMode]);
  const requiresLocalDesktop = approvalModeSelectionRequiresLocalDesktop(
    mode,
    trustedModesAvailable,
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // a row of the + menu: Escape steps back to the row, not out of the menu
      if (variant === "row") triggerRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, variant]);

  // a menu opened from the + menu takes the keyboard at its first level
  useEffect(() => {
    if (!open || variant !== "row") return;
    const frame = requestAnimationFrame(() => focusFirstMenuItem(menuRef.current));
    return () => cancelAnimationFrame(frame);
  }, [open, variant]);

  const CurrentIcon = current.Icon;
  // The allowlist is Advanced only: in Simple a busy bot greys the icon.
  const triggerDisabled = disabled && !(advanced && onManageCommandAllowlist);
  const modesDisabled = disabled || requiresLocalDesktop;
  const allowlistAction = onManageCommandAllowlist && (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        triggerRef.current?.focus();
        onManageCommandAllowlist();
        onDone?.();
      }}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
    >
      <ListChecks size={16} className="shrink-0" />
      {t("commandAllowlist.title")}
    </button>
  );
  // Simple offers two choices, in the bot settings and in the composer, and
  // leaves any other saved level untouched until the person picks one of
  // them. Decide is absent when this engine has no auto mode (hiding, not a
  // disabled row). The five levels and the command allowlist stay in
  // Advanced.
  const canDecide = visibleOptions.some((option) => option.mode === "auto");
  const known = mode === "ask" || (mode === "auto" && canDecide);
  const choices = [
    { mode: "ask" as const, label: t("approvalMode.simple.ask"), hint: t("approvalMode.simple.askHint") },
    ...(canDecide ? [{ mode: "auto" as const, label: t("approvalMode.simple.decide"), hint: t("approvalMode.simple.decideHint") }] : []),
  ];
  if (!advanced && wide) {
    const choiceClass = cn(
      "flex min-w-0 flex-1 flex-col rounded-lg border px-2.5 py-1.5 text-left",
      "border-hairline/40 bg-inset hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45",
    );
    return (
      <div data-approval-simple className="flex w-full min-w-0 flex-col gap-1">
        <div className="flex w-full min-w-0 flex-col gap-1">
          {choices.map((choice) => (
            <button
              key={choice.mode}
              type="button"
              data-approval-choice={choice.mode}
              aria-pressed={known && mode === choice.mode}
              disabled={disabled}
              onClick={() => { if (!disabled) onSelect(choice.mode); }}
              className={cn(choiceClass, known && mode === choice.mode && "border-accent/40 bg-accent/10")}
            >
              <span className="text-[13px] leading-[18px] text-ink">{choice.label}</span>
              <span className="text-[11.5px] leading-4 text-ink-tertiary">{choice.hint}</span>
            </button>
          ))}
        </div>
        {!known && <p data-approval-custom className="text-[12px] leading-4 text-ink-secondary">{t("approvalMode.simple.custom")}</p>}
      </div>
    );
  }
  return (
    <div className={cn("relative flex items-center", (wide || row) && "w-full")} ref={wrapperRef}>
      {row ? (
        <button
          ref={triggerRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("approvalMode.triggerAria", { mode: current.label, provider: providerName })}
          disabled={triggerDisabled}
          title={disabled ? t("approvalMode.busy") : undefined}
          data-composer-plus-row="approval"
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); setOpen(true); }
            if (event.key === "ArrowLeft" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          }}
          className={cn(
            "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none aria-expanded:bg-hover",
            triggerDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
          )}
        >
          <CurrentIcon size={16} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("composer.plus.approval")}</span>
          <span className="max-w-[110px] shrink-0 truncate text-ink-tertiary">{current.chip}</span>
          <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        </button>
      ) : (
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("approvalMode.triggerAria", { mode: current.label, provider: providerName })}
        disabled={triggerDisabled}
        title={disabled ? t("approvalMode.busy") : wide ? undefined : current.chip}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          wide
            ? "flex h-10 w-full items-center justify-between rounded-lg border border-hairline/40 bg-inset px-3.5 text-[13px] text-ink hover:bg-raised"
            : "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink",
          triggerDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink-secondary",
        )}
      >
        {wide ? (
          <span className="flex min-w-0 items-center gap-2">
            <CurrentIcon size={14} className="shrink-0 opacity-70" />
            <span className="truncate">{current.label}</span>
          </span>
        ) : (
          <CurrentIcon size={16} className="shrink-0 opacity-80" />
        )}
        {wide && <span aria-hidden className="text-[11px] text-ink-secondary">⌄</span>}
      </button>
      )}

      {motion.shown && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("approvalMode.menuAria", { provider: providerName })}
          onKeyDown={(event) => {
            if (moveMenuFocus(event.currentTarget, event.key, document.activeElement)) { event.preventDefault(); event.stopPropagation(); return; }
            if (row && event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
          }}
          {...motion.exitProps}
          className={cn(
            // Same surface and scale as the right-click menus: no heading,
            // 13px rows, and nothing listed that cannot be picked here.
            "absolute z-40 flex w-[260px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
            row ? "bottom-0 left-full ml-2" : menuDirection === "up" ? "bottom-full mb-2" : "top-full mt-2",
            !row && (align === "right" ? "right-0" : "left-0"),
            wide && "w-full min-w-[260px]",
            motion.className,
          )}
        >
          {!advanced && (
            <>
              {choices.map((choice) => {
                const selected = known && mode === choice.mode;
                const Icon = choice.mode === "ask" ? Hand : ShieldCheck;
                return (
                  <button
                    key={choice.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={modesDisabled}
                    data-approval-choice={choice.mode}
                    title={disabled ? t("approvalMode.busy") : requiresLocalDesktop ? t("approvalMode.customLocalOnly") : undefined}
                    onClick={() => {
                      if (modesDisabled) return;
                      onSelect(choice.mode);
                      setOpen(false);
                      onDone?.();
                    }}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
                      modesDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
                    )}
                  >
                    <Icon size={16} className="mt-px shrink-0 text-ink" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center justify-between gap-3 text-[13px] leading-[18px] text-ink">
                        {choice.label}
                        {selected && <Check size={14} className="shrink-0" />}
                      </span>
                      <span className="text-[12px] leading-4 text-ink-tertiary">{choice.hint}</span>
                    </span>
                  </button>
                );
              })}
              {!known && <p data-approval-custom className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">{t("approvalMode.simple.custom")}</p>}
            </>
          )}
          {advanced && visibleOptions.map((option) => {
            const selected = option.mode === mode;
            const Icon = option.Icon;
            // The organization turned Full off: shown, greyed, with why.
            const orgOff = option.mode === "full" && orgFullAccess === "disabled";
            const optionDisabled = modesDisabled || orgOff;
            return (
              <Fragment key={option.mode}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={optionDisabled}
                  data-approval-mode={option.mode}
                  title={
                    disabled ? t("approvalMode.busy") : requiresLocalDesktop ? t("approvalMode.customLocalOnly") : orgOff ? t("approvalMode.full.orgDisabled") : undefined
                  }
                  onClick={() => {
                    if (optionDisabled) return;
                    onSelect(option.mode);
                    setOpen(false);
                    onDone?.();
                  }}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
                    optionDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
                  )}
                >
                  <Icon size={16} className="mt-px shrink-0 text-ink" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center justify-between gap-3 text-[13px] leading-[18px] text-ink">
                      {option.label}
                      {selected && <Check size={14} className="shrink-0" />}
                    </span>
                    <span className="text-[12px] leading-4 text-ink-tertiary">
                      {option.description}
                    </span>
                    {orgOff && (
                      <span className="mt-0.5 text-[12px] leading-4 text-warning" data-full-access-org-off>
                        {t("approvalMode.full.orgDisabled")}
                      </span>
                    )}
                  </span>
                </button>
                {option.mode === "full" && allowlistAction}
              </Fragment>
            );
          })}
          {advanced && !visibleOptions.some((option) => option.mode === "full") && allowlistAction}
        </div>
      )}
    </div>
  );
}
