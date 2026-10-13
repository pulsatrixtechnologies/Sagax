// First-paint skin: the same rules as readSkin() in skins.ts, without touching
// the DOM. index.html runs equivalent logic inline before the module bundle loads.

import { DEFAULT_SKIN, SKIN_IDS, type SkinId } from "./skins";

const BOOTSTRAP_IDS: readonly string[] = SKIN_IDS;

export function skinIdFromStored(stored: string | null | undefined): SkinId {
  if (stored && BOOTSTRAP_IDS.includes(stored)) return stored as SkinId;
  return DEFAULT_SKIN;
}

/** Inline script for index.html: sets document.documentElement.dataset.skin. */
export function skinBootstrapInlineScript(): string {
  const ids = JSON.stringify([...BOOTSTRAP_IDS]);
  const fallback = JSON.stringify(DEFAULT_SKIN);
  return `(function(){var SKINS=${ids},d=${fallback},s;try{s=localStorage.getItem("omb-skin")}catch(e){}document.documentElement.dataset.skin=SKINS.indexOf(s)>=0?s:d})();`;
}
