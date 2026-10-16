// Settings > Models and voice: every key in one list, model keys, voice
// keys and image keys alike, one row per provider (name, state in words, one
// action) and a small dialog to add, replace, test or remove a key. Since
// 2026-10-15 this list is the only place a key is managed on the page: the
// Voice section and Image generation only say whether the key of the chosen
// provider is saved and lead here (revealKeyRow), Grok voice and Grok images
// use the xAI row. The dialog holds the same ApiKeyRow that Settings > API
// keys used to show as a column of open fields (2026-10-12), so a key is
// saved, tested and resolved exactly as before (PUT /api/config, POST
// /api/keys/test). Keys stay write-only: a row says whether one is saved,
// never its value.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, ExternalLink, KeyRound, X } from "lucide-react";

import { useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  AnthropicEveryClaudeBot,
  ApiKeyRow,
  OpenAiCompatUrl,
  OpenCodeProviderKeys,
  credentialCopy,
  type ConfigSection,
  type TestableProvider,
} from "../ApiKeys";
import { FoldRow, HelpTip, PILL, requestSettingsCard } from "../SettingsPrimitives";

export type KeyRowId = "openai" | "anthropic" | "xai" | "elevenlabs" | "fishAudio" | "openaiImage" | "customImage" | "openrouter" | "mistral" | "openaiCompat" | "opencodeGo";

/** Which key a row holds, its name and whether a key is saved. `included`:
 * works with no saved key (Cloud Pro). */
const ROWS: Record<KeyRowId, { section: ConfigSection; nameKey: LocaleKey; test?: TestableProvider; saved: (config: ConfigStatus) => boolean; included?: (config: ConfigStatus) => boolean }> = {
  anthropic: { section: "anthropic", nameKey: "providerKeys.anthropic", test: "anthropic", saved: (c) => c.anthropic?.configured ?? false },
  openai: { section: "openai", nameKey: "providerKeys.openai", test: "openai", saved: (c) => c.openai?.configured ?? false },
  xai: { section: "xai", nameKey: "providerKeys.xai", test: "xai", saved: (c) => c.xai?.configured ?? false },
  elevenlabs: { section: "elevenlabs", nameKey: "providerKeys.elevenlabs", saved: (c) => c.tts?.keys?.elevenlabs ?? false, included: (c) => c.tts?.included === true },
  fishAudio: { section: "fishAudio", nameKey: "providerKeys.fishAudio", saved: (c) => c.tts?.keys?.fish ?? false },
  openaiImage: { section: "openaiImage", nameKey: "providerKeys.openaiImage", saved: (c) => c.imageGen?.openaiConfigured === true },
  customImage: { section: "customImage", nameKey: "providerKeys.customImage", saved: (c) => c.imageGen?.customKeyConfigured === true },
  openrouter: { section: "openrouter", nameKey: "providerKeys.openrouter", test: "openrouter", saved: (c) => c.openrouter?.configured ?? false },
  mistral: { section: "mistral", nameKey: "providerKeys.mistral", test: "mistral", saved: (c) => c.mistral?.configured ?? false },
  openaiCompat: { section: "openaiCompat", nameKey: "providerKeys.openaiCompat", test: "openaiCompat", saved: (c) => c.openaiCompat?.configured ?? false },
  opencodeGo: { section: "opencodeGo", nameKey: "providerKeys.opencode", saved: (c) => (c.opencodeGo?.configured ?? false) || (c.opencodeGo?.providerKeys?.length ?? 0) > 0 },
};
/** The keys most people need: the big model providers. Grok voice and Grok
 * images use the xAI key of this list. */
export const MAIN_KEY_ROWS = ["anthropic", "openai", "xai"] as const satisfies readonly KeyRowId[];
/** Rarer keys, under "More providers" until one is saved: a saved key is
 * always in the main list, never hidden. The voice keys (ElevenLabs, Fish
 * Audio) and the image keys are here too since 2026-10-15: one place for
 * every key, the Voice section and Image generation only lead to their row. */
export const MORE_KEY_ROWS = ["openrouter", "mistral", "openaiCompat", "opencodeGo", "elevenlabs", "fishAudio", "openaiImage", "customImage"] as const satisfies readonly KeyRowId[];

export function keyRowSaved(id: KeyRowId, config: ConfigStatus | null | undefined): boolean {
  return config ? ROWS[id].saved(config) : false;
}

/** The rows of the main list and of "More providers" for this config. */
export function keyRowName(id: KeyRowId): string {
  return t(ROWS[id].nameKey);
}

/** A rare key that works already (saved, or included with Cloud Pro) sits in
 * the main list. */
function inMainList(id: KeyRowId, config: ConfigStatus | null | undefined): boolean {
  return config ? ROWS[id].saved(config) || ROWS[id].included?.(config) === true : false;
}

/** The rows of the main list and of "More providers" for this config. */
export function splitKeyRows(config: ConfigStatus | null | undefined): { main: KeyRowId[]; more: KeyRowId[] } {
  return {
    main: [...MAIN_KEY_ROWS, ...MORE_KEY_ROWS.filter((id) => inMainList(id, config))],
    more: MORE_KEY_ROWS.filter((id) => !inMainList(id, config)),
  };
}

// The open dialog, in a module store so another page (an engine card's
// "Add the key", an old link to API keys) can open it before this page mounts.
let openRow: KeyRowId | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export function openProviderKeyDialog(row: KeyRowId | null): void {
  openRow = row;
  emit();
}
function useOpenRow(): KeyRowId | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => openRow, () => openRow);
}

// The row another section asked to see ("Add in Keys"): highlighted for a
// moment, so the eye lands on it after the scroll.
let highlightRow: KeyRowId | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;
const HIGHLIGHT_MS = 2400;
function useHighlightRow(): KeyRowId | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => highlightRow, () => highlightRow);
}

/** Shows a row of the Keys list: opens "More providers" when the row is
 * folded there, scrolls the row into view, highlights it and moves the focus
 * to its button. No form opens: the person adds the key from the row, the
 * one place keys are managed. */
export function revealKeyRow(row: KeyRowId, config: ConfigStatus | null | undefined): void {
  if (!inMainList(row, config) && (MORE_KEY_ROWS as readonly KeyRowId[]).includes(row)) requestSettingsCard("engines.moreProviders");
  highlightRow = row;
  emit();
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => { highlightRow = null; highlightTimer = null; emit(); }, HIGHLIGHT_MS);
  let frames = 0;
  const reveal = () => {
    try {
      const item = document.querySelector<HTMLElement>(`[data-provider-key="${row}"]`);
      // the card opens on the next render: wait until the row is laid out
      if (item && item.getClientRects().length > 0) {
        item.scrollIntoView?.({ block: "center", behavior: "smooth" });
        item.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      } else if (++frames < 30) requestAnimationFrame(reveal);
    } catch {
      /* no document outside the renderer */
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
}

/** The key line of a section that uses a key of the list (Voice, Image
 * generation): whether the chosen provider's key is saved, in a few words,
 * and when it is missing a link to its row in Keys, never a key field.
 * `link` is false where the Keys list is not on the page (a remote window):
 * the line then only says what is missing. */
export function KeyInKeys({ row, saved, included = false, optional = false, missing, link = true }: {
  row: KeyRowId;
  saved: boolean;
  /** Works with no saved key (ElevenLabs with Cloud Pro). */
  included?: boolean;
  /** The provider also works without a key (a keyless custom server). */
  optional?: boolean;
  /** The words when no key is saved; default "{name} key missing". */
  missing?: string;
  link?: boolean;
}) {
  const { state } = useStore();
  const name = keyRowName(row);
  const ready = saved || included;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-key-in-keys={row} data-key-in-keys-saved={ready ? "true" : "false"}>
      <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-accent" : optional ? "bg-raised-hover" : "bg-warning")} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[12.5px] text-ink-secondary">
        {saved ? t("modelsVoice.key.uses", { name })
          : included ? t("keys.includedWithCloudPro")
          : missing ?? t("modelsVoice.key.missing", { name })}
      </span>
      {!ready && link && (
        <button
          type="button"
          data-add-in-keys={row}
          onClick={() => revealKeyRow(row, state.config)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md text-[12.5px] font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {t("modelsVoice.key.addInKeys")}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The key a key engine runs on, for an engine card's "Add the key". */
export function keyRowForEngine(driverKind: string, instanceId: string): KeyRowId | null {
  if (driverKind === "claudeAgent") return "anthropic";
  if (driverKind === "mistral" || instanceId.includes("mistral")) return "mistral";
  if (driverKind === "grok" || driverKind === "grokAgent" || instanceId.includes("xai")) return "xai";
  if (instanceId.includes("openrouter")) return "openrouter";
  if (driverKind === "opencodeGo") return "opencodeGo";
  if (instanceId.includes("openai-compat") || instanceId.includes("compat")) return "openaiCompat";
  if (driverKind === "codex" || instanceId.includes("openai")) return "openai";
  return null;
}

/** One row per key, as Grok Bot's settings rows: the provider and its state
 * in a grey line at the left, one pill at the right. Rows of the Keys group
 * card (no frame of their own). */
export function ProviderKeyRows({ rows }: { rows: readonly KeyRowId[] }) {
  const { state } = useStore();
  const highlighted = useHighlightRow();
  return (
    <ul className="flex flex-col" data-provider-keys="">
      {rows.map((id) => {
        const row = ROWS[id];
        const saved = state.config ? row.saved(state.config) : false;
        const included = !saved && state.config ? row.included?.(state.config) === true : false;
        return (
          <li
            key={id}
            data-provider-key={id}
            data-key-saved={saved ? "true" : "false"}
            data-key-highlight={highlighted === id ? "true" : undefined}
            className={cn("mx-1.5 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors motion-reduce:transition-none", highlighted === id && "bg-accent/10")}
          >
            <KeyRound size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-[18px] text-ink">{t(row.nameKey)}</span>
              <span className={cn("block text-[12px] leading-4", saved || included ? "text-accent-text" : "text-ink-secondary")}>
                {saved ? t("providerKeys.saved") : included ? t("keys.includedWithCloudPro") : t("providerKeys.none")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => openProviderKeyDialog(id)}
              aria-label={`${saved ? t("providerKeys.manage") : t("providerKeys.add")} · ${t(row.nameKey)}`}
              className={cn(PILL, "shrink-0")}
            >
              {saved ? t("providerKeys.manage") : t("providerKeys.add")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The one list of keys: the main rows (with any rare key already saved),
 * then "More providers", folded with its count, with the rare ones not
 * saved yet and `moreExtra` (the cloud coding agents' keys, `moreExtraCount`
 * of them). */
export function KeyList({ moreExtra, moreExtraCount = 0 }: { moreExtra?: ReactNode; moreExtraCount?: number }) {
  const { state } = useStore();
  const { main, more } = splitKeyRows(state.config);
  return (
    <>
      <ProviderKeyRows rows={main} />
      {(more.length > 0 || moreExtra) && (
        <FoldRow cardId="engines.moreProviders" label={t("modelsVoice.keys.more")} count={more.length + moreExtraCount}>
          <div className="-mx-3.5 flex flex-col" data-more-providers="">
            {more.length > 0 && <ProviderKeyRows rows={more} />}
            {moreExtra}
          </div>
        </FoldRow>
      )}
    </>
  );
}

/** Mounted once on the page: the dialog of the row being edited. */
export function ProviderKeyDialog() {
  const open = useOpenRow();
  useEffect(() => () => openProviderKeyDialog(null), []);
  if (!open) return null;
  return <KeyDialog id={open} onClose={() => openProviderKeyDialog(null)} />;
}

function KeyDialog({ id, onClose }: { id: KeyRowId; onClose: () => void }) {
  const row = ROWS[id];
  const copy = credentialCopy(row.section);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  let extra: ReactNode = null;
  if (id === "anthropic") extra = <AnthropicEveryClaudeBot />;
  if (id === "openaiCompat") extra = <OpenAiCompatUrl />;
  if (id === "opencodeGo") {
    extra = (
      <>
        <div className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <span>{t("providerKeys.opencodeMore")}</span>
          <HelpTip label={t("providerKeys.opencodeMore")}>
            {t("keys.opencode.providersHint").split("{command}").flatMap((part, index) =>
              index === 0 ? [part] : [<code key={index} className="font-mono">opencode auth login</code>, part])}
          </HelpTip>
        </div>
        <OpenCodeProviderKeys />
      </>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-key-title"
        data-provider-key-dialog={id}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        className="flex max-h-[min(640px,calc(100dvh-2rem))] w-full max-w-[460px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated"
      >
        <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id="provider-key-title" className="text-[15px] font-semibold text-ink">{t(row.nameKey)}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-4">
          <p className="text-[12.5px] leading-relaxed text-ink-secondary">{copy.description}</p>
          <a href={copy.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-medium text-accent hover:underline">
            {copy.linkLabel}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          <ApiKeyRow section={row.section} testProvider={row.test} bare />
          {extra}
        </div>
        <footer className="flex justify-end border-t border-hairline/40 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg bg-control px-4 py-1.5 text-[13px] text-ink hover:bg-raised-hover">
            {t("providerKeys.done")}
          </button>
        </footer>
      </div>
    </div>
  );
}
