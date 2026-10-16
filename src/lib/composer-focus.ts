/** The composer's text field on screen (the chat's or the group's). */
export const COMPOSER_INPUT_SELECTOR = '[data-tour="composer"] textarea';

/** Put the caret at the end of the composer's text, if one is on screen.
 * Returns whether it found one. */
export function focusComposer(): boolean {
  if (typeof document === "undefined") return false;
  const input = document.querySelector<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR);
  if (!input || input.disabled) return false;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange?.(end, end);
  return true;
}
