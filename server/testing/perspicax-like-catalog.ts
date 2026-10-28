// A synthetic MCP catalog shaped like a Perspicax profile of a managed
// services organization (#1276): ten connectors, each with a big read tool
// (its resource list and filter guide in the description), a write tool and
// an action tool, plus the connector-wide helpers (api_search, api_describe,
// result queries, memory, agents). Sizes follow what such a profile sends:
// about 150 tools and 300 KB of JSON. No real data: every name is made up.

const CONNECTORS = [
  "psa", "endpoint", "backup", "rmm", "docs", "phone", "sms", "vpn", "quotes", "mail",
];

const GUIDE = "Filters: keys are field paths with dots; a value is a scalar or one operator object. "
  + "A reference is compared through a subfield (company.id, owner.identifier). Users type partial names: use contains. "
  + "Without limit only the first 25 rows come back; pass limit up to 1000. order takes a field, or field desc. ";

function resourceList(connector: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${connector}_resource_${index}`);
}

function queryTool(connector: string) {
  const resources = resourceList(connector, 120);
  return {
    name: `${connector}__query`,
    description: `Read any of the ${resources.length} resources of ${connector}; pass resource, then filter, fields, order, limit, cursor, or id for one object.\n${GUIDE.repeat(6)}\nResources:\n${resources.slice(0, 40).map((resource) => `- ${resource}: ${connector}__query resource ${resource}`).join("\n")}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["resource"],
      properties: {
        resource: { type: "string", enum: resources, description: "resource name from the model" },
        filter: { type: "object", additionalProperties: true, description: "field to scalar (equality) or to { eq, ne, in, contains, gt, gte, lt, lte, between }" },
        fields: { type: ["array", "string"], items: { type: "string" }, description: "fields each item keeps" },
        order: { type: "string", description: "field, or field desc" },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "elements wanted; above one page the connector iterates" },
        cursor: { type: "string", description: "next of a previous result" },
        id: { type: ["string", "integer"], description: "select one object by id" },
        parent: { type: ["string", "integer", "array"], items: { type: ["string", "integer"] }, description: "id of the parent object" },
      },
    },
  };
}

function writeTool(connector: string) {
  return {
    name: `${connector}__write`,
    description: `Write any of the resources of ${connector}: pass resource, action (create, update or delete), id, parent, set and expect.\n${GUIDE.repeat(3)}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["resource", "action"],
      properties: {
        resource: { type: "string", description: "resource name from the model" },
        action: { type: "string", enum: ["create", "update", "delete"] },
        id: { type: ["string", "integer"] },
        set: { type: "object", additionalProperties: true, description: "fields to write" },
        expect: { type: "object", additionalProperties: true, description: "fields that must match first" },
        _dry_run: { type: "boolean" },
      },
    },
  };
}

function smallTool(name: string, description: string) {
  return {
    name,
    description: `${description} ${GUIDE}`,
    inputSchema: { type: "object", properties: { query: { type: "string", description: "what to look for" }, limit: { type: "integer" } } },
  };
}

export function perspicaxLikeCatalog(): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];
  for (const connector of CONNECTORS) {
    tools.push(queryTool(connector), writeTool(connector));
    for (let index = 0; index < 10; index++) tools.push(smallTool(`${connector}__action_${index}`, `Run action ${index} of ${connector}.`));
  }
  for (const helper of ["api_list", "api_search", "api_describe", "api_plan", "api_result_query", "identity", "memory_search", "memory_write", "work_search", "claim"]) {
    tools.push(smallTool(helper, `The ${helper.replace(/_/g, " ")} helper of every connector.`));
  }
  return tools;
}
