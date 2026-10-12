// Multi-provider cloud coding agents (Cursor Cloud Agents API, Claude Code
// background agents, OpenAI Codex cloud, …). Sagax keeps a local record per
// bot; providers speak their own HTTP APIs through server/cloud-agents/providers/*.

export const CLOUD_AGENT_PROVIDERS = ["cursor", "claude", "codex"] as const;
export type CloudAgentProviderId = (typeof CLOUD_AGENT_PROVIDERS)[number];

/** Normalized lifecycle across providers. */
export type CloudAgentStatus =
  | "creating"
  | "running"
  | "idle"
  | "finished"
  | "failed"
  | "cancelled"
  | "archived";

export type CloudAgentFollowUpMode = "queue" | "steer" | "interrupt";

export interface CloudAgentRepoRef {
  url: string;
  ref?: string;
  prUrl?: string;
}

export interface CloudAgentLaunchInput {
  provider: CloudAgentProviderId;
  prompt: string;
  repos?: CloudAgentRepoRef[];
  model?: string;
  workOnCurrentBranch?: boolean;
  autoCreatePr?: boolean;
  name?: string;
}

export interface CloudAgentFollowUpInput {
  text: string;
  mode: CloudAgentFollowUpMode;
}

export interface CloudAgentGitBranch {
  repoUrl?: string;
  branch?: string;
  prUrl?: string;
}

export interface CloudAgentRecord {
  /** Sagax id: `ca_<uuid>` */
  id: string;
  botId: string;
  /** Thread that launched it (completion wakes here). */
  threadId: string;
  principalId: string;
  provider: CloudAgentProviderId;
  /** Provider's agent id (e.g. bc-…). */
  externalId: string;
  name: string;
  status: CloudAgentStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  endedAt?: number;
  /** Latest provider run id. */
  latestRunId?: string;
  /** Public dashboard URL when the provider offers one. */
  url?: string;
  model?: string;
  repos: CloudAgentRepoRef[];
  gitBranches: CloudAgentGitBranch[];
  /** Last assistant result text from a finished run. */
  lastResult?: string;
  error?: string;
  archived: boolean;
  /** Completion already delivered to the launching thread. */
  completionNotified: boolean;
  /** Queued follow-up while a run is active (mode queue). */
  pendingFollowUp?: { text: string; at: number };
}

export interface CloudAgentArtifact {
  path: string;
  size?: number;
  contentType?: string;
}

export interface CloudAgentTranscriptLine {
  at: number;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface CloudAgentProviderListing {
  provider: CloudAgentProviderId;
  label: string;
  configured: boolean;
  last4?: string;
}

/** Live SSE payload (no secrets). */
export interface CloudAgentWireItem {
  id: string;
  botId: string;
  provider: CloudAgentProviderId;
  name: string;
  status: CloudAgentStatus;
  updatedAt: number;
  threadId: string;
}

export const CLOUD_AGENT_WRITE_TOOLS = new Set([
  "launch_cloud_agent",
  "cancel_cloud_agent",
  "archive_cloud_agent",
  "cloud_agent_follow_up",
]);

export const CLOUD_AGENT_READ_TOOLS = new Set([
  "list_cloud_agents",
  "get_cloud_agent",
  "find_cloud_agent_by_pr",
  "cloud_agent_transcript",
  "list_cloud_agent_artifacts",
]);

const CLOUD_AGENT_TOOL_ACTION: Record<string, string> = {
  list_cloud_agents: "list",
  get_cloud_agent: "get",
  launch_cloud_agent: "launch",
  cloud_agent_follow_up: "follow_up",
  cancel_cloud_agent: "cancel",
  archive_cloud_agent: "archive",
  cloud_agent_transcript: "transcript",
  list_cloud_agent_artifacts: "artifacts",
  find_cloud_agent_by_pr: "find_by_pr",
};

/** Harness internal route action for a catalog tool name. */
export function cloudAgentToolAction(toolName: string): string | null {
  return CLOUD_AGENT_TOOL_ACTION[toolName] ?? null;
}

export function cloudAgentStatusActive(status: CloudAgentStatus): boolean {
  return status === "creating" || status === "running" || status === "idle";
}

export function normalizeCloudAgentStatus(raw: string): CloudAgentStatus {
  const key = raw.toUpperCase();
  if (key === "CREATING" || key === "PENDING") return "creating";
  if (key === "RUNNING" || key === "ACTIVE") return "running";
  if (key === "IDLE") return "idle";
  if (key === "FINISHED" || key === "SUCCEEDED" || key === "SUCCESS") return "finished";
  if (key === "FAILED" || key === "ERROR") return "failed";
  if (key === "CANCELLED" || key === "CANCELED" || key === "STOPPED") return "cancelled";
  if (key === "ARCHIVED") return "archived";
  return "failed";
}
