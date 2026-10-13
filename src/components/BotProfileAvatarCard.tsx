// The bot's avatar at the top of the bot panel and of the persona editor's
// Overview. It plays the bot's moves as they happen (mascotMotion from the
// store) and opens the persona editor on Appearance when clicked, where the
// character, its look and the picture sources live (appearance/AppearancePane).
// A right click keeps the bot panel's mascot menu. In the New bot dialog the
// bot is a draft the store does not hold yet, so the click shows the same
// Appearance pane under the avatar instead.
import { useState } from "react";
import { Pencil } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { t } from "@/lib/i18n";
import { type MausMotion, type MausState } from "@/lib/mascot";
import { BotAvatar } from "./Avatar";
import { AppearancePane } from "./appearance/AppearancePane";
import type { AvatarPatch } from "./appearance/AvatarSources";

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
  onContextMenu,
  onEdit,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
  /** A right click on the mascot (the bot panel opens its bot menu). */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** The bot panel's pencil at the mascot's lower right: opens the persona
   * editor (it replaced the header's "..." button, 2026-10-12). */
  onEdit?: () => void;
}) {
  const { dispatch } = useStore();
  const { draft } = useBotEditor();
  const [draftOpen, setDraftOpen] = useState(false);
  const open = () => {
    if (draft) setDraftOpen((value) => !value);
    else dispatch({ type: "openPersonaEditor", botId: bot.id, section: "appearance" });
  };

  return (
    <div className="relative">
      {/* room above for a move's jump and effects: the panel scrolls, so anything past its top is cut by a straight edge */}
      <div className="flex justify-center pb-3 pt-6">
        <button
          type="button"
          aria-label={t("botPanel.avatar.edit")}
          aria-expanded={draft ? draftOpen : undefined}
          aria-haspopup={draft ? undefined : "dialog"}
          data-avatar-edit=""
          onClick={open}
          onContextMenu={onContextMenu}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <BotAvatar
            bot={bot}
            state={activeState}
            size={112}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
        </button>
        {onEdit && (
          <button
            type="button"
            data-persona-edit-badge=""
            data-edit-persona=""
            aria-label={t("botPanel.editBot")}
            title={t("botPanel.editBot")}
            onClick={onEdit}
            onContextMenu={onContextMenu}
            // 28 px circle, 44 px to touch (the ::before extends the hit area)
            className="relative -ml-7 mb-1 flex size-7 shrink-0 items-center justify-center self-end rounded-full border border-hairline-weak bg-elevated text-ink-tertiary shadow-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-hover hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {draft && draftOpen && (
        <div data-avatar-appearance="" className="pb-2">
          <AppearancePane bot={bot} onPatch={onPatch} />
        </div>
      )}
    </div>
  );
}
