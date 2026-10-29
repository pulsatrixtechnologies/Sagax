import { afterEach, describe, expect, it } from "vitest";
import { workingStepFor } from "../../shared/working-step";
import { setLocale } from "./i18n";
import { liveActivityLabel, liveActivityPhrases } from "./live-activity";
import { quietAgeLabel, workingStepLabel } from "./working-step";
import type { Message } from "@/state/store";

afterEach(() => setLocale("en"));

const running = (tool: NonNullable<Message["tool"]>, at = 5_000): Message => ({ id: "a", at, role: "bot", kind: "activity", tool });

describe("workingStepLabel", () => {
  it("reads the same words for a call made by any engine", () => {
    setLocale("fr");
    const claude = workingStepFor({ name: "Bash", summary: "python3 scrape.py" })!;
    const codex = workingStepFor({ name: "python3 scrape.py", summary: "python3 scrape.py" })!;
    expect(workingStepLabel(claude)).toBe("Roule scrape.py");
    expect(workingStepLabel(codex)).toBe("Roule scrape.py");
    expect(workingStepLabel({ key: "readMail" })).toBe("Lit tes courriels");
    expect(workingStepLabel({ key: "openApp", detail: "Chrome" })).toBe("Ouvre Chrome");
    expect(workingStepLabel({ key: "searchWeb" })).toBe("Cherche sur le web");
    expect(workingStepLabel({ key: "writeFile" })).toBe("Écrit un fichier");
    // a detail on a key that reads without one is left out
    expect(workingStepLabel({ key: "readMail", detail: "x" })).toBe("Lit tes courriels");
  });

  it("is translated in English too", () => {
    expect(workingStepLabel({ key: "run", detail: "scrape.py" })).toBe("Running scrape.py");
    expect(workingStepLabel({ key: "calendar" })).toBe("Checking your calendar");
  });
});

describe("the working line", () => {
  it("names the running call's step, adds to it the quiet time, and drops it once the call ends", () => {
    setLocale("fr");
    const live = liveActivityPhrases(running({ name: "Bash", spoken: "running a command", step: { key: "run", detail: "scrape.py" } }));
    expect(live.phrases).toEqual(["Roule scrape.py"]);
    expect(live.stepSince).toBe(5_000);
    expect(quietAgeLabel(live.stepSince, 5_000 + 125_000)).toBe("dernière sortie il y a 2 min");
    expect(quietAgeLabel(live.stepSince, 5_000 + 30_000)).toBeNull();
    const done = liveActivityPhrases(running({ name: "Bash", ok: true, step: { key: "run", detail: "scrape.py" } }));
    expect(done.phrases[0]).toBe("Réflexion");
    expect(done.stepSince).toBeUndefined();
  });

  it("keeps the old line for a server that sends no step", () => {
    expect(liveActivityLabel(running({ name: "Read" }))).toBe("Reading a file");
  });
});
