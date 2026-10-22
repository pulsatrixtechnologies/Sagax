// @vitest-environment happy-dom
// Dismissing a question, its optional countdown, and the error shown when an
// answer does not reach the bot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { QUESTION_SKIP_MESSAGE, type AskQuestion } from "../../shared/ask-question";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: AskQuestion = { question: "Which plan should the workspace use?", options: [{ label: "Free" }, { label: "Pro" }] };
const name: AskQuestion = { question: "What should the repository be called?", options: [] };

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();

function mount(questions: AskQuestion[], extra: Record<string, unknown> = {}) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "q", subtitle: questions[0]!.question, options: [], requestId: "req-1", questionRequest: { version: 1, questions, ...extra } },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Dev" }, message }) })));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  dispatch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const dismissButton = () => host.querySelector<HTMLButtonElement>("[data-question-dismiss]");

describe("QuestionCard dismiss", () => {
  it("has an Ignore button that closes the question without answering it", () => {
    mount([plan]);
    expect(dismissButton()?.getAttribute("aria-label")).toBe("Ignore");
    act(() => dismissButton()!.click());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "decideRequest", threadId: "t1", requestId: "req-1", behavior: "answer", message: QUESTION_SKIP_MESSAGE });
    expect(host.querySelector('[data-ask-card="settled"]')?.textContent).toContain("Closed without an answer");
    expect(host.textContent).not.toContain("skipped this question");
  });

  it("counts down to closing by itself when the question has a deadline", () => {
    mount([plan], { autoDismissAt: 1_000_000 + 30_000 });
    expect(dismissButton()?.getAttribute("aria-label")).toBe("Ignore, closes automatically in 30 s");
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(dismissButton()?.getAttribute("aria-label")).toBe("Ignore, closes automatically in 20 s");
    expect(dispatch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].message).toBe(QUESTION_SKIP_MESSAGE);
  });

  it("does not close under a half typed answer", () => {
    mount([name], { autoDismissAt: 1_000_000 + 5_000 });
    const field = host.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setter.call(field, "my-repo"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("has no countdown, and nothing closes by itself, without a deadline", () => {
    mount([plan]);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("QuestionCard answer error", () => {
  it("says the answer did not go through, and brings the choices back", () => {
    mount([plan]);
    const pro = Array.from(host.querySelectorAll<HTMLElement>("[data-ask-choice]")).find((el) => el.textContent?.includes("Pro"))!;
    act(() => pro.click());
    const { onError } = dispatch.mock.calls[0]![0] as { onError: () => void };
    expect(host.querySelector('[role="alert"]')).toBeNull();
    act(() => onError());
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Your answer didn't go through. Check your connection and try again.");
    expect(host.querySelector('[data-ask-card="pending"]')).not.toBeNull();
    // choosing again clears it
    const again = Array.from(host.querySelectorAll<HTMLElement>("[data-ask-choice]")).find((el) => el.textContent?.includes("Free"))!;
    act(() => again.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
