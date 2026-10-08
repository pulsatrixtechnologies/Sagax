import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/SettingsPrimitives";
import { PILL_INFO, SWITCH_OFF, SWITCH_ON } from "@/lib/status-tones";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("semantic tones", () => {
  it("paints the on switch in the accent, never in the success green", () => {
    const on = renderToStaticMarkup(createElement(Switch, { checked: true }));
    expect(SWITCH_ON).toContain("bg-accent");
    expect(on).toContain("bg-accent ring-1 ring-inset ring-accent-border");
    expect(on).toContain("bg-[var(--color-accent-ink)]");
    expect(on).not.toMatch(/success|green/);
    const off = renderToStaticMarkup(createElement(Switch, { checked: false }));
    expect(off).toContain(SWITCH_OFF);
    expect(off).not.toContain("bg-accent");
  });

  it("reads on, paused and waiting states in the accent tint", () => {
    expect(PILL_INFO).toBe("bg-accent/15 text-accent-text");
    const routines = read("src/components/routines/RoutineList.tsx");
    expect(routines).toContain("${PILL_INFO}");
    expect(routines).not.toMatch(/data-routine-suspended[^\n]*(warning|amber)/);
    expect(read("src/components/TeamMapPage.tsx")).not.toMatch(/queued"\s*\?\s*"[^"]*warning/);
    expect(read("src/components/WebhooksPanel.tsx")).toContain('{ label: "Active", tone: "text-accent-text", dot: "bg-accent" }');
  });

  it("keeps the verdict tones for work that earns them", () => {
    expect(read("src/components/RoutineRunCard.tsx")).toContain("bg-warning/15 text-warning");
    expect(read("src/components/bot-settings/ActivitySteps.tsx")).toContain('"bg-success" : "bg-danger"');
    expect(read("src/components/SecretRequestCard.tsx")).toMatch(/bg-success\/15[^"]*text-success/);
  });
});
