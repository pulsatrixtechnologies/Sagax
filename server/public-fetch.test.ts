import { describe, expect, it } from "vitest";

import { guardedFetch } from "./public-fetch.ts";

describe("guardedFetch", () => {
  it("leaves the first request alone, including a loopback probe", async () => {
    const response = await guardedFetch("http://127.0.0.1/ok", {}, async () => new Response("ok", { status: 200 }));
    expect(await response.text()).toBe("ok");
  });

  it("does not follow a redirect onto loopback or the Azure WireServer", async () => {
    const calls: string[] = [];
    const inner: typeof fetch = async (input) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
    };
    await expect(guardedFetch("http://127.0.0.1:9/start", {}, inner)).rejects.toThrow(/public internet/);
    expect(calls).toEqual(["http://127.0.0.1:9/start"]);

    const wire = async () => new Response(null, { status: 302, headers: { location: "http://168.63.129.16/machine" } });
    await expect(guardedFetch("https://example.test/start", {}, wire)).rejects.toThrow(/public internet/);
  });
});
