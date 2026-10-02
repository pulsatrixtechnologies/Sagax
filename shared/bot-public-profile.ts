// A bot's public identity inside a group chat: what every person in the
// room sees of each bot in it (name, label and look), whoever owns it. It
// grants no use of the bot outside the room and carries nothing of its
// settings, instructions, memory, routines or other threads.
import type { BotAvatarCrop } from "./bot-avatar.ts";
import type { MascotBodyId } from "./mascot-bodies.ts";
import type { MascotLook } from "./mascot-look.ts";
import type { MascotSkinId } from "./mascot-skins.ts";
import type { MausColor } from "./wire.ts";

export interface BotPublicProfile {
  id: string;
  name: string;
  title: string;
  color: MausColor;
  avatarUrl: string | null;
  avatarCrop?: BotAvatarCrop;
  avatarZoom?: number;
  avatarFocusX?: number;
  avatarFocusY?: number;
  mascotBody?: MascotBodyId | null;
  mascotSkin?: MascotSkinId | null;
  mascotLook?: MascotLook | null;
}

const OPTIONAL = ["avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY", "mascotBody", "mascotSkin", "mascotLook"] as const;

/** Only the listed fields, copied from a bot record or wire bot. */
export function botPublicProfile(bot: { id: string; name: string; title?: string; color: MausColor; avatarUrl?: string | null } & Partial<Record<(typeof OPTIONAL)[number], unknown>>): BotPublicProfile {
  const profile: BotPublicProfile = { id: bot.id, name: bot.name, title: bot.title ?? "", color: bot.color, avatarUrl: bot.avatarUrl ?? null };
  for (const key of OPTIONAL) {
    if (bot[key] !== undefined) (profile as unknown as Record<string, unknown>)[key] = bot[key];
  }
  return profile;
}
