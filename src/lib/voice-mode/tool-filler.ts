// Local spoken filler at tool start: words in the call language, never a
// tone. Played once per tool activity key on a thinking turn so there is no
// dead air while the harness works. The model's own chip is skipped once any
// filler has been said this turn. Barge-in cancels it; the next user turn
// can play again.

export const TOOL_FILLER_COPY = {
  en: "Let me look.",
  fr: "Je regarde.",
  pt: "Deixa eu ver.",
} as const;

export interface ToolFillerState {
  playedKeys: string[];
  cancelled: boolean;
}

export function createToolFillerState(): ToolFillerState {
  return { playedKeys: [], cancelled: false };
}

export function toolFillerLanguage(voiceLanguage?: string, uiLocale?: string): string {
  if (voiceLanguage && voiceLanguage !== "auto") return voiceLanguage;
  if (uiLocale && uiLocale !== "auto") return uiLocale;
  return "en";
}

export function toolFillerText(language: string | undefined): string {
  const key = (language ?? "en").toLowerCase();
  if (key.startsWith("fr")) return TOOL_FILLER_COPY.fr;
  if (key.startsWith("pt")) return TOOL_FILLER_COPY.pt;
  return TOOL_FILLER_COPY.en;
}

/** A filler is spoken words, never an empty string or a control beep. */
export function isSpokenFiller(text: string): boolean {
  return /[a-zà-ÿ]/i.test(text);
}

export function shouldPlayToolFiller(
  state: ToolFillerState,
  opts: { thinking: boolean; toolStarted: boolean; toolKey?: string; speaking?: boolean },
): boolean {
  if (!opts.thinking || !opts.toolStarted || state.cancelled || opts.speaking) return false;
  if (opts.toolKey) return !state.playedKeys.includes(opts.toolKey);
  return state.playedKeys.length === 0;
}

export function shouldSkipToolChip(state: ToolFillerState): boolean {
  return state.playedKeys.length > 0;
}

export function noteToolFillerPlayed(state: ToolFillerState, toolKey?: string): ToolFillerState {
  const key = toolKey ?? "";
  if (key && state.playedKeys.includes(key)) return state;
  return { playedKeys: [...state.playedKeys, key], cancelled: state.cancelled };
}

export function cancelToolFiller(state: ToolFillerState): ToolFillerState {
  return { playedKeys: state.playedKeys, cancelled: true };
}

export function resetToolFiller(_state?: ToolFillerState): ToolFillerState {
  return createToolFillerState();
}
