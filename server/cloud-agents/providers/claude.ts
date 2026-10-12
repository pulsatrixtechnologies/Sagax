// Claude Code background / cloud agents (pluggable HTTP surface). The exact
// upstream paths may evolve; tests mock this adapter.
import type { CloudAgentLaunchInput } from "../../../shared/cloud-agents.ts";
import { providerJson } from "./http.ts";
import type { CloudAgentProviderAdapter, HttpFetch, ProviderLaunchResult, ProviderRunSnapshot } from "./types.ts";

const DEFAULT_BASE = "https://api.anthropic.com";

export function createClaudeCloudProvider(fetchImpl: HttpFetch, baseUrl = DEFAULT_BASE): CloudAgentProviderAdapter {
  return {
    id: "claude",
    label: "Claude Code (cloud)",

    async testToken(token) {
      await providerJson(
        fetchImpl,
        `${baseUrl}/v1/code_agents?limit=1`,
        { method: "GET", token },
      );
    },

    async launch(token, input: CloudAgentLaunchInput) {
      const repo = input.repos?.[0];
      const answer = await providerJson<{ id: string; name?: string; status?: string; run_id?: string; url?: string }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            prompt: input.prompt,
            repository: repo?.url,
            branch: repo?.ref,
            model: input.model,
            name: input.name,
          }),
        },
      );
      return {
        externalId: answer.id,
        name: answer.name ?? input.name ?? "Claude agent",
        latestRunId: answer.run_id,
        url: answer.url,
        status: answer.status ?? "running",
      } satisfies ProviderLaunchResult;
    },

    async refresh(token, record) {
      const answer = await providerJson<{ status: string; result?: string; error?: string; run_id?: string }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}`,
        { method: "GET", token },
      );
      return {
        status: answer.status,
        result: answer.result,
        error: answer.error,
        latestRunId: answer.run_id ?? record.latestRunId,
      } satisfies ProviderRunSnapshot;
    },

    async followUp(token, record, input) {
      const answer = await providerJson<{ status: string; run_id?: string }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}/messages`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ text: input.text, mode: input.mode }),
        },
      );
      return { status: answer.status, latestRunId: answer.run_id };
    },

    async cancel(token, record) {
      await providerJson(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}/cancel`,
        { method: "POST", token },
      );
    },

    async archive(token, record) {
      await providerJson(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}/archive`,
        { method: "POST", token },
      );
    },

    async listArtifacts(token, record) {
      const answer = await providerJson<{ artifacts?: Array<{ path: string; size?: number }> }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}/artifacts`,
        { method: "GET", token },
      );
      return (answer.artifacts ?? []).map((a) => ({ path: a.path, ...(a.size ? { size: a.size } : {}) }));
    },

    async transcript(token, record) {
      const answer = await providerJson<{ lines?: Array<{ at: number; role: string; text: string }> }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents/${encodeURIComponent(record.externalId)}/transcript`,
        { method: "GET", token },
      );
      return (answer.lines ?? []).map((line) => ({
        at: line.at,
        role: line.role === "assistant" || line.role === "system" ? line.role : "user",
        text: line.text,
      }));
    },

    async findByPr(token, prUrl) {
      const answer = await providerJson<{ id?: string; name?: string }>(
        fetchImpl,
        `${baseUrl}/v1/code_agents/by_pr?url=${encodeURIComponent(prUrl)}`,
        { method: "GET", token },
      );
      if (!answer.id) return null;
      return { externalId: answer.id, name: answer.name ?? "" };
    },
  };
}
