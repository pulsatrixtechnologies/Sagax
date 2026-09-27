import { randomBytes } from "node:crypto";
import { acceptInvite, roleOf, type OrgInvite } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept, type OrgRecord } from "./org-record.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface OrgState {
  org: OrgRecord | null;
  invites: OrgInvite[];
  signIn: { admins: string[]; members: string[] };
}

export function createOrgRoute(state: OrgState, input: { name: string; ownerUserId: string; host: OrgRecord["host"] }) {
  if (state.org) return { status: 409 };
  const org = createOrg(input);
  state.org = org;
  return { status: 200, body: { org } };
}

export function issueInviteRoute(state: OrgState, input: { actorId: string; email: string; now: number; token: string }) {
  if (!state.org) return { status: 404 };
  const role = roleOf({
    ownerUserId: state.org.ownerUserId,
    admins: state.signIn.admins,
    members: state.signIn.members,
    userId: input.actorId,
  });
  if (role !== "owner" && role !== "admin") return { status: 403 };
  const invite = issueInvite({ email: input.email, now: input.now, token: input.token });
  state.invites.push(invite);
  return { status: 200, body: { invite: { token: invite.token, email: invite.email, expiresAt: invite.expiresAt } } };
}

export function acceptInviteRoute(state: OrgState, input: { token: string; userId: string; now: number }) {
  const found = state.invites.find((invite) => invite.token === input.token);
  if (!found) return { status: 200, body: { status: "used" as const } };
  const accepted = acceptInvite(found, input.now);
  if (!accepted.ok) return { status: 200, body: { status: accepted.status } };
  const lists = memberListsAfterAccept({ members: state.signIn.members, email: input.userId });
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
  now?: () => number;
  token?: () => string;
  persist?: () => void;
}

export function createOrgRoutes(deps: OrgRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const token = deps.token ?? (() => randomBytes(16).toString("hex"));
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST") return PASS;
    if (path === "/api/org") {
      const body = await readBody(req);
      const host = parseHost(body?.host);
      if (typeof body?.name !== "string" || !host) return json(res, 400, { error: "name and host are required" });
      try {
        const result = createOrgRoute(deps.state, { name: body.name, ownerUserId: deps.actorId(auth), host });
        if (result.status === 200) deps.persist?.();
        return json(res, result.status, result.body ?? {});
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (path === "/api/org/invites") {
      const body = await readBody(req);
      if (typeof body?.email !== "string") return json(res, 400, { error: "email is required" });
      const result = issueInviteRoute(deps.state, {
        actorId: deps.actorId(auth),
        email: body.email,
        now: now(),
        token: token(),
      });
      if (result.status === 200) deps.persist?.();
      return json(res, result.status, result.body ?? {});
    }
    const accept = /^\/api\/org\/invites\/([^/]+)\/accept$/.exec(path);
    if (!accept) return PASS;
    const body = await readBody(req);
    if (typeof body?.userId !== "string") return json(res, 400, { error: "userId is required" });
    const result = acceptInviteRoute(deps.state, {
      token: decodeURIComponent(accept[1]!),
      userId: body.userId,
      now: now(),
    });
    if (result.body.status === "joined") deps.persist?.();
    return json(res, result.status, result.body);
  };
}
