// The person's own API, from a spec they pasted. One file per person on an
// organization server, one file on a solo installation. Other members do
// not receive the tools and cannot read the headers. No admin switch.
import { mkdirSync, readFileSync, rmSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { isPublicDomainAddress } from "./custom-domain.ts";
import { writeFileAtomic } from "./atomic.ts";
import { parseOpenApiSpec, type OpenApiOperation } from "./openapi-tools.ts";

const PRINCIPAL = /^[a-z0-9][a-z0-9_.:-]{0,80}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;

export type OpenApiScope = { organization: false } | { organization: true; principalId: string };

export interface OpenApiRecord {
  title: string;
  baseUrl: string;
  headers: Record<string, string>;
  operations: OpenApiOperation[];
}

export interface OpenApiView {
  title: string | null;
  baseUrl: string | null;
  headerKeys: string[];
  operations: Array<Pick<OpenApiOperation, "name" | "method" | "path" | "summary">>;
}

export function openApiScope(organization: boolean, principalId: string | null | undefined): OpenApiScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) && !id.includes("..") ? { organization: true, principalId: id } : null;
}

function fileFor(dataDir: string, scope: OpenApiScope): string {
  return scope.organization
    ? join(dataDir, "principals", scope.principalId, "openapi.json")
    : join(dataDir, "openapi.json");
}

function refuseLink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("openapi store is a link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function cleanHeaders(value: unknown): Record<string, string> | string {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Headers must be a name to value map.";
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (!HEADER_NAME.test(name)) return `Header “${name}” is not a valid header name.`;
    if (typeof header !== "string" || !header || header.length > 4_096 || /[\r\n]/.test(header)) return `Header “${name}” must be one line.`;
    headers[name] = header;
  }
  if (Object.keys(headers).length > 16) return "Use at most 16 headers.";
  return headers;
}

export class OpenApiStore {
  private readonly dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  read(scope: OpenApiScope): OpenApiRecord | null {
    const path = fileFor(this.dataDir, scope);
    refuseLink(path);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as OpenApiRecord;
      if (!parsed || typeof parsed.baseUrl !== "string" || !Array.isArray(parsed.operations)) return null;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  view(scope: OpenApiScope): OpenApiView {
    const record = this.read(scope);
    if (!record) return { title: null, baseUrl: null, headerKeys: [], operations: [] };
    return {
      title: record.title,
      baseUrl: record.baseUrl,
      headerKeys: Object.keys(record.headers).sort(),
      operations: record.operations.map(({ name, method, path, summary }) => ({ name, method, path, summary })),
    };
  }

  /** Public operation list for the bot. Headers stay out. */
  publicOperations(scope: OpenApiScope): OpenApiOperation[] {
    return this.read(scope)?.operations ?? [];
  }

  save(scope: OpenApiScope, text: string, headers: unknown, baseUrl?: string): OpenApiView | string {
    const parsed = parseOpenApiSpec(text);
    if (!parsed.ok) return parsed.error;
    const cleaned = cleanHeaders(headers);
    if (typeof cleaned === "string") return cleaned;
    const url = (baseUrl?.trim() || parsed.baseUrl).trim();
    if (!/^https?:\/\//i.test(url)) return "The document needs a server address, or pass baseUrl.";
    const record: OpenApiRecord = { title: parsed.title, baseUrl: url, headers: cleaned, operations: parsed.operations };
    const path = fileFor(this.dataDir, scope);
    refuseLink(path);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return this.view(scope);
  }

  forget(scope: OpenApiScope): void {
    rmSync(fileFor(this.dataDir, scope), { force: true });
  }
}

/** Why this call must not run, or null. On an organization server the
 * address has to be public. A solo installation may call its own machine. */
export function openApiUrlRefusal(url: string, addresses: readonly string[], organization: boolean): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "The address is not a URL."; }
  if (parsed.username || parsed.password) return "The address cannot contain a password.";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "The address must be http or https.";
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const localName = host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal";
  if (organization && (localName || addresses.length === 0 || addresses.some((address) => !isPublicDomainAddress(address)))) {
    return "On an organization server this API must be on the public internet.";
  }
  return null;
}

export interface OpenApiCall {
  operation: OpenApiOperation;
  baseUrl: string;
  headers: Record<string, string>;
  args: Record<string, unknown>;
}

export function buildOpenApiRequest(call: OpenApiCall): { url: string; method: string; headers: Record<string, string>; body?: string } | string {
  let path = call.operation.path;
  const query = new URLSearchParams();
  for (const param of call.operation.params) {
    const value = call.args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) return `${param.name} is required.`;
      continue;
    }
    const text = String(value);
    if (/[\r\n]/.test(text)) return `${param.name} must be one line.`;
    if (param.in === "path") path = path.replaceAll(`{${param.name}}`, encodeURIComponent(text));
    else query.set(param.name, text);
  }
  if (path.includes("{")) return "A path value is missing.";
  const base = new URL(call.baseUrl);
  const prefix = base.pathname.replace(/\/$/, "");
  const queryText = query.toString();
  const url = `${base.origin}${prefix}${path.startsWith("/") ? path : `/${path}`}${queryText ? `?${queryText}` : ""}`;
  const headers: Record<string, string> = { ...call.headers, accept: call.headers.accept ?? call.headers.Accept ?? "application/json" };
  let body: string | undefined;
  if (call.operation.body && call.args.body !== undefined) {
    body = JSON.stringify(call.args.body);
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }
  return { url, method: call.operation.method.toUpperCase(), headers, ...(body !== undefined ? { body } : {}) };
}
