// Companies.

import type { CwCompany, CwSite } from "./types.ts";
import { id, text, type CwRecord } from "./read.ts";
import { cwRecordLink } from "./links.ts";

export function looksLikeCompany(record: CwRecord): boolean {
  if (!id(record) || typeof record.summary === "string") return false;
  if ("agreementStatus" in record || "billableOption" in record || "dateStart" in record) return false;
  return Boolean(text(record, "name") && (text(record, "identifier") || "phoneNumber" in record || "website" in record));
}

/** A company website is shown only as https, with no userinfo. */
export function safeWebsite(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 300) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function companyFrom(record: CwRecord, site: CwSite | undefined): CwCompany | undefined {
  const companyId = id(record);
  const name = text(record, "name");
  if (!companyId || !name) return undefined;
  const company: CwCompany = { id: companyId, name };
  const identifier = text(record, "identifier");
  if (identifier) company.identifier = identifier;
  const fields: Array<[keyof CwCompany, string | undefined]> = [
    ["status", text(record, "status.name", "status")],
    ["type", text(record, "type.name", "type")],
    ["phone", text(record, "phoneNumber", "phone")],
    ["city", text(record, "city")],
    ["territory", text(record, "territory.name", "territory")],
  ];
  for (const [key, value] of fields) if (value) (company as unknown as Record<string, unknown>)[key] = value;
  const website = safeWebsite(record.website);
  if (website) company.website = website;
  const link = cwRecordLink(site, "CompanyFv", companyId);
  if (link) company.link = link;
  return company;
}
