// What moves into a message's "more" menu, built the same way for 1:1 chats
// and rooms, bot answers and the person's own bubbles.
import { Code, Eye, Pencil, Pin, PinOff, RefreshCw, Square, Volume2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { ConfigStatus } from "@/state/store";
import { ACTION_ICON, type MessageMenuItem } from "@/components/MessageActions";
import { useSpeakAction } from "@/components/SpeakButton";

export type PinAction = { pinned: boolean; onToggle: () => void; hint?: string };

function pinItem(pin: PinAction | undefined): MessageMenuItem[] {
  if (!pin) return [];
  return [{
    key: "pin",
    icon: pin.pinned ? <PinOff {...ACTION_ICON} /> : <Pin {...ACTION_ICON} />,
    label: pin.pinned ? t("chat.unpinMessage") : t("chat.pinMessage"),
    title: pin.pinned ? t("chat.unpinHint") : pin.hint ?? t("chat.pinHint"),
    onSelect: pin.onToggle,
  }];
}

/** A bot answer: regenerate, pin, then read aloud and raw markdown in the
 * view section. Reply, Copy and Copy request ID come first in every
 * message's menu (MessageHoverActions). */
export function useBotMessageMenu({
  text,
  botId,
  messageId,
  voiceId,
  tts,
  localVoice,
  canSpeak,
  viewRaw,
  onToggleRaw,
  onRegenerate,
  pin,
}: {
  text: string;
  botId?: string;
  messageId: string;
  voiceId?: string;
  tts: ConfigStatus["tts"];
  localVoice: boolean;
  canSpeak: boolean;
  viewRaw: boolean;
  onToggleRaw: () => void;
  onRegenerate?: () => void;
  pin?: PinAction;
}): MessageMenuItem[] {
  const speak = useSpeakAction({ text, botId, messageId, voiceId, tts, localVoice });
  // What changes the message first, then how it is shown (JC, 2026-10-16).
  const items: MessageMenuItem[] = [];
  if (onRegenerate) items.push({ key: "regenerate", icon: <RefreshCw {...ACTION_ICON} />, label: t("chat.regenerate"), onSelect: onRegenerate });
  items.push(...pinItem(pin));
  if (canSpeak && text) {
    items.push({
      key: "speak",
      icon: speak.mine ? <Square {...ACTION_ICON} /> : <Volume2 {...ACTION_ICON} />,
      label: speak.mine ? t("chat.speak.stop") : t("chat.speak.read"),
      title: speak.label,
      disabled: !speak.ready,
      onSelect: speak.toggle,
      section: "view",
    });
  }
  if (text) {
    items.push({
      key: "raw",
      icon: viewRaw ? <Eye {...ACTION_ICON} /> : <Code {...ACTION_ICON} />,
      label: t(viewRaw ? "chat.showRenderedMarkdown" : "chat.showRawMarkdown"),
      onSelect: onToggleRaw,
      section: "view",
    });
  }
  return items;
}

/** The person's own message: edit, pin. */
export function userMessageMenu({ onEdit, pin }: { onEdit?: () => void; pin?: PinAction }): MessageMenuItem[] {
  return [
    ...(onEdit ? [{ key: "edit", icon: <Pencil {...ACTION_ICON} />, label: t("chat.editMessage"), onSelect: onEdit }] : []),
    ...pinItem(pin),
  ];
}
