// The app's side of shared/org-engine-readiness.ts: whether the person
// signed in to an organization server has an engine that answers them, the
// engines they may connect with their own account, and their admins' names.
// Solo servers (and an organization server while its card loads) are always
// "ready", so nothing changes there.
//
// The person's own engines (GET /api/me/engines) are asked again when the
// engine list or the organization's list changes (an admin hid an engine,
// a key was removed) and when the window comes back to the front (an
// expired subscription, a key changed in Perspicax), so the chat's notice
// follows without a reload.
import { useEffect, useMemo } from "react";

import { useStore, type InstanceInfo } from "@/state/store";
import { orgAdminNames, orgEngineReadiness, type OrgEngineReadiness } from "../../shared/org-engine-readiness";
import { reloadMyEngines, useMyEngines, useOrgPeople, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";

/** Set (an ISO date) once the person went through the first-run step on an
 * organization server: it opens by itself only once per person, after
 * which the chat's notice leads back to it. Travels with the person
 * (shared/user-preferences.ts). */
export const ORG_ENGINE_SETUP_SEEN_KEY = "sagax.orgEngineSetupSeen.v1";

/** Opens the step from anywhere on the page (the chat's notice). */
export const ORG_ENGINE_SETUP_EVENT = "sagax:org-engine-setup";

export function openOrgEngineSetup(): void {
  window.dispatchEvent(new CustomEvent(ORG_ENGINE_SETUP_EVENT));
}

export function orgEngineSetupSeen(): boolean {
  try {
    return Boolean(window.localStorage.getItem(ORG_ENGINE_SETUP_SEEN_KEY));
  } catch {
    return false;
  }
}

export function markOrgEngineSetupSeen(now: Date = new Date()): void {
  try {
    if (!window.localStorage.getItem(ORG_ENGINE_SETUP_SEEN_KEY)) window.localStorage.setItem(ORG_ENGINE_SETUP_SEEN_KEY, now.toISOString());
  } catch {
    /* storage refused: the step may open again next visit, which is harmless */
  }
}

export interface PersonEngineReadiness extends OrgEngineReadiness<InstanceInfo, MyEngine> {
  organization: boolean;
  organizationName: string;
  issuer: string;
  adminNames: string[];
}

export function usePersonEngineReadiness(): PersonEngineReadiness {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const people = useOrgPeople();
  const organization = org !== null;
  const allowedEngines = state.config?.allowedEngines ?? null;
  const allowedKey = JSON.stringify(allowedEngines);
  const instanceKey = state.instances.map((instance) => `${instance.instanceId}:${instance.snapshot.state}`).join(",");

  useEffect(() => {
    if (!organization) return;
    void reloadMyEngines();
  }, [organization, allowedKey, instanceKey]);

  useEffect(() => {
    if (!organization) return;
    const onFocus = () => void reloadMyEngines();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [organization]);

  return useMemo(() => {
    const readiness = orgEngineReadiness(state.instances, { organization, allowedEngines, mine });
    return {
      ...readiness,
      organization,
      organizationName: org?.org.name ?? "",
      issuer: org?.org.identity.issuer ?? "",
      adminNames: orgAdminNames(people.values()),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.instances, organization, allowedKey, mine, people, org]);
}
