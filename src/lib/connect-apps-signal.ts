// When the conversation shows the "Connect apps" pill (2026-10-15, JC, after
// Grok Bot): under the last message, only when the bot needed an app that is
// not connected to do what was asked. Never everywhere: the pill is derived
// from the latest turn (everything after the person's last line) and from
// nothing else. The signals, in order:
//
//   1. A connected-app tool call that FAILED because its app is not connected
//      (a Composio tool, `GMAIL_SEND_EMAIL`, or the executor naming one, whose
//      error says the account or connection is missing). The app is the
//      tool's prefix (`gmail`).
//   2. A connection card the bot asked for (COMPOSIO_MANAGE_CONNECTIONS,
//      kind "connector") that did not end connected: it failed, or the
//      person set it aside. A card still waiting has its own Connect button
//      and does not raise the pill (no two buttons for one app).
//
// An app the inventory knows as connected is dropped, and the pill goes away
// once every app it names is connected, or the person speaks again. A
// running turn shows no pill: it may still connect or recover. Empty
// conversations show none: Sagax has no app suggestion there to reuse.
import type { Message } from "@/state/store";

export interface NeededApp {
  /** Composio toolkit slug, lower case */
  slug: string;
  /** the name the transcript gave it, when it gave one */
  label?: string;
}

/** The executor meta-tool: its input names the tools it runs. */
const EXECUTOR = "COMPOSIO_MULTI_EXECUTE_TOOL";
/** A connected-app tool: TOOLKIT_ACTION in capitals. */
const APP_TOOL = /^([A-Z][A-Z0-9]*)_[A-Z0-9_]+$/;
/** Tool names inside an executor's input. */
const TOOL_IN_TEXT = /\b([A-Z][A-Z0-9]*)_[A-Z0-9]+(?:_[A-Z0-9]+)+\b/g;
/** What a call refused for a missing connection says. */
const NOT_CONNECTED = /\b(?:no (?:active |valid )?(?:connected )?(?:account|connection)s?|not connected|isn'?t connected|connection (?:is )?(?:required|missing|not found)|connected ?account ?(?:not ?found|missing|required)|needs? to (?:be )?connect|(?:auth(?:entication|orization)?|oauth) (?:is )?required|connect (?:your |the )?(?:account|app))/i;

/** The tool's own name, whatever namespace the engine put in front
 * (`mcp__connectors__GMAIL_SEND_EMAIL`, `connectors.GMAIL_SEND_EMAIL`). */
function bareToolName(name: string): string {
  const parts = name.split(/__|[./:]/);
  return parts[parts.length - 1] ?? name;
}

function appsOfFailedCall(message: Message): string[] {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool || tool.ok !== false) return [];
  const said = `${tool.output ?? ""}\n${tool.summary ?? ""}`;
  if (!NOT_CONNECTED.test(said)) return [];
  const name = bareToolName(tool.name);
  if (name === EXECUTOR) {
    const slugs = new Set<string>();
    for (const match of (tool.input ?? "").matchAll(TOOL_IN_TEXT)) {
      if (match[1] !== "COMPOSIO") slugs.add(match[1].toLowerCase());
    }
    return [...slugs];
  }
  const match = APP_TOOL.exec(name);
  return match && match[1] !== "COMPOSIO" ? [match[1].toLowerCase()] : [];
}

/** The apps the latest turn needed and did not have, oldest first. */
export function neededApps(
  messages: readonly Message[],
  options: { busy?: boolean; connected?: (slug: string) => boolean } = {},
): NeededApp[] {
  if (options.busy) return [];
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.kind === "text") break;
    start = index;
  }
  const found = new Map<string, NeededApp>();
  const add = (slug: string, label?: string) => {
    const clean = slug.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(clean)) return;
    const known = found.get(clean);
    if (!known) found.set(clean, label ? { slug: clean, label } : { slug: clean });
    else if (!known.label && label) known.label = label;
  };
  for (const message of messages.slice(start)) {
    if (message.kind === "connector" && message.connector) {
      const card = message.connector;
      if (card.status === "failed" || (card.dismissed && card.status !== "connected")) add(card.slug, card.label);
      // a card that connected answers every earlier miss of its app
      if (card.status === "connected") found.delete(card.slug.toLowerCase());
      continue;
    }
    for (const slug of appsOfFailedCall(message)) add(slug);
  }
  return [...found.values()].filter((app) => !options.connected?.(app.slug));
}
