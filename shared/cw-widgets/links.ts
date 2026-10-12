// Deep links into ConnectWise Manage. The record router opens one record in
// the person's own browser session: the host is the site's web host (never
// the API host) and `companyName` the company id typed at sign-in.

import type { CwSite } from "./types.ts";
import { infoHrefs, type CwRecord } from "./read.ts";

export type CwRecordType =
  | "ServiceFv"
  | "ProjectHeaderFV"
  | "CompanyFv"
  | "ContactFv"
  | "OpportunityFv"
  | "AgreementFv"
  | "InvoiceFv"
  | "TimeEntry"
  | "ActivityFv";

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const COMPANY = /^[A-Za-z0-9_.-]{1,60}$/;

/** A site from its parts, or undefined when the host is not a plain host
 * name (a link never carries a scheme, path or port someone typed). */
export function cwSite(host: unknown, company?: unknown): CwSite | undefined {
  if (typeof host !== "string") return undefined;
  let name = host.trim().toLowerCase();
  name = name.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!HOST.test(name) || name.length > 253) return undefined;
  name = webHost(name);
  const site: CwSite = { host: name };
  if (typeof company === "string" && COMPANY.test(company.trim())) site.company = company.trim();
  return site;
}

/** api-na.myconnectwise.net serves na.myconnectwise.net; an on-premises
 * host is its own. */
function webHost(host: string): string {
  const cloud = /^api-([a-z0-9]+)\.(myconnectwise\.net|myconnectwise\.co\.uk|connectwisedev\.com)$/.exec(host);
  return cloud ? `${cloud[1]}.${cloud[2]}` : host;
}

/** The site named by a record's `_info` links. */
export function siteFromRecord(record: CwRecord): CwSite | undefined {
  for (const href of infoHrefs(record)) {
    try {
      const site = cwSite(new URL(href).hostname);
      if (site) return site;
    } catch {
      // not a URL
    }
  }
  return undefined;
}

export function cwRecordLink(site: CwSite | undefined, recordType: CwRecordType, id: number | undefined): string | undefined {
  if (!site || !id || !Number.isInteger(id) || id <= 0) return undefined;
  const params = new URLSearchParams({ recordType, recid: String(id) });
  if (site.company) params.set("companyName", site.company);
  return `https://${site.host}/v4_6_release/services/system_io/router/openrecord.rails?${params.toString()}`;
}

/** Only links this module would build are drawn: https, the router path. */
export function safeCwLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 600) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !HOST.test(url.hostname)) return undefined;
    if (url.pathname !== "/v4_6_release/services/system_io/router/openrecord.rails") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
