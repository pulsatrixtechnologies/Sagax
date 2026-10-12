// Per-bot cloud agent job records (local mirror of provider state).
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { CloudAgentRecord, CloudAgentRepoRef, CloudAgentProviderId, CloudAgentStatus } from "../../shared/cloud-agents.ts";

const repoSchema = z.object({
  url: z.string().min(1).max(2_048),
  ref: z.string().max(256).optional(),
  prUrl: z.string().max(2_048).optional(),
}).strict();

const gitBranchSchema = z.object({
  repoUrl: z.string().max(2_048).optional(),
  branch: z.string().max(256).optional(),
  prUrl: z.string().max(2_048).optional(),
}).strict();

const recordSchema = z.object({
  id: z.string().regex(/^ca_[0-9a-f-]{36}$/),
  botId: z.string().min(1).max(80),
  threadId: z.string().min(1).max(80),
  principalId: z.string().min(1).max(120),
  provider: z.enum(["cursor", "claude", "codex"]),
  externalId: z.string().min(1).max(200),
  name: z.string().max(200),
  status: z.enum(["creating", "running", "idle", "finished", "failed", "cancelled", "archived"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  latestRunId: z.string().max(200).optional(),
  url: z.string().max(2_048).optional(),
  model: z.string().max(200).optional(),
  repos: z.array(repoSchema),
  gitBranches: z.array(gitBranchSchema),
  lastResult: z.string().max(100_000).optional(),
  error: z.string().max(4_000).optional(),
  archived: z.boolean(),
  completionNotified: z.boolean(),
  pendingFollowUp: z.object({ text: z.string().max(50_000), at: z.number() }).strict().optional(),
}).strict();

const fileSchema = z.object({
  version: z.literal(1),
  agents: z.array(recordSchema),
}).strict();

export class CloudAgentStore {
  private readonly file: string;
  private doc: z.infer<typeof fileSchema> | null = null;

  constructor(dataDir: string) {
    mkdirSync(join(dataDir, "cloud-agents"), { recursive: true });
    this.file = join(dataDir, "cloud-agents", "records.json");
  }

  private load(): z.infer<typeof fileSchema> {
    if (this.doc) return this.doc;
    try {
      this.doc = fileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      this.doc = { version: 1, agents: [] };
    }
    return this.doc;
  }

  private save(): void {
    const doc = this.load();
    writeFileAtomic(this.file, JSON.stringify(doc, null, 0), { mode: 0o600 });
  }

  listForBot(botId: string): CloudAgentRecord[] {
    return this.load().agents.filter((a) => a.botId === botId);
  }

  listAll(): CloudAgentRecord[] {
    return this.load().agents;
  }

  get(id: string): CloudAgentRecord | null {
    return this.load().agents.find((a) => a.id === id) ?? null;
  }

  findByExternal(provider: CloudAgentProviderId, externalId: string): CloudAgentRecord | null {
    return this.load().agents.find((a) => a.provider === provider && a.externalId === externalId) ?? null;
  }

  findByPrUrl(prUrl: string): CloudAgentRecord | null {
    const needle = prUrl.trim().toLowerCase();
    return this.load().agents.find((a) =>
      a.gitBranches.some((b) => b.prUrl?.toLowerCase() === needle) ||
      a.repos.some((r) => r.prUrl?.toLowerCase() === needle),
    ) ?? null;
  }

  create(input: {
    botId: string;
    threadId: string;
    principalId: string;
    provider: CloudAgentProviderId;
    externalId: string;
    name: string;
    repos: CloudAgentRepoRef[];
    model?: string;
    url?: string;
    latestRunId?: string;
    status?: CloudAgentStatus;
  }): CloudAgentRecord {
    const now = Date.now();
    const record: CloudAgentRecord = {
      id: `ca_${randomUUID()}`,
      botId: input.botId,
      threadId: input.threadId,
      principalId: input.principalId,
      provider: input.provider,
      externalId: input.externalId,
      name: input.name.slice(0, 200),
      status: input.status ?? "creating",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      repos: input.repos,
      gitBranches: [],
      archived: false,
      completionNotified: false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.latestRunId ? { latestRunId: input.latestRunId } : {}),
    };
    const doc = this.load();
    doc.agents.push(record);
    this.save();
    return record;
  }

  patch(id: string, patch: Partial<CloudAgentRecord>): CloudAgentRecord | null {
    const doc = this.load();
    const index = doc.agents.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const next = { ...doc.agents[index]!, ...patch, updatedAt: Date.now() };
    doc.agents[index] = recordSchema.parse(next);
    this.save();
    return doc.agents[index]!;
  }
}
