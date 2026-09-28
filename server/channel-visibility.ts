/** Who may see a channel or another person's bot in Direct.

A channel is visible only when `viewerId` is in `humanIds`. Direct shows
the owner's own bot always, and anyone else only when they are in
`directGrants`. An empty grant list hides the bot from everyone except
the owner. Pure: no store. */

export function canSeeChannel(input: { humanIds: string[]; viewerId: string }): boolean {
  return input.humanIds.includes(input.viewerId);
}

export function canSeeDirectBot(input: { ownerUserId: string; viewerId: string; directGrants: string[] }): boolean {
  return input.viewerId === input.ownerUserId || input.directGrants.includes(input.viewerId);
}
