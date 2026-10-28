// #1276: on a server whose catalog is searched (the MCP gate's own tool
// search, the agents catalog in a compact prompt), the model runs a tool it
// found with `call_tool({ name, arguments })`. Everything Sagax reads about a
// call (the approval card and its rules, Always allow, the activity row, a
// tool's widget, which tools a bot uses) reads the tool that call runs, as if
// the model had called it by its own name.

export const SEARCH_CALL_TOOL = "call_tool";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** `mcp__<server>__call_tool` on a searched server, as the call it runs:
 * `mcp__<server>__<tool>` with that tool's own arguments. Any other call, or
 * a call_tool that names no tool (it runs nothing), is returned unchanged. */
export function searchedToolCall(name: string, input: unknown, searched: ReadonlySet<string>): { name: string; input: unknown; searched: boolean } {
  const suffix = `__${SEARCH_CALL_TOOL}`;
  if (!name.startsWith("mcp__") || !name.endsWith(suffix)) return { name, input, searched: false };
  const server = name.slice("mcp__".length, -suffix.length);
  if (!server || !searched.has(server) || !isRecord(input)) return { name, input, searched: false };
  const target = typeof input.name === "string" ? input.name.trim() : "";
  if (!target || !/^[\w.:-]{1,200}$/.test(target)) return { name, input, searched: false };
  return { name: `mcp__${server}__${target}`, input: isRecord(input.arguments) ? input.arguments : {}, searched: true };
}

/** The names of the searched servers, from the private setting a driver
 * hands its permission proxy (SAGAX_PERMISSION_SEARCHED). */
export function searchedServersFromEnv(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && /^[\w-]{1,64}$/.test(name)) : []);
  } catch {
    return new Set();
  }
}
