// Who owns the signed-in person's name and email. On an organization server
// (SAGAX_IDENTITY=perspicax) Pulsatrix Perspicax does: the server says so in
// GET /api/auth/session and in the config's `viewer` block
// (`profileManagedBy: "perspicax"`, `profileManageUrl`), refuses to change
// them (403 identity_perspicax) and refreshes them at every sign-in. The UI
// never guesses from where it runs: the desktop app connected to an
// organization server follows that server's answer, and a solo server (no
// field) keeps its editable profile.

export interface ManagedProfile {
  by: "perspicax";
  /** The issuer console's profile page; null when the server sent none
   * usable (the note still shows, without the link). */
  url: string | null;
  name: string;
  email: string;
  /** Their Perspicax avatar as this server serves it; absent: initials. */
  avatarUrl?: string;
}

/** A person's own avatar URL from this server (`/api/people/<id>/avatar`),
 * never anything else: an image from elsewhere would be a tracking pixel. */
export function personAvatarSrc(value: unknown): string | undefined {
  return typeof value === "string" && /^\/api\/people\/[\w-]{1,80}\/avatar(?:\?v=[0-9A-Za-z_-]{1,64})?$/.test(value) ? value : undefined;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Read either payload defensively; null means the profile is this
 * server's own (solo, the operator at its console, or an older server). */
export function managedProfile(source: unknown): ManagedProfile | null {
  if (!source || typeof source !== "object") return null;
  const record = source as { profileManagedBy?: unknown; profileManageUrl?: unknown; name?: unknown; email?: unknown; avatarUrl?: unknown };
  if (record.profileManagedBy !== "perspicax") return null;
  const avatarUrl = personAvatarSrc(record.avatarUrl);
  return {
    by: "perspicax",
    url: webUrl(record.profileManageUrl),
    name: typeof record.name === "string" ? record.name.trim() : "",
    email: typeof record.email === "string" ? record.email.trim() : "",
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}
