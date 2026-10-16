import { afterEach, describe, expect, it, vi } from "vitest";

const stepUp = vi.fn(async () => "fresh-id");
const recent = new Map<string, string>();
vi.mock("@/lib/step-up-client", () => ({
  stepUp: (...args: unknown[]) => stepUp(...(args as [])),
  recentStepUp: (target: { requestId?: string }) => recent.get(target.requestId ?? ""),
  forgetStepUp: (target: { requestId?: string }) => { recent.delete(target.requestId ?? ""); },
}));

import { api, ApiError } from "./store";

const target = { kind: "approval", threadId: "t1", requestId: "r1", answer: {} };
const refused = (code: string) => new Response(JSON.stringify({ error: "needs key", code, classes: ["destructive"], target }), { status: 403 });
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  stepUp.mockClear();
  recent.clear();
});

describe("api and security key step-ups", () => {
  it("asks the key for the target the server named, then sends the same request with it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refused("step_up_required")).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/threads/t1/respond", { method: "POST", body: JSON.stringify({ requestId: "r1", behavior: "allow" }) })).resolves.toEqual({ ok: true });
    expect(stepUp).toHaveBeenCalledWith(target);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ requestId: "r1", behavior: "allow", stepUp: "fresh-id" });
  });

  it("tries a step-up made a moment ago for the same card first, then a fresh one", async () => {
    recent.set("r1", "recent-id");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refused("step_up_required"))
      .mockResolvedValueOnce(refused("step_up_failed"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/threads/t1/respond", { method: "POST", body: JSON.stringify({ requestId: "r1", behavior: "allow" }) });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).stepUp).toBe("recent-id");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).stepUp).toBe("fresh-id");
    expect(stepUp).toHaveBeenCalledTimes(1);
  });

  it("stops after one fresh step-up the server still refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(refused("step_up_required")).mockResolvedValueOnce(refused("step_up_failed")));
    await expect(api("/api/threads/t1/respond", { method: "POST", body: JSON.stringify({ requestId: "r1", behavior: "allow" }) })).rejects.toBeInstanceOf(ApiError);
    expect(stepUp).toHaveBeenCalledTimes(1);
  });

  it("never sends the request again when the key was not given", async () => {
    stepUp.mockRejectedValueOnce(new Error("cancelled"));
    const fetchMock = vi.fn().mockResolvedValueOnce(refused("step_up_required"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/threads/t1/respond", { method: "POST", body: JSON.stringify({ requestId: "r1", behavior: "allow" }) })).rejects.toThrow("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
