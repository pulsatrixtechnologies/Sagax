// Reachability guard: a tool the bot is told about is a tool it is given.
//
// A person asked their bot for a public page. The bot knew propose_page
// existed (its self-knowledge and save_artifact's description said so) but
// the tool was not in its list: a person's ordinary direct chat coordinates
// (server/index.ts boundedCoordination sets SAGAX_ROOM_TURN), and the catalog
// dropped propose_page from every coordinating turn as if it were a room.
//
// This file pins the real turns server/index.ts agentsIntegration() builds
// and fails when:
// 1. a tool description or schema names another catalog tool the same turn
//    is not shown (steering to a tool the bot cannot call);
// 2. the self-knowledge base (sagax_help) says a tool is available in a turn
//    where it is not.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv, PERSPICAX_TOOLS } from "./agents-catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
type Tool = { name: string; description: string; inputSchema?: unknown };
type Env = Record<string, string>;

/** The turns agentsIntegration() builds, by the switches that change the list. */
const TURNS: Record<string, Env> = {
  // a person's own message in a 1:1 chat: bounded coordination, may open its own jobs
  "direct": { SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1", SAGAX_AGENT_API: "1" },
  // the same chat resumed by a card: no own jobs
  "direct-card": { SAGAX_ROOM_TURN: "1", SAGAX_AGENT_API: "1" },
  // a room (group conversation): no agent-to-agent API there
  "room": { SAGAX_ROOM_TURN: "1", SAGAX_GROUP_TURN: "1" },
  // a routine run, or a delegated turn: no bounded coordination
  "routine": { SAGAX_ROOM_TURN: "0", SAGAX_AGENT_API: "1" },
};
const ROLES: Record<string, Env> = { chief: { SAGAX_CHIEF_OF_STAFF: "1" }, member: { SAGAX_CHIEF_OF_STAFF: "0" } };

const tools = (env: Env): Tool[] => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })) as Tool[];
const names = (env: Env) => new Set(tools(env).map((tool) => tool.name));

/** Every switch on: the widest catalog, to know what is a catalog tool name. */
const EVERY_SWITCH: Env = {
  SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_MEETINGS: "1",
  SAGAX_SINGLE_STREAM: "1", SAGAX_ROUTE_MESSAGES: "1", SAGAX_VOICE_CALL: "1", SAGAX_GITHUB_CONNECT: "1", SAGAX_GROUP_MEMORY: "1",
  SAGAX_CREATE_BOTS: "1", SAGAX_PERSPICAX_TOOLS: "1", SAGAX_CLAIMS: "1", SAGAX_WEB_SEARCH: "1", SAGAX_VAULT_HTTP: "1",
};
const CATALOG_NAMES = new Set<string>(PERSPICAX_TOOLS.map((tool) => tool.name));
for (const turn of Object.values(TURNS)) for (const role of Object.values(ROLES)) {
  for (const name of names({ ...turn, ...role, ...EVERY_SWITCH })) CATALOG_NAMES.add(name);
  for (const name of names({ ...turn, ...role })) CATALOG_NAMES.add(name);
}

/** Names mentioned only as a fact, never as "use it": reviewed one by one. */
const INFORMATIONAL: ReadonlyArray<[tool: string, mentions: string]> = [
  // "A temporary agent (create_agent) archived is gone for good."
  ["archive_bot", "create_agent"],
  // "with the handle send_prompt or send_to_bot gave": either one
  ["await_turn", "send_to_bot"],
  ["await_turn", "send_prompt"],
];

function mentionedTools(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]).filter((name) => CATALOG_NAMES.has(name)))];
}

describe("reachability guard: the turns a person really has", () => {
  it("offers propose_page in a person's direct chat and routines, for every role, never in a room", () => {
    for (const role of Object.values(ROLES)) {
      expect(names({ ...TURNS.direct, ...role })).toContain("propose_page");
      expect(names({ ...TURNS["direct-card"], ...role })).toContain("propose_page");
      expect(names({ ...TURNS.routine, ...role })).toContain("propose_page");
      expect(names({ ...TURNS.room, ...role })).not.toContain("propose_page");
    }
  });

  it("names, in each tool's description and schema, only tools the same turn is shown", () => {
    const problems: string[] = [];
    for (const [turnName, turn] of Object.entries(TURNS)) for (const [roleName, role] of Object.entries(ROLES)) {
      for (const extra of [{}, EVERY_SWITCH]) {
        const list = tools({ ...turn, ...role, ...extra });
        const shown = new Set(list.map((tool) => tool.name));
        for (const tool of list) {
          for (const name of mentionedTools(`${tool.description} ${JSON.stringify(tool.inputSchema ?? {})}`)) {
            if (shown.has(name) || INFORMATIONAL.some(([from, to]) => from === tool.name && to === name)) continue;
            problems.push(`${turnName}/${roleName}${extra === EVERY_SWITCH ? "/all-switches" : ""}: ${tool.name} names ${name}, not shown`);
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});

/** What a self-knowledge `where` label promises: the turns that must show the tool. */
const ALL_TURNS = Object.keys(TURNS);
function promisedTurns(where: string): { turns: string[]; env: Env; roles: string[] } | null {
  const label = where.replace(/^bot tool, /, "");
  const flag = (env: Env, roles = Object.keys(ROLES)) => ({ turns: ["direct"], env, roles });
  if (label === "every conversation") return { turns: ALL_TURNS, env: {}, roles: Object.keys(ROLES) };
  if (label === "not in rooms") return { turns: ["direct", "direct-card", "routine"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in routines and delegated turns only")) return { turns: ["routine"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in routines and delegated turns; in a person's chat when they ask for separate jobs")) return { turns: ["routine", "direct"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in a person's chat or a room")) return { turns: ["direct", "direct-card", "room"], env: {}, roles: Object.keys(ROLES) };
  if (label.startsWith("in a room whose shared memory is on")) return { turns: ["room"], env: { SAGAX_GROUP_MEMORY: "1" }, roles: Object.keys(ROLES) };
  if (label.startsWith("for a Primary Bot with the agent-to-agent API")) return flag({}, ["chief"]);
  if (label.startsWith("for a Primary Bot only")) return { turns: ALL_TURNS, env: {}, roles: ["chief"] };
  if (label.startsWith("with the agent-to-agent API (direct turns)")) return flag({});
  if (label.startsWith("on an organization server linked to Perspicax")) return flag({ SAGAX_PERSPICAX_TOOLS: "1" });
  if (label.startsWith("when a Perspicax profile is mounted for the person speaking")) return flag({ SAGAX_CLAIMS: "1" });
  if (label.startsWith("when the bot has a voice configured")) return flag({ SAGAX_VOICE_NOTES: "1" });
  if (label.startsWith("during a live phone call")) return flag({ SAGAX_VOICE_CALL: "1" });
  if (label.startsWith("when Settings > Experimental > Meeting notetaker is on")) return flag({ SAGAX_MEETINGS: "1" });
  if (label.startsWith("when computer sharing is on")) return flag({ SAGAX_SHARED_COMPUTERS_ENABLED: "1" });
  if (label.startsWith("when skill authoring is on")) return flag({ SAGAX_SKILL_AUTHORING_ENABLED: "1" });
  if (label.startsWith("in a single-stream conversation")) return flag({ SAGAX_SINGLE_STREAM: "1" });
  if (label.startsWith("when the bot routes messages sent while it is busy")) return flag({ SAGAX_ROUTE_MESSAGES: "1" });
  return null;
}

describe("reachability guard: the self-knowledge base (sagax_help)", () => {
  const knowledge = JSON.parse(readFileSync(join(HERE, "..", "self-knowledge", "knowledge.generated.json"), "utf8")) as {
    sections: Array<{ id: string; kind: string; where?: string; text: string }>;
  };
  const toolSections = knowledge.sections.filter((section) => section.kind === "tool");

  it("shows every tool in each turn its entry says it is available in", () => {
    const problems: string[] = [];
    for (const section of toolSections) {
      const name = section.id.replace(/^tool:/, "");
      const promise = promisedTurns(section.where ?? "");
      if (!promise) {
        problems.push(`${section.id}: unknown availability "${section.where}" (classify it in promisedTurns)`);
        continue;
      }
      for (const turn of promise.turns) for (const role of promise.roles) {
        if (!names({ ...TURNS[turn], ...ROLES[role], ...promise.env }).has(name)) problems.push(`${section.id} (${section.where}): not shown in ${turn}/${role}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("describes only catalog tools a turn can be shown", () => {
    const missing = toolSections.map((section) => section.id.replace(/^tool:/, "")).filter((name) => !CATALOG_NAMES.has(name) && name !== "make_video");
    expect(missing).toEqual([]);
  });
});
