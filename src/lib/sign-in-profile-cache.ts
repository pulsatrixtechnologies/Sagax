// Name and avatar shown during the post-Pulsatrix connection animation on /pair.
// Written from GET /api/auth/session and refreshed after a successful preview of
// the pairing credential; read before React hydrates the finishing state.

export const SIGN_IN_PROFILE_CACHE_KEY = "sagax.signInProfile.v1";

export type SignInProfileCache = {
  name: string;
  avatarUrl?: string;
  at: number;
};

function store(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readSignInProfileCache(): SignInProfileCache | null {
  try {
    const raw = store()?.getItem(SIGN_IN_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const record = Object(parsed) as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) return null;
    const avatarUrl = typeof record.avatarUrl === "string" && record.avatarUrl.startsWith("/") ? record.avatarUrl : undefined;
    const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0;
    return { name: name.slice(0, 200), ...(avatarUrl ? { avatarUrl } : {}), at };
  } catch {
    return null;
  }
}

export function writeSignInProfileCache(input: { name?: string | null; avatarUrl?: string | null }): void {
  const name = input.name?.trim() ?? "";
  if (!name) return;
  const avatarUrl = input.avatarUrl?.trim();
  const payload: SignInProfileCache = {
    name: name.slice(0, 200),
    ...(avatarUrl && avatarUrl.startsWith("/") ? { avatarUrl } : {}),
    at: Date.now(),
  };
  try {
    store()?.setItem(SIGN_IN_PROFILE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Fields from GET /api/auth/session when kind === "session". */
export function cacheSignInProfileFromSession(body: unknown): void {
  const record = Object(body) as Record<string, unknown>;
  if (record.kind !== "session") return;
  const name = typeof record.name === "string" ? record.name : undefined;
  const avatarUrl = typeof record.avatarUrl === "string" ? record.avatarUrl : undefined;
  writeSignInProfileCache({ name, avatarUrl });
}
