// The organization directory a group's roster searches for people
// (ManageMembersPanel.tsx): anyone active in Perspicax, added by principal
// id. Joining a group lets a person read and post in its threads and talk to
// its bots there, never to those bots outside it.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import type { OrgDirectory } from "@/lib/perspicax-org";

/** The organization directory, once `enabled`; null until it answers. */
export function useOrgDirectory(enabled: boolean): OrgDirectory | null {
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api<OrgDirectory>("/api/org/directory").then(
      (body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); },
      () => { if (alive) setDirectory({ people: [], teams: [] }); },
    );
    return () => { alive = false; };
  }, [enabled]);
  return directory;
}
