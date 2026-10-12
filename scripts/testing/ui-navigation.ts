/** Shared UI harness steps after sidebar / catalogue changes (2026-10). */

type Api = (path: string, method?: string, body?: unknown) => Promise<unknown>;

export async function enableBrowseBots(api: Api): Promise<void> {
  await api("/api/config", "PATCH", { features: { templates: true } });
}

/** Opens the compose picker from the sidebar head control. */
export async function openCompose(click: (name: string) => Promise<unknown>): Promise<void> {
  await click("New");
}

/** Browse Bots on its home view (needs enableBrowseBots first). The config
 * frame puts the sidebar row in place; the catalogue is a click, not a
 * store import. Import and Share a team sit on that home view. */
export async function openTemplatesCatalog(
  click: (name: string) => Promise<unknown>,
  evaluate: (js: string) => Promise<unknown>,
): Promise<void> {
  const open = async () => {
    const text = String(await evaluate("document.body.innerText"));
    return text.includes("Share a team") || text.includes("Community templates");
  };
  if (await open()) return;
  const deadline = Date.now() + 12_000;
  let clicked = false;
  while (Date.now() < deadline) {
    if (await open()) return;
    if (!clicked) {
      try {
        await click("Browse Bots");
        clicked = true;
      } catch {
        // The sidebar row appears once the config frame lands.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Browse Bots did not open");
}

/** Team map → Create team (solo server sections). */
export async function openCreateTeamDialog(click: (name: string) => Promise<unknown>): Promise<void> {
  await click("You");
  await click("Team map");
  await click("Create team");
}
