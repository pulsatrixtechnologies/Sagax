import { randomBytes } from "node:crypto";
import { acceptInvite, inviteStatus, roleOf, type OrgInvite, type OrgRole } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept, type OrgRecord } from "./org-record.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface OrgState {
  org: OrgRecord | null;
  invites: OrgInvite[];
  signIn: { admins: string[]; members: string[] };
}

function orgPeople(state: OrgState, ownerEmail?: string): { id: string; role: OrgRole }[] {
  if (!state.org) return [];
  const lists = { ownerUserId: state.org.ownerUserId, admins: state.signIn.admins, members: state.signIn.members };
  const people: { id: string; role: OrgRole }[] = [];
  const seen = new Set<string>();
  const owner = ownerEmail?.trim().toLowerCase();
  for (const id of [state.org.ownerUserId, ...state.signIn.admins, ...state.signIn.members]) {
    if (seen.has(id)) continue;
    // The owner is listed once, by principal id, even when their sign-in
    // email is also in admins or members.
    if (id !== state.org.ownerUserId && owner && id.trim().toLowerCase() === owner) continue;
    // The owner is a principal id, matched against itself. Admins and
    // members are emails, so each is matched by its own email.
    const role = id === state.org.ownerUserId ? roleOf({ ...lists, userId: id }) : roleOf({ ...lists, userId: id, email: id });
    if (!role) continue;
    seen.add(id);
    people.push({ id, role });
  }
  return people;
}

export function getOrgRoute(state: OrgState, now = Date.now(), ownerEmail?: string) {
  if (!state.org) return { status: 404 as const };
  const pendingInvites = state.invites
    .filter((invite) => inviteStatus(invite, now) === "open")
    .map((invite) => ({ email: invite.email, expiresAt: invite.expiresAt }));
  return { status: 200 as const, body: { org: state.org, people: orgPeople(state, ownerEmail), pendingInvites } };
}

/** `persist` saves the new org before it becomes the state: a failed save
 * throws and leaves no organization behind. */
export function createOrgRoute(
  state: OrgState,
  input: { name: string; ownerUserId: string; host: OrgRecord["host"] },
  persist?: (org: OrgRecord) => void,
) {
  if (state.org) return { status: 409 };
  const org = createOrg(input);
  persist?.(org);
  state.org = org;
  return { status: 200, body: { org } };
}

export function issueInviteRoute(state: OrgState, input: { actorId: string; email: string; now: number; token: string; actorEmail?: string }) {
  if (!state.org) return { status: 404 };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
    email: input.actorEmail,
  });
  if (role !== "owner" && role !== "admin") return { status: 403 };
  const invite = issueInvite({ email: input.email, now: input.now, token: input.token });
  state.invites.push(invite);
  return { status: 200, body: { invite: { token: invite.token, email: invite.email, expiresAt: invite.expiresAt } } };
}

function sameEmail(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function revokeInviteRoute(state: OrgState, input: { actorId: string; token: string; now: number; actorEmail?: string }) {
  if (!state.org) return { status: 404 as const };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
    email: input.actorEmail,
  });
  if (role !== "owner" && role !== "admin") return { status: 403 as const };
  const found = state.invites.find((invite) => invite.token === input.token);
  if (!found) return { status: 404 as const };
  const status = inviteStatus(found, input.now);
  if (status !== "open") return { status: 200 as const, body: { status } };
  found.revokedAt = input.now;
  return { status: 200 as const, body: { status: "revoked" as const } };
}

/** Accept adds the invited address. The caller does not need to already be in signIn.members. The token stays bound to that email. */
export function acceptInviteRoute(state: OrgState, input: { token: string; userId: string; now: number; sessionEmail?: string }) {
  const found = state.invites.find((invite) => invite.token === input.token);
  if (!found) return { status: 200, body: { status: "used" as const } };
  if (!sameEmail(input.userId, found.email)) return { status: 403 };
  if (input.sessionEmail !== undefined && input.sessionEmail !== "" && !sameEmail(input.sessionEmail, found.email)) {
    return { status: 403 };
  }
  const accepted = acceptInvite(found, input.now);
  if (!accepted.ok) return { status: 200, body: { status: accepted.status } };
  const lists = memberListsAfterAccept({ members: state.signIn.members, email: found.email });
  if (lists.alreadyMember) return { status: 200, body: { status: "already-member" as const } };
  state.invites[state.invites.indexOf(found)] = accepted.invite;
  state.signIn.members = lists.members;
  return { status: 200, body: { status: "joined" as const } };
}

function parseHost(value: unknown): OrgRecord["host"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { kind?: unknown; url?: unknown };
  if (record.kind === "this-computer") return { kind: "this-computer" };
  if (record.kind === "server" && typeof record.url === "string") return { kind: "server", url: record.url };
  return null;
}

export interface OrgRouteDeps {
  state: OrgState;
  actorId: (auth: RequestAuth) => string;
  actorEmail: (auth: RequestAuth) => string | undefined;
  /** The org owner's email, so the owner is not listed again by that email. */
  ownerEmail?: () => string | undefined;
  now?: () => number;
  token?: () => string;
  /** Saves the state; `next.org`, when given, is saved in place of the
   * current one (a new organization before it is assigned). */
  persist?: (next?: { org?: OrgRecord }) => void;
  /** After an organization was created and saved. */
  onOrgCreated?: () => void;
}

export function createOrgRoutes(deps: OrgRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const token = deps.token ?? (() => randomBytes(16).toString("hex"));
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/org") {
      const result = getOrgRoute(deps.state, now(), deps.ownerEmail?.());
      return json(res, result.status, result.body ?? {});
    }
    if (method !== "POST") return PASS;
    if (path === "/api/org") {
      const body = await readBody(req);
      const host = parseHost(body?.host);
      if (typeof body?.name !== "string" || !host) return json(res, 400, { error: "name and host are required" });
      let saveFailed: unknown;
      const persist = deps.persist;
      try {
        const result = createOrgRoute(deps.state, { name: body.name, ownerUserId: deps.actorId(auth), host }, persist
          ? (org) => {
            try {
              persist({ org });
            } catch (error) {
              saveFailed = error;
              throw error;
            }
          }
          : undefined);
        if (result.status === 200) deps.onOrgCreated?.();
        return json(res, result.status, result.body ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (saveFailed !== undefined) return json(res, 500, { error: `the organization could not be saved: ${message}` });
        return json(res, 400, { error: message });
      }
    }
    if (path === "/api/org/invites") {
      const body = await readBody(req);
      if (typeof body?.email !== "string") return json(res, 400, { error: "email is required" });
      const result = issueInviteRoute(deps.state, {
        actorId: deps.actorId(auth),
        actorEmail: deps.actorEmail(auth),
        email: body.email,
        now: now(),
        token: token(),
      });
      if (result.status === 200) deps.persist?.();
      return json(res, result.status, result.body ?? {});
    }
    const revoke = /^\/api\/org\/invites\/([^/]+)\/revoke$/.exec(path);
    if (revoke) {
      const result = revokeInviteRoute(deps.state, {
        actorId: deps.actorId(auth),
        actorEmail: deps.actorEmail(auth),
        token: decodeURIComponent(revoke[1]!),
        now: now(),
      });
      if (result.status === 200 && result.body.status === "revoked") deps.persist?.();
      return json(res, result.status, result.status === 200 ? result.body : {});
    }
    const accept = /^\/api\/org\/invites\/([^/]+)\/accept$/.exec(path);
    if (!accept) return PASS;
    const body = await readBody(req);
    if (typeof body?.userId !== "string") return json(res, 400, { error: "userId is required" });
    const sessionEmail = auth.kind === "session" ? auth.session.email : undefined;
    const result = acceptInviteRoute(deps.state, {
      token: decodeURIComponent(accept[1]!),
      userId: deps.actorEmail(auth) ?? body.userId,
      now: now(),
      sessionEmail,
    });
    if (result.body?.status === "joined") deps.persist?.();
    return json(res, result.status, result.body ?? {});
  };
}
