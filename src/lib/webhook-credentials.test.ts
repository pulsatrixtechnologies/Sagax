import { describe, expect, it } from "vitest";

import { purgeStoredWebhookCredentials } from "./webhook-credentials.js";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("webhook credential storage", () => {
  it("deletes the private URLs an older build kept in local storage, leaving the rest", () => {
    const store = memoryStore({
      "omb-webhook-credentials": JSON.stringify({ "hook-1": { url: "http://127.0.0.1:8800/hooks/wh_demo/whsec_demo" } }),
      "omb-skin": "daylight",
    });
    purgeStoredWebhookCredentials(store);
    expect(store.getItem("omb-webhook-credentials")).toBeNull();
    expect(store.getItem("omb-skin")).toBe("daylight");
  });

  it("does not throw when storage is missing or blocked", () => {
    expect(() => purgeStoredWebhookCredentials(undefined)).not.toThrow();
    expect(() => purgeStoredWebhookCredentials({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => { throw new Error("blocked"); },
    })).not.toThrow();
  });
});
