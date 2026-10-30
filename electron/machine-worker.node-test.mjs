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

test("worker retries back off per origin, reset after recovery and leave other servers running", async () => {
  let now = 0;
  let down = true;
  const calls = [];
  const logs = [];
  const worker = createMachineWorker({
    origins: () => ["https://offline.example.test", "https://ready.example.test"],
    localOrigin: () => "http://127.0.0.1:8799",
    identity: () => ({ deviceId: "laptop", name: "Studio" }),
    engines: async () => [], now: () => now, random: () => 0, log: (line) => logs.push(line),
    fetchLocal: async () => assert.fail("no local turn is due"),
    fetchOrg: async (url) => {
      calls.push(url);
      if (down && url.startsWith("https://offline.")) throw new Error("offline");
      return json(url.endsWith("/pull") ? { turns: [] } : {});
    },
  });
  const attempts = () => calls.filter((url) => url === "https://offline.example.test/api/workers").length;
  await worker.cycle();
  now = 4_999;
  await worker.cycle();
  assert.equal(attempts(), 1);
  now = 5_000;
  await worker.cycle();
  now = 14_999;
  await worker.cycle();
  assert.equal(attempts(), 2);
  assert.equal(logs.length, 2, "skipped retries do not repeat the error log");
  assert.equal(calls.filter((url) => url === "https://ready.example.test/api/workers").length, 4);
  down = false;
  now = 15_000;
  await worker.cycle();
  down = true;
  await worker.cycle();
  assert.equal(attempts(), 4);
  now = 20_000;
  await worker.cycle();
  assert.equal(attempts(), 5, "recovery starts the next backoff at five seconds");
});

for (const status of [401, 403, 404]) {
  test(`worker pauses a server that refuses registration or polling (${status})`, async () => {
    for (const refusedRoute of ["register", "pull"]) {
      let now = 0;
      let attempts = 0;
      const worker = createMachineWorker({
        origins: () => ["https://example.test"], localOrigin: () => "http://127.0.0.1:8799",
        identity: () => ({ deviceId: "laptop", name: "Studio" }), engines: async () => [],
        now: () => now, random: () => 0,
        fetchLocal: async () => assert.fail("no local turn is due"),
        fetchOrg: async (url) => {
          const registration = url.endsWith("/workers");
          if (registration) attempts++;
          return (registration ? refusedRoute === "register" : refusedRoute === "pull")
            ? { ok: false, status } : json({});
        },
      });
      await worker.cycle();
      now = 59_999;
      await worker.cycle();
      assert.equal(attempts, 1, refusedRoute);
      now = 60_000;
      await worker.cycle();
      assert.equal(attempts, 2, refusedRoute);
    }
  });
}

test("removing an origin drops its retry state", async () => {
  let origins = ["https://example.test"];
  let attempts = 0;
  const worker = createMachineWorker({
    origins: () => origins, localOrigin: () => "http://127.0.0.1:8799",
    identity: () => ({ deviceId: "laptop", name: "Studio" }), engines: async () => [],
    now: () => 0, random: () => 0,
    fetchOrg: async () => { attempts++; return { ok: false, status: 401 }; },
    fetchLocal: async () => assert.fail("no local turn is due"),
  });
  await worker.cycle();
  origins = [];
  await worker.cycle();
  origins = ["https://example.test"];
  await worker.cycle();
  assert.equal(attempts, 2, "a newly reconnected origin retries immediately");
});

function localTurnFixture(fetchLocal) {
  const notices = [];
  const worker = createMachineWorker({
    origins: () => ["https://example.test"], localOrigin: () => "http://127.0.0.1:8799",
    identity: () => ({ deviceId: "laptop", name: "Studio" }), engines: async () => [],
    fetchLocal,
    fetchOrg: async (url, options) => {
      if (url.endsWith("/pull")) return json({ turns: [{ messageId: "m1", botId: "desk" }] });
      if (url.includes("/turns/m1") && options?.method !== "POST") return json({ prompt: "Hello", model: {}, botId: "desk" });
      if (url.includes("/turns/m1") && options?.method === "POST") {
        assert.equal(options.signal.aborted, false, "failure delivery outlives the stopped local request");
        notices.push(JSON.parse(options.body));
      }
      return json({});
    },
  });
  return { worker, notices };
}

for (const failure of ["connection", "stream", "empty", "status"]) {
  test(`a local ${failure} failure settles the claimed organization turn`, async () => {
    const { worker, notices } = localTurnFixture(async () => {
      if (failure === "connection") throw new Error("local server is down");
      if (failure === "status") return { ok: false, status: 503 };
      if (failure === "empty") return new Response("");
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error("local server restarted")); } }));
    });
    await worker.cycle();
    assert.deepEqual(notices.map((notice) => notice.kind), ["failed"]);
    assert.match(notices[0].text, /could not finish/);
  });
}

test("stopping cancels a local turn and an immediate restart waits for its failure delivery", async () => {
  let entered;
  let active = new Promise((resolve) => { entered = resolve; });
  const signals = [];
  const { worker, notices } = localTurnFixture(async (_url, options) => {
    signals.push(options.signal);
    entered();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  const first = worker.start();
  await active;
  const stopping = worker.stop();
  active = new Promise((resolve) => { entered = resolve; });
  const restarted = worker.start();
  await stopping;
  await active;
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  await worker.stop();
  await Promise.all([first, restarted]);
  assert.deepEqual(notices.map((notice) => notice.kind), ["failed", "failed"]);
});

test("a newer stop cancels a restart queued while an interrupted turn settles", async () => {
  let entered;
  const active = new Promise((resolve) => { entered = resolve; });
  let starts = 0;
  const { worker } = localTurnFixture(async (_url, options) => {
    starts++;
    entered();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  const first = worker.start();
  await active;
  void worker.stop();
  const restarted = worker.start();
  await worker.stop();
  await Promise.all([first, restarted]);
  assert.equal(starts, 1);
});
