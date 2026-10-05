import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { canEditConfig } from "@/lib/viewer";
import { SettingsText } from "./SettingsLink";

const INPUT_CLASS = "w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50";

export function AvatarImageGenerator({
  botLabel,
  disabled,
  generating,
  onGenerate,
}: {
  botLabel: string;
  disabled: boolean;
  generating: boolean;
  onGenerate: (direction: string) => Promise<void>;
}) {
  const { state } = useStore();
  const configured = state.config?.imageGen?.configured === true;
  const [direction, setDirection] = useState("");
  const busy = disabled || generating;

  return (
    <div className="mt-5 border-t border-hairline/40 pt-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Sparkles size={14} className="text-accent" /> {t("botPanel.avatar.generateWithAi")}
      </div>
      {configured ? (
        <>
          <textarea
            value={direction}
            disabled={busy}
            onChange={(event) => setDirection(event.target.value.slice(0, 400))}
            maxLength={400}
            placeholder={t("botPanel.avatar.directionPlaceholder", { name: botLabel })}
            aria-label={t("botPanel.avatar.direction")}
            className={`${INPUT_CLASS} mt-3 min-h-[72px] resize-none`}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] tabular-nums text-ink-secondary">{direction.length}/400</span>
            <button
              type="button"
              onClick={() => {
                if (!busy && configured) void onGenerate(direction.trim());
              }}
              disabled={busy || !configured}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
            >
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generating ? t("botPanel.avatar.generating") : t("botPanel.avatar.generateAvatar")}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">
          {canEditConfig(state.config)
            ? <SettingsText text={t("imageGen.setup")} links={{ settings: { section: "connections", cardId: "connections.image" } }} />
            : t("imageGen.unavailable")}
        </p>
      )}
    </div>
  );
}
