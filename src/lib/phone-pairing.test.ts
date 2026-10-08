import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { SessionState } from "./session";
import {
  connectPhoneEntry,
  currentPhonePairingTarget,
  loadPhonePairingAccess,
  pairedDestination,
  phonePairingSettingsAction,
  phonePairingTarget,
  resetPhonePairingAccess,
  revealPhonePairing,
  takePhonePairingRequest,
  type PhonePairingAccess,
} from "./phone-pairing";

const owner: SessionState = { kind: "loopback" };
const admin: SessionState = { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 };
const chatOnly: SessionState = { kind: "session", id: "s", label: "Staff phone", scopes: ["client"], expiresAt: 1 };
const access = (session: SessionState | null, pairingCodes = true): PhonePairingAccess => ({ session, pairingCodes });
const subtitle = (entry: ReturnType<typeof connectPhoneEntry>) => (entry ? t(entry.subtitleKey) : null);

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.unstubAllGlobals();
  resetPhonePairingAccess();
});

describe("where Connect your phone pairs", () => {
  it("pairs with this computer only in the desktop app's own window", () => {
    expect(phonePairingTarget({ companion: true, remoteClient: false, cloudHome: false })).toBe("computer");
    // a remote server's page never gets the phone bridge; a browser has none
    expect(phonePairingTarget({ companion: false, remoteClient: false, cloudHome: false })).toBe("server");
    // a desktop that is a client of another server pairs phones there
    expect(phonePairingTarget({ companion: true, remoteClient: true, cloudHome: false })).toBe("server");
  });

  it("ignores a Cloud home flag and pairs with this window", () => {
    expect(phonePairingTarget({ companion: false, remoteClient: false, cloudHome: true })).toBe("server");
    expect(phonePairingTarget({ companion: true, remoteClient: true, cloudHome: true })).toBe("server");
    expect(phonePairingTarget({ companion: true, remoteClient: false, cloudHome: true })).toBe("computer");
  });

  it("reads the window's bridges", () => {
    vi.stubGlobal("window", { ogb: { companion: {} } });
    expect(currentPhonePairingTarget(false)).toBe("computer");
    vi.stubGlobal("window", { ogb: { companion: {}, remoteClient: { active: true } } });
    expect(currentPhonePairingTarget(false)).toBe("server");
    // no phone bridge: the server's pairing code, even if a Cloud plan object is present
    vi.stubGlobal("window", { ogb: { cloudPlan: {} } });
    expect(currentPhonePairingTarget(true)).toBe("server");
    // a browser
    vi.stubGlobal("window", {});
    expect(currentPhonePairingTarget(false)).toBe("server");
  });
});

describe("Connect your phone in the account menu", () => {
  it("on this computer: always there, to this computer, without asking the server", () => {
    expect(subtitle(connectPhoneEntry("computer", null))).toBe("to this computer");
    expect(connectPhoneEntry("computer", access(chatOnly, false))?.target).toBe("computer");
  });

  it("on the person's own Cloud: to My Cloud, for the owner's session", () => {
    expect(subtitle(connectPhoneEntry("cloud", access(admin)))).toBe("to My Cloud");
    expect(connectPhoneEntry("cloud", access(chatOnly))).toBeNull();
  });

  it("on another server: to this server, only for a session that may make a pairing code", () => {
    expect(subtitle(connectPhoneEntry("server", access(admin)))).toBe("to this server");
    expect(subtitle(connectPhoneEntry("server", access(owner)))).toBe("to this server");
    // chat and approvals only: the server refuses it a code
    expect(connectPhoneEntry("server", access(chatOnly))).toBeNull();
    // a shared server that does not treat this machine as its owner
    expect(connectPhoneEntry("server", access({ kind: "loopback", trust: "service" }))).toBeNull();
    expect(connectPhoneEntry("server", access({ kind: "unauthenticated", error: "pair" }))).toBeNull();
    // people sign in through the organization's Admin there: codes are off
    expect(connectPhoneEntry("server", access(admin, false))).toBeNull();
  });

  it("offers nothing while it does not know yet", () => {
    expect(connectPhoneEntry("server", null)).toBeNull();
    expect(connectPhoneEntry("cloud", null)).toBeNull();
    expect(connectPhoneEntry("cloud", access(null))).toBeNull();
  });
});

describe("asking the server", () => {
  const respond = (routes: Record<string, unknown>) =>
    vi.fn(async (path: string) => {
      const body = routes[path];
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200 });
    }) as unknown as typeof fetch;

  it("reads the session, then whether pairing codes are on", async () => {
    const fetchImpl = respond({ "/api/auth/session": { kind: "session", id: "s", label: "Mac", scopes: ["admin"], expiresAt: 1 }, "/api/config": { membership: { authority: "portal", pairingCodes: false } } });
    expect(await loadPhonePairingAccess(fetchImpl)).toMatchObject({ session: { kind: "session" }, pairingCodes: false });
  });

  it("does not ask for the config of a session that cannot pair anyway", async () => {
    const fetchImpl = respond({ "/api/auth/session": { kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 } });
    expect(await loadPhonePairingAccess(fetchImpl)).toMatchObject({ pairingCodes: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a config it cannot read means codes on, as an older server's does; asked once per page", async () => {
    const fetchImpl = respond({ "/api/auth/session": {}, "/api/config": new Error("offline") });
    expect(await loadPhonePairingAccess(fetchImpl)).toEqual({ session: { kind: "loopback" }, pairingCodes: true });
    await loadPhonePairingAccess(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("opening Settings on the phone pairing", () => {
  it("is Remote access, asking for the pairing to be revealed", () => {
    expect(phonePairingSettingsAction()).toEqual({ type: "toggleAppSettings", open: true, section: "companion", phonePairing: true });
  });

  type Focusable = { focus: (options?: FocusOptions) => void };
  const focusable = () => ({ focus: vi.fn<(options?: FocusOptions) => void>() });
  const element = (action: Focusable | null) => ({
    scrollIntoView: vi.fn<(options: ScrollIntoViewOptions) => void>(),
    focus: vi.fn<(options?: FocusOptions) => void>(),
    querySelector: vi.fn((_selector: string) => action),
  });
  const now = (callback: () => void) => callback();

  it("scrolls the card into view and focuses the button that shows the code", () => {
    const action = focusable();
    const root = element(action);
    expect(revealPhonePairing(root, now)).toBe(true);
    expect(root.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(root.querySelector).toHaveBeenCalledWith("[data-phone-pairing-action]:not([disabled])");
    expect(action.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(root.focus).not.toHaveBeenCalled();
  });

  it("focuses the card itself when there is no button to press yet", () => {
    const root = element(null);
    revealPhonePairing(root, now);
    expect(root.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("waits a frame, and reports a card that is not drawn yet", () => {
    const root = element(focusable());
    const frames: Array<() => void> = [];
    revealPhonePairing(root, (callback) => frames.push(callback));
    expect(root.scrollIntoView).not.toHaveBeenCalled();
    frames[0]!();
    expect(root.scrollIntoView).toHaveBeenCalled();
    expect(revealPhonePairing(null, now)).toBe(false);
  });
});

describe("the ?desktop-settings=phone request", () => {
  it("is taken off the address, keeping everything else", () => {
    expect(takePhonePairingRequest("https://home.fly.dev/?desktop-settings=phone")).toBe("/");
    expect(takePhonePairingRequest("https://home.fly.dev/?a=1&desktop-settings=phone#x")).toBe("/?a=1#x");
    expect(takePhonePairingRequest("https://home.fly.dev/?desktop-settings=workspaces")).toBeNull();
    expect(takePhonePairingRequest("https://home.fly.dev/")).toBeNull();
  });

  it("survives pairing, and nothing else does", () => {
    expect(pairedDestination("?desktop-settings=phone")).toBe("/?desktop-settings=phone");
    expect(pairedDestination("?desktop-settings=phone&next=https://evil.example")).toBe("/?desktop-settings=phone");
    expect(pairedDestination("?desktop-settings=workspaces")).toBe("/");
    expect(pairedDestination("?next=//evil.example")).toBe("/");
    expect(pairedDestination("")).toBe("/");
  });
});

