// A local, in-process fake of Perspicax's runner routes for sagax-runner
// tests (contract runner <-> Perspicax, 2026-10-19): bootstrap, secrets
// (once, 409 after), events, long-polled commands, bundle, and the read-only
// git endpoint over smart HTTP (git-upload-pack against a local bare
// repository; git-receive-pack answers 403). No network beyond loopback.
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";

export interface FakeCommand { seq: number; kind: string; data: Record<string, unknown> }

export interface FakePerspicaxOptions {
  token: string;
  /** The bare repository the git endpoint serves. */
  bareRepo: string;
  bootstrap: (base: string) => Record<string, unknown>;
  secrets?: Array<{ name: string; value: string; setup_only?: boolean }>;
}

export class FakePerspicax {
  readonly events: Array<{ kind: string; data: Record<string, unknown> }> = [];
  readonly bundles: Buffer[] = [];
  readonly requests: Array<{ method: string; path: string; auth: string | undefined }> = [];
  readonly gitRequests: string[] = [];
  secretsCalls = 0;
  /** Every route answers 401 from now on. */
  revoked = false;
  /** Called on each events POST (after recording). */
  onEvents: ((events: Array<{ kind: string; data: Record<string, unknown> }>) => void) | null = null;
  bundleStatus = 200;
  /** Answer {status: "refused", reason} to the next bundle (once). */
  bundleRefuseOnce: string | null = null;
  /** Answer 503 to this many bootstrap calls first. */
  bootstrapFailures = 0;
  /** Answer this status to the next events POST (once), e.g. 422. */
  eventsStatusOnce: number | null = null;
  private commands: FakeCommand[] = [];
  private seq = 0;
  private waiters: Array<() => void> = [];
  private server: Server | null = null;
  base = "";
  private options: FakePerspicaxOptions;

  constructor(options: FakePerspicaxOptions) {
    this.options = options;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.base = `http://127.0.0.1:${port}`;
    return this.base;
  }

  async close(): Promise<void> {
    for (const wake of this.waiters.splice(0)) wake();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.server?.closeAllConnections?.();
  }

  get gitUrl(): string {
    return `${this.base}/api/v1/agents/runner/git/acme/widgets.git`;
  }

  get modelProxy(): { anthropic: string; openai: string } {
    return { anthropic: `${this.base}/api/v1/agents/model-proxy/anthropic`, openai: `${this.base}/api/v1/agents/model-proxy/openai` };
  }

  /** A new Pod of the same run (a followup): same address, new bootstrap,
   * secrets handed out again, fresh records. */
  newPod(bootstrap: (base: string) => Record<string, unknown>): void {
    this.options.bootstrap = bootstrap;
    this.secretsCalls = 0;
    this.events.length = 0;
    this.bundles.length = 0;
  }

  /** The seq of the last command pushed (a bootstrap's commands_after). */
  get lastSeq(): number {
    return this.seq;
  }

  push(kind: string, data: Record<string, unknown> = {}): number {
    const seq = ++this.seq;
    this.commands.push({ seq, kind, data });
    for (const wake of this.waiters.splice(0)) wake();
    return seq;
  }

  /** Resolves when an event matching `match` has been received. */
  async waitFor(match: (event: { kind: string; data: Record<string, unknown> }) => boolean, timeoutMs = 20_000): Promise<{ kind: string; data: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for an event; got ${JSON.stringify(this.events.map((e) => e.kind === "state" ? `state:${String(e.data.state)}` : e.kind))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  states(): string[] {
    return this.events.filter((e) => e.kind === "state").map((e) => String(e.data.state));
  }

  private async body(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    return req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.base);
    const auth = req.headers.authorization;
    this.requests.push({ method: req.method ?? "", path: url.pathname, auth });
    if (this.revoked || auth !== `Bearer ${this.options.token}`) {
      await this.body(req).catch(() => undefined);
      return this.json(res, 401, { error: "a run token is required" });
    }
    const path = url.pathname;
    const api = "/api/v1/agents/runner";
    if (path.startsWith(`${api}/git/acme/widgets.git/`)) return this.git(req, res, path.slice(`${api}/git/acme/widgets.git/`.length), url);
    if (req.method === "GET" && path === `${api}/bootstrap`) {
      if (this.bootstrapFailures > 0) { this.bootstrapFailures--; return this.json(res, 503, { error: "starting" }); }
      return this.json(res, 200, this.options.bootstrap(this.base));
    }
    if (req.method === "GET" && path === `${api}/secrets`) {
      this.secretsCalls++;
      if (this.secretsCalls > 1) return this.json(res, 409, { error: "already handed out" });
      return this.json(res, 200, { secrets: this.options.secrets ?? [] });
    }
    if (req.method === "POST" && path === `${api}/events`) {
      const raw = await this.body(req);
      let body: { events: Array<{ kind: string; data: Record<string, unknown> }> };
      try { body = JSON.parse(raw.toString("utf8")); } catch { return this.json(res, 400, { error: "not JSON" }); }
      if (body.events.length > 256 || raw.length > 1024 * 1024) return this.json(res, 413, { error: "too big" });
      if (this.eventsStatusOnce) { const status = this.eventsStatusOnce; this.eventsStatusOnce = null; return this.json(res, status, { error: "refused" }); }
      this.events.push(...body.events);
      this.onEvents?.(body.events);
      return this.json(res, 200, { accepted: body.events.length });
    }
    if (req.method === "GET" && path === `${api}/commands`) {
      const after = Number(url.searchParams.get("after") ?? "0");
      const wait = Math.min(25, Number(url.searchParams.get("wait") ?? "0"));
      const ready = () => this.commands.filter((c) => c.seq > after);
      if (!ready().length && wait > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait * 1000);
          this.waiters.push(() => { clearTimeout(timer); resolve(); });
        });
      }
      if (this.revoked) return this.json(res, 401, { error: "revoked" });
      return this.json(res, 200, { commands: ready() });
    }
    if (req.method === "POST" && path === `${api}/bundle`) {
      const bytes = await this.body(req);
      this.bundles.push(bytes);
      if (this.bundleStatus !== 200) return this.json(res, this.bundleStatus, { error: "refused" });
      const head = /^([0-9a-f]{40}) refs\/heads\//m.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1];
      if (this.bundleRefuseOnce) { const reason = this.bundleRefuseOnce; this.bundleRefuseOnce = null; return this.json(res, 200, { status: "refused", head_sha: head, reason }); }
      return this.json(res, 200, { status: "received", head_sha: head });
    }
    return this.json(res, 404, { error: "no route" });
  }

  private async git(req: IncomingMessage, res: ServerResponse, rest: string, url: URL): Promise<void> {
    this.gitRequests.push(`${req.method} ${rest}${url.search}`);
    const service = url.searchParams.get("service");
    if (rest === "git-receive-pack" || service === "git-receive-pack") {
      await this.body(req).catch(() => undefined);
      res.writeHead(403, { "content-type": "text/plain" });
      return void res.end("push refused: Perspicax pushes for the run\n");
    }
    if (req.method === "GET" && rest === "info/refs" && service === "git-upload-pack") {
      const out = await runUploadPack(["--stateless-rpc", "--advertise-refs", this.options.bareRepo], Buffer.alloc(0));
      const line = "# service=git-upload-pack\n";
      const pkt = `${(line.length + 4).toString(16).padStart(4, "0")}${line}0000`;
      res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement", "cache-control": "no-cache" });
      return void res.end(Buffer.concat([Buffer.from(pkt), out]));
    }
    if (req.method === "POST" && rest === "git-upload-pack") {
      const body = await this.body(req);
      const out = await runUploadPack(["--stateless-rpc", this.options.bareRepo], body);
      res.writeHead(200, { "content-type": "application/x-git-upload-pack-result", "cache-control": "no-cache" });
      return void res.end(out);
    }
    res.writeHead(404);
    res.end();
  }
}

function runUploadPack(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["upload-pack", ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(out)));
    child.stdin.end(input);
  });
}
