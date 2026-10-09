// A connected app's Tools card: one switch per tool for the whole workspace
// (server/connector-tool-switches.ts). Every tool not listed as off is on;
// a bot's own grants still narrow what it may call.
import { api } from "@/state/store";

export interface ConnectorToolListing {
  name: string;
  description?: string;
}

export interface ConnectorToolsInventory {
  services: Record<string, ConnectorToolListing[]>;
  disabledTools: Record<string, string[]>;
}

export interface ConnectorToolRow extends ConnectorToolListing {
  enabled: boolean;
}

/** The app's tools with their switch, in the order the catalog lists them. */
export function connectorToolRows(inventory: ConnectorToolsInventory, slug: string): ConnectorToolRow[] {
  const off = new Set(inventory.disabledTools[slug] ?? []);
  return (inventory.services[slug] ?? []).map((tool) => ({ ...tool, enabled: !off.has(tool.name) }));
}

/** The app's list of tools off after one switch moves. */
export function toggledDisabledTools(current: readonly string[] | undefined, tool: string, enabled: boolean): string[] {
  const next = new Set(current ?? []);
  if (enabled) next.delete(tool);
  else next.add(tool);
  return [...next].sort();
}

export async function loadConnectorTools(): Promise<ConnectorToolsInventory> {
  const response = await api<{ services?: Record<string, ConnectorToolListing[]>; disabledTools?: Record<string, string[]> }>("/api/connectors/tools");
  return { services: response.services ?? {}, disabledTools: response.disabledTools ?? {} };
}

export async function saveDisabledTools(slug: string, disabledTools: string[]): Promise<Record<string, string[]>> {
  const response = await api<{ disabledTools?: Record<string, string[]> }>(`/api/connectors/${encodeURIComponent(slug)}/tools`, {
    method: "PUT",
    body: JSON.stringify({ disabledTools }),
  });
  return response.disabledTools ?? {};
}
