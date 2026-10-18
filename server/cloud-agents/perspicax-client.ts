// A client of Perspicax's cloud agents API (`/api/v1/agents`, Perspicax PR
// #372, lot P1.1; its spec section 10.1). Sagax calls it with the person's
// own sign-in token: there is no key to paste and none is stored here.
//
// Rules, none optional:
//   - the token goes in `Authorization: Bearer` only, never in a URL, an
//     error or a log line;
//   - every call has a timeout; a non-2xx answer becomes a ProviderHttpError
//     with Perspicax's own message (quota refusals are shown as they are);
//   - ids are checked before they reach a path;
//   - the artifact routes (diff, commits, files) belong to a later Perspicax
//     lot: a 404 or 405 there is "not available yet", not an error.
import type {
  PerspicaxEnvironment,
  PerspicaxNewRun,
  PerspicaxPage,
  PerspicaxRun,
  RunEvent,
} from "../../shared/cloud-agents.ts";
import { diffFilesFrom, type CodeArtifact, type CodeCommit, type CodeFileEntry, type DiffFile, type FollowUpMode } from "../../shared/code-runs.ts";
import { ProviderHttpError } from "./providers/http.ts";
import type { HttpFetch } from "./providers/types.ts";

export const PERSPICAX_AGENTS_PATH = "/api/v1/agents";
export const PERSPICAX_TIMEOUT_MS = 10_000;
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface PerspicaxAccess {
  /** Perspicax's origin (the issuer). */
  baseUrl: string;
  /** The person's access token. */
  token: string;
}

function checkId(id: string): string {
  if (!ID.test(id)) throw new ProviderHttpError(400, "bad_id", "Invalid run or environment id.");
  return encodeURIComponent(id);
}

export class PerspicaxAgentsClient {
  private readonly fetchImpl: HttpFetch;
  private readonly timeoutMs: number;
  constructor(fetchImpl: HttpFetch = fetch, timeoutMs = PERSPICAX_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private url(access: PerspicaxAccess, path: string): string {
    const base = new URL(access.baseUrl);
    return new URL(`${PERSPICAX_AGENTS_PATH}${path}`, base.origin).toString();
  }

  private async call<T>(access: PerspicaxAccess, method: string, path: string, body?: unknown, optional = false): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(access, path), {
        method,
        headers: {
          authorization: `Bearer ${access.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderHttpError(502, "unreachable", "Perspicax did not answer.");
    }
    if (optional && (res.status === 404 || res.status === 405 || res.status === 501)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readCapped(res);
    if (!res.ok) {
      let message = `Perspicax answered ${res.status}.`;
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const said = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
        if (said.trim()) message = said.trim().slice(0, 500);
      } catch {}
      throw new ProviderHttpError(res.status, res.status === 409 ? "conflict" : "perspicax", message);
    }
    if (!text) return {} as T;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) return text as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderHttpError(502, "bad_answer", "Perspicax sent an unreadable answer.");
    }
  }

  private async must<T>(access: PerspicaxAccess, method: string, path: string, body?: unknown): Promise<T> {
    return (await this.call<T>(access, method, path, body)) as T;
  }

  /** A run, or a `{ value: run }` mutation answer, checked for its id. */
  private async runAnswer(access: PerspicaxAccess, method: string, path: string, body?: unknown, wrapped = false): Promise<PerspicaxRun> {
    const answer = await this.must<unknown>(access, method, path, body);
    const run = wrapped && answer && typeof answer === "object" ? (answer as { value?: unknown }).value : answer;
    if (!run || typeof run !== "object" || typeof (run as { id?: unknown }).id !== "string") {
      throw new ProviderHttpError(502, "bad_answer", "Perspicax sent an unreadable run.");
    }
    return run as PerspicaxRun;
  }

  async environments(access: PerspicaxAccess): Promise<PerspicaxEnvironment[]> {
    const page = await this.must<PerspicaxPage<PerspicaxEnvironment>>(access, "GET", "/environments?page_size=200");
    return Array.isArray(page?.items) ? page.items.filter((env) => !env.archived) : [];
  }

  async runs(access: PerspicaxAccess, query: { mine?: boolean; envId?: string; state?: string } = {}): Promise<PerspicaxRun[]> {
    const params = new URLSearchParams({ page_size: "200" });
    if (query.mine) params.set("mine", "true");
    if (query.envId) params.set("env_id", query.envId);
    if (query.state) params.set("state", query.state);
    const page = await this.must<PerspicaxPage<PerspicaxRun>>(access, "GET", `/runs?${params}`);
    return Array.isArray(page?.items) ? page.items : [];
  }

  async run(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "GET", `/runs/${checkId(id)}`);
  }

  async create(access: PerspicaxAccess, input: PerspicaxNewRun): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", "/runs", input, true);
  }

  async events(access: PerspicaxAccess, id: string, after = 0): Promise<RunEvent[]> {
    const list = await this.must<RunEvent[]>(access, "GET", `/runs/${checkId(id)}/events?after=${Math.max(0, Math.floor(after))}&limit=1000`);
    return Array.isArray(list) ? list : [];
  }

  async markRead(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/read`, {});
  }

  async followUp(access: PerspicaxAccess, id: string, text: string, mode: FollowUpMode): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/followup`, { text, mode }, true);
  }

  async approve(access: PerspicaxAccess, id: string, approvalId: string, option: string): Promise<void> {
    await this.must<unknown>(access, "POST", `/runs/${checkId(id)}/approve`, { approval_id: approvalId, option });
  }

  async stop(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/stop`, {}, true);
  }

  async archive(access: PerspicaxAccess, id: string): Promise<PerspicaxRun> {
    return this.runAnswer(access, "POST", `/runs/${checkId(id)}/archive`, {}, true);
  }

  async diff(access: PerspicaxAccess, id: string): Promise<CodeArtifact<DiffFile>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/diff`, undefined, true);
    return answer === null ? { available: false, items: [] } : { available: true, items: diffFilesFrom(answer) };
  }

  async commits(access: PerspicaxAccess, id: string): Promise<CodeArtifact<CodeCommit>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/commits`, undefined, true);
    if (answer === null) return { available: false, items: [] };
    const rows = Array.isArray(answer) ? answer : Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : [];
    const items: CodeCommit[] = rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const c = row as Record<string, unknown>;
      if (typeof c.sha !== "string") return [];
      return [{
        sha: c.sha,
        title: typeof c.title === "string" ? c.title : typeof c.message === "string" ? c.message.split("\n")[0]! : "",
        ...(typeof c.author === "string" ? { author: c.author } : {}),
        ...(typeof c.at === "string" ? { at: c.at } : {}),
      }];
    });
    return { available: true, items };
  }

  async files(access: PerspicaxAccess, id: string): Promise<CodeArtifact<CodeFileEntry>> {
    const answer = await this.call<unknown>(access, "GET", `/runs/${checkId(id)}/files`, undefined, true);
    if (answer === null) return { available: false, items: [] };
    const rows = Array.isArray(answer) ? answer : Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : [];
    const items: CodeFileEntry[] = rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const f = row as Record<string, unknown>;
      if (typeof f.path !== "string") return [];
      return [{ path: f.path, kind: f.kind === "dir" ? "dir" as const : "file" as const, ...(typeof f.size === "number" ? { size: f.size } : {}) }];
    });
    return { available: true, items };
  }

  /** The run's live events (`/runs/:id/stream`), parsed from SSE. Ends when
   * Perspicax closes the stream or `signal` aborts. */
  async *stream(access: PerspicaxAccess, id: string, after: number, signal: AbortSignal): AsyncGenerator<RunEvent> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(access, `/runs/${checkId(id)}/stream?after=${Math.max(0, Math.floor(after))}`), {
        headers: { authorization: `Bearer ${access.token}`, accept: "text/event-stream" },
        signal,
      });
    } catch {
      if (signal.aborted) return;
      throw new ProviderHttpError(502, "unreachable", "Perspicax did not answer.");
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new ProviderHttpError(res.status || 502, "perspicax", `Perspicax answered ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as RunEvent;
            if (event && typeof event.seq === "number" && typeof event.kind === "string") yield event;
          } catch {}
        }
        if (buffer.length > ANSWER_MAX_BYTES) buffer = "";
      }
    } catch (error) {
      if (signal.aborted) return;
      throw new ProviderHttpError(502, "unreachable", error instanceof Error && error.name === "AbortError" ? "Perspicax stream aborted." : "Perspicax stream broke.");
    } finally {
      reader.releaseLock();
      try { await res.body.cancel(); } catch {}
    }
  }
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ANSWER_MAX_BYTES) {
      await reader.cancel();
      throw new ProviderHttpError(502, "too_large", "Perspicax sent too large an answer.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
