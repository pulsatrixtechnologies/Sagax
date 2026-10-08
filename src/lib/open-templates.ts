// Open the bot templates (the Templates library the sidebar owns) from
// elsewhere, such as Connect apps' "Bot templates". The sidebar listens.
export const OPEN_TEMPLATES_EVENT = "sagax:open-templates";

export function requestTemplates(): void {
  window.dispatchEvent(new Event(OPEN_TEMPLATES_EVENT));
}
