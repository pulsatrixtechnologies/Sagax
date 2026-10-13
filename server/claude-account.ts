export interface ClaudeAccountInput {
  signedIn?: boolean;
  loginMarker?: boolean;
  anthropicConfigured?: boolean;
  myKey?: boolean;
  orgKey?: boolean;
}

export function claudeAccountLinked(input: ClaudeAccountInput): boolean {
  if (input.signedIn || input.loginMarker) return true;
  if (input.anthropicConfigured || input.myKey) return true;
  return false;
}
