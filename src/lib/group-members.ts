// The bots in a group chat as the viewer sees them. A bot the viewer may
// open comes from their own list; any other bot in the room (someone else's,
// not shared with them) comes from the room's public profile of it: its
// name, label and look only (shared/bot-public-profile.ts). Every person in
// a room sees every bot in it, so the panel, the header's count and
// avatars, mentions and the responder hints all read the same list.
import type { BotPublicProfile } from "../../shared/bot-public-profile";
import type { Bot, Group } from "@/state/store";

/** A Bot-shaped stand-in for a room member the viewer knows only by its
 * public profile: nothing to open, no thread, no settings. */
export function publicProfileBot(profile: BotPublicProfile): Bot {
  return {
    ...profile,
    threadId: "",
    description: "",
    notifications: false,
    unread: false,
    modelSelection: { instanceId: "", model: "" },
    messages: [],
    publicProfile: true,
  };
}

/** Every bot in the room, in the room's order; a member neither listed nor
 * profiled (an older server, a bot just deleted) is left out. */
export function groupMemberBots(group: Pick<Group, "memberIds" | "memberProfiles">, bots: readonly Bot[]): Bot[] {
  return group.memberIds.flatMap((id) => {
    const own = bots.find((bot) => bot.id === id);
    if (own) return [own];
    const profile = group.memberProfiles?.find((candidate) => candidate.id === id);
    return profile ? [publicProfileBot(profile)] : [];
  });
}
