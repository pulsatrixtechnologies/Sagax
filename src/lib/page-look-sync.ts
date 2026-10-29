// The person's look, sent to the server for their published pages
// (2026-10-29, src/lib/page-look.ts): a reading link of their page draws its
// bar and its frame in their Sagax theme. The tokens are read the way the
// browser resolves them (a probe element wearing the skin, as the picker's
// live miniatures do), for the light and the dark sibling of the skin worn,
// with its color, intensity and texture; the server keeps known tokens with
// safe values only. Sent when the app starts and whenever the skin or the
// bot-accent choice changes, only when it changed.
import { useEffect } from "react";
import { useBotAccentEnabled } from "./bot-accent";
import { autoPairs, tintsBySkin } from "./skin-families";
import { PAGE_LOOK_TOKENS, sanitizeLookTokens, type PageLook, type PageLookTokens } from "./page-look";

const SKIN_ATTRIBUTES = ["data-skin", "data-skin-tint", "data-skin-depth", "data-skin-texture"];

/** The tokens of one skin as the browser resolves them, from a hidden probe
 * that wears it (and the tint, intensity and texture the person chose). */
export function probeLookTokens(doc: Document, skin: string, extra: { tint?: string; depth?: string; texture?: string }): PageLookTokens {
  const probe = doc.createElement("div");
  probe.dataset.skin = skin;
  if (extra.tint) probe.dataset.skinTint = extra.tint;
  if (extra.depth) probe.dataset.skinDepth = extra.depth;
  if (extra.texture) probe.dataset.skinTexture = extra.texture;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  doc.body.appendChild(probe);
  try {
    const style = doc.defaultView?.getComputedStyle(probe);
    const tokens: Record<string, string> = {};
    for (const name of PAGE_LOOK_TOKENS) {
      const value = style?.getPropertyValue(name).trim();
      if (value) tokens[name] = value;
    }
    return sanitizeLookTokens(tokens);
  } finally {
    probe.remove();
  }
}

/** The person's look now: their skin's light and dark siblings (one only
 * for a skin with a single scheme, such as Hibou 98), and the bot accent. */
export function currentPageLook(doc: Document, botAccent: boolean): PageLook | null {
  const root = doc.documentElement.dataset;
  const worn = root.skin;
  if (!worn) return null;
  const pair = autoPairs()[worn];
  const tints = tintsBySkin();
  const extra = (skin: string) => ({
    ...(root.skinTint && tints[skin]?.includes(root.skinTint as never) ? { tint: root.skinTint } : {}),
    ...(root.skinDepth ? { depth: root.skinDepth } : {}),
    ...(root.skinTexture ? { texture: root.skinTexture } : {}),
  });
  const look: PageLook = { skin: worn, ...(botAccent ? { botAccent: true } : {}) };
  if (pair) {
    look.light = probeLookTokens(doc, pair[0], extra(pair[0]));
    look.dark = probeLookTokens(doc, pair[1], extra(pair[1]));
  } else {
    const own = probeLookTokens(doc, worn, extra(worn));
    look[own["--code-color-scheme"] === "dark" ? "dark" : "light"] = own;
  }
  return look;
}

let lastSent = "";
let refused = false;

/** Send the look when it differs from the last one sent. */
export async function sendPageLook(look: PageLook | null, put: (body: string) => Promise<Response>): Promise<void> {
  if (!look || refused) return;
  const body = JSON.stringify(look);
  if (body === lastSent) return;
  lastSent = body;
  try {
    const answer = await put(body);
    // not a person of this server (a bot's shell, a paired device): stop asking
    if (answer.status === 403 || answer.status === 404) refused = true;
    else if (!answer.ok) lastSent = "";
  } catch {
    lastSent = "";
  }
}

function putLook(body: string): Promise<Response> {
  return fetch("/api/pages/look", { method: "PUT", headers: { "content-type": "application/json" }, body });
}

/** Keeps the server's copy of the person's look current. */
export function usePageLookSync(enabled: boolean): void {
  const botAccent = useBotAccentEnabled();
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void sendPageLook(currentPageLook(document, botAccent), putLook), delay);
    };
    schedule(1500);
    const observer = new MutationObserver(() => schedule(1000));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: SKIN_ATTRIBUTES });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, botAccent]);
}

/** For the tests: forget what was sent. */
export function resetPageLookSync(): void {
  lastSent = "";
  refused = false;
}
