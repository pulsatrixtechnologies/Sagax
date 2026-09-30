// Hibou 98 draws every modal as a 98 dialog: a navy title bar carrying the
// dialog's own name and a bevelled close box. The stylesheet cannot read a
// dialog's name when it comes from aria-labelledby, nor tell its close
// button from any other, so this watcher tags them while the skin is worn:
//
//   data-r98-title="Settings"   on the dialog (the title bar text)
//   data-r98-static             when the dialog had no positioning of its own
//   data-r98-close="bar|inline" on the button that closes it
//   data-r98-caption="Pepper - Properties"  on a docked panel's header row
//
// It only adds attributes, never nodes, so React's tree is untouched, and the
// returned cleanup removes every attribute it set.

import { t } from "@/lib/i18n";

const DIALOGS = '[role="dialog"][aria-modal="true"], [role="alertdialog"], dialog[open]';
const CLOSE_WORDS = /^(close|fermer|cancel|annuler|dismiss)\b/i;
const SKIP = ".r98-root, [data-r98-chrome], .app-docked-panel";

function dialogTitle(dialog: Element): string {
  const own = dialog.getAttribute("aria-label")?.trim();
  if (own) return own;
  const ids = dialog.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  const fromIds = ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
  if (fromIds) return fromIds;
  return dialog.querySelector("h1, h2, h3")?.textContent?.trim() ?? "";
}

function closeButton(dialog: Element): HTMLElement | null {
  const buttons = [...dialog.querySelectorAll<HTMLElement>("button[aria-label], button[title]")];
  return (
    buttons.find((button) => CLOSE_WORDS.test(button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "") && Boolean(button.querySelector("svg"))) ??
    null
  );
}

export function tagDialogs(root: ParentNode, tagged: Set<Element>): void {
  for (const dialog of root.querySelectorAll(DIALOGS)) {
    if (dialog.closest(SKIP)) continue;
    const title = dialogTitle(dialog).slice(0, 120);
    if (dialog.getAttribute("data-r98-title") !== title) dialog.setAttribute("data-r98-title", title);
    if (!dialog.hasAttribute("data-r98-static") && getComputedStyle(dialog).position === "static") dialog.setAttribute("data-r98-static", "");
    tagged.add(dialog);
    const close = closeButton(dialog);
    if (close) {
      // Only a button laid out against the dialog itself can move into its
      // title bar; one nested in another box stays where it is, restyled.
      const place = close.offsetParent === dialog ? "bar" : "inline";
      if (close.getAttribute("data-r98-close") !== place) close.setAttribute("data-r98-close", place);
      tagged.add(close);
    }
  }
}

/** A docked side panel reads as a property sheet: "Pepper - Properties". */
export function tagPanels(root: ParentNode, tagged: Set<Element>): void {
  for (const panel of root.querySelectorAll(".app-docked-panel")) {
    const own = panel.getAttribute("aria-label")?.trim();
    const name = panel.querySelector("span.truncate")?.textContent?.trim();
    const title = own || (name ? t("retro.panel.titleNamed", { name }) : t("retro.panel.title"));
    const header = panel.querySelector(":scope > div.h-12") ?? panel;
    if (header.getAttribute("data-r98-caption") !== title) header.setAttribute("data-r98-caption", title.slice(0, 120));
    tagged.add(header);
  }
}

/** Starts the watcher; the returned function stops it and removes the tags. */
export function decorateRetroSurfaces(root: Document = document): () => void {
  if (typeof MutationObserver === "undefined" || !root.body) return () => undefined;
  const tagged = new Set<Element>();
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      tagDialogs(root, tagged);
      tagPanels(root, tagged);
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root.body, { childList: true, subtree: true, characterData: true });
  tagDialogs(root, tagged);
  tagPanels(root, tagged);
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    for (const node of tagged) {
      node.removeAttribute("data-r98-title");
      node.removeAttribute("data-r98-static");
      node.removeAttribute("data-r98-close");
      node.removeAttribute("data-r98-caption");
    }
    tagged.clear();
  };
}
