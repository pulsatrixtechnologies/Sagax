// Opt-in usage measure. The schema is closed: an unknown name or property
// is dropped. An event never carries a person's name, an address, or free text.

export const USAGE_EVENTS = ["app_opened", "message_sent", "bot_created", "settings_opened"] as const;
export type UsageEventName = (typeof USAGE_EVENTS)[number];

const SURFACES = ["desktop", "web"] as const;
const SECTIONS = ["account", "models", "bots", "other"] as const;

export interface UsageEvent {
  name: UsageEventName;
  props: Record<string, string>;
}

const PROP_KEYS: Record<UsageEventName, readonly string[]> = {
  app_opened: ["surface"],
  message_sent: ["queued"],
  bot_created: [],
  settings_opened: ["section"],
};

function oneOf(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

/** The properties the schema allows for this name. Anything else is left out. */
export function usageProps(name: UsageEventName, props: unknown): Record<string, unknown> {
  const raw = props && typeof props === "object" && !Array.isArray(props) ? props as Record<string, unknown> : {};
  const keys = PROP_KEYS[name];
  return Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]]));
}

/** A closed event, or null when the name or a property is not in the schema. */
export function usageEvent(name: unknown, props: unknown): UsageEvent | null {
  if (typeof name !== "string" || !(USAGE_EVENTS as readonly string[]).includes(name)) return null;
  const eventName = name as UsageEventName;
  const raw = props && typeof props === "object" && !Array.isArray(props) ? props as Record<string, unknown> : {};
  const allowed = new Set(PROP_KEYS[eventName]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  const clean: Record<string, string> = {};
  if (eventName === "app_opened") {
    const surface = oneOf(raw.surface, SURFACES);
    if (!surface) return null;
    clean.surface = surface;
  } else if (eventName === "message_sent") {
    if (raw.queued !== true && raw.queued !== false && raw.queued !== "true" && raw.queued !== "false") return null;
    clean.queued = raw.queued === true || raw.queued === "true" ? "true" : "false";
  } else if (eventName === "settings_opened") {
    const section = oneOf(raw.section, SECTIONS);
    if (!section) return null;
    clean.section = section;
  }
  return { name: eventName, props: clean };
}
