// First-paint skin: the same rules as readSkin() in skins.ts, without touching
// the DOM. index.html runs equivalent logic inline before the module bundle
// loads (skin-families.test.ts keeps its ids and Auto pairs equal).
// skinIdFromStored is the stored id alone; the inline script adds Auto.

import { autoPairs, SKIN_MODE_KEY } from "./skin-families";
import { DEFAULT_SKIN, SKIN_IDS, type SkinId } from "./skins";

const BOOTSTRAP_IDS: readonly string[] = SKIN_IDS;

export function skinIdFromStored(stored: string | null | undefined): SkinId {
  if (stored && BOOTSTRAP_IDS.includes(stored)) return stored as SkinId;
  return DEFAULT_SKIN;
}

const SCRIPT_UNSAFE: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "/": "\\u002F",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** JSON literal safe to embed in an inline <script> (single pass over JSON.stringify's output). */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (c) => SCRIPT_UNSAFE[c] ?? c);
}

/** Inline script for index.html: sets document.documentElement.dataset.skin.
 * Under Auto (`omb-skin-mode` "auto", skin-families.ts) a skin with a light
 * and a dark sibling is swapped for the one the system's scheme asks for. */
export function skinBootstrapInlineScript(): string {
  const ids = scriptSafeJson([...BOOTSTRAP_IDS]);
  const fallback = scriptSafeJson(DEFAULT_SKIN);
  const pairs = scriptSafeJson(autoPairs());
  const modeKey = scriptSafeJson(SKIN_MODE_KEY);
  return `(function(){var SKINS=${ids},PAIRS=${pairs},d=${fallback},s,m;try{s=localStorage.getItem("omb-skin");m=localStorage.getItem(${modeKey})}catch(e){}s=SKINS.indexOf(s)>=0?s:d;if(m==="auto"&&PAIRS[s]){var k=false;try{k=matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}s=PAIRS[s][k?1:0]}document.documentElement.dataset.skin=s})();`;
}
