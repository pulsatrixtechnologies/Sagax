// The /pair page's hash: a typed pairing code, and the credential the
// desktop app hands back from "Sign in with Pulsatrix" (#code=<c>&auto=1).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { parsePairingHash, takePairingFromLocation } from "@/lib/session";
import { PairPage, finishReturnedSignIn } from "./PairPage";

const CREDENTIAL = `omb_pair_${"A1b2_C3d4-".repeat(4)}xyz`;

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("the pairing hash", () => {
  it("reads a typed code, and never auto-submits it", () => {
    expect(parsePairingHash("#code=ABCD-EFGH-JKLM")).toEqual({ code: "ABCD-EFGH-JKLM", auto: false });
    expect(parsePairingHash("#code=ABCD-EFGH-JKLM&auto=1")).toEqual({ code: "ABCD-EFGH-JKLM", auto: false });
    expect(parsePairingHash("")).toEqual({ code: null, auto: false });
  });

  it("keeps a sign-in credential verbatim and auto-submits it only with auto=1", () => {
    expect(CREDENTIAL).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    expect(parsePairingHash(`#code=${CREDENTIAL}&auto=1`)).toEqual({ code: CREDENTIAL, auto: true });
    expect(parsePairingHash(`#code=${CREDENTIAL}`)).toEqual({ code: CREDENTIAL, auto: false });
    expect(parsePairingHash(`#code=${CREDENTIAL}&auto=10`)).toEqual({ code: CREDENTIAL, auto: false });
    expect(parsePairingHash(`#code=${CREDENTIAL}x&auto=1`).auto).toBe(false);
    expect(parsePairingHash("#code=%E0%A4%A&auto=1")).toEqual({ code: null, auto: false });
  });

  it("drops the code from the address bar once read", () => {
    const replaceState = vi.fn();
    const got = takePairingFromLocation({ hash: `#code=${CREDENTIAL}&auto=1`, pathname: "/pair", search: "" }, { replaceState });
    expect(got).toEqual({ code: CREDENTIAL, auto: true });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
  });

  it("shows the finishing state while a returned credential is redeemed in the desktop app", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    vi.stubGlobal("window", { ogb: { platform: "darwin", takeSignInReturn: async () => true } });
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(html).toContain("Finishing sign-in...");
    expect(html).not.toContain("pair-code");
    const form = renderToStaticMarkup(createElement(PairPage, { initialCode: "ABCD-EFGH-JKLM" }));
    expect(form).toContain("pair-code");
    expect(form).not.toContain("Finishing sign-in...");
  });

  it("a plain browser opening #code=<credential>&auto=1 shows the form and never redeems it on its own", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(html).not.toContain("Finishing sign-in...");
    expect(html).toContain("pair-code");
    const pair = vi.fn(async () => ({ ok: true as const }));
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: undefined, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
    // a remote page's bridge without the handoff (an older app) asks too
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: {}, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
  });

  it("the desktop app redeems a returned credential only when its main process handed that exact one over", async () => {
    const pair = vi.fn(async () => ({ ok: true as const }));
    const refused = vi.fn(async () => false);
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: refused }, pair })).toBe("ask");
    expect(refused).toHaveBeenCalledWith(CREDENTIAL);
    expect(pair).not.toHaveBeenCalled();
    const broken = vi.fn(async () => { throw new Error("no handler"); });
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: broken }, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
    const handed = vi.fn(async () => true);
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: handed }, pair })).toEqual({ ok: true });
    expect(pair).toHaveBeenCalledTimes(1);
  });
});
