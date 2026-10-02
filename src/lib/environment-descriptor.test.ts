import { describe, expect, it } from "vitest";

import { fetchEnvironmentDescriptor } from "./environment-descriptor";

describe("fetchEnvironmentDescriptor", () => {
  it("asks for the new path, then the old one only when the server answers 404", async () => {
    const asked: string[] = [];
    const server = (statuses: Record<string, number>) => (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response("{}", { status: statuses[String(input)] ?? 404 });
    }) as typeof fetch;
    expect((await fetchEnvironmentDescriptor(undefined, server({ "/.well-known/sagax/environment": 200 }))).status).toBe(200);
    expect(asked).toEqual(["/.well-known/sagax/environment"]);
    asked.length = 0;
    expect((await fetchEnvironmentDescriptor(undefined, server({ "/.well-known/openmausbot/environment": 200 }))).status).toBe(200);
    expect(asked).toEqual(["/.well-known/sagax/environment", "/.well-known/openmausbot/environment"]);
    asked.length = 0;
    expect((await fetchEnvironmentDescriptor(undefined, server({ "/.well-known/sagax/environment": 503 }))).status).toBe(503);
    expect(asked).toHaveLength(1);
  });
});
