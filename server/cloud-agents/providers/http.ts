import type { HttpFetch } from "./types.ts";

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function providerJson<T>(
  fetchImpl: HttpFetch,
  url: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetchImpl(url, { ...init, headers });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const code = typeof (body as { error?: { code?: string }; code?: string }).error === "object"
      ? (body as { error: { code?: string } }).error.code
      : (body as { code?: string }).code;
    throw new ProviderHttpError(response.status, code ?? "provider_error", `Provider HTTP ${response.status}`);
  }
  return body as T;
}

/** Basic auth for Cursor (`-u KEY:`). */
export async function cursorJson<T>(fetchImpl: HttpFetch, url: string, init: RequestInit & { apiKey: string }): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${Buffer.from(`${init.apiKey}:`).toString("base64")}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetchImpl(url, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ProviderHttpError(response.status, (body as { code?: string }).code ?? "provider_error", `Cursor HTTP ${response.status}`);
  }
  return body as T;
}
