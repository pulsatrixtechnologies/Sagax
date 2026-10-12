import type { CloudAgentProviderId } from "../../shared/cloud-agents.ts";

export interface CloudAgentProviderRow {
  provider: CloudAgentProviderId;
  label: string;
  configured: boolean;
  last4?: string;
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function loadCloudAgentProviders(api: Api): Promise<CloudAgentProviderRow[]> {
  const answer = await api<{ providers?: CloudAgentProviderRow[] }>("/api/me/cloud-agent-providers");
  return answer.providers ?? [];
}

export async function saveCloudAgentProvider(
  api: Api,
  provider: CloudAgentProviderId,
  token: string,
): Promise<void> {
  await api(`/api/me/cloud-agent-providers/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
}

export async function removeCloudAgentProvider(api: Api, provider: CloudAgentProviderId): Promise<void> {
  await api(`/api/me/cloud-agent-providers/${provider}`, { method: "DELETE" });
}

export async function testCloudAgentProvider(
  api: Api,
  provider: CloudAgentProviderId,
  token?: string,
): Promise<void> {
  await api(`/api/me/cloud-agent-providers/${provider}/test`, {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
  });
}
