// First-paint skin: the same rules as readSkin() in skins.ts, without touching
// the DOM. index.html runs equivalent logic inline before the module bundle loads.

import { DEFAULT_SKIN, SKIN_IDS, type SkinId } from "./skins";

const BOOTSTRAP_IDS: readonly string[] = SKIN_IDS;

export function skinIdFromStored(stored: string | null | undefined): SkinId {
  if (stored && BOOTSTRAP_IDS.includes(stored)) return stored as SkinId;
  return DEFAULT_SKIN;
}

const UNSAFE_SCRIPT_CHARS: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "/": "\\u002F",
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** After JSON.stringify, so a value cannot break out of an inline script. */
export function escapeUnsafeChars(json: string): string {
  return json.replace(/[<>/\b\f\n\r\t\0\u2028\u2029]/g, (ch) => UNSAFE_SCRIPT_CHARS[ch] ?? ch);
}

/** Inline script for index.html: sets document.documentElement.dataset.skin. */
export function skinBootstrapInlineScript(): string {
  const ids = escapeUnsafeChars(JSON.stringify([...BOOTSTRAP_IDS]));
  const fallback = escapeUnsafeChars(JSON.stringify(DEFAULT_SKIN));
  return `(function(){var SKINS=${ids},d=${fallback},s;try{s=localStorage.getItem("omb-skin")}catch(e){}document.documentElement.dataset.skin=SKINS.indexOf(s)>=0?s:d})();`;
}
