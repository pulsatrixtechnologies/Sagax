// Settings > Models and accounts: the API keys, one row per provider (name,
// state in words, one action) and a small dialog to add, replace, test or
// remove a key. The dialog holds the same ApiKeyRow that Settings > API keys
// used to show as a column of open fields (2026-10-12), so a key is saved,
// tested and resolved exactly as before (PUT /api/config, POST
// /api/keys/test). Keys stay write-only: a row says whether one is saved,
// never its value.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ExternalLink, KeyRound, X } from "lucide-react";

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
import { HelpTip } from "../SettingsPrimitives";

type KeyRowId = "openai" | "anthropic" | "xai" | "openrouter" | "mistral" | "openaiCompat" | "opencodeGo";

/** Which key a row holds, its name and whether a key is saved. */
const ROWS: Record<KeyRowId, { section: ConfigSection; nameKey: LocaleKey; test?: TestableProvider; saved: (config: ConfigStatus) => boolean }> = {
  anthropic: { section: "anthropic", nameKey: "providerKeys.anthropic", test: "anthropic", saved: (c) => c.anthropic?.configured ?? false },
  openai: { section: "openai", nameKey: "providerKeys.openai", test: "openai", saved: (c) => c.openai?.configured ?? false },
  xai: { section: "xai", nameKey: "providerKeys.xai", test: "xai", saved: (c) => c.xai?.configured ?? false },
  openrouter: { section: "openrouter", nameKey: "providerKeys.openrouter", test: "openrouter", saved: (c) => c.openrouter?.configured ?? false },
  mistral: { section: "mistral", nameKey: "providerKeys.mistral", test: "mistral", saved: (c) => c.mistral?.configured ?? false },
  openaiCompat: { section: "openaiCompat", nameKey: "providerKeys.openaiCompat", test: "openaiCompat", saved: (c) => c.openaiCompat?.configured ?? false },
  opencodeGo: { section: "opencodeGo", nameKey: "providerKeys.opencode", saved: (c) => (c.opencodeGo?.configured ?? false) || (c.opencodeGo?.providerKeys?.length ?? 0) > 0 },
};
export const PROVIDER_KEY_ROWS = ["anthropic", "openai", "xai", "openrouter", "mistral", "openaiCompat"] as const satisfies readonly KeyRowId[];
export const ENGINE_KEY_ROWS = ["opencodeGo"] as const satisfies readonly KeyRowId[];

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

export function ProviderKeyRows({ rows }: { rows: readonly KeyRowId[] }) {
  const { state } = useStore();
  return (
    <ul className="divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/40" data-provider-keys="">
      {rows.map((id) => {
        const row = ROWS[id];
        const saved = state.config ? row.saved(state.config) : false;
        return (
          <li key={id} data-provider-key={id} className="flex items-center gap-3 px-3.5 py-2.5">
            <KeyRound size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{t(row.nameKey)}</span>
              <span className={cn("block text-[12px]", saved ? "text-accent-text" : "text-ink-secondary")}>
                {saved ? t("providerKeys.saved") : t("providerKeys.none")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => openProviderKeyDialog(id)}
              className="shrink-0 rounded-lg bg-control px-3 py-1.5 text-[12.5px] text-ink hover:bg-raised-hover"
            >
              {saved ? t("providerKeys.manage") : t("providerKeys.add")}
            </button>
          </li>
        );
      })}
    </ul>
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
