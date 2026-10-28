// POST /api/internal/openapi on a bot shared with the person speaking
// (2026-10-28): the call uses the speaker's own API document, never the
// owner's, and a speaker without one gets a sentence that says so.
import { describe, expect, it } from "vitest";

import { createOpenApiInternalRoutes } from "./openapi-internal.ts";

function call(record: Parameters<typeof createOpenApiInternalRoutes>[0]["record"], name = "openapi_list_notes") {
  const answers: Array<{ status: number; body: unknown }> = [];
  const handler = createOpenApiInternalRoutes({ organization: () => true, record });
  const json = ((_res: unknown, status: number, body: unknown) => { answers.push({ status, body }); }) as never;
  return handler({
    res: {} as never, path: "/api/internal/openapi", method: "POST", json,
    capability: { botId: "shared-bot", threadId: "t1", generation: "g1" },
    readBody: async () => ({ name, arguments: {} }),
  }).then(() => answers[0]!);
}

describe("openapi on a bot shared with the person speaking", () => {
  it("tells the bot the speaker has no document of their own", async () => {
    const answer = await call(() => null);
    expect(answer.status).toBe(404);
    expect(String((answer.body as { error: string }).error)).toMatch(/person speaking has no API document/);
    expect(String((answer.body as { error: string }).error)).toMatch(/never the bot owner's/);
  });

  it("asks for the record of the turn's capability, never another person's", async () => {
    const seen: string[] = [];
    await call((capability) => { seen.push(`${capability.botId}/${capability.threadId}`); return null; });
    expect(seen).toEqual(["shared-bot/t1"]);
  });
});
