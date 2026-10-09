import { describe, expect, it, vi } from "vitest";

// After a sign-in the picker reloads the person's engines, while a reload
// started earlier (opening the picker) may still be on the wire. Only the
// newest answer may reach the page; an older one landing last used to show
// the engine as not connected again.
const fixture = vi.hoisted(() => ({
  shown: undefined as unknown,
  answers: [] as Array<(value: unknown) => void>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, (next: unknown) => { fixture.shown = next; }],
  useEffect: (effect: () => void) => { effect(); },
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: vi.fn((path: string) => path === "/api/org"
    ? Promise.resolve({ org: { name: "GOX", identity: { kind: "perspicax", issuer: "https://px.example.test" } } })
    : new Promise((resolve) => { fixture.answers.push(resolve); })),
}));

const { reloadMyEngines, useMyEngines } = await import("./perspicax-org");
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const engine = (signedIn: boolean) => ({ instanceId: "claude", subscription: { supported: true, signedIn } });

describe("reloading the person's engines", () => {
  it("shows the newest answer even when an older one arrives last", async () => {
    useMyEngines();
    await flush();
    fixture.answers.shift()!({ engines: [engine(false)] });
    await flush();
    expect(fixture.shown).toEqual([engine(false)]);

    const opening = reloadMyEngines();
    await flush();
    const afterSignIn = reloadMyEngines();
    await flush();
    const [older, newer] = fixture.answers.splice(0);
    newer!({ engines: [engine(true)] });
    await afterSignIn;
    await flush();
    expect(fixture.shown).toEqual([engine(true)]);
    older!({ engines: [engine(false)] });
    await opening;
    await flush();
    expect(fixture.shown).toEqual([engine(true)]);
  });
});
