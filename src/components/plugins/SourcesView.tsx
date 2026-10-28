// Connect apps > Sources (2026-10-27): where plugins and private
// repositories come from, and every GitHub setting in one place.
//
//   - GitHub (2026-10-28, GithubSourcesSection): one section for every
//     GitHub setting: the person's connection, one list of credentials
//     (theirs, and the organization's marked so).
//   - Marketplaces: add, fetch again, remove; each picks a credential of
//     that list, or Automatic.
//   - Organization (admins only, the same right as before): allowed
//     marketplaces. The GitHub OAuth App's client id is in Settings >
//     Organization.
//
// A part with nothing to show is left out.
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

export interface SourcesViewProps {
  github?: ReactNode;
  marketplaces?: ReactNode;
  /** the organization's sources and access, for an organization admin */
  organization?: ReactNode;
}

export function SourcesView({ github, marketplaces, organization }: SourcesViewProps) {
  return (
    <div data-plugins-sources>
      {github}
      {marketplaces}
      {organization && (
        <section className="mt-8 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5" data-plugins-sources-admin>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.orgAccess.title")}</h3>
            <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary">{t("connectApps.sources.adminsOnly")}</span>
          </div>
          {organization}
        </section>
      )}
    </div>
  );
}
