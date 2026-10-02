// Perspicax MCP for the person who speaks (slice 5, spec section 4).
//
// A bot on an organization server lists Perspicax profiles
// (server/bot-perspicax.ts). When a turn starts, the harness takes the
// speaker's current sign-in access token (server/idp-session.ts, memory
// only) and exchanges it at Perspicax (RFC 8693, server/perspicax-link.ts)
// for one short MCP token per profile. Those tokens stay here: the engine
// mounts a stdio bridge per profile (server/perspicax-mcp-bridge.ts) that
// holds only this turn's capability and posts every JSON-RPC frame to
// POST /api/internal/perspicax/mcp, which lands in `relay` below. The
// tokens are revoked when the turn's generation ends.
//
//   - a person speaking uses their own access, never the owner's (T2); a
//     peer hop speaks for its root human; `operator` is the owner;
//   - a routine, and anything it starts (a bot it asks, a thread it opens, a
//     room goal it runs: routine lineage), uses the routine delegation of the
//     person it runs as (slice 6), never a sign-in; without one, nothing;
//   - a peer hop whose source speaker is not known is an unknown speaker,
//     never the asking bot's owner;
//   - a profile the speaker does not hold is not mounted: the turn gets a
//     note and an activity row instead (decided before the engine lists its
//     tools);
//   - a token near its end, or refused by /mcp, is exchanged again once with
//     a fresh subject; when that fails the call answers "Perspicax access
//     for this turn ended" (a disabled person mid-turn, S5-10);
//   - no token is ever logged or put in an error.
import type { SubjectTokenOutcome } from "./idp-session.ts";
import type { DirectoryProfile, ExchangeResult } from "./perspicax-link.ts";

export type PerspicaxUnavailableReason = "not_held" | "no_session" | "unreachable" | "rate_limited" | "no_delegation" | "unknown_speaker" | "unknown_profile";

/** Why a profile is not mounted, as the system note and the activity row say it. */
export const PERSPICAX_UNAVAILABLE_WHY: Record<PerspicaxUnavailableReason, string> = {
  not_held: "the person speaking does not hold this profile in Perspicax",
  no_session: "the person speaking has no live Perspicax sign-in on this server",
  unreachable: "Perspicax could not be reached",
  rate_limited: "Perspicax is rate limiting this server; try again in a minute",
  no_delegation: "the person it runs as has not allowed routines to act in their name",
  unknown_speaker: "the person speaking is not known to Perspicax",
  unknown_profile: "Perspicax no longer lists this profile",
};

/** The activity row of the profiles one reason left out of a turn. A rate
 * limit says its sentence, so the person knows to wait; the other reasons
 * keep their code. */
export function perspicaxUnavailableRow(names: readonly string[], speakerName: string, reason: PerspicaxUnavailableReason): string {
  const head = `Perspicax: ${names.join(", ")} unavailable for ${speakerName}`;
  return reason === "rate_limited" ? `${head}: ${PERSPICAX_UNAVAILABLE_WHY.rate_limited}` : `${head} (${reason})`;
}

export interface PerspicaxMountedProfile {
  profileId: string;
  slug: string;
  name: string;
}

export interface PerspicaxTurnPlan {
  mounted: PerspicaxMountedProfile[];
  unavailable: Array<{ profileId: string; name: string; reason: PerspicaxUnavailableReason }>;
}

/** The link client calls this module needs (PerspicaxDirectory). */
export interface PerspicaxMcpLink {
  exchangeToken(subjectToken: string, profileId: string): Promise<ExchangeResult>;
  revokeExchanged(token: string): Promise<boolean>;
  mcpEndpoint(): string;
  profileCatalog(): DirectoryProfile[];
}

export interface PerspicaxMcpOptions {
  /** SAGAX_PERSPICAX_ISSUER; a speaker's subject must come from it. */
  issuer: string;
  /** The link client, or null while this server is not linked (solo mode, no
   * link file): nothing mounts then. */
  link(): PerspicaxMcpLink | null;
  /** The speaker's Perspicax subject, and whether they are out now. */
  subjectOf(principalId: string): { iss: string; sub: string; disabled: boolean } | null;
  /** IdpSessionManager.subjectToken. */
  subjectToken(subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome>;
  /** Slice 6: RoutineConsents.subjectToken, the subject of routine lineage. */
  routineSubjectToken?(principalId: string): Promise<SubjectTokenOutcome>;
  /** Slice 6: an exchange refused a delegation subject: forget its cache
   * (RoutineConsents.dropCache), so the next run learns the end at once. */
  delegationRefused?(principalId: string): void;
  /** The bot's current profile ids (undefined: the bot is gone). */
  botProfiles(botId: string): readonly string[] | undefined;
  /** The thread is on a live voice call: a turn's tokens are kept for its
   * next turn instead of revoked, so the call's tools stay mounted from turn
   * to turn without a new exchange (server/voice-call-session.ts). */
  keepWarm?(threadId: string): boolean;
  /** Pulsa Bot's version, sent in `clientInfo`. */
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

/** A token with less than this left is exchanged again before a call. */
export const PERSPICAX_TOKEN_MIN_LIFE_MS = 60_000;
export const PERSPICAX_RELAY_TIMEOUT_MS = 10 * 60_000;
export const PERSPICAX_RELAY_MAX_BYTES = 20 * 1024 * 1024;
export const PERSPICAX_ACCESS_ENDED = "Perspicax access for this turn ended";

interface Entry {
  threadId: string;
  generation: string;
  botId: string;
  profileId: string;
  principalId: string;
  subject: { iss: string; sub: string };
  /** Slice 6: whose grant the subject came from, and so how to renew it. */
  source: "session" | "delegation";
  token: string;
  expiresAt: number;
  mcpSessionId?: string;
  /** The person is out, or the access could not be renewed: every call ends. */
  ended?: boolean;
  renewing?: Promise<boolean>;
}

export interface PerspicaxRelayAnswer {
  status: number;
  /** A JSON body, absent for 202. */
  body?: unknown;
}

const key = (threadId: string, generation: string, profileId: string) => `${threadId}\u0000${generation}\u0000${profileId}`;
const warmKey = (threadId: string, profileId: string, principalId: string, source: Entry["source"]) =>
  `${threadId}\u0000${profileId}\u0000${principalId}\u0000${source}`;
/** A refusal worth one more try a moment later. */
const TRANSIENT = new Set(["unreachable", "rate_limited"]);
const RETRY_EXCHANGE_MS = 400;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** One JSON-RPC answer out of a JSON or an SSE body (connector-proxy.ts). */
export function parseMcpBody(text: string, id: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as unknown;
  const frames = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Json];
      } catch {
        return [];
      }
    });
  return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}

async function readBounded(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error("the Perspicax answer is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error("the Perspicax answer is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export class PerspicaxMcp {
  private readonly options: PerspicaxMcpOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly entries = new Map<string, Entry>();
  /** tokens a call keeps between turns (keepWarm), by thread, profile and speaker */
  private readonly warm = new Map<string, Entry>();

  constructor(options: PerspicaxMcpOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Exchange the speaker's access for each profile of the bot, before the
   * engine starts. Never throws. */
  async prepareTurn(input: {
    threadId: string;
    generation: string;
    bot: { id: string; perspicax?: { profiles: readonly string[] } };
    speakerPrincipalId: string;
    speakerOrigin: "person" | "operator" | "owner-routine" | "peer";
    /** The turn descends from a routine or other automation (a hop it
     * asked, a thread it opened, a room goal it runs). */
    routine?: boolean;
  }): Promise<PerspicaxTurnPlan> {
    const plan: PerspicaxTurnPlan = { mounted: [], unavailable: [] };
    const link = this.options.link();
    const profiles = [...new Set(input.bot.perspicax?.profiles ?? [])];
    if (!link || !profiles.length) return plan;
    const catalog = new Map(link.profileCatalog().map((profile) => [profile.id, profile] as const));
    const nameOf = (id: string) => catalog.get(id)?.name || catalog.get(id)?.slug || id;
    const refuse = (ids: readonly string[], reason: PerspicaxUnavailableReason) => {
      for (const id of ids) plan.unavailable.push({ profileId: id, name: nameOf(id), reason });
    };
    const known = profiles.filter((id) => catalog.has(id));
    refuse(profiles.filter((id) => !catalog.has(id)), "unknown_profile");
    if (!known.length) return plan;
    const source: Entry["source"] = input.speakerOrigin === "owner-routine" || input.routine === true ? "delegation" : "session";
    const principalId = input.speakerPrincipalId.trim();
    const subject = principalId ? this.options.subjectOf(principalId) : null;
    if (!subject || subject.iss !== this.options.issuer) {
      refuse(known, "unknown_speaker");
      return plan;
    }
    if (subject.disabled) {
      refuse(known, "no_session");
      return plan;
    }
    const who = { iss: subject.iss, sub: subject.sub };
    // On a live call, the tokens of the call's last turn are still good:
    // reuse them rather than exchange again for every sentence (a call's
    // quick turns hit Perspicax's rate limit, and a refused exchange left
    // the profile out of that turn: tools gone, then back).
    let need = known;
    const keepWarm = this.options.keepWarm?.(input.threadId) === true;
    // the call ended (or expired) without saying so: its kept tokens go
    if (!keepWarm) void this.endWarm(input.threadId);
    if (keepWarm) {
      need = [];
      for (const profileId of known) {
        const at = warmKey(input.threadId, profileId, principalId, source);
        const kept = this.warm.get(at);
        if (kept && !kept.ended && kept.botId === input.bot.id && kept.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
          this.warm.delete(at);
          kept.generation = input.generation;
          const previous = this.entries.get(key(input.threadId, input.generation, profileId));
          if (previous && previous !== kept) void this.revoke(previous.token);
          this.entries.set(key(input.threadId, input.generation, profileId), kept);
          const profile = catalog.get(profileId)!;
          plan.mounted.push({ profileId, slug: profile.slug, name: profile.name || profile.slug || profileId });
          this.log(`perspicax mcp: profile ${profileId} kept for the call's next turn`);
        } else need.push(profileId);
      }
      if (!need.length) return plan;
    }
    let signIn = await this.subjectFor(source, principalId, who);
    if (!signIn.ok) {
      refuse(need, signIn.error === "unreachable" || signIn.error === "rate_limited" ? signIn.error : source === "delegation" ? "no_delegation" : "no_session");
      return plan;
    }
    const exchangeAll = (token: string, ids: readonly string[] = need) => Promise.all(ids.map(async (profileId) => ({ profileId, result: await link.exchangeToken(token, profileId) })));
    let results = await exchangeAll(signIn.token);
    // a refusal that may pass a moment later (unreachable, rate limited) is
    // tried once more before the profile is left out of the turn
    const transient = results.filter(({ result }) => !result.ok && TRANSIENT.has(result.error)).map(({ profileId }) => profileId);
    if (transient.length) {
      this.log(`perspicax mcp: exchange for ${transient.join(", ")} refused for now; retrying once`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_EXCHANGE_MS));
      const again = await exchangeAll(signIn.token, transient);
      results = results.map((entry) => again.find((retry) => retry.profileId === entry.profileId) ?? entry);
    }
    if (source === "delegation" && results.some(({ result }) => !result.ok && result.error === "subject")) {
      // The cached delegation token was refused (revoked from the console,
      // for one): drop it and renew once now. A live family mounts the tools
      // for this very turn; an ended one is learned (and its routines
      // paused) now rather than at the next run.
      this.options.delegationRefused?.(principalId);
      const renewed = await this.subjectFor(source, principalId, who);
      if (renewed.ok) {
        for (const { result } of results) if (result.ok) void this.revoke(result.token);
        signIn = renewed;
        results = await exchangeAll(renewed.token);
      }
    }
    for (const { profileId, result } of results) {
      if (!result.ok) {
        const reason: PerspicaxUnavailableReason = result.error === "not_held" ? "not_held"
          : result.error === "subject" ? (source === "delegation" ? "no_delegation" : "no_session")
          : result.error === "rate_limited" ? "rate_limited" : "unreachable";
        this.log(`perspicax mcp: profile ${profileId} not mounted for this turn (${reason})`);
        refuse([profileId], reason);
        continue;
      }
      const at = key(input.threadId, input.generation, profileId);
      const previous = this.entries.get(at);
      if (previous) void this.revoke(previous.token);
      this.entries.set(at, {
        threadId: input.threadId,
        generation: input.generation,
        botId: input.bot.id,
        profileId,
        principalId,
        subject: who,
        source,
        token: result.token,
        expiresAt: Math.min(result.expiresAt, signIn.expiresAt),
      });
      const profile = catalog.get(profileId)!;
      plan.mounted.push({ profileId, slug: profile.slug, name: profile.name || profile.slug || profileId });
    }
    return plan;
  }

  /** Relay one JSON-RPC frame from a bridge to Perspicax /mcp. */
  async relay(input: { threadId: string; generation: string; botId: string; profileId: string; frame: unknown }): Promise<PerspicaxRelayAnswer> {
    const entry = this.entries.get(key(input.threadId, input.generation, input.profileId));
    if (!entry || entry.botId !== input.botId) return { status: 403, body: { error: "this Perspicax profile is not mounted in this turn", code: "profile_not_mounted" } };
    if (!isObject(input.frame)) return { status: 400, body: rpcError(null, -32600, "Invalid Request") };
    const frame: Json = { ...input.frame };
    const id = frame.id;
    const notification = id === undefined;
    const ended = (): PerspicaxRelayAnswer => (notification ? { status: 202 } : { status: 200, body: rpcError(id, -32001, PERSPICAX_ACCESS_ENDED) });
    if (!(this.options.botProfiles(input.botId) ?? []).includes(input.profileId)) {
      return { status: 403, body: { error: "this bot no longer lists that Perspicax profile", code: "profile_not_mounted" } };
    }
    const speaker = this.options.subjectOf(entry.principalId);
    if (!speaker || speaker.disabled) this.end(entry);
    if (entry.ended) return ended();
    if (entry.expiresAt - this.now() < PERSPICAX_TOKEN_MIN_LIFE_MS && !(await this.renew(entry))) return ended();
    if (frame.method === "initialize") {
      const params = isObject(frame.params) ? { ...frame.params } : {};
      params.clientInfo = { name: `Pulsa Bot (${input.botId})`, version: this.options.version };
      frame.params = params;
    }
    const link = this.options.link();
    if (!link) return ended();
    let response: Response;
    try {
      response = await this.post(link.mcpEndpoint(), entry, frame);
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        if (!(await this.renew(entry))) return ended();
        response = await this.post(link.mcpEndpoint(), entry, frame);
        if (response.status === 401) {
          void response.body?.cancel().catch(() => {});
          this.end(entry);
          return ended();
        }
      }
    } catch (error) {
      this.log(`perspicax mcp: a call could not reach Perspicax (${error instanceof Error ? error.name : "error"})`);
      return notification ? { status: 202 } : { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
    }
    const session = response.headers.get("mcp-session-id");
    if (session && session.length <= 256) entry.mcpSessionId = session;
    let text: string;
    try {
      text = await readBounded(response, PERSPICAX_RELAY_MAX_BYTES);
    } catch {
      return notification ? { status: 202 } : { status: 200, body: rpcError(id, -32000, "Perspicax is unavailable") };
    }
    if (notification) return { status: 202 };
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = parseMcpBody(text, id);
      } catch {
        body = null;
      }
      if (isObject(body) && isObject(body.error)) return { status: 200, body };
      return { status: 200, body: rpcError(id, -32000, `Perspicax answered HTTP ${response.status}`) };
    }
    try {
      const body = parseMcpBody(text, id);
      return body === null ? { status: 200, body: rpcError(id, -32000, "Perspicax sent no answer") } : { status: 200, body };
    } catch {
      return { status: 200, body: rpcError(id, -32000, "Perspicax sent an answer that is not JSON") };
    }
  }

  /** The turn's generation ended: revoke every token it holds and close its
   * MCP sessions (best effort). */
  async endGeneration(threadId: string, generation: string): Promise<void> {
    await this.retire(`${threadId}\u0000${generation}\u0000`, threadId);
  }

  /** The call on this thread ended: the tokens it kept are revoked. */
  async endWarm(threadId: string): Promise<void> {
    const prefix = `${threadId}\u0000`;
    const done: Promise<unknown>[] = [];
    for (const [at, entry] of this.warm) {
      if (!at.startsWith(prefix)) continue;
      this.warm.delete(at);
      done.push(this.close(entry));
    }
    await Promise.all(done);
  }

  /** Every generation of a thread (stop, delete, the backstop before a new
   * turn). On a live call its tokens are kept for the call's next turn. */
  async endThread(threadId: string): Promise<void> {
    const keep = this.options.keepWarm?.(threadId) === true;
    await Promise.all([this.retire(`${threadId}\u0000`, threadId), ...(keep ? [] : [this.endWarm(threadId)])]);
  }

  /** End the entries under `prefix`: kept for a live call's next turn
   * (prepareTurn takes them over), revoked otherwise. */
  private async retire(prefix: string, threadId: string): Promise<void> {
    const done: Promise<unknown>[] = [];
    const keep = this.options.keepWarm?.(threadId) === true;
    for (const [at, entry] of this.entries) {
      if (!at.startsWith(prefix)) continue;
      this.entries.delete(at);
      if (keep && !entry.ended && entry.expiresAt - this.now() >= PERSPICAX_TOKEN_MIN_LIFE_MS) {
        const warm = warmKey(entry.threadId, entry.profileId, entry.principalId, entry.source);
        const previous = this.warm.get(warm);
        if (previous && previous !== entry) done.push(this.close(previous));
        this.warm.set(warm, entry);
        continue;
      }
      done.push(this.close(entry));
    }
    await Promise.all(done);
  }

  /** Shutdown: revoke everything. */
  async endAll(): Promise<void> {
    const all = [...this.entries.values(), ...this.warm.values()];
    this.entries.clear();
    this.warm.clear();
    await Promise.all(all.map((entry) => this.close(entry)));
  }

  /** The person is out (back-channel logout, directory): every token of
   * theirs is revoked now, and their running turns' calls end. */
  forgetSubject(iss: string, sub: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.subject.iss === iss && entry.subject.sub === sub) this.end(entry);
    }
  }

  /** Slice 6: the person's routine delegation ended: every token exchanged
   * from it is revoked now, and those turns' calls end. */
  forgetPrincipal(principalId: string): void {
    for (const entry of [...this.entries.values(), ...this.warm.values()]) {
      if (entry.source === "delegation" && entry.principalId === principalId) this.end(entry);
    }
  }

  /** The subject token of a turn: the sign-in's for a person, the routine
   * delegation's for routine lineage. */
  private subjectFor(source: Entry["source"], principalId: string, subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome> {
    if (source === "session") return this.options.subjectToken(subject);
    if (!this.options.routineSubjectToken) return Promise.resolve({ ok: false, error: "no_session" });
    return this.options.routineSubjectToken(principalId);
  }

  /** How many turns hold tokens (tests, health). */
  size(): number {
    return this.entries.size;
  }

  private post(endpoint: string, entry: Entry, frame: Json): Promise<Response> {
    return this.fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(PERSPICAX_RELAY_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${entry.token}`,
        ...(entry.mcpSessionId ? { "mcp-session-id": entry.mcpSessionId } : {}),
      },
      body: JSON.stringify(frame),
    });
  }

  /** Exchange again with a fresh subject, once at a time per entry. */
  private renew(entry: Entry): Promise<boolean> {
    entry.renewing ??= this.renewOnce(entry).finally(() => { entry.renewing = undefined; });
    return entry.renewing;
  }

  private async renewOnce(entry: Entry): Promise<boolean> {
    if (entry.ended) return false;
    const link = this.options.link();
    const speaker = this.options.subjectOf(entry.principalId);
    if (!link || !speaker || speaker.disabled) {
      this.end(entry);
      return false;
    }
    const signIn = await this.subjectFor(entry.source, entry.principalId, entry.subject);
    const result = signIn.ok ? await link.exchangeToken(signIn.token, entry.profileId) : null;
    if (entry.source === "delegation" && result && !result.ok && result.error === "subject") this.options.delegationRefused?.(entry.principalId);
    if (entry.ended) {
      if (result?.ok) void this.revoke(result.token);
      return false;
    }
    if (!signIn.ok || !result?.ok) {
      this.log(`perspicax mcp: the access for profile ${entry.profileId} could not be renewed (${signIn.ok ? (result && !result.ok ? result.error : "error") : signIn.error})`);
      this.end(entry);
      return false;
    }
    const old = entry.token;
    entry.token = result.token;
    entry.expiresAt = Math.min(result.expiresAt, signIn.expiresAt);
    void this.revoke(old);
    return true;
  }

  private end(entry: Entry): void {
    if (entry.ended) return;
    entry.ended = true;
    void this.revoke(entry.token);
  }

  private async close(entry: Entry): Promise<void> {
    const link = this.options.link();
    if (entry.ended) return;
    entry.ended = true;
    // The session goes first, while its token still opens it; then the token.
    if (link && entry.mcpSessionId) {
      await this.fetcher(link.mcpEndpoint(), {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { authorization: `Bearer ${entry.token}`, "mcp-session-id": entry.mcpSessionId },
      }).then((response) => { void response.body?.cancel().catch(() => {}); }, () => {});
    }
    await this.revoke(entry.token);
  }

  private async revoke(token: string): Promise<void> {
    const link = this.options.link();
    if (!link) return;
    try {
      await link.revokeExchanged(token);
    } catch {
      /* logged by the link client, never with the token */
    }
  }
}
