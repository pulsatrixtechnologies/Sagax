// @vitest-environment happy-dom
// `#approvals` and `#code` open their screen at load and when the hash changes
// in an open tab; any other hash is left alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { followViewHash, watchViewHash } from "./view-hash";

function setHash(hash: string) {
  history.replaceState(null, "", `/${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

describe("view hash", () => {
  afterEach(() => { history.replaceState(null, "", "/"); });

  it("opens Approvals and keeps its filters in the address", () => {
    const dispatch = vi.fn();
    const loc = { hash: "#approvals?tab=history", pathname: "/", search: "" };
    const historyApi = { state: null, replaceState: vi.fn() };
    expect(followViewHash(dispatch, loc, historyApi)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "showApprovals" });
    expect(historyApi.replaceState).not.toHaveBeenCalled();
  });

  it("opens a Code run and clears the hash", () => {
    const dispatch = vi.fn();
    const historyApi = { state: { k: 1 }, replaceState: vi.fn() };
    followViewHash(dispatch, { hash: "#code/run_1", pathname: "/app", search: "?x=1" }, historyApi);
    expect(dispatch).toHaveBeenCalledWith({ type: "showCode", runId: "run_1" });
    expect(historyApi.replaceState).toHaveBeenCalledWith({ k: 1 }, "", "/app?x=1");
  });

  it("leaves other hashes alone", () => {
    for (const hash of ["#inbox", "#code=abc", "#thread=t&bot=b", ""]) {
      const dispatch = vi.fn();
      const historyApi = { state: null, replaceState: vi.fn() };
      expect(followViewHash(dispatch, { hash, pathname: "/pair", search: "" }, historyApi)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
      expect(historyApi.replaceState).not.toHaveBeenCalled();
    }
  });

  it("follows hash changes after mount and stops on cleanup", () => {
    const dispatch = vi.fn();
    const stop = watchViewHash(dispatch);
    expect(dispatch).not.toHaveBeenCalled();

    setHash("#approvals");
    expect(dispatch).toHaveBeenLastCalledWith({ type: "showApprovals" });

    setHash("#code/run_2");
    expect(dispatch).toHaveBeenLastCalledWith({ type: "showCode", runId: "run_2" });
    expect(location.hash).toBe("");

    setHash("#inbox");
    expect(dispatch).toHaveBeenCalledTimes(2);

    stop();
    setHash("#approvals");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
