// A neutral adapter: code outside Sagax answers a bot's turn.
// The host passes a run function. This file names no outside product.

export interface ExternalTurn {
  message: string;
}

export interface ExternalTurnResult {
  text: string;
}

export interface ExternalAgent {
  id: string;
  name: string;
  run(turn: ExternalTurn): Promise<ExternalTurnResult>;
}

export interface ExternalBot {
  id: string;
  name: string;
  driver: "external";
}

const agents = new Map<string, ExternalAgent>();

function check(agent: ExternalAgent): { id: string; name: string } {
  const id = agent.id.trim();
  const name = agent.name.trim();
  if (!id || id.length > 80 || !/^[\w.-]+$/.test(id)) throw new Error("An external agent needs an id made of letters, digits, dots, or dashes.");
  if (!name || name.length > 80) throw new Error("An external agent needs a name.");
  if (typeof agent.run !== "function") throw new Error("An external agent needs a run function.");
  return { id, name };
}

/** Remember the agent and hand back the bot Sagax will call. */
export function adoptExternalAgent(agent: ExternalAgent): ExternalBot {
  const { id, name } = check(agent);
  agents.set(id, agent);
  return { id, name, driver: "external" };
}

export function listExternalBots(): ExternalBot[] {
  return [...agents.values()].map((agent) => ({ id: agent.id.trim(), name: agent.name.trim(), driver: "external" as const }));
}

export function forgetExternalAgent(id: string): void {
  agents.delete(id);
}

/** One turn of that bot. The text is whatever run returned. */
export async function runExternalBot(id: string, message: string): Promise<ExternalTurnResult> {
  const agent = agents.get(id);
  if (!agent) throw new Error("No external bot with that id.");
  const result = await agent.run({ message });
  if (!result || typeof result.text !== "string") throw new Error("The external bot returned no text.");
  return { text: result.text };
}
