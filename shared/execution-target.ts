// Where a tool ran, as the transcript names it (organization mode):
// "Your computer" for the person's own desktop, "Your server environment" for
// their per-person sandbox on the server (server/user-sandbox-routing.ts).
// Read from the tool's name alone, like shared/tool-surface.ts.

export type ToolExecutionTarget = "user-desktop" | "user-sandbox";

/** The MCP server the server environment tools are mounted under. Keep in
 * sync with USER_SANDBOX_MCP_NAME in server/user-sandbox-routing.ts. */
export const USER_SANDBOX_SERVER = "sagax-environment";

/** `mcp__sagax-environment__run_command`, `sagax-environment__run_command`
 * (desktop names) or pi's `sagax-environment_run_command`. */
export function toolExecutionTarget(toolName: string, place?: string | null): ToolExecutionTarget | null {
  const name = toolName.toLowerCase();
  if (name.startsWith(`mcp__${USER_SANDBOX_SERVER}__`) || name.startsWith(`${USER_SANDBOX_SERVER}__`) || name.startsWith(`${USER_SANDBOX_SERVER}_`)) {
    return "user-sandbox";
  }
  return place === "local" ? "user-desktop" : null;
}
