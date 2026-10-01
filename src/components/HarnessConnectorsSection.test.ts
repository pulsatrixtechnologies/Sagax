import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { harnessUnavailableKey } from "./HarnessConnectorsSection";

describe("HarnessConnectorsSection copy", () => {
  it("has an English and a French sentence for every reason the server gives", () => {
    for (const reason of ["disabled", "managed_policy", "no_engine", "not_signed_in", "not_operator", "key", "unknown"] as const) {
      const key = harnessUnavailableKey(reason);
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(Object.hasOwn(fr, key), key).toBe(true);
    }
    expect((fr as Record<string, string>)["harnessConnectors.title"]).toBe("Fournis par Claude (votre compte)");
    expect((fr as Record<string, string>)["harnessConnectors.unavailable.notSignedIn"]).toBe("Connectez votre abonnement Claude pour utiliser vos connecteurs.");
  });
  it("falls back to the unknown sentence", () => {
    expect(harnessUnavailableKey(undefined)).toBe("harnessConnectors.unavailable.unknown");
  });
});
