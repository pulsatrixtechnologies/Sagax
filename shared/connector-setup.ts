// "Connect Microsoft Teams" from the chat (JC 2026-10-22, after Sagax 0.7.2:
// "peux tu le connecter" took 13 tool calls and ended in "I can't"). The
// bot calls open_connector_setup once; Sagax posts a card whose one button
// opens the page where the person signs in, in their own browser:
//
//   - a Grok bot on the person's own xAI account: grok.com/connectors (xAI
//     documents no per-connector deep link: "New Connector", then the app);
//   - a Claude bot on the person's own subscription: claude.ai Customize >
//     Connectors;
//   - otherwise Sagax's own Connect apps card (Composio), when it knows the app.
//
// Sagax never holds a token for these and never signs anyone in. An engine
// account that belongs to someone else (the payer is not the speaker,
// review of #943) is refused: the person would connect an account the turn
// is not theirs to use. The card says "Connecté" only on evidence: the
// claude.ai inventory read again, or a successful call to that connector in
// the conversation after the card. Grok has no API that says which
// connectors an account connected, so a Grok card stays "pending" until a
// call succeeds.
import { claudeAiConnectorCapabilities, grokConnectorCapabilities, type ConnectorCapability } from "./engine-connectors.ts";
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "./grok-cloud-connectors.ts";
import { composioSlugFor } from "./grok-import.ts";
import { containsUuid, isOpaqueId } from "./human-id.ts";

/** Where a person adds, signs in to and removes their claude.ai connectors. */
export const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/** The only hosts a setup card may open. */
const SETUP_HOSTS = new Set(["grok.com", "claude.ai"]);

export type ConnectorSetupProvider = "grok" | "claude";

export interface ConnectorSetupTarget {
  /** a stable id: the Grok catalog id when there is one, else the cleaned name */
  id: string;
  label: string;
  /** the xAI cloud connector id (shared/grok-cloud-connectors.ts) */
  grok?: string;
  /** the Composio toolkit slug, when Sagax knows one */
  composio?: string;
  /** what it reaches, to read the claude.ai inventory by service */
  capabilities: ConnectorCapability[];
}

export interface ConnectorSetupView {
  /** cs_ + 18 hex */
  id: string;
  connector: string;
  label: string;
  provider: ConnectorSetupProvider;
  /** grok.com or claude.ai only (isConnectorSetupUrl) */
  url: string;
  /** waiting: not checked yet; pending: checked, no evidence yet; connected: evidence */
  status: "waiting" | "pending" | "connected";
  /** A digest of the person the card is for (server/routes/connector-setup.ts), never their id. */
  owner: string;
  createdAt: number;
  checkedAt?: number;
}

const ALIASES: Array<[RegExp, string]> = [
  [/^(?:microsoft[\s_-]*teams|ms[\s_-]*teams|teams)$/, "microsoft-teams"],
  [/^(?:outlook|microsoft outlook|outlook \(exchange\)|exchange|outlook mail|hotmail)$/, "outlook"],
  [/^(?:gmail|google mail)$/, "gmail"],
  [/^(?:google[\s_-]*drive|gdrive|drive)$/, "google-drive"],
  [/^(?:one[\s_-]*drive)$/, "onedrive"],
  [/^(?:share[\s_-]*point)$/, "sharepoint"],
  [/^salesforce$/, "salesforce"],
  [/^(?:x|twitter|x \(twitter\))$/, "x"],
];

const COMPOSIO_BY_ID: Record<string, string> = {
  "microsoft-teams": "microsoft_teams",
  outlook: "outlook",
  gmail: "gmail",
  "google-drive": "googledrive",
  salesforce: "salesforce",
  x: "twitter",
};

function cleanName(raw: string): string {
  // oxlint-disable-next-line no-control-regex -- control characters never belong in a name on screen
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

/** The connector a person named ("Teams", "Microsoft Teams", "gmail"), or null. */
export function resolveConnectorSetupTarget(raw: string): ConnectorSetupTarget | null {
  const label = cleanName(raw);
  // a name on screen, never an id (AGENTS.md "Never a UUID/GUID on screen")
  if (!label || containsUuid(label) || isOpaqueId(label)) return null;
  const key = label.toLowerCase();
  const id = ALIASES.find(([pattern]) => pattern.test(key))?.[1];
  const grok = id ? GROK_CLOUD_CONNECTORS.find((connector) => connector.id === id) : undefined;
  if (grok) {
    return {
      id: grok.id,
      label: grok.id === "outlook" ? "Outlook" : grok.name,
      grok: grok.id,
      ...(COMPOSIO_BY_ID[grok.id] ? { composio: COMPOSIO_BY_ID[grok.id] } : {}),
      capabilities: grokConnectorCapabilities(grok.id),
    };
  }
  const composio = composioSlugFor(label);
  return {
    id: key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app",
    label,
    ...(composio ? { composio } : {}),
    capabilities: claudeAiConnectorCapabilities(label),
  };
}

export type ConnectorSetupRoute =
  | { route: ConnectorSetupProvider; url: string }
  | { route: "composio"; slug: string }
  | { refusal: "foreign" | "not_on_engine" | "no_route" };

/** Where the person signs in. Engine connectors first (JC 2026-10-21), on
 * the person's own engine account only; Sagax's Connect apps otherwise. */
export function chooseConnectorSetupRoute(input: {
  target: ConnectorSetupTarget;
  /** the engine the bot runs on */
  engine: "grok" | "claude" | "other";
  /** server/harness-connectors.ts accountConnectorsForTurn */
  account: "own" | "foreign" | "none";
  /** Sagax's Connect apps (Composio) are on for this bot */
  composio: boolean;
  prefer?: ConnectorSetupProvider | "composio";
}): ConnectorSetupRoute {
  const { target } = input;
  if (input.account === "foreign" && input.engine !== "other") return { refusal: "foreign" };
  const engineRoute: ConnectorSetupRoute | null = input.account !== "own" ? null
    : input.engine === "grok" ? (target.grok ? { route: "grok", url: GROK_CONNECTORS_URL } : null)
      : input.engine === "claude" ? { route: "claude", url: CLAUDE_AI_CONNECTORS_URL }
        : null;
  const composioRoute: ConnectorSetupRoute | null = input.composio && target.composio ? { route: "composio", slug: target.composio } : null;
  if (input.prefer === "composio" && composioRoute) return composioRoute;
  if (engineRoute) return engineRoute;
  if (composioRoute) return composioRoute;
  if (input.account === "own" && input.engine === "grok") return { refusal: "not_on_engine" };
  return { refusal: "no_route" };
}

/** https on grok.com or claude.ai, no credentials in the URL. */
export function isConnectorSetupUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && SETUP_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
}

interface ActivityLike {
  kind?: string;
  at?: number;
  tool?: { name?: string; ok?: boolean; input?: string };
}

const claudeServerOf = (name: string) => /^mcp__claude_ai_([A-Za-z0-9_.-]+?)__/.exec(name)?.[1]?.replace(/_/g, " ");

/** A successful call to this connector in the conversation after the card. */
export function connectorSetupEvidence(messages: readonly ActivityLike[], view: Pick<ConnectorSetupView, "provider" | "connector" | "label" | "createdAt">): boolean {
  const target = resolveConnectorSetupTarget(view.label) ?? resolveConnectorSetupTarget(view.connector);
  if (!target) return false;
  const grokPrefix = target.grok ? `${target.grok.replace(/-/g, "_")}__` : null;
  return messages.some((message) => {
    const tool = message.tool;
    if (message.kind !== "activity" || !tool || tool.ok !== true || (message.at ?? 0) <= view.createdAt) return false;
    const names = [tool.name ?? ""];
    try {
      const parsed = JSON.parse(tool.input ?? "") as { tool_name?: unknown };
      if (typeof parsed?.tool_name === "string") names.push(parsed.tool_name);
    } catch {
      // not JSON: only the name counts
    }
    return names.some((name) => {
      if (view.provider === "grok") return Boolean(grokPrefix) && name.toLowerCase().replace(/^mcp__/, "").startsWith(grokPrefix!);
      const server = claudeServerOf(name);
      return Boolean(server) && claudeServiceMatches(server!, target);
    });
  });
}

function claudeServiceMatches(service: string, target: ConnectorSetupTarget): boolean {
  if (service.trim().toLowerCase() === target.label.toLowerCase()) return true;
  const reaches = claudeAiConnectorCapabilities(service);
  if (!target.capabilities.length) return false;
  // Microsoft 365 reaches Teams; Gmail does not reach Teams
  return target.capabilities.every((capability) => reaches.includes(capability));
}

/** The claude.ai inventory (GET /api/me/harness-connectors) shows this connector connected. */
export function claudeInventoryShowsConnected(connectors: readonly { name: string; status: string }[], target: ConnectorSetupTarget): boolean {
  return connectors.some((connector) => connector.status === "connected" && claudeServiceMatches(connector.name, target));
}

const HOST_LABEL: Record<ConnectorSetupProvider, string> = { grok: "grok.com", claude: "claude.ai" };

/** The row's text: what clients without the card draw (phones, exports). */
export function connectorSetupText(view: Pick<ConnectorSetupView, "label" | "provider" | "url">, language: "fr" | "en"): string {
  const link = `[${HOST_LABEL[view.provider]}](${view.url})`;
  return language === "fr" ? `Connectez ${view.label} sur ${link}.` : `Connect ${view.label} on ${link}.`;
}
