// POST /api/internal/openapi: one operation of the turn's person's API.
// The headers stored with the spec are added here and never returned.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { wrapUntrusted } from "../../shared/safety-review.ts";
import { buildOpenApiRequest, openApiUrlRefusal, type OpenApiRecord } from "../openapi-connector.ts";
import { isOpenApiTool } from "../openapi-tools.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const OPENAPI_INTERNAL_PATH = "/api/internal/openapi";

export interface OpenApiInternalDeps {
  /** The spec of the person this turn is for, or null when they have none
   * or this turn must not use it (a room, another member). */
  record(capability: InternalCapabilityView): OpenApiRecord | null;
  organization(): boolean;
  resolve?(host: string): Promise<string[]>;
  fetch?: typeof fetch;
}

async function addressesOf(host: string, resolve: OpenApiInternalDeps["resolve"]): Promise<string[]> {
  const literal = isIP(host);
  if (literal) return [host];
  if (resolve) return resolve(host);
  const found = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  return found.map((entry) => entry.address);
}

export function createOpenApiInternalRoutes(deps: OpenApiInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === OPENAPI_INTERNAL_PATH)) return PASS;
    const body = await readBody();
    const name = typeof body.name === "string" ? body.name : "";
    if (!isOpenApiTool(name)) return json(res, 400, { error: "name must be one of this person's operations." });
    const record = deps.record(capability);
    const operation = record?.operations.find((item) => `openapi_${item.name}` === name);
    if (!record || !operation) return json(res, 404, { error: "No API document is set up for this person." });
    const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {};
    const request = buildOpenApiRequest({ operation, baseUrl: record.baseUrl, headers: record.headers, args });
    if (typeof request === "string") return json(res, 400, { error: request });
    let host = "";
    try { host = new URL(request.url).hostname; } catch { return json(res, 400, { error: "The address is not a URL." }); }
    const refusal = openApiUrlRefusal(request.url, await addressesOf(host, deps.resolve), deps.organization());
    if (refusal) return json(res, 403, { error: refusal });
    try {
      const response = await (deps.fetch ?? fetch)(request.url, {
        method: request.method,
        headers: request.headers,
        redirect: "manual",
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) return json(res, 502, { error: "The API redirected. The redirect was not followed." });
      const text = (await response.text()).slice(0, 8_000);
      const wrapped = wrapUntrusted("api", `HTTP ${response.status}\n${text}`);
      if (response.status >= 400) return json(res, 502, { error: wrapped });
      return json(res, 200, { text: wrapped });
    } catch {
      return json(res, 502, { error: "The API call failed." });
    }
  };
}
