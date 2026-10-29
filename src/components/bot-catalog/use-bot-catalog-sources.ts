// What Browse Bots reads (2026-10-29, out of BotCatalogPane): the bot
// catalogue (GET /api/bot-catalog), New bot's presets, the community teams,
// the organization's packages and the xAI Bot Marketplace, made into the
// templates. Connect Apps reads them once for its Bots tab and its one
// search (src/components/PluginsPanel.tsx) and hands them to the pane; Browse
// Bots' own window reads them itself.
import { useCallback, useEffect, useMemo, useState } from "react";

import { t } from "@/lib/i18n";
import type { OrgLibraryListing } from "@/lib/org-library";
import type { BotPreset } from "@/lib/bot-presets";
import { api, type ApiError } from "@/state/store";
import { catalogTemplates, xaiErrorText, type BotCatalogResponse, type CatalogTemplate, type CommunityCatalog } from "@/lib/bot-catalog";
import type { XaiMarketplaceList } from "../../../shared/xai-marketplace";

export interface BotCatalogSources {
  data: BotCatalogResponse | null;
  loadFailed: boolean;
  /** read the catalogue (and the organization's packages) again */
  reload: () => void;
  community: CommunityCatalog | null;
  orgListing: OrgLibraryListing | null;
  xai: XaiMarketplaceList | null;
  xaiError: string;
  xaiLoading: boolean;
  /** read x.ai again */
  refreshXai: () => void;
  templates: CatalogTemplate[];
}

const apiCode = (error: unknown) => (error as ApiError | undefined)?.body?.code;

/** Off (`enabled` false): nothing is read, the pane uses what it is given. */
export function useBotCatalogSources({ enabled = true, remoteClient }: { enabled?: boolean; remoteClient: boolean }): BotCatalogSources {
  const [data, setData] = useState<BotCatalogResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [presets, setPresets] = useState<BotPreset[]>([]);
  const [reloadCount, setReloadCount] = useState(0);
  const [community, setCommunity] = useState<CommunityCatalog | null>(null);
  const [orgListing, setOrgListing] = useState<OrgLibraryListing | null>(null);
  const [xai, setXai] = useState<XaiMarketplaceList | null>(null);
  const [xaiError, setXaiError] = useState("");
  const [xaiLoading, setXaiLoading] = useState(enabled);
  const [xaiRefresh, setXaiRefresh] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoadFailed(false);
    api<BotCatalogResponse>("/api/bot-catalog")
      .then((result) => { if (alive) setData(result); })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [enabled, reloadCount]);

  // The community teams and the organization's packages: no source is the
  // same as an empty one (offline, no organization, a remote client).
  useEffect(() => {
    if (!enabled || remoteClient) return;
    let alive = true;
    api<CommunityCatalog>("/api/team-library/catalog")
      .then((result) => { if (alive) setCommunity(result); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled, remoteClient]);

  useEffect(() => {
    if (!enabled || remoteClient) return;
    let alive = true;
    api<OrgLibraryListing>("/api/org-library")
      .then((result) => { if (alive) setOrgListing(result); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled, remoteClient, reloadCount]);

  // The xAI Bot Marketplace: kept a few hours on the server; Refresh reads
  // x.ai again. A failure is a clear line in its section, never the raw error.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setXaiLoading(true);
    setXaiError("");
    api<XaiMarketplaceList>(`/api/team-library/xai${xaiRefresh ? "?refresh=1" : ""}`)
      .then((result) => {
        if (!alive) return;
        setXai(result);
        if (result.stale) setXaiError([xaiErrorText(result.stale.code), t("botCatalog.xai.staleNote")].join(" "));
      })
      .catch((error) => { if (alive) setXaiError(xaiErrorText(apiCode(error))); })
      .finally(() => { if (alive) setXaiLoading(false); });
    return () => { alive = false; };
  }, [enabled, xaiRefresh]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // New bot's presets are an admin read; a member keeps the built-in roles.
    api<{ presets: BotPreset[] }>("/api/bot-presets")
      .then((result) => { if (alive) setPresets(result.presets); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);

  const templates = useMemo(
    () => catalogTemplates(presets, undefined, { community: community?.teams ?? [], orgPackages: orgListing?.organization ? orgListing.packages : [], xai: xai?.bots ?? [] }),
    [presets, community, orgListing, xai],
  );
  const reload = useCallback(() => setReloadCount((value) => value + 1), []);
  const refreshXai = useCallback(() => setXaiRefresh((value) => value + 1), []);
  return { data, loadFailed, reload, community, orgListing, xai, xaiError, xaiLoading, refreshXai, templates };
}
