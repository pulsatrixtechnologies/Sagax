// Mac local models for organization bots. The desktop probes its own loopback
// servers and publishes endpoint ids. This process binds a proxy on 127.0.0.1
// and injects that proxy through the existing local-host table. It never
// fetches the Mac address, and a client cannot supply the proxy URL.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";

import { isDesktopHostId, normalizeLoopbackBase, SEED_ENDPOINTS, type LoopbackEndpoint } from "../shared/desktop-local-models.ts";
import { localModelLabels, localModelUnavailable } from "../shared/local-model-engines.ts";
import { writeFileAtomic } from "./atomic.ts";
import { personForDesktopGrant } from "./desktop-model-grant.ts";
import type { DesktopBridgeOperation } from "./desktop-bridge.ts";
import {
  decodeInjectId,
  encodeInjectId,
  isDesktopInjectModel,
  removeDesktopInjectHost,
  upsertDesktopInjectHost,
  type InjectedModel,
} from "./drivers/local-inject.ts";

export const DESKTOP_MODEL_UNAVAILABLE = "This local model is unavailable. The computer is offline, or it is not shared with you.";
export const DESKTOP_MODEL_WRONG_ENGINE = "This engine cannot run a model from your computer. Pick it on pi, Codex, Grok or another engine that takes an OpenAI-compatible endpoint.";
const INVALID_BASE = "Use http://127.0.0.1 or http://localhost, and a path ending in /v1.";
const REQUEST_CAP = 1_000_000;
const RESPONSE_CAP = 1_500_000;
const MODEL_ID = /^[\w][\w./:+-]*$/;

interface PersonSettings {
  expose: boolean;
  share: boolean;
  endpoints: LoopbackEndpoint[];
}

interface PublishedEndpoint {
  id: string;
  label: string;
  models: string[];
  /** Display name and context window per model id, when the server reports them. */
  details?: Record<string, { name?: string; contextWindow?: number }>;
}

interface BridgeClient {
  connected(person: string | null): boolean;
  current(person: string | null): { name: string } | null;
  request(person: string | null, operation: DesktopBridgeOperation, active: () => boolean): Promise<unknown>;
}

export interface DesktopLocalModelView {
  expose: boolean;
  share: boolean;
  endpoints: LoopbackEndpoint[];
  published: PublishedEndpoint[];
  connected: boolean;
}

type ModelOption = { id: string; label: string; custom?: boolean; local?: boolean; contextWindow?: number };

/** Own bots may use this computer's models until the person turns that off.
 * Other people never do until the person turns sharing on. */
function defaultSettings(): PersonSettings {
  return { expose: true, share: false, endpoints: SEED_ENDPOINTS.map((row) => ({ ...row })) };
}

function parseDetails(value: unknown, models: readonly string[]): PublishedEndpoint["details"] | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 200) return null;
  const out: NonNullable<PublishedEndpoint["details"]> = {};
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((name) => name !== "id" && name !== "name" && name !== "contextLength")) return null;
    if (typeof row.id !== "string" || !models.includes(row.id)) continue;
    const name = cleanLabel(row.name, "");
    const raw = row.contextLength;
    const contextWindow = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 && raw <= 100_000_000 ? raw : undefined;
    out[row.id] = { ...(name && name !== row.id ? { name } : {}), ...(contextWindow ? { contextWindow } : {}) };
  }
  return out;
}

function usableModel(id: string): boolean {
  if (!MODEL_ID.test(id)) return false;
  const low = id.toLowerCase();
  return !low.includes("embed") && !low.includes("bge-") && !low.includes("nomic");
}

function cleanLabel(value: unknown, fallback: string): string {
  // oxlint-disable-next-line no-control-regex -- strip control characters from a model label
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
  return text || fallback;
}

/** Stable inject host id for one person and one desktop endpoint. The proxy port is not in the id. */
export function injectHostId(person: string, endpointId: string): string {
  const hash = createHash("sha256").update(person.trim().toLowerCase()).digest("hex").slice(0, 6);
  const suffix = (endpointId.startsWith("desk") ? endpointId.slice(4) : endpointId).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
  const id = `desk${hash}${suffix}`;
  return isDesktopHostId(id) ? id : "";
}

function assignEndpoints(items: unknown): { ok: true; endpoints: LoopbackEndpoint[] } | { ok: false; error: string } {
  if (!Array.isArray(items)) return { ok: false, error: INVALID_BASE };
  if (items.length > 20) return { ok: false, error: "At most 20 loopback servers." };
  const endpoints: LoopbackEndpoint[] = [];
  const seenUrl = new Set<string>();
  const usedId = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: INVALID_BASE };
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== "id" && key !== "label" && key !== "baseUrl") return { ok: false, error: INVALID_BASE };
    }
    const baseUrl = normalizeLoopbackBase(record.baseUrl);
    if (!baseUrl) return { ok: false, error: INVALID_BASE };
    if (seenUrl.has(baseUrl)) continue;
    seenUrl.add(baseUrl);
    let id = typeof record.id === "string" ? record.id.trim().toLowerCase() : "";
    if (!isDesktopHostId(id) || usedId.has(id)) id = `desku${randomBytes(4).toString("hex")}`;
    usedId.add(id);
    endpoints.push({ id, label: cleanLabel(record.label, `:${new URL(baseUrl).port}`), baseUrl });
  }
  return { ok: true, endpoints };
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    if (match) return match[1];
  }
  const key = req.headers["x-api-key"];
  return typeof key === "string" ? key.trim() : undefined;
}

function safeType(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || /[\r\n]/.test(value)) return "application/json";
  if (!/^(application|text)\/[\w.+-]+/.test(value)) return "application/json";
  return value;
}

function readLimited(req: IncomingMessage, cap: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => finish(null));
  });
}

const textHeaders = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };

export class DesktopLocalModels {
  private file: string;
  private bridges: BridgeClient;
  private people = new Map<string, PersonSettings>();
  private published = new Map<string, { endpoints: PublishedEndpoint[] }>();
  private hostMeta = new Map<string, { person: string; endpointId: string }>();
  private server: Server | null = null;
  private port = 0;
  private loaded = false;

  constructor(dataDir: string, bridges: BridgeClient) {
    this.file = join(dataDir, "desktop-local-models.json");
    this.bridges = bridges;
  }

  /** Bind 127.0.0.1 only. The port is chosen by the OS. */
  listen(): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      // Chat completions wait on the bridge job (up to its own timeout).
      // The bridge returns one body, so this socket has to stay open that long.
      server.requestTimeout = 700_000;
      server.headersTimeout = 700_000;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
          server.close();
          reject(new Error("desktop model proxy must bind 127.0.0.1"));
          return;
        }
        this.server = server;
        this.port = address.port;
        this.load();
        for (const person of this.people.keys()) this.syncPerson(person);
        resolve();
      });
    });
  }

  portNumber(): number {
    return this.port;
  }

  close(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
    for (const id of this.hostMeta.keys()) removeDesktopInjectHost(id);
    this.hostMeta.clear();
  }

  read(person: string): DesktopLocalModelView {
    this.load();
    const key = person.trim().toLowerCase();
    const stored = key ? this.people.get(key) : undefined;
    const settings = stored ?? defaultSettings();
    const pub = key && settings.expose ? this.published.get(key) : undefined;
    return {
      expose: settings.expose,
      share: settings.share,
      endpoints: settings.endpoints.map((row) => ({ ...row })),
      published: (pub?.endpoints ?? []).filter((row) => settings.endpoints.some((endpoint) => endpoint.id === row.id)),
      connected: key ? this.bridges.connected(key) : false,
    };
  }

  update(person: string, body: unknown): { ok: true; value: DesktopLocalModelView } | { ok: false; error: string } {
    this.load();
    const key = person.trim().toLowerCase();
    if (!key) return { ok: false, error: "Sign in first." };
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: INVALID_BASE };
    const record = body as Record<string, unknown>;
    for (const name of Object.keys(record)) {
      if (name !== "expose" && name !== "share" && name !== "endpoints") return { ok: false, error: INVALID_BASE };
    }
    const current = this.people.get(key) ?? defaultSettings();
    let expose = current.expose;
    let share = current.share;
    let endpoints = current.endpoints.map((row) => ({ ...row }));
    if (record.expose !== undefined) {
      if (typeof record.expose !== "boolean") return { ok: false, error: INVALID_BASE };
      expose = record.expose;
    }
    if (record.share !== undefined) {
      if (typeof record.share !== "boolean") return { ok: false, error: INVALID_BASE };
      share = record.share;
    }
    if (record.endpoints !== undefined) {
      const assigned = assignEndpoints(record.endpoints);
      if (!assigned.ok) return assigned;
      endpoints = assigned.endpoints;
    }
    this.people.set(key, { expose, share, endpoints });
    if (!expose) this.published.delete(key);
    this.save();
    this.syncPerson(key);
    return { ok: true, value: this.read(key) };
  }

  /** Catalog from the owning desktop: ids, labels, and model ids. No URLs. */
  publish(person: string, body: unknown): { ok: true } | { ok: false; error: string } {
    this.load();
    const key = person.trim().toLowerCase();
    // Someone who never changed the switches publishes under the defaults.
    // Held in memory only: the file keeps what the person chose.
    if (key && !this.people.has(key)) {
      this.people.set(key, defaultSettings());
      this.syncPerson(key);
    }
    const settings = key ? this.people.get(key) : undefined;
    if (!settings?.expose) {
      if (key) this.published.delete(key);
      return { ok: true };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid local model catalog." };
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((name) => name !== "endpoints")) return { ok: false, error: "Invalid local model catalog." };
    if (!Array.isArray(record.endpoints) || record.endpoints.length > 20) return { ok: false, error: "Invalid local model catalog." };
    const allowed = new Set(settings.endpoints.map((row) => row.id));
    const endpoints: PublishedEndpoint[] = [];
    for (const item of record.endpoints) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Invalid local model catalog." };
      const row = item as Record<string, unknown>;
      if (Object.keys(row).some((name) => name !== "id" && name !== "label" && name !== "models" && name !== "details")) return { ok: false, error: "Invalid local model catalog." };
      if (typeof row.id !== "string" || !allowed.has(row.id) || !Array.isArray(row.models)) continue;
      const models: string[] = [];
      for (const model of row.models) {
        if (typeof model !== "string" || !usableModel(model) || models.includes(model)) continue;
        models.push(model);
        if (models.length >= 200) break;
      }
      if (!models.length) continue;
      const details = parseDetails(row.details, models);
      if (details === null) return { ok: false, error: "Invalid local model catalog." };
      const saved = settings.endpoints.find((endpoint) => endpoint.id === row.id);
      endpoints.push({ id: row.id, label: cleanLabel(row.label, saved?.label ?? ""), models, ...(details ? { details } : {}) });
    }
    this.published.set(key, { endpoints });
    return { ok: true };
  }

  /** Picker rows for this person. Shared rows are included. Offline desktops are omitted. */
  modelsFor(viewer: string | null): InjectedModel[] {
    if (!this.port) return [];
    this.load();
    const who = viewer?.trim().toLowerCase() || "";
    const out: InjectedModel[] = [];
    for (const [owner, settings] of this.people) {
      if (!settings.expose || !this.bridges.connected(owner)) continue;
      if (who !== owner && !settings.share) continue;
      const pub = this.published.get(owner);
      if (!pub) continue;
      const computer = this.bridges.current(owner)?.name?.trim() || "Computer";
      for (const endpoint of pub.endpoints) {
        if (!settings.endpoints.some((row) => row.id === endpoint.id)) continue;
        const hostId = injectHostId(owner, endpoint.id);
        if (!hostId || !this.hostMeta.has(hostId)) continue;
        // Your own computer reads "DwarfStar: Qwen3.8 Flash Next"; someone
        // else's shared one names that computer too.
        const server = who === owner ? endpoint.label || computer : `${endpoint.label || "Local"} (${computer})`;
        const labels = localModelLabels(server, endpoint.models.map((model) => ({ id: model, ...(endpoint.details?.[model]?.name ? { name: endpoint.details[model]!.name } : {}) })));
        for (const model of endpoint.models) {
          const contextWindow = endpoint.details?.[model]?.contextWindow;
          out.push({ id: encodeInjectId(hostId, model), host: hostId, model, label: labels.get(model) ?? model, ...(contextWindow ? { contextWindow } : {}) });
        }
      }
    }
    return out;
  }

  /** A desk inject id that this person may not run, or that this engine
   * cannot run (Claude Code needs the Anthropic protocol, the bridge
   * carries OpenAI-compatible calls only), fails the turn before any CLI starts. */
  assertAvailable(person: string | null, model: string | null | undefined, driverKind?: string): void {
    if (!isDesktopInjectModel(model)) return;
    if (driverKind !== undefined && localModelUnavailable(driverKind, "desktop")) throw new Error(DESKTOP_MODEL_WRONG_ENGINE);
    if (!this.available(person, model ?? "")) throw new Error(DESKTOP_MODEL_UNAVAILABLE);
  }

  available(person: string | null, modelId: string): boolean {
    const decoded = decodeInjectId(modelId);
    if (!decoded || !isDesktopHostId(decoded.host)) return false;
    const meta = this.hostMeta.get(decoded.host);
    if (!meta) return false;
    const settings = this.people.get(meta.person);
    if (!settings?.expose) return false;
    const who = person?.trim().toLowerCase() || "";
    if (who !== meta.person && !settings.share) return false;
    if (!this.bridges.connected(meta.person)) return false;
    const endpoint = this.published.get(meta.person)?.endpoints.find((row) => row.id === meta.endpointId);
    return Boolean(endpoint?.models.includes(decoded.model));
  }

  overlay<T extends { models: { default: string; options: ModelOption[] } }>(instances: T[], person: string | null): T[] {
    const rows = this.modelsFor(person);
    return instances.map((instance) => {
      const options = instance.models.options.filter((option) => !isDesktopInjectModel(option.id));
      for (const row of rows) options.push({ id: row.id, label: row.label, custom: true, local: true, ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}) });
      return { ...instance, models: { ...instance.models, options } };
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await this.route(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(503, textHeaders);
        res.end(DESKTOP_MODEL_UNAVAILABLE);
      }
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") {
      res.writeHead(403, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      res.writeHead(405, textHeaders);
      res.end("This local model request was refused.");
      return;
    }
    let url: URL;
    try { url = new URL(req.url ?? "/", "http://127.0.0.1"); } catch {
      res.writeHead(400, textHeaders);
      res.end("This local model request was refused.");
      return;
    }
    if (url.search) {
      res.writeHead(400, textHeaders);
      res.end("This local model request was refused.");
      return;
    }
    const match = /^\/d\/(desk[a-z0-9]{3,24})\/v1(\/models|\/chat\/completions)$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404, textHeaders);
      res.end("This local model request was refused.");
      return;
    }
    const hostId = match[1]!;
    const httpPath = match[2] as "/models" | "/chat/completions";
    const meta = this.hostMeta.get(hostId);
    const caller = personForDesktopGrant(tokenFrom(req));
    if (!meta || !caller) {
      res.writeHead(403, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    const settings = this.people.get(meta.person);
    if (!settings?.expose || (caller !== meta.person && !settings.share)) {
      res.writeHead(403, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    if (!this.bridges.connected(meta.person)) {
      res.writeHead(503, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    const stillPublished = this.published.get(meta.person)?.endpoints.some((row) => row.id === meta.endpointId);
    if (!stillPublished) {
      res.writeHead(503, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    const json = method === "POST" ? await readLimited(req, REQUEST_CAP) : "";
    if (json === null) {
      res.writeHead(413, textHeaders);
      res.end("This local model request was refused.");
      return;
    }
    // The bridge returns one complete() result, so a chat completion is
    // buffered up to the body cap and the bridge job timeout. There is no
    // second channel.
    let result: unknown;
    try {
      result = await this.bridges.request(meta.person, {
        action: "local_model",
        endpoint: meta.endpointId,
        http_method: method,
        http_path: httpPath,
        ...(method === "POST" ? { json } : {}),
        timeout_seconds: httpPath === "/models" ? 30 : 240,
      }, () => true);
    } catch {
      res.writeHead(503, textHeaders);
      res.end(DESKTOP_MODEL_UNAVAILABLE);
      return;
    }
    const record = result && typeof result === "object"
      ? result as { isError?: boolean; localModel?: { status?: unknown; contentType?: unknown; body?: unknown } }
      : null;
    if (!record || record.isError || typeof record.localModel?.body !== "string") {
      res.writeHead(502, textHeaders);
      res.end("The local model request failed.");
      return;
    }
    if (record.localModel.body.length > RESPONSE_CAP) {
      res.writeHead(502, textHeaders);
      res.end("The local model response is too large.");
      return;
    }
    const status = typeof record.localModel.status === "number" && record.localModel.status >= 100 && record.localModel.status <= 599
      ? record.localModel.status
      : 502;
    res.writeHead(status, { "content-type": safeType(record.localModel.contentType), "cache-control": "no-store" });
    res.end(record.localModel.body);
  }

  private syncPerson(person: string): void {
    for (const [id, meta] of this.hostMeta) {
      if (meta.person !== person) continue;
      this.hostMeta.delete(id);
      removeDesktopInjectHost(id);
    }
    const settings = this.people.get(person);
    if (!settings?.expose || !this.port) return;
    for (const endpoint of settings.endpoints) {
      const id = injectHostId(person, endpoint.id);
      if (!id) continue;
      const baseUrl = `http://127.0.0.1:${this.port}/d/${id}/v1`;
      try {
        upsertDesktopInjectHost({ id, label: endpoint.label || "Computer", baseUrl });
      } catch {
        continue;
      }
      this.hostMeta.set(id, { person, endpointId: endpoint.id });
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { people?: unknown };
      if (!raw || typeof raw !== "object" || !raw.people || typeof raw.people !== "object") return;
      for (const [person, value] of Object.entries(raw.people as Record<string, unknown>)) {
        const parsed = parseStored(value);
        const key = person.trim().toLowerCase();
        if (parsed && key) this.people.set(key, parsed);
      }
    } catch { /* missing or unreadable: both switches stay off */ }
  }

  private save(): void {
    const people: Record<string, PersonSettings> = {};
    for (const [person, settings] of this.people) people[person] = settings;
    writeFileAtomic(this.file, JSON.stringify({ people }), { mode: 0o600 });
  }
}

function parseStored(value: unknown): PersonSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.expose !== "boolean" || typeof record.share !== "boolean" || !Array.isArray(record.endpoints)) return null;
  const assigned = assignEndpoints(record.endpoints);
  if (!assigned.ok) return { expose: record.expose, share: record.share, endpoints: [] };
  return { expose: record.expose, share: record.share, endpoints: assigned.endpoints };
}
