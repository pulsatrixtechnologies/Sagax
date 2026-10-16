// @vitest-environment happy-dom
// The goal card's "…" menu (JC, 2026-10-16): Show details and Copy goal
// first, Stop last, in red, under a separator; the menu closes on choice.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { GroupGoalRunCardData } from "../../shared/group-goal-run";
import { GoalRunCard } from "./GoalRunCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(status: GroupGoalRunCardData["status"]): Message {
  return {
    id: "goal-run-card",
    role: "bot",
    kind: "goal.run",
    at: 1,
    goalRun: {
      runId: "run-1",
      goal: "Rédiger et peaufiner l'annonce du lancement",
      status,
      coordinatorBotId: "bot-1",
      coordinatorName: "Sprout",
      turnCount: 2,
      maxTurns: 12,
      detail: "Luna relit la deuxième version.",
      startedAt: Date.UTC(2026, 9, 16, 14, 0),
      finishedAt: status === "working" ? undefined : Date.UTC(2026, 9, 16, 15, 0),
    },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("fr");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

function mount(status: GroupGoalRunCardData["status"], props: { onStop?: () => void; onRunAgain?: () => void } = {}) {
  act(() => root.render(createElement(GoalRunCard, { message: message(status), ...props })));
}

function openMenu() {
  act(() => host.querySelector<HTMLButtonElement>("[data-goal-run-more]")!.click());
  return [...host.querySelectorAll<HTMLButtonElement>('[data-goal-run-menu] [role="menuitem"]')];
}

describe("goal card menu", () => {
  it("groups the secondary actions and puts Stop last, in red", () => {
    const onStop = vi.fn();
    mount("working", { onStop });
    expect(host.textContent).toContain("En cours");
    expect(host.textContent).toContain("Tour 3 sur 12");
    expect(host.textContent).toContain("Dernière étape :");
    const items = openMenu();
    expect(items.map((item) => item.textContent)).toEqual(["Voir le détail", "Copier l'objectif", "Arrêter l'objectif"]);
    const stop = items.at(-1)!;
    expect(stop.className).toContain("text-danger");
    expect(host.querySelector('[data-goal-run-menu] [role="separator"]')).not.toBeNull();
    act(() => stop.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("offers no Stop once the goal is over, and Resume in view when paused", () => {
    const onRunAgain = vi.fn();
    mount("paused", { onStop: vi.fn(), onRunAgain });
    const resume = host.querySelector<HTMLButtonElement>('[data-goal-run-action="resume"]')!;
    expect(resume.textContent).toBe("Reprendre");
    act(() => resume.click());
    expect(onRunAgain).toHaveBeenCalledTimes(1);
    expect(openMenu().map((item) => item.textContent)).toEqual(["Voir le détail", "Copier l'objectif"]);
  });

  it("opens the full goal and its times from Voir le détail", () => {
    mount("completed");
    expect(host.querySelector("[data-goal-run-details]")).toBeNull();
    const [details] = openMenu();
    act(() => details!.click());
    expect(host.querySelector("[data-goal-run-details]")?.textContent).toContain("Début");
    expect(host.querySelector("[data-goal-run-details]")?.textContent).toContain("Fin");
    expect(openMenu()[0]!.textContent).toBe("Masquer le détail");
  });
});
