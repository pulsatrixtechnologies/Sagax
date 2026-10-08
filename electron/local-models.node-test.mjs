// Desktop local-model guard: only an allowlisted path on a published loopback base.
import test from "node:test";
import assert from "node:assert/strict";

import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createDesktopBridge, validBridgeOperation } from "./desktop-bridge.mjs";
import { executeLocalModel, modelDetailsFromPayload, modelIdsFromPayload, normalizeLoopbackBase, probeAnthropicMessages, probeLoopbackCatalog, probeLoopbackModels, resetAnthropicProbeCache } from "./local-models.mjs";

test("a non-allowlisted path and a non-loopback base are refused before any fetch", async () => {
  assert.equal(normalizeLoopbackBase("http://10.0.0.8:8002/v1"), null);
  assert.equal(normalizeLoopbackBase("https://127.0.0.1:8002/v1"), null);
  assert.equal(normalizeLoopbackBase("http://[::1]:8002/v1"), null);
  assert.equal(normalizeLoopbackBase("http://127.0.0.1:8002/v1/models"), null);
  assert.equal(normalizeLoopbackBase("http://127.0.0.1:8002/v1"), "http://127.0.0.1:8002/v1");
  assert.equal(normalizeLoopbackBase("http://localhost:9338/v1/"), "http://localhost:9338/v1");

  let fetched = false;
  const fetchImpl = () => { fetched = true; throw new Error("fetched"); };
  const chat = { action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/chat/completions", json: "{}" };
  // /messages needs a base the desktop probed as speaking it; anything else is refused before a fetch.
  const messages = { ...chat, http_path: "/messages" };
  await assert.rejects(() => executeLocalModel(messages, () => "http://127.0.0.1:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel(messages, () => "http://127.0.0.1:8002/v1", fetchImpl, undefined, () => false));
  await assert.rejects(() => executeLocalModel(messages, () => "http://10.0.0.8:8002/v1", fetchImpl, undefined, () => true));
  await assert.rejects(() => executeLocalModel({ ...messages, http_method: "GET" }, () => "http://127.0.0.1:8002/v1", fetchImpl, undefined, () => true));
  await assert.rejects(() => executeLocalModel({ ...messages, endpoint: "not-a-desk" }, () => "http://127.0.0.1:8002/v1", fetchImpl, undefined, () => true));
  await assert.rejects(() => executeLocalModel({ ...messages, json: "x".repeat(1_000_001) }, () => "http://127.0.0.1:8002/v1", fetchImpl, undefined, () => true));
  await assert.rejects(() => executeLocalModel(chat, () => "http://10.0.0.8:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel({ ...chat, url: "http://10.0.0.8/v1" }, () => "http://127.0.0.1:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel({ ...chat, http_method: "GET", http_path: "/models" }, () => null, fetchImpl));
  assert.equal(fetched, false);

  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/messages" }), true);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/embeddings" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/messages", url: "http://127.0.0.1:8002/v1" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/chat/completions", url: "http://127.0.0.1:8002/v1" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "not-a-desk", http_method: "GET", http_path: "/models" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "GET", http_path: "/models" }), true);
});

// The shape `curl http://127.0.0.1:8002/v1/models` returns from DwarfStar (ds4.c).
const ds4Row = id => ({
  id, object: "model", created: 1767225600, owned_by: "ds4.c", name: "Qwen3.8 Flash Next", context_length: 262144,
  top_provider: { context_length: 262144, max_completion_tokens: 262144, is_moderated: false },
  supported_parameters: ["tools", "tool_choice", "max_tokens", "temperature", "top_p", "stream", "reasoning_effort"],
});
const DS4_MODELS = { object: "list", data: [ds4Row("qwen3.8-flash-next"), ds4Row("qwen3.8-flash-next-chat"), { id: "nomic-embed-text", name: "Embed" }] };

test("the DwarfStar /v1/models shape yields ids, names and context windows", async () => {
  assert.deepEqual(modelIdsFromPayload(DS4_MODELS), ["qwen3.8-flash-next", "qwen3.8-flash-next-chat"]);
  assert.deepEqual(modelDetailsFromPayload(DS4_MODELS), [
    { id: "qwen3.8-flash-next", name: "Qwen3.8 Flash Next", contextLength: 262144 },
    { id: "qwen3.8-flash-next-chat", name: "Qwen3.8 Flash Next", contextLength: 262144 },
  ]);
  // No name, a name equal to the id, a nonsense window: only what is useful stays.
  assert.deepEqual(modelDetailsFromPayload({ data: [{ id: "a" }, { id: "b", name: "b", context_length: -5 }, { id: "c", top_provider: { context_length: 4096 } }] }),
    [{ id: "a" }, { id: "b" }, { id: "c", contextLength: 4096 }]);
  assert.deepEqual(modelDetailsFromPayload(null), []);

  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push({ url, method: init.method, redirect: init.redirect });
    return new Response(JSON.stringify(DS4_MODELS), { status: 200, headers: { "content-type": "application/json" } });
  };
  const probed = await probeLoopbackCatalog("http://127.0.0.1:8002/v1", fetchImpl);
  assert.deepEqual(probed.models, ["qwen3.8-flash-next", "qwen3.8-flash-next-chat"]);
  assert.equal(probed.details[0].name, "Qwen3.8 Flash Next");
  // The catalog probe also asks /v1/messages once (no body that runs a model).
  assert.deepEqual(urls, [
    { url: "http://127.0.0.1:8002/v1/models", method: "GET", redirect: "error" },
    { url: "http://127.0.0.1:8002/v1/messages", method: "POST", redirect: "error" },
  ]);
  assert.equal(probed.anthropic, true);
  assert.deepEqual(await probeLoopbackModels("http://127.0.0.1:8002/v1", fetchImpl), ["qwen3.8-flash-next", "qwen3.8-flash-next-chat"]);
  assert.equal(await probeLoopbackCatalog("http://10.0.0.8:8002/v1", fetchImpl), null);
  assert.equal(await probeLoopbackCatalog("http://127.0.0.1:8002/v1", async () => new Response("down", { status: 503 })), null);
  assert.equal(await probeLoopbackCatalog("http://127.0.0.1:8002/v1", async () => { throw new Error("ECONNREFUSED"); }), null);
});

test("the bridge publishes names, falls back for an older server, and probes again when the picker opens", async () => {
  // A local model server that is down at launch and starts later.
  let modelServerUp = false;
  let modelProbes = 0;
  const modelServer = http.createServer((req, res) => {
    modelProbes++;
    if (!modelServerUp || req.url !== "/v1/models") { res.statusCode = 503; return res.end("down"); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(DS4_MODELS));
  });
  await new Promise(resolve => modelServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${modelServer.address().port}/v1`;
  const publishes = [];
  const org = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (value, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/api/auth/session") return send({ kind: "session", identity: "perspicax" });
    if (req.url === "/api/me/preferences") return send({ preferences: {} });
    if (req.url === "/api/desktop-bridge/connect") return send({ ok: true });
    if (req.url === "/api/me/local-models") return send({ expose: true, share: false, endpoints: [{ id: "desk8002", label: "DwarfStar", baseUrl: base }] });
    if (req.url.endsWith("/local-models")) {
      const parsed = JSON.parse(body);
      publishes.push(parsed);
      // An older server refuses the details field.
      if (parsed.endpoints.some(row => "details" in row)) return send({ error: "Invalid local model catalog." }, 400);
      return send({ ok: true });
    }
    if (req.url.endsWith("/poll")) { await new Promise(resolve => setTimeout(resolve, 200)); return send({ job: null }); }
    res.statusCode = 404; send({});
  });
  await new Promise(resolve => org.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${org.address().port}`;
  const bridge = createDesktopBridge({
    environment: () => ({ id: "org", name: "GOX", origin }), fetch: globalThis.fetch, cookieHeader: async () => "",
    home: os.tmpdir(), attachmentsDir: path.join(os.tmpdir(), "omb-bridge-models"), activityFile: path.join(os.tmpdir(), `omb-bridge-models-${process.pid}.jsonl`),
    WebSocketImpl: null, retryMs: 50, localModelFreshMs: 300,
  });
  try {
    bridge.sync();
    for (let tries = 0; tries < 100 && publishes.length === 0; tries++) await new Promise(resolve => setTimeout(resolve, 20));
    // Down at launch: nothing published, and the failure is not remembered.
    assert.deepEqual(publishes[0], { endpoints: [] });
    await new Promise(resolve => setTimeout(resolve, 350));
    modelServerUp = true;
    await bridge.refreshLocalModels();
    const withDetails = publishes.find(row => row.endpoints[0]?.details);
    assert.deepEqual(withDetails.endpoints[0].models, ["qwen3.8-flash-next", "qwen3.8-flash-next-chat"]);
    assert.deepEqual(withDetails.endpoints[0].details[0], { id: "qwen3.8-flash-next", name: "Qwen3.8 Flash Next", contextLength: 262144 });
    const plain = publishes.at(-1);
    assert.deepEqual(plain, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3.8-flash-next", "qwen3.8-flash-next-chat"] }] });
    assert.equal(JSON.stringify(publishes).includes(base), false, "the server never receives the loopback URL");
    // Reopening at once reuses the fresh answer.
    const probes = modelProbes;
    await bridge.refreshLocalModels();
    assert.equal(modelProbes, probes);
  } finally {
    bridge.close();
    org.close();
    modelServer.close();
  }
});

test("the bridge forwards /v1/messages to an allowed loopback base and nothing else", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, redirect: init.redirect, headers: init.headers, body: init.body });
    return new Response('{"type":"message"}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const operation = { action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/messages", json: '{"model":"m","max_tokens":1,"messages":[]}', timeout_seconds: 240 };
  const result = await executeLocalModel(operation, () => "http://127.0.0.1:8002/v1", fetchImpl, undefined, endpoint => endpoint === "desk8002");
  assert.equal(result.localModel.status, 200);
  assert.equal(result.localModel.body, '{"type":"message"}');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://127.0.0.1:8002/v1/messages");
  assert.equal(seen[0].redirect, "error");
  assert.equal(seen[0].headers.Authorization, "Bearer local");
  assert.equal(seen[0].headers["x-api-key"], "local");
  // localhost is loopback too; another host or a base outside /v1 is not.
  await executeLocalModel(operation, () => "http://localhost:11434/v1", fetchImpl, undefined, () => true);
  assert.equal(seen[1].url, "http://localhost:11434/v1/messages");
  await assert.rejects(() => executeLocalModel(operation, () => "http://192.168.1.5:8002/v1", fetchImpl, undefined, () => true));
  await assert.rejects(() => executeLocalModel(operation, () => "http://127.0.0.1:8002/other", fetchImpl, undefined, () => true));
  assert.equal(seen.length, 2);
});

test("the Anthropic probe is one body-less POST, cached for 5 s, and failures are not cached", async () => {
  resetAnthropicProbeCache();
  const base = "http://127.0.0.1:8002/v1";
  let clock = 1000;
  const now = () => clock;
  const calls = [];
  const answer = status => async (url, init) => { calls.push({ url, method: init.method, body: init.body }); return new Response("{}", { status }); };
  assert.equal(await probeAnthropicMessages(base, answer(400), now), true);
  assert.deepEqual(calls[0], { url: `${base}/messages`, method: "POST", body: '{"model":"probe","max_tokens":1,"messages":[]}' });
  // Inside 5 s the answer is reused, whatever the server says now.
  clock += 4000;
  assert.equal(await probeAnthropicMessages(base, answer(404), now), true);
  assert.equal(calls.length, 1);
  clock += 1500;
  assert.equal(await probeAnthropicMessages(base, answer(404), now), false);
  assert.equal(calls.length, 2);
  for (const status of [405, 501, 503]) {
    resetAnthropicProbeCache();
    assert.equal(await probeAnthropicMessages(base, answer(status), now), false, `status ${status}`);
  }
  resetAnthropicProbeCache();
  assert.equal(await probeAnthropicMessages(base, answer(200), now), true);
  // A connection failure is not cached: the next call asks again.
  resetAnthropicProbeCache();
  assert.equal(await probeAnthropicMessages(base, async () => { throw new Error("ECONNREFUSED"); }, now), false);
  assert.equal(await probeAnthropicMessages(base, answer(400), now), true);
  // Not a loopback base: no request at all.
  resetAnthropicProbeCache();
  const before = calls.length;
  assert.equal(await probeAnthropicMessages("http://10.0.0.8:8002/v1", answer(200), now), false);
  assert.equal(calls.length, before);
});

test("the catalog probe reports whether the server speaks the Anthropic protocol", async () => {
  const models = { data: [{ id: "qwen3" }] };
  const server = status => async url => String(url).endsWith("/messages")
    ? new Response("{}", { status })
    : new Response(JSON.stringify(models), { status: 200, headers: { "content-type": "application/json" } });
  resetAnthropicProbeCache();
  assert.equal((await probeLoopbackCatalog("http://127.0.0.1:8002/v1", server(400))).anthropic, true);
  resetAnthropicProbeCache();
  assert.equal((await probeLoopbackCatalog("http://127.0.0.1:8002/v1", server(404))).anthropic, false);
  resetAnthropicProbeCache();
});
