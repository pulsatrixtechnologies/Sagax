/** Who may see a channel or another person's bot in Direct.

A channel is visible only when `viewerId` is in `humanIds`. Direct shows
the owner's own bot always, and anyone else only when they are in
`directGrants`. An empty grant list hides the bot from everyone except
the owner. Pure: no store. */

function actorKey(id: string): string {
  return id.trim().toLowerCase();
}

export function canSeeChannel(input: { humanIds: string[]; viewerId: string }): boolean {
  const viewer = actorKey(input.viewerId);
  return input.humanIds.some((id) => actorKey(id) === viewer);
}

export function canSeeDirectBot(input: { ownerUserId: string; viewerId: string; directGrants: string[] }): boolean {
  const viewer = actorKey(input.viewerId);
  return viewer === actorKey(input.ownerUserId) || input.directGrants.some((id) => actorKey(id) === viewer);
}

/** Signed-in owner, admin, or member: email, else userId. Loopback and a
 * session with no user id have no viewer id and see every group. Admin
 * scope does not skip the humanIds check. */
export function channelViewerId(auth: {
  kind: string;
  session?: { email?: string; userId?: string };
}): string | undefined {
  if (auth.kind !== "session") return undefined;
  const email = auth.session?.email?.trim().toLowerCase();
  if (email) return email;
  const userId = auth.session?.userId?.trim().toLowerCase();
  if (userId && !userId.startsWith("portal:")) return userId;
  return undefined;
}

/** The GET /api/groups filter. No viewer id (local operator) sees every
 * group. A signed-in id sees a channel only when canSeeChannel is true. */
export function seesChannel(group: { humanIds?: string[] }, viewerId: string | undefined): boolean {
  if (!viewerId) return true;
  return canSeeChannel({ humanIds: group.humanIds ?? [], viewerId });
}

/** Signed-in viewers, including admin, have live frames filtered. Loopback
 * and a session with no user id do not. */
export function liveFramesNeedChannelFilter(viewerId: string | undefined): boolean {
  return Boolean(viewerId);
}

/** After memberSeesFrame allows the frame, admins still get the admin
 * projection. Members get the client projection (config is the one that
 * differs). */
export function sseFrameProjection(input: { admin: boolean }): "admin" | "client" {
  return input.admin ? "admin" : "client";
}

/** A channel frame is judged only by humanIds. The speaking bot's Direct
 * grants are not consulted. */
export function seesChannelFrame(input: {
  humanIds: string[];
  viewerId: string;
  speakingOwnerUserId?: string;
  speakingDirectGrants?: string[];
}): boolean {
  return canSeeChannel({ humanIds: input.humanIds, viewerId: input.viewerId });
}

/** Direct or a channel the viewer can see. A missing owner is not a pass:
 * a signed-in viewer still needs to be the owner, a direct grant, or a
 * human in a channel that contains the bot. No viewer id sees every bot. */
export function seesBotForViewer(input: {
  viewerId: string | undefined;
  ownerUserId?: string;
  directGrants: string[];
  inChannels: { humanIds?: string[] }[];
}): boolean {
  if (!input.viewerId) return true;
  if (input.ownerUserId && canSeeDirectBot({ ownerUserId: input.ownerUserId, viewerId: input.viewerId, directGrants: input.directGrants })) return true;
  if (!input.ownerUserId && input.directGrants.some((id) => actorKey(id) === actorKey(input.viewerId!))) return true;
  return input.inChannels.some((group) => seesChannel(group, input.viewerId));
}

/** Same rules as the channel list and the bot list. A missing subject is
 * hidden from a signed-in viewer. */
export function searchHitVisible(input: {
  viewerId: string | undefined;
  channel: { humanIds?: string[] } | null;
  bot: { ownerUserId?: string; directGrants: string[]; inChannels: { humanIds?: string[] }[] } | null;
}): boolean {
  if (input.bot) {
    return seesBotForViewer({
      viewerId: input.viewerId,
      ownerUserId: input.bot.ownerUserId,
      directGrants: input.bot.directGrants,
      inChannels: input.bot.inChannels,
    });
  }
  if (input.channel) return seesChannel(input.channel, input.viewerId);
  return !input.viewerId;
}
