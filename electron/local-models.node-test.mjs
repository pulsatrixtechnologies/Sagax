// Desktop local-model guard: only an allowlisted path on a published loopback base.
import test from "node:test";
import assert from "node:assert/strict";

import { validBridgeOperation } from "./desktop-bridge.mjs";
import { executeLocalModel, normalizeLoopbackBase } from "./local-models.mjs";

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
  await assert.rejects(() => executeLocalModel({ ...chat, http_path: "/messages" }, () => "http://127.0.0.1:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel(chat, () => "http://10.0.0.8:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel({ ...chat, url: "http://10.0.0.8/v1" }, () => "http://127.0.0.1:8002/v1", fetchImpl));
  await assert.rejects(() => executeLocalModel({ ...chat, http_method: "GET", http_path: "/models" }, () => null, fetchImpl));
  assert.equal(fetched, false);

  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/messages" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/chat/completions", url: "http://127.0.0.1:8002/v1" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "not-a-desk", http_method: "GET", http_path: "/models" }), false);
  assert.equal(validBridgeOperation({ action: "local_model", endpoint: "desk8002", http_method: "GET", http_path: "/models" }), true);
});
