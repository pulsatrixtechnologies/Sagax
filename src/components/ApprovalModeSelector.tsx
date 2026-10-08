import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FilePen, Hand, ListChecks, Settings, ShieldCheck, TriangleAlert } from "lucide-react";
import { reportAchievement } from "@/lib/achievements";

import { approvalModeFor, hasNativeAutoReview, isApprovalMode, supportsApprovalMode, type ApprovalMode } from "../../shared/approval-mode";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
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

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')) : [];
}

/** Arrow, Home and End movement inside a menu of `count` rows, wrapping at
 * both ends. `null` for any other key. */
export function nextMenuIndex(at: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % count;
  if (key === "ArrowUp") return at < 0 ? count - 1 : (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
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

/** How much this bot may do on its own. Advanced is an icon beside the
 * message field that opens the full menu. Simple is a chip beside the model
 * chip ("Ask me first", "Decide for me") whose menu holds the two choices,
 * so the message field stays a normal chat bar. `wide` stacks the same two
 * choices on bot settings. */
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
}) {
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
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  // The Simple chip's menu takes focus on open (the checked row, else the
  // first) so Enter, the arrows and Escape work without the mouse.
  useEffect(() => {
    if (!open || advanced) return;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, [open, advanced]);

  const handleMenuKey = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = menuItems(menuRef.current);
    const at = items.findIndex((item) => item === document.activeElement);
    const next = nextMenuIndex(at, items.length, event.key);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const CurrentIcon = current.Icon;
  const triggerDisabled = disabled && !onManageCommandAllowlist;
  const modesDisabled = disabled || requiresLocalDesktop;
  const allowlistAction = onManageCommandAllowlist && (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        triggerRef.current?.focus();
        onManageCommandAllowlist();
      }}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
    >
      <ListChecks size={16} className="shrink-0" />
      {t("commandAllowlist.title")}
    </button>
  );
  // Simple offers two choices and leaves any other saved level untouched
  // until the person picks one of them. Decide is absent when this engine
  // has no auto mode (hiding, not a disabled row). In the composer they sit
  // behind a chip beside the model chip; bot settings (`wide`) stacks them.
  if (!advanced) {
    const canDecide = visibleOptions.some((option) => option.mode === "auto");
    const known = mode === "ask" || (mode === "auto" && canDecide);
    const choices = [
      { mode: "ask" as const, label: t("approvalMode.simple.ask"), hint: t("approvalMode.simple.askHint") },
      ...(canDecide ? [{ mode: "auto" as const, label: t("approvalMode.simple.decide"), hint: t("approvalMode.simple.decideHint") }] : []),
    ];
    if (!wide) {
      const currentChoice = known ? choices.find((choice) => choice.mode === mode) : undefined;
      const chipLabel = currentChoice?.label ?? t("approvalMode.simple.customChip");
      // No level saved yet: the chip reads the default, with a dot.
      const unset = !isApprovalMode(approvalMode) && autoApprove === undefined;
      return (
        <div data-approval-simple className="relative flex min-w-0 items-center" ref={wrapperRef}>
          <button
            ref={triggerRef}
            type="button"
            data-approval-chip
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
            aria-label={t("approvalMode.triggerAria", { mode: chipLabel, provider: providerName })}
            disabled={disabled}
            title={disabled ? t("approvalMode.busy") : unset ? t("approvalMode.simple.unset") : currentChoice?.hint ?? t("approvalMode.simple.custom")}
            onClick={() => setOpen((value) => !value)}
            className="flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {unset && <span aria-hidden data-approval-unset className="size-1.5 shrink-0 rounded-full bg-accent" />}
            <span className="truncate">{chipLabel}</span>
            <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
          </button>
          {motion.shown && !disabled && (
            <div
              ref={menuRef}
              role="menu"
              aria-label={t("approvalMode.menuAria", { provider: providerName })}
              onKeyDown={(event) => handleMenuKey(event)}
              {...motion.exitProps}
              className={cn(
                "absolute z-40 flex w-[260px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1.5",
                menuDirection === "up" ? "bottom-full mb-2" : "top-full mt-2",
                align === "right" ? "right-0" : "left-0",
                motion.className,
              )}
            >
              {choices.map((choice) => {
                const selected = known && choice.mode === mode;
                return (
                  <button
                    key={choice.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-approval-choice={choice.mode}
                    onClick={() => {
                      onSelect(choice.mode);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus:bg-hover focus:outline-none"
                  >
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
              {!known && <p data-approval-custom className="px-2 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">{t("approvalMode.simple.custom")}</p>}
            </div>
          )}
        </div>
      );
    }
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
    <div className={cn("relative flex items-center", wide && "w-full")} ref={wrapperRef}>
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

      {motion.shown && (
        <div
          role="menu"
          aria-label={t("approvalMode.menuAria", { provider: providerName })}
          {...motion.exitProps}
          className={cn(
            // Same surface and scale as the right-click menus: no heading,
            // 13px rows, and nothing listed that cannot be picked here.
            "absolute z-40 flex w-[260px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1.5",
            menuDirection === "up" ? "bottom-full mb-2" : "top-full mt-2",
            align === "right" ? "right-0" : "left-0",
            wide && "w-full min-w-[260px]",
            motion.className,
          )}
        >
          {visibleOptions.map((option) => {
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
          {!visibleOptions.some((option) => option.mode === "full") && allowlistAction}
        </div>
      )}
    </div>
  );
}
