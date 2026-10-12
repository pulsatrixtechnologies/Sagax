// Cursor Cloud Agents API v1 (https://cursor.com/docs/cloud-agent/api/endpoints).
import type { CloudAgentFollowUpInput } from "../../../shared/cloud-agents.ts";
import { normalizeCloudAgentStatus } from "../../../shared/cloud-agents.ts";
import { cursorJson, ProviderHttpError } from "./http.ts";
import type { CloudAgentProviderAdapter, HttpFetch, ProviderLaunchResult, ProviderRunSnapshot } from "./types.ts";

const DEFAULT_BASE = "https://api.cursor.com";

export function createCursorProvider(fetchImpl: HttpFetch, baseUrl = DEFAULT_BASE): CloudAgentProviderAdapter {
  return {
    id: "cursor",
    label: "Cursor Cloud Agents",

    async testToken(apiKey) {
      await cursorJson<{ items?: unknown[] }>(
        fetchImpl,
        `${baseUrl}/v1/agents?limit=1`,
        { method: "GET", apiKey },
      );
    },

    async launch(apiKey, input) {
      const repos = (input.repos ?? []).map((r) => ({
        url: r.url,
        ...(r.ref ? { startingRef: r.ref } : {}),
        ...(r.prUrl ? { prUrl: r.prUrl } : {}),
      }));
      const body: Record<string, unknown> = {
        prompt: { text: input.prompt },
        ...(input.name ? { name: input.name } : {}),
        ...(repos.length ? { repos } : {}),
        ...(input.workOnCurrentBranch ? { workOnCurrentBranch: true } : {}),
        ...(input.autoCreatePr ? { autoCreatePR: true } : {}),
        ...(input.model ? { model: { id: input.model } } : {}),
      };
      const answer = await cursorJson<{ agent: Record<string, unknown>; run?: Record<string, unknown> }>(
        fetchImpl,
        `${baseUrl}/v1/agents`,
        { method: "POST", apiKey, body: JSON.stringify(body) },
      );
      const agent = answer.agent;
      return {
        externalId: String(agent.id),
        name: String(agent.name ?? input.name ?? "Cloud agent"),
        latestRunId: answer.run?.id ? String(answer.run.id) : agent.latestRunId ? String(agent.latestRunId) : undefined,
        url: agent.url ? String(agent.url) : undefined,
        status: String(agent.status ?? answer.run?.status ?? "CREATING"),
      } satisfies ProviderLaunchResult;
    },

    async refresh(apiKey, record) {
      const agent = await cursorJson<Record<string, unknown>>(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}`,
        { method: "GET", apiKey },
      );
      let runStatus = "";
      let result: string | undefined;
      const latestRunId = agent.latestRunId ? String(agent.latestRunId) : record.latestRunId;
      if (latestRunId) {
        try {
          const run = await cursorJson<Record<string, unknown>>(
            fetchImpl,
            `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/runs/${encodeURIComponent(latestRunId)}`,
            { method: "GET", apiKey },
          );
          runStatus = String(run.status ?? "");
          if (typeof run.result === "string") result = run.result;
          if (run.git && typeof run.git === "object") {
            const branches = (run.git as { branches?: unknown[] }).branches;
            if (Array.isArray(branches)) {
              return {
                status: runStatus || String(agent.status ?? ""),
                result,
                latestRunId,
                gitBranches: branches.map((b) => {
                  const row = b as Record<string, unknown>;
                  return {
                    repoUrl: row.repoUrl ? String(row.repoUrl) : undefined,
                    branch: row.branch ? String(row.branch) : undefined,
                    prUrl: row.prUrl ? String(row.prUrl) : undefined,
                  };
                }),
              };
            }
          }
        } catch (e) {
          if ((e as ProviderHttpError).status !== 404) throw e;
        }
      }
      return {
        status: runStatus || String(agent.status ?? record.status),
        result,
        latestRunId,
      } satisfies ProviderRunSnapshot;
    },

    async followUp(apiKey, record, input: CloudAgentFollowUpInput) {
      if (input.mode === "steer" || input.mode === "interrupt") {
        if (record.latestRunId) {
          try {
            await cursorJson(
              fetchImpl,
              `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/runs/${encodeURIComponent(record.latestRunId)}/cancel`,
              { method: "POST", apiKey },
            );
          } catch (e) {
            if ((e as ProviderHttpError).status !== 409) throw e;
          }
        }
      } else if (record.status === "running" || record.status === "creating") {
        throw new ProviderHttpError(409, "agent_busy", "Agent is busy; use steer or interrupt, or wait.");
      }
      const answer = await cursorJson<{ run: Record<string, unknown> }>(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/runs`,
        { method: "POST", apiKey, body: JSON.stringify({ prompt: { text: input.text } }) },
      );
      const run = answer.run;
      return {
        status: String(run.status ?? "CREATING"),
        latestRunId: run.id ? String(run.id) : undefined,
      };
    },

    async cancel(apiKey, record) {
      if (!record.latestRunId) return;
      await cursorJson(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/runs/${encodeURIComponent(record.latestRunId)}/cancel`,
        { method: "POST", apiKey },
      );
    },

    async archive(apiKey, record) {
      await cursorJson(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/archive`,
        { method: "POST", apiKey },
      );
    },

    async listArtifacts(apiKey, record) {
      const answer = await cursorJson<{ items?: Array<Record<string, unknown>> }>(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/artifacts`,
        { method: "GET", apiKey },
      );
      return (answer.items ?? []).map((item) => ({
        path: String(item.path ?? ""),
        ...(typeof item.size === "number" ? { size: item.size } : {}),
        ...(item.contentType ? { contentType: String(item.contentType) } : {}),
      }));
    },

    async transcript(apiKey, record) {
      const runs = await cursorJson<{ items?: Array<Record<string, unknown>> }>(
        fetchImpl,
        `${baseUrl}/v1/agents/${encodeURIComponent(record.externalId)}/runs?limit=20`,
        { method: "GET", apiKey },
      );
      const out: { at: number; role: "user" | "assistant" | "system"; text: string }[] = [];
      for (const run of runs.items ?? []) {
        const at = Date.parse(String(run.createdAt ?? "")) || Date.now();
        if (typeof run.result === "string" && run.result.trim()) {
          out.push({ at, role: "assistant", text: run.result });
        }
        const status = normalizeCloudAgentStatus(String(run.status ?? ""));
        if (status === "failed") out.push({ at, role: "system", text: `Run ${run.id ?? ""} failed.` });
      }
      return out.sort((a, b) => a.at - b.at);
    },

    async findByPr(apiKey, prUrl) {
      const answer = await cursorJson<{ items?: Array<Record<string, unknown>> }>(
        fetchImpl,
        `${baseUrl}/v1/agents?prUrl=${encodeURIComponent(prUrl)}&limit=5`,
        { method: "GET", apiKey },
      );
      const first = answer.items?.[0];
      if (!first?.id) return null;
      return { externalId: String(first.id), name: String(first.name ?? "") };
    },
  };
}
