// Who a page may be shown to inside Sagax. The person chooses this when
// they share. A page marked person never enters a room or a group, and
// choosing a wider audience is the only way it can. The public reading
// link (private, organization, link) is a separate door and is not widened
// here.

export const PAGE_AUDIENCE_KINDS = ["person", "room", "group"] as const;
export type PageAudienceKind = (typeof PAGE_AUDIENCE_KINDS)[number];

export type PageAudience =
  | { kind: "person" }
  | { kind: "room"; id: string }
  | { kind: "group"; id: string };

export type PagePlace = { kind: "room" | "group"; id: string };

const ID = /^[A-Za-z0-9_-]{1,80}$/;

type Parsed = { ok: true; value: PageAudience } | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The audience a share request names. `kind` or `audience` both work.
 * A room or a group needs its id. Anything else is refused. */
export function parsePageAudience(value: unknown): Parsed {
  const body = record(value);
  if (!body) return { ok: false, error: "audience: person, or room or group with an id." };
  const kind = body.kind ?? body.audience;
  if (kind === "person") return { ok: true, value: { kind: "person" } };
  if (kind !== "room" && kind !== "group") return { ok: false, error: "audience: person, room or group." };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!ID.test(id)) return { ok: false, error: "id: the room or the group, as its id." };
  return { ok: true, value: { kind, id } };
}

/** Missing or unreadable storage stays with the person. Never a wider guess. */
export function pageAudienceOf(value: unknown): PageAudience {
  const parsed = parsePageAudience(value);
  return parsed.ok ? parsed.value : { kind: "person" };
}

export function samePageAudience(left: PageAudience, right: PageAudience): boolean {
  if (left.kind === "person" || right.kind === "person") return left.kind === "person" && right.kind === "person";
  return left.kind === right.kind && left.id === right.id;
}

/** Whether this page may be put in that room or group. A person mark never
 * may. A room mark enters only that room. A group mark enters only that
 * group. This does not change the mark. */
export function pageMayEnter(audience: PageAudience, into: PagePlace): boolean {
  if (audience.kind === "person") return false;
  return audience.kind === into.kind && audience.id === into.id;
}

/** The share body the app sends. A room or a group without a real id is
 * null, so the app does not send a wider audience by accident. */
export function shareAudienceBody(kind: string, id: string): { audience: "person" | "room" | "group"; id?: string } | null {
  if (kind === "person") return { audience: "person" };
  const parsed = parsePageAudience({ kind, id });
  if (!parsed.ok || parsed.value.kind === "person") return null;
  return { audience: parsed.value.kind, id: parsed.value.id };
}
