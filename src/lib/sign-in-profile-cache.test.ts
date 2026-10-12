import { afterEach, describe, expect, it } from "vitest";
import {
  SIGN_IN_PROFILE_CACHE_KEY,
  cacheSignInProfileFromSession,
  readSignInProfileCache,
  writeSignInProfileCache,
} from "./sign-in-profile-cache";

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}

const real = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true });
});

describe("sign-in profile cache", () => {
  it("round-trips name and avatar for the connection animation", () => {
    Object.defineProperty(globalThis, "localStorage", { value: memory(), configurable: true });
    writeSignInProfileCache({ name: "Jean Dupont", avatarUrl: "/api/people/p1/avatar?v=2" });
    expect(readSignInProfileCache()).toMatchObject({ name: "Jean Dupont", avatarUrl: "/api/people/p1/avatar?v=2" });
  });

  it("learns from GET /api/auth/session", () => {
    Object.defineProperty(globalThis, "localStorage", { value: memory(), configurable: true });
    cacheSignInProfileFromSession({ kind: "session", name: "Marie Tremblay", avatarUrl: "/api/people/p2/avatar?v=1" });
    expect(localStorage.getItem(SIGN_IN_PROFILE_CACHE_KEY)).toContain("Marie Tremblay");
  });
});
