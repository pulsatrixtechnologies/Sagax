// Organization GitHub access tokens (Settings > Organization > Plugins and
// GitHub). The OAuth App client id is a separate public setting. These are
// access tokens. A client sees the label and a redacted hint, never the token.

/** At least ten. Twenty leaves room past the usual set of repository groups. */
export const MAX_ORG_GITHUB_TOKENS = 20;

/** Hint when the stored value is too short to show a last-4 that is not the value. */
export const ORG_GITHUB_TOKEN_HINT_SAVED = "saved";

export interface OrgGithubTokenPublic {
  id: string;
  label: string;
  /** Last 4 characters, or `ORG_GITHUB_TOKEN_HINT_SAVED`. Never the token. */
  hint: string;
}

/** What a client may see. A short value stays the word "saved", not its text. */
export function orgGithubTokenHint(token: string): string {
  if (token.length < 8) return ORG_GITHUB_TOKEN_HINT_SAVED;
  const hint = token.slice(-4);
  return hint.length === 4 && hint !== token ? hint : ORG_GITHUB_TOKEN_HINT_SAVED;
}
