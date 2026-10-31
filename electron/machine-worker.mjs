// The desktop app checks in with each organization server the person is
// signed in to, and runs that person's machine-hosted turns on this
// computer. pi keeps its own directory (PI_CODING_AGENT_DIR, or ~/.pi/agent
// on the local server). Approvals are answered in the organization
// conversation and delivered to the engine here. No key is stored.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAuthBackoff } from "./auth-backoff.mjs";

const DEVICE_ID = /^[\w-]{1,80}$/;

export function publishEngines(instances) {
  if (!Array.isArray(instances)) return [];
  const engines = [];
  for (const instance of instances) {
    if (!instance || typeof instance.instanceId !== "string") continue;
    if (instance.snapshot?.state === "unavailable") continue;
    const options = Array.isArray(instance.models?.options) ? instance.models.options : [];
    const models = [];
    for (const option of options) {
      if (!option || typeof option.id !== "string" || !option.id.trim()) continue;
      models.push({ id: option.id.trim().slice(0, 200), label: String(option.label || option.id).slice(0, 200) });
      if (models.length >= 80) break;
    }
    const fallback = typeof instance.models?.default === "string" ? instance.models.default.trim() : "";
    if (!models.length && fallback) models.push({ id: fallback.slice(0, 200), label: fallback.slice(0, 200) });
    if (!models.length) continue;
    const driverKind = typeof instance.driverKind === "string" ? instance.driverKind.slice(0, 60) : "";
    engines.push({
      instanceId: instance.instanceId.trim().slice(0, 120),
      label: String(instance.displayName || instance.instanceId).slice(0, 120),
      ...(driverKind ? { driverKind } : {}),
      models,
    });
    if (engines.length >= 40) break;
  }
  return engines;
}

export function readMachineIdentity(file, deps = {}) {
  const read = deps.readFileSync ?? fs.readFileSync;
  const write = deps.writeFileSync ?? fs.writeFileSync;
  const mkdir = deps.mkdirSync ?? fs.mkdirSync;
  const hostname = deps.hostname ?? (() => os.hostname());
  const random = deps.random ?? (() => randomBytes(8).toString("hex"));
  let deviceId = "";
  try {
    const parsed = JSON.parse(read(file, "utf8"));
    if (parsed && typeof parsed.deviceId === "string" && DEVICE_ID.test(parsed.deviceId)) deviceId = parsed.deviceId;
  } catch {
    deviceId = "";
  }
  if (!deviceId) {
    deviceId = `computer-${random()}`;
    mkdir(path.dirname(file), { recursive: true });
    write(file, `${JSON.stringify({ deviceId })}\n`);
  }
  const name = String(hostname() || "computer").split(".")[0].replace(/[^\w -]/g, "").trim().slice(0, 80) || "computer";
  return { deviceId, name };
}

async function readSse(response, onEvent) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    for (const block of text.split("\n\n")) {
      const line = block.split("\n").find((item) => item.startsWith("data:"));
      if (line) await onEvent(JSON.parse(line.slice(5).trim()));
    }
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const line = block.split("\n").find((item) => item.startsWith("data:"));
      if (line) await onEvent(JSON.parse(line.slice(5).trim()));
      split = buffer.indexOf("\n\n");
    }
  }
}

export function createMachineWorker({
  origins,
  localOrigin,
  identity,
  fetchOrg,
  fetchLocal,
  log = () => {},
  waitMs = 20_000,
  engines,
  now = Date.now,
  random = Math.random,
}) {
  let stopped = false;
  let chain = null;
  let stopping = new AbortController();
  let generation = 0;
  const retries = new Map();
  const sleep = (ms) => delay(ms, undefined, { signal: stopping.signal }).catch(() => {});

  const loadEngines = async () => {
    if (engines) return engines();
    try {
      const response = await fetchLocal(`${localOrigin()}/api/instances`, { cache: "no-store", signal: stopping.signal });
      if (!response.ok) return [];
      const body = await response.json();
      return publishEngines(body.instances);
    } catch {
      return [];
    }
  };

  const postJson = (fetchImpl, url, body, signal = stopping.signal) => fetchImpl(url, {
    method: "POST",
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const runTurn = async (origin, device, turn, published) => {
    const messageId = turn.messageId;
    if (!messageId) return;
    const query = turn.botId ? `?botId=${encodeURIComponent(turn.botId)}` : "";
    const resultUrl = `${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}`;
    let beat;
    let terminalDelivered = false;
    try {
      const loaded = await fetchOrg(`${resultUrl}${query}`, {
        credentials: "include", redirect: "error", cache: "no-store", signal: stopping.signal,
      });
      if (!loaded.ok) throw new Error("This computer could not retrieve the turn.");
      const job = await loaded.json();
      beat = setInterval(() => {
        void postJson(fetchOrg, `${origin}/api/workers`, {
          deviceId: device.deviceId, name: device.name, engines: published,
        }).catch(() => undefined);
      }, 15_000);
      const local = await postJson(fetchLocal, `${localOrigin()}/api/machine-runs`, {
        instanceId: job.model?.instanceId,
        model: job.model?.model,
        ...(job.model?.effort ? { effort: job.model.effort } : {}),
        prompt: job.prompt,
        ...(job.bot?.soul ? { system: job.bot.soul } : {}),
        botId: job.botId,
        history: job.history ?? [],
      });
      if (!local.ok) throw new Error("This computer could not start the turn.");
      let runId = "";
      await readSse(local, async (notice) => {
        if (typeof notice.runId === "string") runId = notice.runId;
        if (notice.kind === "progress" || notice.kind === "reply" || notice.kind === "failed") {
          const delivered = await postJson(fetchOrg, resultUrl, notice);
          if (!delivered.ok) throw new Error("The server could not receive the turn's result.");
          if (notice.kind === "reply" || notice.kind === "failed") terminalDelivered = true;
          return;
        }
        if (notice.kind !== "approval") return;
        await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}`, {
          kind: "approval",
          requestId: notice.requestId,
          tool: notice.tool,
          summary: notice.summary ?? "",
        });
        const deadline = Date.now() + 10 * 60_000;
        let decision = null;
        while (!stopped && Date.now() < deadline && !decision) {
          await sleep(1_000);
          const again = await fetchOrg(`${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}${query}`, {
            credentials: "include",
            redirect: "error",
            cache: "no-store",
            signal: stopping.signal,
          });
          if (!again.ok) continue;
          const body = await again.json();
          decision = (body.approvals ?? []).find((row) => row.requestId === notice.requestId && row.behavior) ?? null;
        }
        await postJson(fetchLocal, `${localOrigin()}/api/machine-runs/${runId}/answer`, {
          requestId: notice.requestId,
          behavior: decision?.behavior ?? "deny",
          ...(decision?.message ? { message: decision.message } : {}),
        });
      });
      if (!terminalDelivered) throw new Error("This computer stopped before replying.");
      await postJson(fetchOrg, resultUrl, { kind: "done" });
    } catch {
      // Even an unavailable local server, a broken stream or a deliberate
      // worker stop must settle the claimed turn on its organization.
      if (!terminalDelivered) {
        try {
          const delivered = await postJson(fetchOrg, resultUrl, {
            kind: "failed",
            text: stopped ? "This computer stopped before finishing the turn." : "This computer could not finish the turn.",
          }, AbortSignal.timeout(10_000));
          if (!delivered.ok) throw new Error("result refused");
        } catch { log("machine worker: could not deliver the interrupted turn's failure"); }
      }
    } finally {
      clearInterval(beat);
    }
  };

  const cycle = async () => {
    const list = origins().filter((origin) => typeof origin === "string" && origin);
    for (const origin of retries.keys()) if (!list.includes(origin)) retries.delete(origin);
    if (!list.length) return;
    const published = await loadEngines();
    const device = identity();
    for (const origin of list) {
      if (stopped) return;
      let retry = retries.get(origin);
      if (!retry) {
        retry = { backoff: createAuthBackoff({ random }), at: 0 };
        retries.set(origin, retry);
      }
      if (retry.at > now()) continue;
      try {
        const registered = await postJson(fetchOrg, `${origin}/api/workers`, {
          deviceId: device.deviceId,
          name: device.name,
          engines: published,
        });
        if (!registered.ok) throw Object.assign(new Error(`Registration refused (${registered.status})`), { status: registered.status });
        const pull = await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/pull`, { waitMs });
        if (!pull.ok) throw Object.assign(new Error(`Turn polling refused (${pull.status})`), { status: pull.status });
        const body = await pull.json();
        const turns = Array.isArray(body.turns) && body.turns.length
          ? body.turns
          : (body.ids ?? []).map((messageId) => ({ messageId }));
        for (const turn of turns) await runTurn(origin, device, turn, published);
        retry.backoff.reset();
        retry.at = 0;
      } catch (error) {
        // An older server with no worker route needs the same long pause
        // as a refused session, rather than a request every 250 ms.
        const pause = retry.backoff.next(error?.status === 404 ? { status: 401 } : error);
        retry.at = now() + ([401, 403, 404].includes(error?.status) ? Math.max(60_000, pause) : pause);
        log(`machine worker: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const loop = async () => {
    while (!stopped) {
      await cycle();
      if (stopped) return;
      if (!origins().length) await sleep(5_000);
      else await sleep(250);
    }
  };

  const worker = {
    cycle,
    start() {
      if (chain && !stopped) return chain;
      const requested = ++generation;
      if (chain) return chain.catch(() => {}).then(() => requested === generation ? worker.start() : undefined);
      stopped = false;
      stopping = new AbortController();
      chain = loop().finally(() => { chain = null; });
      return chain;
    },
    stop() {
      generation++;
      stopped = true;
      stopping.abort();
      return chain ?? Promise.resolve();
    },
  };
  return worker;
}
