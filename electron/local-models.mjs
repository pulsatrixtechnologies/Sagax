// Local models on this computer (electron/desktop-bridge.mjs).
// Keep the loopback check in step with shared/desktop-local-models.ts.
// The server names an endpoint id. This process resolves that id to a
// loopback base it published and fetches only the allowlisted path.
// The request body is never logged.

export const SEED_ENDPOINTS = [
  { id: "desk8002", label: "DwarfStar", baseUrl: "http://127.0.0.1:8002/v1" },
  { id: "desk9337", label: "llama-server", baseUrl: "http://127.0.0.1:9337/v1" },
  { id: "desk9338", label: "Bonsai", baseUrl: "http://127.0.0.1:9338/v1" },
  { id: "desk8080", label: "oMLX", baseUrl: "http://127.0.0.1:8080/v1" },
  { id: "desk11434", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "desk52415", label: "EXO", baseUrl: "http://127.0.0.1:52415/v1" },
  { id: "desk1234", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "desk8888", label: "Unsloth", baseUrl: "http://127.0.0.1:8888/v1" },
];

const HOST_ID = /^desk[a-z0-9]{3,24}$/;
const PATHS = new Set(["/models", "/chat/completions"]);
const METHODS = new Set(["GET", "POST"]);
const MODEL_ID = /^[\w][\w./:+-]*$/;
const RESPONSE_CAP = 1_500_000;
const REQUEST_CAP = 1_000_000;

export function normalizeLoopbackBase(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > 200) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/v1") return null;
  if (!url.port || !/^[0-9]+$/.test(url.port)) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://${host}:${port}/v1`;
}

export function modelIdsFromPayload(payload) {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray(payload.data)
      ? payload.data
      : payload && typeof payload === "object" && Array.isArray(payload.models)
        ? payload.models
        : [];
  const ids = [];
  for (const record of records) {
    const id = typeof record === "string" ? record : record && typeof record === "object" ? (record.id ?? record.name) : null;
    if (typeof id !== "string" || !MODEL_ID.test(id)) continue;
    const low = id.toLowerCase();
    if (low.includes("embed") || low.includes("bge-") || low.includes("nomic")) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Display facts a server may add to /v1/models (DwarfStar, OpenRouter-style
 * rows): `name` and `context_length`. Only ids that modelIdsFromPayload keeps
 * get a row, so an embedding model never comes back through here.
 */
export function modelDetailsFromPayload(payload) {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray(payload.data)
      ? payload.data
      : payload && typeof payload === "object" && Array.isArray(payload.models)
        ? payload.models
        : [];
  const keep = new Set(modelIdsFromPayload(payload));
  const details = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const id = record.id ?? record.name;
    if (typeof id !== "string" || !keep.has(id)) continue;
    // oxlint-disable-next-line no-control-regex -- strip control characters from a model name
    const name = typeof record.name === "string" ? record.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
    const raw = record.context_length ?? record.top_provider?.context_length;
    const contextLength = Number.isSafeInteger(raw) && raw > 0 && raw <= 100_000_000 ? raw : undefined;
    details.push({ id, ...(name && name !== id ? { name } : {}), ...(contextLength ? { contextLength } : {}) });
  }
  return details;
}

/** Probe one loopback base. Returns model ids, or null when it does not answer. */
export async function probeLoopbackModels(base, fetchImpl = globalThis.fetch) {
  const probed = await probeLoopbackCatalog(base, fetchImpl);
  return probed ? probed.models : null;
}

/** Probe one loopback base. Returns ids and display details, or null when it does not answer. */
export async function probeLoopbackCatalog(base, fetchImpl = globalThis.fetch) {
  const normalized = normalizeLoopbackBase(base);
  if (!normalized) return null;
  try {
    const response = await fetchImpl(`${normalized}/models`, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer local" },
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return { models: modelIdsFromPayload(payload), details: modelDetailsFromPayload(payload) };
  } catch {
    return null;
  }
}

/**
 * Fetch one allowlisted path on a published loopback base.
 * The bridge returns one result, so the body is buffered up to the cap.
 * There is no second channel.
 */
export async function executeLocalModel(operation, resolveBase, fetchImpl = globalThis.fetch, signal) {
  if (!operation || typeof operation !== "object") throw new Error("This local model request was refused.");
  if (operation.url !== undefined) throw new Error("This local model request was refused.");
  if (!METHODS.has(operation.http_method) || !PATHS.has(operation.http_path)) throw new Error("This local model request was refused.");
  if (typeof operation.endpoint !== "string" || !HOST_ID.test(operation.endpoint)) throw new Error("This local model request was refused.");
  const base = normalizeLoopbackBase(typeof resolveBase === "function" ? resolveBase(operation.endpoint) : null);
  if (!base) throw new Error("This local model request was refused.");
  const target = new URL(`${base}${operation.http_path}`);
  if (target.protocol !== "http:" || (target.hostname !== "127.0.0.1" && target.hostname !== "localhost")) {
    throw new Error("This local model request was refused.");
  }
  if (target.pathname !== `${new URL(base).pathname}${operation.http_path}` && target.pathname !== `${operation.http_path}`) {
    throw new Error("This local model request was refused.");
  }
  const json = operation.http_method === "POST" ? (typeof operation.json === "string" ? operation.json : "{}") : "";
  if (json.length > REQUEST_CAP) throw new Error("This local model request was refused.");
  const seconds = Math.min(600, Math.max(1, Number(operation.timeout_seconds) || 120));
  const timeout = AbortSignal.timeout(seconds * 1000);
  const response = await fetchImpl(target.href, {
    method: operation.http_method,
    redirect: "error",
    headers: { Authorization: "Bearer local", ...(operation.http_method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(operation.http_method === "POST" ? { body: json } : {}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const reader = response.body?.getReader?.();
  const chunks = [];
  let bytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength ?? value.length;
      if (bytes > RESPONSE_CAP) {
        await reader.cancel().catch(() => {});
        throw new Error("The local model response is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    const text = await response.text();
    if (text.length > RESPONSE_CAP) throw new Error("The local model response is too large.");
    chunks.push(Buffer.from(text));
  }
  return {
    localModel: {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: Buffer.concat(chunks).toString("utf8"),
    },
  };
}
