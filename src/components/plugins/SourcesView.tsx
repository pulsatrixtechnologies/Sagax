// Connect apps > Sources (2026-10-27): where plugins and private
// repositories come from, and every GitHub setting in one place.
//
//   - Your GitHub connection (organization server): Connect GitHub (the
//     organization's OAuth App) or a fine-grained token, as the person.
//   - Marketplaces: add, fetch again, remove, and a token per marketplace.
//   - Organization (admins only, the same right as before): allowed
//     marketplaces, the organization's GitHub access tokens and its GitHub
//     OAuth App. They were in Settings > Organization, which now only links
//     here.
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
      {github && (
        <section className="mb-6" data-plugins-sources-github>
          {github}
        </section>
      )}
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
