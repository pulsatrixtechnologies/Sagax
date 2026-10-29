// Families of agents tools listed as one tool each (shared/merged-agent-tools.ts),
// where an engine is shown the whole catalog on every turn. The family tool's
// `tool` argument names the tool to run; its other arguments are that
// tool's own. Each action keeps its whole description and says which
// arguments it needs, so nothing the model was told is lost. The schema is one
// flat object (no oneOf: a provider's conversion mangled one before, #544).
import { MERGED_ACTION, MERGED_AGENT_TOOLS, MERGED_AGENT_TOOL_INTROS, mergedFamilyOf } from "../../shared/merged-agent-tools.ts";

type Schema = Record<string, unknown>;
type Tool = {
  name: string;
  description?: string;
  inputSchema?: Schema;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** The same argument with a different shape cannot be one property: such a
 * tool stays listed on its own. */
function sameShape(a: Schema, b: Schema): boolean {
  const { description: _a, ...restA } = a;
  const { description: _b, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

function annotationsOf(members: readonly Tool[]): Record<string, unknown> | undefined {
  if (!members.every((tool) => tool.annotations)) {
    // A destructive member marks the family destructive; nothing else is claimed.
    return members.some((tool) => tool.annotations?.destructiveHint === true) ? { destructiveHint: true } : undefined;
  }
  const all = (key: string) => members.every((tool) => tool.annotations?.[key] === true);
  const any = (key: string) => members.some((tool) => tool.annotations?.[key] === true);
  return { readOnlyHint: all("readOnlyHint"), destructiveHint: any("destructiveHint"), idempotentHint: all("idempotentHint"), openWorldHint: any("openWorldHint") };
}

/** Deferred behind tool search only when every member was. */
function metaOf(members: readonly Tool[]): Record<string, unknown> | undefined {
  const first = JSON.stringify(members[0]?._meta ?? null);
  return members.every((tool) => JSON.stringify(tool._meta ?? null) === first) ? members[0]?._meta : undefined;
}

function familyTool(family: string, members: readonly Tool[]): Tool {
  const properties: Record<string, Schema> = {};
  const descriptions = new Map<string, string[]>();
  for (const tool of members) {
    for (const [name, schema] of Object.entries((tool.inputSchema?.properties ?? {}) as Record<string, Schema>)) {
      if (!properties[name]) properties[name] = schema;
      const text = typeof schema.description === "string" ? schema.description : "";
      if (text) {
        const seen = descriptions.get(name) ?? [];
        if (!seen.includes(text)) seen.push(text);
        descriptions.set(name, seen);
      }
    }
  }
  for (const [name, texts] of descriptions) {
    const { description: _drop, ...shape } = properties[name]!;
    properties[name] = { ...shape, description: texts.join(" / ") };
  }
  const actions = members.map((tool) => {
    const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required as string[] : [];
    return `- ${tool.name}: ${tool.description ?? ""}${required.length ? ` Needs: ${required.join(", ")}.` : ""}`;
  });
  const annotations = annotationsOf(members);
  const meta = metaOf(members);
  return {
    name: family,
    description: `${MERGED_AGENT_TOOL_INTROS[family] ?? ""} Set tool to the one to run, with its own arguments beside it.\n${actions.join("\n")}`.trim(),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        [MERGED_ACTION]: { type: "string", enum: members.map((tool) => tool.name), description: "The tool to run." },
        ...properties,
      },
      required: [MERGED_ACTION],
    },
    ...(annotations ? { annotations } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

/** The listing with each family's offered tools as one tool, placed where
 * its first offered tool was. A family with one tool offered, or a tool
 * whose argument clashes with another member's, stays listed by its own name. */
export function mergeByAction<T extends Tool>(tools: readonly T[]): Array<T | Tool> {
  const byFamily = new Map<string, T[]>();
  for (const tool of tools) {
    const family = mergedFamilyOf(tool.name);
    if (!family) continue;
    const members = byFamily.get(family) ?? [];
    const clashes = Object.hasOwn((tool.inputSchema?.properties ?? {}) as object, MERGED_ACTION) || members.some((member) => Object.entries((tool.inputSchema?.properties ?? {}) as Record<string, Schema>)
      .some(([name, schema]) => {
        const other = (member.inputSchema?.properties as Record<string, Schema> | undefined)?.[name];
        return other !== undefined && !sameShape(other, schema);
      }));
    if (!clashes) {
      members.push(tool);
      byFamily.set(family, members);
    }
  }
  const merged = new Set<string>();
  const out: Array<T | Tool> = [];
  for (const tool of tools) {
    const family = mergedFamilyOf(tool.name);
    const members = family ? byFamily.get(family) : undefined;
    if (!family || !members || members.length < 2 || !members.includes(tool)) {
      out.push(tool);
      continue;
    }
    if (merged.has(family)) continue;
    merged.add(family);
    // keep the family's own order
    const ordered = (MERGED_AGENT_TOOLS[family] ?? []).map((name) => members.find((member) => member.name === name)).filter((member): member is T => Boolean(member));
    out.push(familyTool(family, ordered));
  }
  return out;
}
