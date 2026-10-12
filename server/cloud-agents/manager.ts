import {
  cloudAgentStatusActive,
  normalizeCloudAgentStatus,
  type CloudAgentFollowUpInput,
  type CloudAgentLaunchInput,
  type CloudAgentRecord,
  type CloudAgentProviderId,
} from "../../shared/cloud-agents.ts";
import type { CloudAgentCredentialStore } from "./credentials.ts";
import type { CloudAgentStore } from "./store.ts";
import type { CloudAgentProviderAdapter } from "./providers/types.ts";
import { ProviderHttpError } from "./providers/http.ts";

export interface CloudAgentCompletionEvent {
  record: CloudAgentRecord;
  summary: string;
}

export interface CloudAgentManagerDeps {
  store: CloudAgentStore;
  credentials: CloudAgentCredentialStore;
  providers: Map<CloudAgentProviderId, CloudAgentProviderAdapter>;
  now?: () => number;
  onComplete?: (event: CloudAgentCompletionEvent) => void;
  onChange?: (record: CloudAgentRecord) => void;
}

const TERMINAL = new Set(["finished", "failed", "cancelled", "archived"]);

export class CloudAgentManager {
  private readonly now: () => number;
  private readonly deps: CloudAgentManagerDeps;
  constructor(deps: CloudAgentManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private provider(id: CloudAgentProviderId): CloudAgentProviderAdapter {
    const adapter = this.deps.providers.get(id);
    if (!adapter) throw new Error(`unknown provider ${id}`);
    return adapter;
  }

  private token(principalId: string, provider: CloudAgentProviderId): string {
    const value = this.deps.credentials.token(principalId, provider);
    if (!value) throw new ProviderHttpError(401, "not_configured", `No API key configured for ${provider}.`);
    return value;
  }

  list(botId: string): CloudAgentRecord[] {
    return this.deps.store.listForBot(botId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): CloudAgentRecord | null {
    return this.deps.store.get(id);
  }

  async launch(input: {
    botId: string;
    threadId: string;
    principalId: string;
    launch: CloudAgentLaunchInput;
  }): Promise<CloudAgentRecord> {
    const adapter = this.provider(input.launch.provider);
    const token = this.token(input.principalId, input.launch.provider);
    const launched = await adapter.launch(token, input.launch);
    const record = this.deps.store.create({
      botId: input.botId,
      threadId: input.threadId,
      principalId: input.principalId,
      provider: input.launch.provider,
      externalId: launched.externalId,
      name: launched.name,
      repos: input.launch.repos ?? [],
      model: input.launch.model,
      url: launched.url,
      latestRunId: launched.latestRunId,
      status: normalizeCloudAgentStatus(launched.status),
    });
    this.deps.onChange?.(record);
    void this.syncOne(record.id);
    return record;
  }

  async followUp(id: string, principalId: string, body: CloudAgentFollowUpInput): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    if (body.mode === "queue" && cloudAgentStatusActive(record.status) && record.status !== "idle") {
      const queued = this.deps.store.patch(id, { pendingFollowUp: { text: body.text, at: this.now() }, status: "running" });
      if (!queued) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
      this.deps.onChange?.(queued);
      return queued;
    }
    const adapter = this.provider(record.provider);
    const snap = await adapter.followUp(this.token(principalId, record.provider), record, body);
    const next = this.applySnapshot(record.id, snap, { clearPending: true });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    return next;
  }

  async cancel(id: string, principalId: string): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    await this.provider(record.provider).cancel(this.token(principalId, record.provider), record);
    const next = this.deps.store.patch(id, { status: "cancelled", endedAt: this.now() });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    this.maybeComplete(next);
    return next;
  }

  async archive(id: string, principalId: string): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    await this.provider(record.provider).archive(this.token(principalId, record.provider), record);
    const next = this.deps.store.patch(id, { status: "archived", archived: true, endedAt: this.now() });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    return next;
  }

  async refresh(id: string): Promise<CloudAgentRecord | null> {
    return this.syncOne(id);
  }

  async syncBot(botId: string): Promise<void> {
    for (const record of this.deps.store.listForBot(botId)) {
      if (!record.archived && (cloudAgentStatusActive(record.status) || record.pendingFollowUp)) {
        await this.syncOne(record.id);
      }
    }
  }

  /** Poll every active cloud agent (all bots). */
  async syncActive(): Promise<void> {
    for (const record of this.deps.store.listAll()) {
      if (!record.archived && (cloudAgentStatusActive(record.status) || record.pendingFollowUp)) {
        await this.syncOne(record.id);
      }
    }
  }

  async testCredential(principalId: string, provider: CloudAgentProviderId, token?: string): Promise<void> {
    const value = token?.trim() || this.deps.credentials.token(principalId, provider);
    if (!value) throw new ProviderHttpError(401, "not_configured", `No API key configured for ${provider}.`);
    await this.provider(provider).testToken(value);
  }

  private applySnapshot(id: string, snap: { status: string; result?: string; error?: string; latestRunId?: string; gitBranches?: CloudAgentRecord["gitBranches"] }, extra?: { clearPending?: boolean }) {
    const status = normalizeCloudAgentStatus(snap.status);
    const ended = TERMINAL.has(status);
    return this.deps.store.patch(id, {
      status,
      ...(snap.latestRunId ? { latestRunId: snap.latestRunId } : {}),
      ...(snap.result ? { lastResult: snap.result } : {}),
      ...(snap.error ? { error: snap.error } : {}),
      ...(snap.gitBranches ? { gitBranches: snap.gitBranches } : {}),
      ...(ended ? { endedAt: this.now() } : {}),
      ...(extra?.clearPending ? { pendingFollowUp: undefined } : {}),
    });
  }

  private async syncOne(id: string): Promise<CloudAgentRecord | null> {
    const record = this.deps.store.get(id);
    if (!record || record.archived) return record;
    try {
      const snap = await this.provider(record.provider).refresh(this.token(record.principalId, record.provider), record);
      let next = this.applySnapshot(id, snap);
      if (!next) return null;
      if (next.pendingFollowUp && (next.status === "idle" || next.status === "finished")) {
        const text = next.pendingFollowUp.text;
        next = await this.followUp(id, next.principalId, { text, mode: "queue" });
      }
      this.deps.onChange?.(next);
      this.maybeComplete(next);
      return next;
    } catch (e) {
      if (e instanceof ProviderHttpError && e.status === 401) {
        const failed = this.deps.store.patch(id, { status: "failed", error: "Provider credentials refused.", endedAt: this.now() });
        if (failed) this.maybeComplete(failed);
        return failed;
      }
      throw e;
    }
  }

  private maybeComplete(record: CloudAgentRecord): void {
    if (record.completionNotified || !TERMINAL.has(record.status)) return;
    const summary = record.lastResult?.trim()
      || record.error?.trim()
      || `Cloud agent ${record.name} finished (${record.status}).`;
    const marked = this.deps.store.patch(record.id, { completionNotified: true });
    if (marked) this.deps.onComplete?.({ record: marked, summary });
  }

  async artifacts(id: string, principalId: string) {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    return this.provider(record.provider).listArtifacts(this.token(principalId, record.provider), record);
  }

  async transcript(id: string, principalId: string) {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    return this.provider(record.provider).transcript(this.token(principalId, record.provider), record);
  }

  async findByPr(principalId: string, provider: CloudAgentProviderId, prUrl: string) {
    const local = this.deps.store.findByPrUrl(prUrl);
    if (local) return local;
    const hit = await this.provider(provider).findByPr(this.token(principalId, provider), prUrl);
    if (!hit) return null;
    return this.deps.store.findByExternal(provider, hit.externalId);
  }
}
