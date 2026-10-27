// The person's web search provider (server/routes/web-search.ts). The key goes
// up once; what comes back only says whether one is saved.
import type { WebSearchProviderId, WebSearchSettingsView } from "../../shared/web-search.ts";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function loadWebSearch(api: Api): Promise<WebSearchSettingsView> {
  return api<WebSearchSettingsView>("/api/me/web-search");
}

export async function saveWebSearch(api: Api, input: { provider: WebSearchProviderId; key?: string; baseUrl?: string }): Promise<WebSearchSettingsView> {
  return api<WebSearchSettingsView>("/api/me/web-search", { method: "PUT", body: JSON.stringify(input) });
}

export async function removeWebSearch(api: Api): Promise<WebSearchSettingsView> {
  return api<WebSearchSettingsView>("/api/me/web-search", { method: "DELETE" });
}

/** One real search with the typed values, or the saved ones when none are given. */
export async function testWebSearch(api: Api, input?: { provider: WebSearchProviderId; key?: string; baseUrl?: string }): Promise<{ ok: boolean; results: number }> {
  return api("/api/me/web-search/test", { method: "POST", body: JSON.stringify(input ?? {}) });
}
