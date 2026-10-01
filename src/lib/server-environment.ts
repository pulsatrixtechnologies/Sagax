// Settings > Organization > Your server environment: the signed-in person's
// own isolated Linux environment on the server, shared by all their bots
// (server/user-sandbox-routes.ts).
import { api } from "@/state/store";

export interface ServerEnvironmentStatus {
  configured: boolean;
  state?: "missing" | "stopped" | "running" | "unavailable";
  lastUsedAt?: number | null;
  workspaceBytes?: number | null;
  overQuota?: boolean;
  limits?: { memoryMb: number; cpus: number; pids: number; diskMb: number; tmpMb: number } | null;
  idleMinutes?: number | null;
  pendingDeletionAt?: number | null;
  error?: string;
}

export function loadServerEnvironment(): Promise<ServerEnvironmentStatus> {
  return api<ServerEnvironmentStatus>("/api/me/server-environment");
}

export function resetServerEnvironment(): Promise<ServerEnvironmentStatus> {
  return api<ServerEnvironmentStatus>("/api/me/server-environment/reset", { method: "POST", body: JSON.stringify({ confirm: true }) });
}
