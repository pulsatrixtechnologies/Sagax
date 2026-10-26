import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { localModelLabel, withLocalModelLabels } from "./local-model-label";

afterEach(() => setLocale("en"));

const catalog = (options: Array<{ id: string; label: string; sharedBy?: string; server?: string }>) => [{ instanceId: "claude", models: { default: "x", options } }];

describe("local model label", () => {
  it("keeps the model name alone when the computer is the person's own", () => {
    expect(localModelLabel({ label: "Ornith-1.5-122B-oQ4e-mtp" })).toBe("Ornith-1.5-122B-oQ4e-mtp");
    const [instance] = withLocalModelLabels(catalog([{ id: "desk8000abc::ornith", label: "Ornith-1.5-122B-oQ4e-mtp" }]));
    expect(instance!.models.options[0]!.label).toBe("Ornith-1.5-122B-oQ4e-mtp");
  });

  it("says who shares a model from another person's computer, in English and French", () => {
    expect(localModelLabel({ label: "Ornith-1.5-122B-oQ4e-mtp", sharedBy: "Camille Tremblay" })).toBe("Ornith-1.5-122B-oQ4e-mtp (Shared by Camille Tremblay)");
    setLocale("fr");
    const [instance] = withLocalModelLabels(catalog([{ id: "desk8000abc::ornith", label: "Ornith-1.5-122B-oQ4e-mtp", sharedBy: "Camille Tremblay" }]));
    expect(instance!.models.options[0]!.label).toBe("Ornith-1.5-122B-oQ4e-mtp (Partagé par Camille Tremblay)");
    expect(instance!.models.options[0]!.id).toBe("desk8000abc::ornith");
  });

  it("leaves the server as a separate hint, never in the label", () => {
    const [instance] = withLocalModelLabels(catalog([{ id: "a::m", label: "Model Nine", server: "oMLX" }]));
    expect(instance!.models.options[0]).toMatchObject({ label: "Model Nine", server: "oMLX" });
  });
});
