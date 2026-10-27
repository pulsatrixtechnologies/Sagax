// Who may give a tool access grant (2026-10-26, docs/tool-policy.md): a
// person manages the grants of their own bots, and their own, without an
// admin, for everything that stays in their own environment. Only a scope
// whose effect reaches past it stays an admin's: other people, the whole
// organization, the shared server, the organization's billing. The areas
// are those of server/tool-policy.generated.ts.

/** Areas whose writes reach past one person's environment. */
export const ORG_REACH_AREAS: readonly string[] = [
  // the organization, its people, roles and teams
  "org", "org-library", "members", "people", "roles", "teams", "team-map", "team-memory", "team-library", "team-computers",
  // the shared server: its admin pages, engines, keys, workers, config, backups
  "admin", "admin-activity", "config", "edition", "brand", "instances", "engines", "keys", "credentials", "workers",
  "shared-computers", "workspace-backup", "internal", "fleet", "decisions",
  // the organization's billing and usage
  "billing", "usage", "plan-usage", "resource-usage",
  // granting itself: only an admin hands out access beyond a person's own
  "tool-grants",
];

const ORG_REACH = new Set(ORG_REACH_AREAS);

export function grantArea(scope: string): string {
  return scope.split(":")[0] ?? "";
}

/** Whether a grant of this scope stays in the person's own environment, so
 * they may give it themselves (to their own bot, or to themselves). */
export function grantStaysInOwnEnvironment(scope: string): boolean {
  return !ORG_REACH.has(grantArea(scope));
}
