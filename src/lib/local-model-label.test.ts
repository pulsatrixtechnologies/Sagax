import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { localModelSubtext } from "./local-model-label";

afterEach(() => setLocale("en"));

describe("local model second line", () => {
  it("has none when the computer is the person's own and the name is unique", () => {
    expect(localModelSubtext({})).toBeUndefined();
  });

  it("says who shares a model from another person's computer, in English and French, whole", () => {
    expect(localModelSubtext({ sharedBy: "Camille Tremblay-Lachance" })).toBe("Shared by Camille Tremblay-Lachance");
    setLocale("fr");
    expect(localModelSubtext({ sharedBy: "Camille Tremblay-Lachance" })).toBe("Partagé par Camille Tremblay-Lachance");
  });

  it("adds the server beside it when a name is duplicated", () => {
    expect(localModelSubtext({ server: "oMLX" })).toBe("oMLX");
    expect(localModelSubtext({ sharedBy: "Camille Tremblay", server: ":8002" })).toBe("Shared by Camille Tremblay · :8002");
  });
});
