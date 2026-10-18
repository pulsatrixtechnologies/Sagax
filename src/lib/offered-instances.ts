// The engines the app offers this person, from shared/offered-engines.ts
// (the server's answer too). Every list of providers or models reads it:
// the model menu and window, New bot, a bot's backups and recovery, and
// Settings > Models and voice ("settings": also the engines the
// organization did not give the person, so they can connect their own).
// Solo: every engine, unchanged.
import { useMemo } from "react";
import { useStore, type ConfigStatus, type InstanceInfo } from "@/state/store";
import { offeredEngines, type EngineOfferContext } from "../../shared/offered-engines";
import { useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";

/** The offer context for this viewer: an organization server once its
 * card has loaded (usePerspicaxOrg); the server already leaves out what
 * the organization does not allow before that. */
export function engineOfferContext(config: ConfigStatus | null | undefined, organization: boolean, mine: readonly MyEngine[] | null): EngineOfferContext {
  return { organization, allowedEngines: config?.allowedEngines ?? null, mine };
}

/** `state.instances` as offered to this person. */
export function useOfferedInstances(purpose: "pick" | "settings" = "pick"): InstanceInfo[] {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const context = engineOfferContext(state.config, org !== null, mine);
  return useMemo(
    () => offeredEngines(state.instances, context, purpose),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.instances, context.organization, context.allowedEngines, mine, purpose],
  );
}
