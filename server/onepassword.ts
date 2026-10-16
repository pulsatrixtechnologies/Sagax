// Optional 1Password source for the credential vault: read-only, feature
// detected, off when absent. Two ways in, the first one found wins:
//
//   Connect   OP_CONNECT_HOST and OP_CONNECT_TOKEN in the server's
//             environment (a 1Password Connect server the operator runs)
//   CLI       the official `op` command on this computer, signed in through
//             the 1Password desktop app integration (biometric unlock) or a
//             service account (OP_SERVICE_ACCOUNT_TOKEN)
//
// Only a desktop or a solo server offers it: on an organization server the
// host's 1Password account is not any one person's to share. Items are
// listed for the picker (title, vault, sites); a picked item is saved in the
// vault as a reference, and its fields are read only at fill time, never
// cached, never listed, never logged. `op` runs with execFile and an
// argument array, never a shell; its environment carries no other OP_*
// variable than the two named above.
import { execFile } from "node:child_process";

import { normalizeVaultDomain, type VaultFillField } from "../shared/credential-vault.ts";
import type { OnePasswordRef } from "./credential-vault.ts";

export type OnePasswordVia = "cli" | "connect";

export interface OnePasswordStatus {
  available: boolean;
  via?: OnePasswordVia;
  /** Why it is off, for Settings ("not installed", "not signed in"). */
  reason?: "absent" | "signed_out" | "organization" | "error";
}

export interface OnePasswordItemSummary {
  id: string;
  vaultId: string;
  vaultName: string;
  title: string;
  category: string;
  domains: string[];
}

export type ExecFileFn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => Promise<string>;
export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const ID = /^[a-z0-9]{1,64}$/i;
const CLI_TIMEOUT_MS = 15_000;
const MAX_ITEMS = 1_000;

const defaultExec: ExecFileFn = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, { ...options, windowsHide: true, shell: false }, (error, stdout) => {
    if (error) reject(new Error("1Password command failed"));
    else resolve(String(stdout));
  });
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function domainsOf(urls: unknown): string[] {
  const out: string[] = [];
  for (const entry of Array.isArray(urls) ? urls : []) {
    const href = record(entry)?.href;
    const domain = normalizeVaultDomain(href);
    if (domain && !out.includes(domain)) out.push(domain);
  }
  return out.slice(0, 10);
}

/** The value of one field of a full item, as `op item get --format json` or
 * Connect return it. TOTP: the current code the source computed. */
export function fieldValue(item: unknown, field: VaultFillField): string | null {
  const fields = Array.isArray(record(item)?.fields) ? record(item)!.fields as unknown[] : [];
  const rows = fields.map(record).filter((row): row is Record<string, unknown> => row !== null);
  const value = (row: Record<string, unknown> | undefined) => {
    if (!row) return null;
    const raw = field === "totp" ? (row.totp ?? null) : row.value;
    return typeof raw === "string" && raw ? raw : null;
  };
  switch (field) {
    case "username":
      return value(rows.find((row) => row.purpose === "USERNAME") ?? rows.find((row) => row.id === "username"));
    case "password":
      return value(rows.find((row) => row.purpose === "PASSWORD") ?? rows.find((row) => row.id === "password"));
    case "totp":
      return value(rows.find((row) => row.type === "OTP" || row.type === "otp"));
    case "apiKey":
      return value(rows.find((row) => row.id === "credential" || String(row.label ?? "").toLowerCase() === "credential"))
        ?? value(rows.find((row) => row.purpose === "PASSWORD"));
  }
}

export class OnePassword {
  private readonly env: NodeJS.ProcessEnv;
  private readonly exec: ExecFileFn;
  private readonly fetch: FetchFn;
  private readonly organization: () => boolean;
  private readonly path: () => string;
  private cachedStatus: { at: number; status: OnePasswordStatus } | null = null;

  constructor(options: { env?: NodeJS.ProcessEnv; exec?: ExecFileFn; fetch?: FetchFn; organization: () => boolean; path?: () => string }) {
    this.env = options.env ?? process.env;
    this.exec = options.exec ?? defaultExec;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchFn>);
    this.organization = options.organization;
    this.path = options.path ?? (() => this.env.PATH ?? "");
  }

  private connect(): { host: string; token: string } | null {
    const host = this.env.OP_CONNECT_HOST?.trim();
    const token = this.env.OP_CONNECT_TOKEN?.trim();
    if (!host || !token) return null;
    try {
      const url = new URL(host);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return { host: url.origin, token };
    } catch {
      return null;
    }
  }

  /** The CLI's environment: plumbing, plus the service account and account
   * choice when the operator set them; never another OP_ variable. */
  private cliEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (value !== undefined && !key.startsWith("OP_")) env[key] = value;
    }
    env.PATH = this.path();
    if (this.env.OP_SERVICE_ACCOUNT_TOKEN) env.OP_SERVICE_ACCOUNT_TOKEN = this.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (this.env.OP_ACCOUNT) env.OP_ACCOUNT = this.env.OP_ACCOUNT;
    env.OP_CACHE = "false";
    env.OP_BIOMETRIC_UNLOCK_ENABLED = "true";
    return env;
  }

  private async op(args: string[]): Promise<unknown> {
    const out = await this.exec("op", args, { env: this.cliEnv(), timeout: CLI_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(out);
  }

  private async connectGet(path: string): Promise<unknown> {
    const connect = this.connect();
    if (!connect) throw new Error("1Password Connect is not configured");
    const response = await this.fetch(`${connect.host}${path}`, {
      headers: { Authorization: `Bearer ${connect.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`1Password Connect answered ${response.status}`);
    return response.json();
  }

  /** Feature detection, cached for a minute. */
  async status(force = false): Promise<OnePasswordStatus> {
    if (this.organization()) return { available: false, reason: "organization" };
    if (!force && this.cachedStatus && Date.now() - this.cachedStatus.at < 60_000) return this.cachedStatus.status;
    let status: OnePasswordStatus;
    if (this.connect()) {
      try {
        await this.connectGet("/v1/vaults");
        status = { available: true, via: "connect" };
      } catch {
        status = { available: false, via: "connect", reason: "error" };
      }
    } else {
      try {
        await this.exec("op", ["--version"], { env: this.cliEnv(), timeout: 5_000, maxBuffer: 64 * 1024 });
        try {
          const accounts = await this.op(["account", "list", "--format=json"]);
          status = (Array.isArray(accounts) && accounts.length > 0) || this.env.OP_SERVICE_ACCOUNT_TOKEN
            ? { available: true, via: "cli" }
            : { available: false, via: "cli", reason: "signed_out" };
        } catch {
          status = { available: false, via: "cli", reason: "signed_out" };
        }
      } catch {
        status = { available: false, reason: "absent" };
      }
    }
    this.cachedStatus = { at: Date.now(), status };
    return status;
  }

  /** Logins and API credentials for the picker: names and sites only. */
  async listItems(): Promise<OnePasswordItemSummary[]> {
    const status = await this.status();
    if (!status.available || !status.via) throw new Error("1Password is not available");
    const out: OnePasswordItemSummary[] = [];
    if (status.via === "connect") {
      const vaults = await this.connectGet("/v1/vaults");
      for (const vault of (Array.isArray(vaults) ? vaults : []).map(record)) {
        if (!vault || typeof vault.id !== "string" || !ID.test(vault.id)) continue;
        const items = await this.connectGet(`/v1/vaults/${vault.id}/items`);
        for (const item of (Array.isArray(items) ? items : []).map(record)) {
          if (!item || typeof item.id !== "string" || !ID.test(item.id)) continue;
          if (!["LOGIN", "PASSWORD", "API_CREDENTIAL"].includes(String(item.category))) continue;
          out.push({ id: item.id, vaultId: vault.id, vaultName: String(vault.name ?? ""), title: String(item.title ?? "").slice(0, 120), category: String(item.category), domains: domainsOf(item.urls) });
          if (out.length >= MAX_ITEMS) return out;
        }
      }
      return out;
    }
    const items = await this.op(["item", "list", "--categories", "Login,Password,API Credential", "--format=json"]);
    for (const item of (Array.isArray(items) ? items : []).map(record)) {
      const vault = record(item?.vault);
      if (!item || typeof item.id !== "string" || !ID.test(item.id) || typeof vault?.id !== "string" || !ID.test(vault.id)) continue;
      out.push({ id: item.id, vaultId: vault.id, vaultName: String(vault.name ?? ""), title: String(item.title ?? "").slice(0, 120), category: String(item.category ?? ""), domains: domainsOf(item.urls) });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  /** One field at fill time. Never cached; null when the item has none. */
  async readField(ref: OnePasswordRef, field: VaultFillField): Promise<string | null> {
    if (!ID.test(ref.itemId) || !ID.test(ref.vaultId)) return null;
    const status = await this.status();
    if (!status.available || status.via !== ref.via) throw new Error("1Password is not available");
    const item = ref.via === "connect"
      ? await this.connectGet(`/v1/vaults/${ref.vaultId}/items/${ref.itemId}`)
      : await this.op(["item", "get", ref.itemId, "--vault", ref.vaultId, "--reveal", "--format=json"]);
    return fieldValue(item, field);
  }
}
