import assert from "node:assert/strict";
import test from "node:test";
import { createMachineWorker, publishEngines, readMachineIdentity } from "./machine-worker.mjs";

test("publishEngines lists models and does not copy a key", () => {
  const engines = publishEngines([
    {
      instanceId: "pi",
      displayName: "pi",
      driverKind: "piAgent",
      snapshot: { state: "available" },
      models: { default: "qwen", options: [{ id: "qwen", label: "Qwen" }] },
      config: { apiKey: "secret-value" },
    },
    { instanceId: "down", snapshot: { state: "unavailable" }, models: { options: [{ id: "x", label: "X" }] } },
  ]);
  assert.deepEqual(engines, [{
    instanceId: "pi",
    label: "pi",
    driverKind: "piAgent",
    models: [{ id: "qwen", label: "Qwen" }],
  }]);
  assert.equal(JSON.stringify(engines).includes("secret-value"), false);
});

test("readMachineIdentity keeps one device id", () => {
  const files = new Map();
  const deps = {
    readFileSync: (file) => {
      if (!files.has(file)) throw new Error("missing");
      return files.get(file);
    },
    writeFileSync: (file, text) => files.set(file, text),
    mkdirSync: () => undefined,
    hostname: () => "Studio.local",
    random: () => "abc123",
  };
  const first = readMachineIdentity("/tmp/machine-worker.json", deps);
  const second = readMachineIdentity("/tmp/machine-worker.json", deps);
  assert.equal(first.deviceId, "computer-abc123");
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(first.name, "Studio");
});

test("a cycle registers this computer and posts the reply", async () => {
  const calls = [];
  const worker = createMachineWorker({
    origins: () => ["https://org.example.test"],
    localOrigin: () => "http://127.0.0.1:8799",
    identity: () => ({ deviceId: "laptop", name: "Studio" }),
    engines: async () => [{ instanceId: "pi", label: "pi", models: [{ id: "qwen", label: "Qwen" }] }],
    waitMs: 0,
    log: () => undefined,
    fetchOrg: async (url, init) => {
      calls.push([init?.method ?? "GET", url, init?.body ?? ""]);
      if (url.endsWith("/pull")) return json({ ids: ["m1"], turns: [{ messageId: "m1", botId: "desk" }] });
      if (url.includes("/turns/m1")) {
        if ((init?.method ?? "GET") === "GET") {
          return json({
            prompt: "salut",
            model: { instanceId: "pi", model: "qwen" },
            botId: "desk",
            bot: { id: "desk", name: "Desk", soul: "Be brief." },
            history: [],
            approvals: [],
          });
        }
        return json({ ok: true });
      }
      return json({ worker: { deviceId: "laptop" } });
    },
    fetchLocal: async () => ({
      ok: true,
      body: null,
      text: async () => "data: {\"kind\":\"reply\",\"text\":\"bonjour\",\"runId\":\"abc\"}\n\ndata: {\"kind\":\"done\",\"runId\":\"abc\"}\n\n",
    }),
  });
  await worker.cycle();
  const register = calls.find((call) => call[0] === "POST" && call[1] === "https://org.example.test/api/workers");
  assert.equal(JSON.parse(register[2]).deviceId, "laptop");
  assert.equal(JSON.parse(register[2]).engines[0].instanceId, "pi");
  assert.equal(calls.some((call) => call[0] === "POST" && String(call[2]).includes("\"kind\":\"reply\"")), true);
  assert.equal(calls.some((call) => String(call[1]).includes("ada@")), false);
});

function json(body) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
}
