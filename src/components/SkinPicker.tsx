// Choosing a skin is a visual decision, so the options are shown visually: each
// card carries a working miniature of the app rendered in that skin, not a row
// of paint chips. That works because the skin blocks in styles.css are keyed on
// `[data-skin]` rather than `:root[data-skin]` — any element can open a skin
// context for its own subtree, so the miniature styles itself and can never
// drift from what picking it actually does.
import { useState } from "react";
import { Check } from "lucide-react";
import { applySkin, readSkin, visibleSkins, type SkinId } from "@/lib/skins";
import { readRetroUnlocked } from "@/lib/retro98";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * The app's own layout at roughly 1/14 scale: rail, sidebar with a selected
 * row, thread, composer. The selected row and the send button are drawn in the
 * accent on purpose — a skin is mostly judged by where its colour lands, and a
 * single dot was too small to judge.
 */
function Miniature({ skin, selected }: { skin: SkinId; selected: boolean }) {
  return (
    <div
      data-skin={skin}
      aria-hidden="true"
      className={cn("flex h-[78px] w-full overflow-hidden rounded-lg bg-app", selected ? "ring-2 ring-accent-border" : "ring-1 ring-hairline/60")}
    >
      {/* rail */}
      <div className="flex w-[11px] shrink-0 flex-col items-center gap-[3px] bg-panel pt-[5px]">
        <span className="size-[5px] rounded-full bg-accent" />
        <span className="size-[5px] rounded-full bg-ink-secondary/40" />
        <span className="size-[5px] rounded-full bg-ink-secondary/40" />
      </div>
      {/* sidebar — the top row is the selected conversation */}
      <div className="flex w-[30px] shrink-0 flex-col gap-[3px] border-r border-hairline bg-panel p-[4px]">
        <span className="flex h-[9px] w-full items-center gap-[2px] rounded-sm bg-raised px-[2px]">
          <span className="size-[4px] shrink-0 rounded-full bg-accent" />
          <span className="h-[2px] flex-1 rounded-full bg-ink/50" />
        </span>
        <span className="h-[3px] w-[80%] rounded-full bg-ink-secondary/30" />
        <span className="h-[3px] w-[62%] rounded-full bg-ink-secondary/30" />
        <span className="h-[3px] w-[74%] rounded-full bg-ink-secondary/30" />
      </div>
      {/* thread */}
      <div className="flex min-w-0 flex-1 flex-col gap-[4px] p-[6px]">
        <span className="h-[13px] w-[62%] self-end rounded-md bg-bubble-user" />
        <div className="flex w-[88%] flex-col gap-[3px] rounded-md bg-card p-[4px]">
          <span className="h-[2px] w-full rounded-full bg-ink/45" />
          <span className="h-[2px] w-[85%] rounded-full bg-ink/45" />
          <span className="h-[2px] w-[60%] rounded-full bg-ink-secondary/40" />
        </div>
        <div className="mt-auto flex items-center gap-[4px]">
          <span className="h-[11px] flex-1 rounded-full bg-inset ring-1 ring-hairline" />
          {/* filled accent with its own ink — Foundry's inversion reads right
              here: bright brass carrying a dark mark, where the others carry
              a light one */}
          <span className="flex size-[11px] items-center justify-center rounded-full bg-accent">
            <span
              className="h-[1.5px] w-[5px] rounded-full"
              style={{ background: "var(--color-accent-ink)" }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

export function SkinPicker() {
  // The document is the source of truth, not storage: main.tsx has already
  // stamped it, and reading it back keeps the checkmark honest even if the
  // skin was set some other way.
  // SAFETY: main.tsx writes this attribute from applySkin() before the first
  // paint, and readSkin() covers the case where it is absent or unreadable.
  const [active, setActive] = useState<SkinId>(
    () => (document.documentElement.dataset.skin as SkinId) || readSkin(),
  );
  // Secret skins stay out of the list until this device has found them.
  const [skins] = useState(() => visibleSkins(readRetroUnlocked(), active));

  return (
    // 0.5.6 (JC): Grok Bot's tiles inside the Appearance card: the picture,
    // the name and a check. The tagline is the tile's tooltip and its
    // accessible description, so the grid fits four across.
    <div role="group" aria-label={t("settings.skin.title")} data-skin-grid="" className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2 px-2 py-1">
      {skins.map((skin) => {
        const selected = skin.id === active;
        return (
          <button
            key={skin.id}
            type="button"
            aria-pressed={selected}
            aria-description={skin.tagline}
            title={skin.tagline}
            onClick={() => {
              applySkin(skin.id);
              setActive(skin.id);
            }}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[10px] p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none",
              selected ? "bg-selected" : "hover:bg-hover",
            )}
          >
            <Miniature skin={skin.id} selected={selected} />
            <span className="flex min-w-0 items-center gap-1.5 px-0.5 text-[13px] leading-[18px] text-ink">
              <span className="min-w-0 truncate">{skin.name}</span>
              {skin.secret && (
                <span className="shrink-0 rounded-sm bg-accent px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
                  {t("retro.skin.unlocked")}
                </span>
              )}
              {selected && <Check size={13} aria-hidden="true" className="ml-auto shrink-0 text-accent-text" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
