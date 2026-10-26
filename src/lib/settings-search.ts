// Settings search (the box in the Settings nav) used to match only a section's
// name and keywords, then open that page at the top. The matching row stayed
// wherever it sits. This reads the rows the page actually drew.

import { foldForSearch } from "./palette-rank";

const ROW = "[data-settings-row]";
const GROUP = "[data-settings-group]";

/** Accents folded, case folded, inner space collapsed. "Icône" and "icon"
 * meet on the same string. */
export function settingsQuery(query: string): string {
  return foldForSearch(query).replace(/\s+/g, " ").trim();
}

/** Whether `text` contains `query` after that folding. An empty query matches. */
export function settingsTextMatches(text: string, query: string): boolean {
  const q = settingsQuery(query);
  if (!q) return true;
  return foldForSearch(text).replace(/\s+/g, " ").includes(q);
}

/** The row's own words, without a row nested inside it. */
function ownRowText(row: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node !== row && node instanceof HTMLElement && node.matches(ROW)) return;
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? "");
    for (const child of node.childNodes) walk(child);
  };
  walk(row);
  return parts.join(" ");
}

/** The label a person reads on a settings row. */
export function settingsRowLabel(row: HTMLElement): string {
  const id = row.getAttribute("aria-labelledby");
  if (id) {
    const node = row.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    const text = node?.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return ownRowText(row).replace(/\s+/g, " ").trim();
}

function rowMatches(row: HTMLElement, query: string): boolean {
  if (settingsTextMatches(ownRowText(row), query)) return true;
  const extra = row.getAttribute("data-settings-keywords");
  return extra !== null && settingsTextMatches(extra, query);
}

function mark(el: HTMLElement, match: boolean): void {
  if (match) {
    el.removeAttribute("data-settings-search-miss");
    el.setAttribute("data-settings-search-match", "");
    return;
  }
  el.removeAttribute("data-settings-search-match");
  el.setAttribute("data-settings-search-miss", "");
}

/** Drops every mark this module wrote. */
export function clearSettingsSearch(pane: HTMLElement): void {
  pane.removeAttribute("data-settings-filtering");
  for (const el of pane.querySelectorAll<HTMLElement>("[data-settings-search-miss], [data-settings-search-match], [data-settings-search-hit]")) {
    el.removeAttribute("data-settings-search-miss");
    el.removeAttribute("data-settings-search-match");
    el.removeAttribute("data-settings-search-hit");
  }
}

/** A wrapper whose children are all hidden by the search can go too, so a
 * flex gap does not leave a hole. A row that stays (it holds a matching
 * row) and the page title stay. */
function collapseEmpty(pane: HTMLElement): void {
  const nodes = [...pane.querySelectorAll<HTMLElement>("*")].reverse();
  for (const el of nodes) {
    if (el.hasAttribute("data-settings-search-miss") || el.hasAttribute("data-settings-search-match")) continue;
    if (el.matches("h2")) continue;
    const row = el.closest(ROW);
    if (row && !row.hasAttribute("data-settings-search-miss")) continue;
    const kids = [...el.children];
    if (kids.length === 0) continue;
    if (kids.every((kid) => kid.hasAttribute("data-settings-search-miss"))) {
      el.setAttribute("data-settings-search-miss", "");
    }
  }
}

/** Hide the rows of `pane` that do not match `query`, keep their group
 * heading, and mark the first match. A query that matches nothing the page
 * drew (a section keyword with no such row) leaves the page as it was.
 * Returns that first match, or null. */
export function applySettingsSearch(pane: HTMLElement, query: string): HTMLElement | null {
  clearSettingsSearch(pane);
  const q = settingsQuery(query);
  if (!q) return null;

  // Inner groups first, so a group sees only the rows that belong to it.
  const groups = [...pane.querySelectorAll<HTMLElement>(GROUP)].sort((a, b) =>
    a.contains(b) ? 1 : b.contains(a) ? -1 : 0,
  );
  let any = false;
  for (const group of groups) {
    const heading = group.querySelector<HTMLElement>("h3");
    const headingHit = heading !== null && settingsTextMatches(heading.textContent ?? "", q);
    const rows = [...group.querySelectorAll<HTMLElement>(ROW)].filter((row) => row.closest(GROUP) === group);
    for (const row of rows) {
      const match = headingHit || rowMatches(row, q);
      mark(row, match);
      if (match) any = true;
    }
    // A row that holds a matching row has to stay, or the match is hidden with it.
    for (const row of rows) {
      if (row.hasAttribute("data-settings-search-match")) continue;
      if (row.querySelector(`${ROW}[data-settings-search-match]`)) row.removeAttribute("data-settings-search-miss");
    }
    const blocks = [...group.querySelectorAll<HTMLElement>("[data-settings-card], [data-settings-intro], [data-settings-notice]")].filter(
      (el) => el.closest(GROUP) === group && el.querySelector(ROW) === null,
    );
    for (const block of blocks) {
      const match = headingHit || settingsTextMatches(block.textContent ?? "", q);
      mark(block, match);
      if (match) any = true;
    }
    const keptRow = rows.some((row) => !row.hasAttribute("data-settings-search-miss"));
    const keptBlock = blocks.some((block) => block.hasAttribute("data-settings-search-match"));
    if (!headingHit && !keptRow && !keptBlock) group.setAttribute("data-settings-search-miss", "");
  }

  for (const row of pane.querySelectorAll<HTMLElement>(ROW)) {
    if (row.closest(GROUP)) continue;
    const match = rowMatches(row, q);
    mark(row, match);
    if (match) any = true;
    if (!match && row.querySelector(`${ROW}[data-settings-search-match]`)) row.removeAttribute("data-settings-search-miss");
  }

  if (!any) {
    clearSettingsSearch(pane);
    return null;
  }

  pane.setAttribute("data-settings-filtering", "");
  collapseEmpty(pane);
  const first = pane.querySelector<HTMLElement>("[data-settings-search-match]");
  if (first) first.setAttribute("data-settings-search-hit", "");
  return first;
}

/** Move the highlight to the row whose label is `label` and scroll it into
 * view. The highlight is an attribute, so a later React render keeps it. */
export function focusSettingsSearchLabel(pane: HTMLElement, label: string): void {
  for (const row of pane.querySelectorAll<HTMLElement>(`${ROW}[data-settings-search-match]`)) {
    if (row.closest("[data-settings-search-miss]")) continue;
    if (settingsRowLabel(row) !== label) continue;
    const previous = pane.querySelector<HTMLElement>("[data-settings-search-hit]");
    if (previous && previous !== row) previous.removeAttribute("data-settings-search-hit");
    row.setAttribute("data-settings-search-hit", "");
    row.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
}

/** Labels of the rows the last apply kept, in page order, capped. */
export function settingsSearchLabels(pane: ParentNode): string[] {
  const labels: string[] = [];
  for (const row of pane.querySelectorAll<HTMLElement>(`${ROW}[data-settings-search-match]`)) {
    if (row.closest("[data-settings-search-miss]")) continue;
    const label = settingsRowLabel(row);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= 8) break;
  }
  return labels;
}
