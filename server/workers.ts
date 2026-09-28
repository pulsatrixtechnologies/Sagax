import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { turnDestination, type BotHost } from "./turn-route.ts";

export interface Worker {
  deviceId: string;
  userId: string;
  online: boolean;
}

/** Same deviceId is one entry. The new record replaces it. Other devices stay. */
export function registerWorker(workers: Worker[], worker: Worker): Worker[] {
  return [...workers.filter((entry) => entry.deviceId !== worker.deviceId), worker];
}

export function queueTurn(input: {
  destination: ReturnType<typeof turnDestination>;
  messageId: string;
  queued: string[];
}): { queued: string[]; started: boolean } {
  if (input.destination.kind === "queued") {
    return { queued: [...input.queued, input.messageId], started: false };
  }
  return { queued: input.queued, started: true };
}

function normalizedHost(host: BotHost | undefined): BotHost {
  if (host?.kind === "machine" && host.userId && host.deviceId) return host;
  return { kind: "fleet" };
}

function machineOnline(workers: Worker[], host: BotHost): boolean {
  if (host.kind !== "machine") return false;
  return workers.some((worker) => worker.online && worker.deviceId === host.deviceId && worker.userId === host.userId);
}

/**
 * One channel message is queued once, even when several bots are offline.
 * A missing host is fleet, so an older bot is not treated as an offline machine.
 */
export function channelTurnGate(input: {
  bots: { id: string; host?: BotHost }[];
  workers: Worker[];
  messageId: string;
  queued: string[];
}): { queued: string[]; startedIds: string[]; status: "machine-offline" | null } {
  let queued = input.queued;
  let held = false;
  const startedIds: string[] = [];
  for (const bot of input.bots) {
    const host = normalizedHost(bot.host);
    const destination = turnDestination({ host, workerOnline: machineOnline(input.workers, host) });
    const result = queueTurn({ destination, messageId: input.messageId, queued });
    if (result.started) {
      startedIds.push(bot.id);
    } else if (!held) {
      queued = result.queued;
      held = true;
    }
  }
  return { queued, startedIds, status: held ? "machine-offline" : null };
}

export function registerWorkerBody(input: {
  workers: Worker[];
  userId: string;
  body: { deviceId?: unknown } | null;
}): { status: 200; worker: Worker; workers: Worker[] } | { status: 400; error: string } {
  const deviceId = typeof input.body?.deviceId === "string" ? input.body.deviceId.trim() : "";
  const userId = input.userId.trim();
  if (!deviceId) return { status: 400, error: "deviceId is required" };
  if (!userId) return { status: 400, error: "session user is required" };
  const worker: Worker = { deviceId, userId, online: true };
  return { status: 200, worker, workers: registerWorker(input.workers, worker) };
}

export interface WorkerRouteDeps {
  workers(): Worker[];
  replace(workers: Worker[]): void;
  userId(auth: RequestAuth): string;
}

export function createWorkerRoutes(deps: WorkerRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST" || path !== "/api/workers") return PASS;
    const body = await readBody(req);
    const result = registerWorkerBody({
      workers: deps.workers(),
      userId: deps.userId(auth),
      body: body && typeof body === "object" && !Array.isArray(body) ? body : null,
    });
    if (result.status === 400) return json(res, 400, { error: result.error });
    deps.replace(result.workers);
    return json(res, 200, { worker: result.worker });
  };
}
