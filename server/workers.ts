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

/** Drop `messageId`. Status is failed. `partial` is the same string. */
export function failTurn(input: {
  queued: string[];
  messageId: string;
  partial: string;
}): { queued: string[]; status: "failed"; partial: string } {
  return {
    queued: input.queued.filter((id) => id !== input.messageId),
    status: "failed",
    partial: input.partial,
  };
}

export interface OpenTurnMessage {
  id: string;
  text?: string;
  status?: "failed";
  card?: { answered?: unknown };
}

function withFailedStatus(messages: OpenTurnMessage[], messageId: string, partial: string): OpenTurnMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    if (message.text === undefined && partial) return { ...message, text: partial, status: "failed" };
    return { ...message, status: "failed" };
  });
}

/** The queue loses this id and the channel message is marked failed.
 * Other messages stay. The card object is not answered. */
export function failOpenTurn(input: {
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed"; partial: string; messages: OpenTurnMessage[] } {
  const failed = failTurn({ queued: input.queued, messageId: input.messageId, partial: input.partial });
  return {
    queued: failed.queued,
    status: failed.status,
    partial: failed.partial,
    messages: withFailedStatus(input.messages, input.messageId, failed.partial),
  };
}

/** A worker socket that closes before the turn starts leaves the queue.
 * A close during the turn uses failTurn. */
export function failTurnOnWorkerClose(input: {
  midTurn: boolean;
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed" | null; partial: string; messages: OpenTurnMessage[] } {
  if (!input.midTurn) {
    return { queued: input.queued, status: null, partial: input.partial, messages: input.messages };
  }
  return failOpenTurn(input);
}

function rosterLost(before: readonly string[], after: readonly string[]): boolean {
  return before.some((id) => !after.includes(id));
}

/** True when the next memberIds list drops a bot that is there now. */
export function memberIdsDropBot(input: {
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
}): boolean {
  return input.beforeMemberIds.some((id) => !input.afterMemberIds.includes(id));
}

/** A memberIds change while a turn is held is applied, not refused.
 * failTurn runs for the held id. Partial text stays. Nothing is approved. */
export function memberIdsChangeDuringHeldTurn(input: {
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
  heldId: string;
  queued: string[];
  partial: string;
  messages: OpenTurnMessage[];
}): {
  refused: boolean;
  memberIds: readonly string[];
  queued: string[];
  status: "failed" | null;
  partial: string;
  messages: OpenTurnMessage[];
} {
  if (!memberIdsDropBot({ beforeMemberIds: input.beforeMemberIds, afterMemberIds: input.afterMemberIds })) {
    return {
      refused: true,
      memberIds: input.beforeMemberIds,
      queued: input.queued,
      status: null,
      partial: input.partial,
      messages: input.messages,
    };
  }
  const failed = failTurnOnMembershipRemoval({
    beforeHumanIds: [],
    afterHumanIds: [],
    beforeMemberIds: input.beforeMemberIds,
    afterMemberIds: input.afterMemberIds,
    inTurn: true,
    queued: input.queued,
    messageId: input.heldId,
    partial: input.partial,
    messages: input.messages,
  });
  return {
    refused: false,
    memberIds: input.afterMemberIds,
    queued: failed.queued,
    status: failed.status,
    partial: failed.partial,
    messages: failed.messages,
  };
}

/** A human leaving humanIds, or a bot leaving memberIds, during a turn
 * uses the same failTurn path. History is the messages array, unchanged
 * except for the failed id. */
export function failTurnOnMembershipRemoval(input: {
  beforeHumanIds: readonly string[];
  afterHumanIds: readonly string[];
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
  inTurn: boolean;
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed" | null; partial: string; messages: OpenTurnMessage[] } {
  const removed = input.inTurn && (
    rosterLost(input.beforeHumanIds, input.afterHumanIds) || rosterLost(input.beforeMemberIds, input.afterMemberIds)
  );
  if (!removed) {
    return { queued: input.queued, status: null, partial: input.partial, messages: input.messages };
  }
  return failOpenTurn(input);
}

/** Queued ids and ids already pulled. A pull removes the id from the queue,
 * so membership has to see the inflight row, including on a task thread. */
export function turnsOpenForMembership(input: {
  threadIds: readonly string[];
  queued: readonly { messageId: string; threadId: string }[];
  inflight: readonly { messageId: string; threadId: string }[];
}): string[] {
  const threads = new Set(input.threadIds);
  const ids: string[] = [];
  for (const item of [...input.queued, ...input.inflight]) {
    if (!threads.has(item.threadId) || ids.includes(item.messageId)) continue;
    ids.push(item.messageId);
  }
  return ids;
}

/** A pull socket closes for the ids that pull holds, including after the
 * response has finished. Registration does not fail inflight ids. */
export function failPulledTurnsOnClose(input: {
  source: "register" | "pull";
  pulledIds: readonly string[];
  partials: Readonly<Record<string, string>>;
  messages: OpenTurnMessage[];
}): { failedIds: string[]; partials: Record<string, string>; messages: OpenTurnMessage[] } {
  if (input.source !== "pull") {
    return { failedIds: [], partials: { ...input.partials }, messages: input.messages };
  }
  let messages = input.messages;
  const partials = { ...input.partials };
  const failedIds: string[] = [];
  for (const messageId of input.pulledIds) {
    const partial = partials[messageId] ?? "";
    const result = failTurnOnWorkerClose({
      midTurn: true,
      queued: [],
      messageId,
      partial,
      messages,
    });
    messages = result.messages;
    partials[messageId] = result.partial;
    failedIds.push(messageId);
  }
  return { failedIds, partials, messages };
}

/** The pull socket's close fails that pull. A finished response does not swallow it. */
export function bindWorkerSocket(input: {
  socket: { once(event: "close", listener: () => void): void };
  onClose: () => void;
}): void {
  input.socket.once("close", () => {
    input.onClose();
  });
}

/** A channel turn waiting for one device. `userId` is who owned that device when the turn was held. */
export interface DeviceQueuedTurn {
  messageId: string;
  deviceId: string;
  userId: string;
  authorId: string;
  started: boolean;
}

export function destinationForBot(input: { host?: BotHost; workers: Worker[] }): ReturnType<typeof turnDestination> {
  const host = normalizedHost(input.host);
  return turnDestination({ host, workerOnline: machineOnline(input.workers, host) });
}

/** Fleet is the only destination the host runner may execute. */
export function invokeFleetRunner(input: {
  destination: ReturnType<typeof turnDestination>;
  run: () => void;
}): boolean {
  if (input.destination.kind !== "fleet") return false;
  input.run();
  return true;
}

export function enqueueOfflineTurn(input: {
  queued: DeviceQueuedTurn[];
  messageId: string;
  deviceId: string;
  userId: string;
  authorId: string;
}): DeviceQueuedTurn[] {
  if (input.queued.some((item) => !item.started && item.messageId === input.messageId && item.deviceId === input.deviceId && item.userId === input.userId)) {
    return input.queued;
  }
  return [...input.queued, {
    messageId: input.messageId,
    deviceId: input.deviceId,
    userId: input.userId,
    authorId: input.authorId,
    started: false,
  }];
}

/** Ids held for this device while that same session owned it. They leave the queue marked started. A second pull does not return them. */
export function takeQueued(deviceId: string, queued: DeviceQueuedTurn[], userId: string): {
  queued: DeviceQueuedTurn[];
  ids: string[];
  started: DeviceQueuedTurn[];
} {
  const started: DeviceQueuedTurn[] = [];
  const rest: DeviceQueuedTurn[] = [];
  for (const item of queued) {
    if (item.deviceId === deviceId && item.userId === userId && !item.started) started.push({ ...item, started: true });
    else rest.push(item);
  }
  return { queued: rest, ids: started.map((item) => item.messageId), started };
}

/** The author can drop their own queued message. Anyone else leaves the queue as it is. */
export function cancelQueued(messageId: string, authorId: string, queued: DeviceQueuedTurn[]): DeviceQueuedTurn[] {
  if (!authorId) return queued;
  return queued.filter((item) => item.started || item.messageId !== messageId || item.authorId !== authorId);
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
 * Fleet bots are the only ones the host may run. Offline and online machines
 * are both claimable by that device's pull. Only an offline machine is
 * machine-offline. A missing host is fleet.
 */
export function channelTurnGate(input: {
  bots: { id: string; host?: BotHost }[];
  workers: Worker[];
  messageId: string;
  authorId?: string;
  queued: DeviceQueuedTurn[];
}): { queued: DeviceQueuedTurn[]; fleetIds: string[]; status: "machine-offline" | null } {
  let queued = input.queued;
  let held = false;
  const fleetIds: string[] = [];
  const authorId = input.authorId ?? "";
  for (const bot of input.bots) {
    const host = normalizedHost(bot.host);
    const destination = turnDestination({ host, workerOnline: machineOnline(input.workers, host) });
    queueTurn({ destination, messageId: input.messageId, queued: queued.map((item) => item.messageId) });
    if (destination.kind === "fleet") {
      fleetIds.push(bot.id);
    } else if (destination.kind === "worker") {
      queued = enqueueOfflineTurn({
        queued,
        messageId: input.messageId,
        deviceId: destination.deviceId,
        userId: host.kind === "machine" ? host.userId : "",
        authorId,
      });
    } else if (destination.kind === "queued" && host.kind === "machine") {
      held = true;
      queued = enqueueOfflineTurn({
        queued,
        messageId: input.messageId,
        deviceId: host.deviceId,
        userId: host.userId,
        authorId,
      });
    }
  }
  return { queued, fleetIds, status: held ? "machine-offline" : null };
}

export function pullQueuedForSession(input: {
  deviceId: string;
  userId: string;
  workers: Worker[];
  queued: DeviceQueuedTurn[];
}): { status: 200; ids: string[]; queued: DeviceQueuedTurn[] } | { status: 403; error: "forbidden" } {
  const owner = input.workers.find((worker) => worker.deviceId === input.deviceId);
  if (!owner || owner.userId !== input.userId) return { status: 403, error: "forbidden" };
  const pulled = takeQueued(input.deviceId, input.queued, input.userId);
  return { status: 200, ids: pulled.ids, queued: pulled.queued };
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
  queued(): DeviceQueuedTurn[];
  replaceQueued(queued: DeviceQueuedTurn[]): void;
  userId(auth: RequestAuth): string;
  authorId(auth: RequestAuth): string;
  /** The caller that just registered this device, so approval delivery can
   * tell that session from the owner's other sessions. */
  rememberDevice?(input: { sessionId?: string; userId: string; deviceId: string }): void;
  /** Ids the device just took. They are in a turn until the socket closes. */
  onTurnPulled?(input: { deviceId: string; userId: string; messageIds: string[] }): void;
  /** The pull socket dropped. `messageIds` are the ids that pull holds, not every inflight id. */
  onWorkerSocketClose?(input: { deviceId: string; userId: string; messageIds: string[] }): void;
}

export function createWorkerRoutes(deps: WorkerRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST") return PASS;
    if (path === "/api/workers") {
      const body = await readBody(req);
      const result = registerWorkerBody({
        workers: deps.workers(),
        userId: deps.userId(auth),
        body: body && typeof body === "object" && !Array.isArray(body) ? body : null,
      });
      if (result.status === 400) return json(res, 400, { error: result.error });
      deps.replace(result.workers);
      deps.rememberDevice?.({
        sessionId: auth.kind === "session" ? auth.session.id : undefined,
        userId: result.worker.userId,
        deviceId: result.worker.deviceId,
      });
      return json(res, 200, { worker: result.worker });
    }
    const pull = path.match(/^\/api\/workers\/([\w-]+)\/pull$/);
    if (pull) {
      const result = pullQueuedForSession({
        deviceId: pull[1]!,
        userId: deps.userId(auth),
        workers: deps.workers(),
        queued: deps.queued(),
      });
      if (result.status === 403) return json(res, 403, { error: result.error });
      deps.replaceQueued(result.queued);
      if (result.ids.length) {
        deps.onTurnPulled?.({ deviceId: pull[1]!, userId: deps.userId(auth), messageIds: result.ids });
        bindWorkerSocket({
          socket: req.socket,
          onClose() {
            deps.onWorkerSocketClose?.({
              deviceId: pull[1]!,
              userId: deps.userId(auth),
              messageIds: result.ids,
            });
          },
        });
      }
      return json(res, 200, { ids: result.ids });
    }
    const cancel = path.match(/^\/api\/workers\/queue\/([\w-]+)\/cancel$/);
    if (cancel) {
      const before = deps.queued();
      const next = cancelQueued(cancel[1]!, deps.authorId(auth), before);
      deps.replaceQueued(next);
      return json(res, 200, { removed: before.length - next.length });
    }
    return PASS;
  };
}
