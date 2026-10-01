// The provisioner API: only the Sagax server (holder of the shared key) can
// call it, every request is signed over method, path and body, replays are
// refused, and the only addressable thing is a per-person sandbox key.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SANDBOXD_AUTH_HEADER, SandboxdVerifier, signSandboxdRequest } from "./sandboxd-auth.ts";
import { SandboxService } from "./sandboxd-core.ts";
import { createSandboxdHandler } from "./sandboxd.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { sandboxdClient, SandboxdRequestError } from "./user-sandbox-client.ts";
import { sandboxKeyForPrincipal, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const sandboxKey = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-000000000001");

let server: Server;
let base: string;
let docker: FakeDocker;

beforeEach(async () => {
  docker = new FakeDocker();
  const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" });
  const service = new SandboxService(docker, config);
  await service.installEgressPolicy();
  server = createServer(createSandboxdHandler(service, new SandboxdVerifier(KEY)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function raw(method: string, path: string, body = "", header?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(header === undefined ? {} : { [SANDBOXD_AUTH_HEADER]: header }) },
    ...(method === "GET" ? {} : { body }),
  });
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
}

describe("sandboxd authorization", () => {
  it("answers health without auth but nothing else", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await raw("GET", "/v1/status")).status).toBe(401);
    expect((await raw("POST", `/v1/sandboxes/${sandboxKey}/ensure`, "{}")).status).toBe(401);
    expect(docker.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  });

  it("refuses a signature made with another key", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/ensure`;
    expect((await raw("POST", path, "{}", signSandboxdRequest(OTHER_KEY, "POST", path, "{}"))).status).toBe(401);
  });

  it("binds the signature to the method, the path and the body", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/exec`;
    const body = JSON.stringify({ argv: ["true"] });
    const signed = signSandboxdRequest(KEY, "POST", path, body);
    expect((await raw("POST", path, JSON.stringify({ argv: ["rm", "-rf", "/workspace"] }), signed)).status).toBe(401);
    const otherKey = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-000000000002");
    expect((await raw("POST", `/v1/sandboxes/${otherKey}/exec`, body, signed)).status).toBe(401);
    expect((await raw("DELETE", path, body, signed)).status).toBe(401);
  });

  it("refuses a replayed request and an expired one", async () => {
    const path = "/v1/status";
    const signed = signSandboxdRequest(KEY, "GET", path, "");
    expect((await raw("GET", path, "", signed)).status).toBe(200);
    expect((await raw("GET", path, "", signed)).status).toBe(401);
    expect((await raw("GET", path, "", signSandboxdRequest(KEY, "GET", path, "", Date.now() - 120_000))).status).toBe(401);
  });

  it("addresses only 32-hex person keys: no bot ids, no names, no traversal", async () => {
    for (const path of ["/v1/sandboxes/bot_123/ensure", "/v1/sandboxes/pr_00000000-0000-4000-8000-000000000001/ensure", `/v1/sandboxes/${sandboxKey.toUpperCase()}/ensure`, "/v1/bots/abc/ensure"]) {
      expect((await raw("POST", path, "{}", signSandboxdRequest(KEY, "POST", path, "{}"))).status).toBe(404);
    }
    // A dot segment is normalized away before it is sent, so its signature
    // no longer matches: refused either way, never acted on.
    const dotted = `/v1/sandboxes/${sandboxKey}/../${sandboxKey}/ensure`;
    expect((await raw("POST", dotted, "{}", signSandboxdRequest(KEY, "POST", dotted, "{}"))).status).toBe(401);
    expect(docker.containers.size).toBe(0);
  });

  it("serves the signed client end to end, and scopes every object by labels", async () => {
    const client = sandboxdClient(base, () => KEY);
    expect((await client.info()).egress).toBe("enforced");
    const ensured = await client.ensure(sandboxKey);
    expect(ensured.state).toBe("running");
    const result = await client.exec(sandboxKey, { argv: ["echo", "hi"] });
    expect(result.exitCode).toBe(0);
    expect(docker.execs[0]!.exec.User).toBe("1000:1000");
    expect(docker.execs[0]!.exec.Cmd.slice(0, 4)).toEqual(["timeout", "-k", "2", "120"]);
    await expect(client.exec(sandboxKey, { argv: ["true"], env: { PATH: "/evil" } })).rejects.toBeInstanceOf(SandboxdRequestError);
    expect((await client.remove(sandboxKey)).state).toBe("missing");
  });

  it("refuses to touch a same-named container it does not manage", async () => {
    await docker.createContainer(`sagax-user-${sandboxKey}`, { Labels: {} });
    const client = sandboxdClient(base, () => KEY);
    await expect(client.ensure(sandboxKey)).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(client.remove(sandboxKey)).rejects.toMatchObject({ status: 409 });
    expect(docker.containers.has(`sagax-user-${sandboxKey}`)).toBe(true);
  });

  it("rejects a client URL that is not plain internal http", () => {
    expect(() => sandboxdClient("https://sandboxd:8791", () => KEY)).toThrow();
    expect(() => sandboxdClient("http://user:pw@sandboxd:8791", () => KEY)).toThrow();
    expect(() => sandboxdClient("http://sandboxd:8791/v1", () => KEY)).toThrow();
  });
});
