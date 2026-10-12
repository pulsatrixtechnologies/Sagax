// Compose "Create new Bot" dispatches `{ type: "newBot" }` and closes: instant
// create, no NewBotDialog, no Starting role, no Browse templates.
// Templates live in Browse Bots (sidebar), behind features.templates.
// NewBotDialog stays on Team map → manage a named team → New Bot.
// Unassigned (`data-team-key=""`) has no New Bot: TeamDialog.managing is
// Boolean(section) && !rename, and an empty key is falsy.

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
  await until(async () => (await flow.snapshot()).includes("Browse Bots"), 12_000, "Browse Bots");
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

/** NewBotDialog with Starting role: Team map, a named team, New Bot. */
export async function openNewBotDialog(flow: NewBotFlow): Promise<void> {
  const hasStartingRole = async () => (await flow.snapshot()).includes("Starting role");
  const createBotReady = async () => Boolean(await flow.evaluate(`Boolean([...document.querySelectorAll("[role=dialog] button")].find((button) => (button.textContent || "").trim() === "Create bot"))`));
  if (await hasStartingRole() && await createBotReady()) return;
  await dismissOverlays(flow, (snap) => snap.includes("Starting role") && snap.includes("Create bot"));
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
