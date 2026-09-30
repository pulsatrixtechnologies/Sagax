// The organization of a server signed in with Perspicax (slice 3): GET
// /api/org answers with `org.identity.kind === "perspicax"` there, and with
// the interim organization (or 404) on a solo server. Asked once per page
// load; null while the answer is on its way or on a solo server.
import { useEffect, useState } from "react";

import { api } from "@/state/store";

export interface PerspicaxOrg {
  org: { name: string; identity: { kind: "perspicax"; issuer: string; serverId?: string } };
  link: { state: "missing" | "ok" | "error"; syncedAt?: number; error?: string };
  viewerRole: "admin" | "member";
  settings: { memberBotsUseOrgKey: boolean };
}

export interface OrgDirectoryPerson {
  principalId: string;
  name: string;
  login: string;
  email?: string;
  role: "admin" | "member";
  disabled: boolean;
}

export function isPerspicaxOrg(body: unknown): body is PerspicaxOrg {
  const org = body && typeof body === "object" ? (body as { org?: { identity?: { kind?: unknown } } }).org : undefined;
  return org?.identity?.kind === "perspicax";
}

let pending: Promise<PerspicaxOrg | null> | null = null;

export function loadPerspicaxOrg(force = false): Promise<PerspicaxOrg | null> {
  if (force) pending = null;
  pending ??= api<unknown>("/api/org").then((body) => (isPerspicaxOrg(body) ? body : null), () => null);
  return pending;
}

/** The Perspicax organization, or null (solo server, or still loading). */
export function usePerspicaxOrg(): PerspicaxOrg | null {
  const [org, setOrg] = useState<PerspicaxOrg | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPerspicaxOrg().then((value) => { if (alive) setOrg(value); });
    return () => { alive = false; };
  }, []);
  return org;
}

/** The people a bot owner may add: not the owner, not disabled, not already
 * granted, matching the search by name, login or address. */
export function sharePickerPeople(people: OrgDirectoryPerson[], input: { ownerId?: string; grants: string[]; query: string }): OrgDirectoryPerson[] {
  const owner = input.ownerId?.toLowerCase();
  const granted = new Set(input.grants.map((id) => id.toLowerCase()));
  const q = input.query.trim().toLowerCase();
  return people.filter((person) => {
    const id = person.principalId.toLowerCase();
    if (person.disabled || id === owner || granted.has(id)) return false;
    if (!q) return true;
    return [person.name, person.login, person.email ?? ""].some((field) => field.toLowerCase().includes(q));
  });
}
