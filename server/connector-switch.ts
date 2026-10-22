// A request that needs a mail, calendar, Teams or SharePoint connector the
// bot's engine lacks runs, for that request only, on another engine of the
// same person that has it (JC 2026-10-21, review of #943): same bot, same
// thread, one line "Passé à Claude pour Gmail". The candidates are the
// engines this turn's payer may use (index.ts autoEnginesFor: allowed
// engines and models, approval level, cost) and each engine's reach counts
// only on the person's own sign-in (harness-connectors.ts
// accountConnectorsForTurn), so a switch never borrows someone else's
// mailbox. Approval cards are unchanged. Pure: the server passes the facts.
import { claudeAiConnectorCapabilities, type ConnectorCapability, GROK_CONNECTOR_CAPABILITY_BY_NAME } from "../shared/engine-connectors.ts";

export interface SwitchEngine {
  instanceId: string;
  engineLabel: string;
  models: readonly string[];
  defaultModel?: string;
  /** The connectors this engine reaches for this person, by name. */
  reach: ReadonlyArray<{ connector: string }>;
}

export interface ConnectorSwitch {
  instanceId: string;
  model: string;
  engineLabel: string;
  connector: string;
}

/** What a connector reaches, from its name (claude.ai or Grok catalog). */
function capabilitiesOf(connector: string): ConnectorCapability[] {
  return GROK_CONNECTOR_CAPABILITY_BY_NAME.get(connector) ?? claudeAiConnectorCapabilities(connector);
}

/** The services a named one is served by: Microsoft 365 answers Outlook,
 * Teams, SharePoint and OneDrive; Gmail only Gmail. */
const HINT_SERVED_BY: Record<string, RegExp> = {
  Gmail: /gmail/i,
  Outlook: /outlook|exchange|microsoft\s*365/i,
  Teams: /teams|microsoft\s*365/i,
  SharePoint: /sharepoint|microsoft\s*365/i,
  OneDrive: /onedrive|microsoft\s*365/i,
  "Google Calendar": /google\s*calendar/i,
};

function reaches(engine: SwitchEngine, need: { capability: ConnectorCapability; hint?: string }): string | undefined {
  const served = need.hint ? HINT_SERVED_BY[need.hint] : undefined;
  return engine.reach.find(({ connector }) => capabilitiesOf(connector).includes(need.capability) && (!served || served.test(connector)))?.connector;
}

export function pickConnectorSwitch(input: {
  need: { capability: ConnectorCapability; hint?: string } | null;
  current: SwitchEngine;
  candidates: readonly SwitchEngine[];
}): ConnectorSwitch | null {
  const { need } = input;
  if (!need || reaches(input.current, need)) return null;
  for (const engine of input.candidates) {
    if (engine.instanceId === input.current.instanceId) continue;
    const connector = reaches(engine, need);
    if (!connector) continue;
    const model = engine.defaultModel && engine.models.includes(engine.defaultModel) ? engine.defaultModel : engine.models[0];
    if (!model) continue;
    return { instanceId: engine.instanceId, model, engineLabel: engine.engineLabel, connector };
  }
  return null;
}

/** The English line, for clients that do not draw `tool.connectorSwitch`. */
export function connectorSwitchText(line: { engine: string; connector: string }): string {
  return `Switched to ${line.engine} for ${line.connector}.`;
}
