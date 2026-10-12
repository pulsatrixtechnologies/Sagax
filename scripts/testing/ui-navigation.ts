/** Shared UI harness steps after sidebar / catalogue changes (2026-10). */

type Api = (path: string, method?: string, body?: unknown) => Promise<unknown>;

export async function enableBrowseBots(api: Api): Promise<void> {
  await api("/api/config", "PATCH", { features: { templates: true } });
}

/** Opens the compose picker from the sidebar head control. */
export async function openCompose(click: (name: string) => Promise<unknown>): Promise<void> {
  await click("New");
}

/** Browse Bots on the Templates section (needs enableBrowseBots first). */
export async function openTemplatesCatalog(
  click: (name: string) => Promise<unknown>,
  evaluate: (js: string) => Promise<unknown>,
): Promise<void> {
  await evaluate(`(async () => {
    const store = await import("/src/state/store.tsx");
    const config = await fetch("/api/config").then((response) => response.json());
    store.dispatch({ type: "configStatus", config });
    store.dispatch(store.openBotCatalog({ section: "templates" }));
    return true;
  })()`);
  await click("Templates");
}

/** Team map → Create team (solo server sections). */
export async function openCreateTeamDialog(click: (name: string) => Promise<unknown>): Promise<void> {
  await click("You");
  await click("Team map");
  await click("Create team");
}
