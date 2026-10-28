// The desktop app checks in with each organization server the person is
// signed in to, and runs that person's machine-hosted turns on this
// computer. pi keeps its own directory (PI_CODING_AGENT_DIR, or ~/.pi/agent
// on the local server). Approvals are answered in the organization
// conversation and delivered to the engine here. No key is stored.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}) {
  let stopped = false;
  let chain = null;

  const loadEngines = async () => {
    if (engines) return engines();
    try {
      const response = await fetchLocal(`${localOrigin()}/api/instances`, { cache: "no-store" });
      if (!response.ok) return [];
      const body = await response.json();
      return publishEngines(body.instances);
    } catch {
      return [];
    }
  };

  const postJson = (fetchImpl, url, body) => fetchImpl(url, {
    method: "POST",
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const runTurn = async (origin, device, turn, published) => {
    const messageId = turn.messageId;
    if (!messageId) return;
    const query = turn.botId ? `?botId=${encodeURIComponent(turn.botId)}` : "";
    const loaded = await fetchOrg(`${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}${query}`, {
      credentials: "include",
      redirect: "error",
      cache: "no-store",
    });
    if (!loaded.ok) return;
    const job = await loaded.json();
    const beat = setInterval(() => {
      void postJson(fetchOrg, `${origin}/api/workers`, {
        deviceId: device.deviceId,
        name: device.name,
        engines: published,
      }).catch(() => undefined);
    }, 15_000);
    try {
      const local = await postJson(fetchLocal, `${localOrigin()}/api/machine-runs`, {
        instanceId: job.model?.instanceId,
        model: job.model?.model,
        ...(job.model?.effort ? { effort: job.model.effort } : {}),
        prompt: job.prompt,
        ...(job.bot?.soul ? { system: job.bot.soul } : {}),
        botId: job.botId,
        history: job.history ?? [],
      });
      if (!local.ok) {
        await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}`, {
          kind: "failed",
          text: "This computer could not start the turn.",
        });
        return;
      }
      let runId = "";
      await readSse(local, async (notice) => {
        if (typeof notice.runId === "string") runId = notice.runId;
        if (notice.kind === "progress" || notice.kind === "reply" || notice.kind === "failed") {
          await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}`, notice);
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
      await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/turns/${encodeURIComponent(messageId)}`, { kind: "done" });
    } finally {
      clearInterval(beat);
    }
  };

  const cycle = async () => {
    const list = origins().filter((origin) => typeof origin === "string" && origin);
    if (!list.length) return;
    const published = await loadEngines();
    const device = identity();
    for (const origin of list) {
      if (stopped) return;
      try {
        const registered = await postJson(fetchOrg, `${origin}/api/workers`, {
          deviceId: device.deviceId,
          name: device.name,
          engines: published,
        });
        if (!registered.ok) continue;
        const pull = await postJson(fetchOrg, `${origin}/api/workers/${device.deviceId}/pull`, { waitMs });
        if (!pull.ok) continue;
        const body = await pull.json();
        const turns = Array.isArray(body.turns) && body.turns.length
          ? body.turns
          : (body.ids ?? []).map((messageId) => ({ messageId }));
        for (const turn of turns) await runTurn(origin, device, turn, published);
      } catch (error) {
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

  return {
    cycle,
    start() {
      if (chain) return chain;
      stopped = false;
      chain = loop().finally(() => { chain = null; });
      return chain;
    },
    stop() {
      stopped = true;
    },
  };
}
