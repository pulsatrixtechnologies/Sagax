import { describe, expect, it } from "vitest";

import { createHostScreenLease } from "./host-screen-lease.mjs";

const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });

function lease(answers, calls = []) {
  return createHostScreenLease({
    url: () => "http://127.0.0.1:1/api/desktop/shared-computer-control",
    headers: () => ({}),
    timeoutMs: 50,
    fetch: async (_url, init) => {
      const action = JSON.parse(init.body).action;
      calls.push(action);
      const answer = answers[action];
      return typeof answer === "function" ? answer(init) : answer.shift?.() ?? answer;
    },
  });
}

describe("lent screen lock on this computer", () => {
  it("passes on the server's own reason: another bot, a person, an organization", async () => {
    for (const code of ["screen_bot", "screen_person", "managed_policy"]) {
      const status = code === "managed_policy" ? 403 : 409;
      await expect(lease({ acquire: reply(status, { error: `reason ${code}`, code }) })("id"))
        .rejects.toMatchObject({ message: `reason ${code}`, code });
    }
  });

  it("never reads a failed check as a person (regression: every failure said 'in use')", async () => {
    for (const [status, body] of [[400, { error: "Invalid computer lease" }], [401], [403, { error: "Local desktop only" }], [404], [500], [409, { error: "made up" }]]) {
      const refused = await lease({ acquire: reply(status, body) })("id").catch((error) => error);
      expect(refused.message).toContain(`its server answered ${status}`);
      expect(refused.message).toContain("This is not a person");
      expect(refused.message).not.toMatch(/in use locally|held by a person/);
    }
    const unreachable = await createHostScreenLease({ url: () => "x", headers: () => ({}), fetch: async () => { throw new TypeError("fetch failed"); } })("id").catch((error) => error);
    expect(unreachable.message).toContain("could not be reached");
    const slow = await createHostScreenLease({
      url: () => "x", headers: () => ({}), timeoutMs: 20,
      fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    })("id").catch((error) => error);
    expect(slow.message).toContain("did not answer within");
  });

  it("passes on the call's own stop as it is", async () => {
    const stop = new AbortController();
    const reason = new Error("stopped by the call");
    const pending = createHostScreenLease({
      url: () => "x", headers: () => ({}), timeoutMs: 5_000,
      fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    })("id", stop.signal);
    stop.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("renews without the takeover checks, and takes the screen again only when the lease is gone", async () => {
    const calls = [];
    const control = await lease({ acquire: () => reply(200, { ok: true }), renew: [reply(200, { ok: true, renewed: true }), reply(200, { ok: true, renewed: false })], release: () => reply(200, { ok: true }) }, calls)("id");
    await control.renew();
    expect(calls).toEqual(["acquire", "renew"]);
    await control.renew();
    expect(calls).toEqual(["acquire", "renew", "renew", "acquire"]);
    await control.release();
    expect(calls.at(-1)).toBe("release");
  });
});
