// Compose "Create new Bot" dispatches `{ type: "newBot" }` and closes: instant
// create, no NewBotDialog, no Start from, no Browse templates.
// Templates live in Browse Bots (sidebar), behind features.templates.
// NewBotDialog stays on Team map → manage a named team → New Bot.
// Unassigned (`data-team-key=""`) has no New Bot: TeamDialog.managing is
// Boolean(section) && !rename, and an empty key is falsy.

import { jsLiteral } from "./js-literal.mjs";
import { clickAccessible, dismissOverlays } from "./ui-click.ts";

export type CatalogFlow = {
  click: (name: string) => Promise<unknown>;
  flag: (assignment: string) => Promise<unknown>;
  snapshot: () => Promise<string>;
};

export type NewBotFlow = {
  click: (name: string) => Promise<unknown>;
  evaluate: (js: string) => Promise<unknown>;
  snapshot: () => Promise<string>;
};

async function until(probe: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`${what} did not appear within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function catalogHome(snap: string): boolean {
  return snap.includes("Import") && snap.includes("Share a team") && !snap.includes('button "Back"');
}

/** Enable the catalog flag, open Browse Bots. Import / Share a team sit on
 * the Templates section of that catalogue (home view, no extra click).
 * If the catalogue is already open, walk Back to home instead of clicking
 * the covered sidebar entry. */
export async function openTemplatesCatalog(flow: CatalogFlow): Promise<void> {
  await flow.flag("features.templates=true");
  const snap = await flow.snapshot();
  if (catalogHome(snap)) return;
  if (snap.includes("Import") || snap.includes("Share a team") || snap.includes("Templates")) {
    await until(async () => {
      const next = await flow.snapshot();
      if (catalogHome(next)) return true;
      if (next.includes('button "Back"')) {
        await flow.click("Back");
        return false;
      }
      return catalogHome(next);
    }, 12_000, "Browse Bots template tools");
    if (catalogHome(await flow.snapshot())) return;
  }
  // Browse Bots sits in the Connect apps window (#594); the sidebar keeps its
  // own entry only on the icon rail.
  if (!(await flow.snapshot()).includes('button "Browse Bots"')) await flow.click("Connect apps");
  await until(async () => (await flow.snapshot()).includes('button "Browse Bots"'), 12_000, "Browse Bots");
  await flow.click("Browse Bots");
  await until(async () => {
    const next = await flow.snapshot();
    if (next.includes('button "Back"')) {
      await flow.click("Back");
      return false;
    }
    return catalogHome(next);
  }, 12_000, "Browse Bots template tools");
}

/** New Bot's first row (newBot.startingRole): a pill menu since #596, no
 * native select. */
export const START_FROM = "Start from";

/** Open Start from if it is closed, then pick the option with this label.
 * True once picked; poll it, the first call only opens the menu. */
export function chooseStartFromJs(label: string): string {
  return `(() => {
    const dialog = [...document.querySelectorAll("[role=dialog]")].at(-1);
    const pill = dialog?.querySelector('button[aria-label="${START_FROM}"]');
    if (!pill || pill.disabled) return false;
    const list = document.querySelector('[role=listbox][aria-label="${START_FROM}"]');
    if (!list) { pill.click(); return false; }
    const option = [...list.querySelectorAll("[role=option]")].find((item) => item.textContent.trim() === ${jsLiteral(label)});
    option?.click();
    return Boolean(option);
  })()`;
}

/** The group headings of the open Start from menu, opening it if needed. */
export function startFromGroupsJs(): string {
  return `(() => {
    const dialog = [...document.querySelectorAll("[role=dialog]")].at(-1);
    const list = document.querySelector('[role=listbox][aria-label="${START_FROM}"]');
    if (!list) { dialog?.querySelector('button[aria-label="${START_FROM}"]')?.click(); return null; }
    return [...list.querySelectorAll("[data-pill-group]")].map((heading) => heading.textContent.trim()).join(" | ");
  })()`;
}

/** NewBotDialog with Start from: Team map, a named team, New Bot. */
export async function openNewBotDialog(flow: NewBotFlow): Promise<void> {
  const hasStartingRole = async () => (await flow.snapshot()).includes(START_FROM);
  const createBotReady = async () => Boolean(await flow.evaluate(`Boolean([...document.querySelectorAll("[role=dialog] button")].find((button) => (button.textContent || "").trim() === "Create bot"))`));
  if (await hasStartingRole() && await createBotReady()) return;
  await dismissOverlays(flow, (snap) => snap.includes(START_FROM) && snap.includes("Create bot"));
  const click = (name: string) => clickAccessible(flow, name);

  const hasNewBot = async () => {
    const snap = await flow.snapshot();
    return snap.includes("New Bot") && (snap.includes("Add or remove bots") || snap.includes("Add bots") || snap.includes("Existing bots"));
  };
  if (await hasNewBot()) {
    await click("New Bot");
    await until(hasStartingRole, 12_000, "New Bot dialog");
    return;
  }

  const onTeamMap = async () => Boolean(await flow.evaluate(`Boolean(document.querySelector("[data-team-key]"))`));
  if (!(await onTeamMap())) {
    await click("You");
    await click("Team map");
    await until(onTeamMap, 12_000, "Team map");
  }

  const namedTeam = async () => (await flow.evaluate(`([...document.querySelectorAll("[data-team-key]")].map((el) => el.getAttribute("data-team-key")).find(Boolean) || "")`)) as string;
  let team = await namedTeam();
  if (!team) {
    await flow.evaluate(`(() => {
      const summary = document.querySelector('summary[aria-label="Add to team map"]');
      if (!summary) throw new Error("Add to team map is missing");
      const details = summary.parentElement;
      if (details && !("open" in details && details.open)) summary.click();
      return true;
    })()`);
    await until(async () => (await flow.snapshot()).includes("Create team"), 10_000, "Create team");
    await click("Create team");
    await until(async () => Boolean(await flow.evaluate(`Boolean(document.querySelector("[role=dialog] input"))`)), 10_000, "Team name");
    await flow.evaluate(`(() => {
      const input = document.querySelector("[role=dialog] input");
      if (!(input instanceof HTMLInputElement)) throw new Error("Team name is missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Desk");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value;
    })()`);
    await click("Create team");
    await until(async () => Boolean(await flow.evaluate(`Boolean(document.querySelector('[data-team-key="Desk"]'))`)), 12_000, "Desk team");
    team = "Desk";
  }

  await flow.evaluate(`(() => {
    const summary = document.querySelector(${JSON.stringify(`[data-team-key="${team}"] summary`)})
      || document.querySelector('summary[aria-label^="Manage "]');
    if (!summary) throw new Error("no named team to manage");
    const details = summary.parentElement;
    if (details && !("open" in details && details.open)) summary.click();
    return true;
  })()`);
  const move = `Move bots to ${team}`;
  await until(async () => (await flow.snapshot()).includes(move), 10_000, move);
  await click(move);
  await until(async () => (await flow.snapshot()).includes("New Bot"), 10_000, "New Bot");
  await click("New Bot");
  await until(hasStartingRole, 12_000, "New Bot dialog");
}
