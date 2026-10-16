// A person's photo changed (server/routes/me-avatar.ts, 2026-10-16): the
// `person.avatar` frame, and the answer of the person's own upload, carry the
// new versioned URL (null once removed). The viewer's own copy lives in the
// config (`viewer.avatarUrl`); everyone's lives in the organization directory
// (src/lib/perspicax-org.ts loadOrgPeople), read again here so the sidebar,
// rooms and pickers draw the new picture. A component that holds people
// listens to PERSON_AVATAR_EVENT.
import type { ConfigStatus } from "@/state/store";
import { personAvatarSrc } from "@/lib/profile-management";

export const PERSON_AVATAR_EVENT = "sagax:person-avatar";

export interface PersonAvatarChange {
  principalId: string;
  avatarUrl: string | null;
}

/** The config with the viewer's avatar replaced, when the change is the
 * viewer's own; the same object otherwise (nothing to dispatch). */
export function withViewerAvatar(config: ConfigStatus, change: PersonAvatarChange): ConfigStatus {
  const viewer = config.viewer;
  const me = viewer?.principalId?.trim().toLowerCase();
  if (!viewer || !me || me !== change.principalId.trim().toLowerCase()) return config;
  const url = personAvatarSrc(change.avatarUrl);
  if ((viewer.avatarUrl ?? undefined) === url) return config;
  const { avatarUrl: _previous, ...rest } = viewer;
  return { ...config, viewer: { ...rest, ...(url ? { avatarUrl: url } : {}) } };
}

/** Tell the page: the directory is read again by whoever listens. */
export function announcePersonAvatar(change: PersonAvatarChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PersonAvatarChange>(PERSON_AVATAR_EVENT, { detail: change }));
}

export type OwnAvatarErrorCode =
  | "avatar_session_only"
  | "avatar_sign_in_again"
  | "avatar_type"
  | "avatar_unreadable"
  | "avatar_too_large"
  | "avatar_rejected"
  | "avatar_perspicax_outdated"
  | "avatar_unreachable";

export class OwnAvatarError extends Error {
  readonly code: OwnAvatarErrorCode | "network";
  constructor(code: OwnAvatarErrorCode | "network") {
    super(code);
    this.code = code;
  }
}

const KNOWN: readonly OwnAvatarErrorCode[] = [
  "avatar_session_only", "avatar_sign_in_again", "avatar_type", "avatar_unreadable",
  "avatar_too_large", "avatar_rejected", "avatar_perspicax_outdated", "avatar_unreachable",
];

async function send(init: RequestInit): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/me/avatar", { credentials: "same-origin", ...init });
  } catch {
    throw new OwnAvatarError("network");
  }
  const body = await res.json().catch(() => ({})) as { ok?: boolean; avatarUrl?: unknown; code?: unknown };
  if (!res.ok || body.ok !== true) {
    const code = KNOWN.find((known) => known === body.code);
    throw new OwnAvatarError(code ?? "avatar_unreachable");
  }
  return personAvatarSrc(body.avatarUrl) ?? null;
}

/** PUT /api/me/avatar with the cropped image; the new URL. */
export function uploadOwnAvatar(image: Blob): Promise<string | null> {
  return send({ method: "PUT", headers: { "content-type": image.type || "application/octet-stream" }, body: image });
}

/** DELETE /api/me/avatar; null. */
export function removeOwnAvatar(): Promise<string | null> {
  return send({ method: "DELETE" });
}
