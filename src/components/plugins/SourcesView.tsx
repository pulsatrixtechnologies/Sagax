// Connect apps > Sources (2026-10-27): where plugins come from, the
// marketplaces only (2026-10-28).
//
//   - Marketplaces: add, list, fetch again, remove, and who sees each one.
//     A private one reads with the person's GitHub account by default; a
//     row picks another credential in a small selector only when one
//     exists. The account and those credentials are in Providers > GitHub.
//   - Organization (admins only, the same right as before): allowed
//     marketplaces.
//
// A part with nothing to show is left out.
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

export interface SourcesViewProps {
  marketplaces?: ReactNode;
  /** the organization's allowed marketplaces, for an organization admin */
  organization?: ReactNode;
}

export function SourcesView({ marketplaces, organization }: SourcesViewProps) {
  return (
    <div data-plugins-sources>
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
