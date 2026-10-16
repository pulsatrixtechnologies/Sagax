import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// There is no DOM here, so a few lines stand in for React: state held by call
// order, layout effects run after each render when their deps change, and a
// state change renders again, the way React settles before it paints.
const react = vi.hoisted(() => {
  const slots: unknown[] = [];
  const effects: Array<{ deps: unknown[]; cleanup: void | (() => void) }> = [];
  let queued: Array<() => void> = [];
  let cursor = 0;
  let effectCursor = 0;
  let changed = false;
  return {
    reset() {
      for (const effect of effects) if (typeof effect.cleanup === "function") effect.cleanup();
      slots.length = 0;
      effects.length = 0;
    },
    render<T>(hook: () => T): T {
      let result: T;
      let passes = 0;
      do {
        if (++passes > 10) throw new Error("hook never settled");
        changed = false;
        cursor = 0;
        effectCursor = 0;
        queued = [];
        result = hook();
        for (const run of queued) run();
      } while (changed);
      return result;
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => {
        const value = typeof next === "function" ? (next as (current: unknown) => unknown)(slots[index]) : next;
        if (Object.is(value, slots[index])) return;
        slots[index] = value;
        changed = true;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) return;
      queued.push(() => {
        if (typeof previous?.cleanup === "function") previous.cleanup();
        effects[index] = { deps, cleanup: effect() };
      });
    },
    get changed() { return changed; },
  };
});
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: react.useState,
  useRef: react.useRef,
  useLayoutEffect: react.useLayoutEffect,
}));

const { MENU_EXIT_MS, REVEAL_EXIT_MS, useHeldMenuMotion, useMenuMotion, useReveal } = await import("./MenuMotion");

let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal("window", {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    matchMedia: () => ({ matches: reduced }),
  });
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
});
afterEach(() => {
  react.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("menu motion", () => {
  it("shows a menu on the render it opens and pops it in", () => {
    expect(react.render(() => useMenuMotion(false))).toMatchObject({ shown: false, closing: false });
    const open = react.render(() => useMenuMotion(true));
    expect(open).toMatchObject({ shown: true, closing: false, className: "animate-pop-in", exitProps: {} });
  });

  it("keeps a closing menu on screen for the pop, but out of reach and out of the accessibility tree", () => {
    react.render(() => useMenuMotion(true));
    const closing = react.render(() => useMenuMotion(false));
    expect(closing.shown).toBe(true);
    expect(closing.closing).toBe(true);
    expect(closing.className).toBe("animate-pop-out pointer-events-none");
    expect(closing.exitProps).toEqual({ inert: true, "aria-hidden": true });
    vi.advanceTimersByTime(MENU_EXIT_MS - 1);
    expect(react.render(() => useMenuMotion(false)).shown).toBe(true);
    vi.advanceTimersByTime(1);
    expect(react.changed).toBe(true);
    expect(react.render(() => useMenuMotion(false))).toMatchObject({ shown: false, closing: false, exitProps: {} });
  });

  it("closes at once under reduced motion", () => {
    reduced = true;
    react.render(() => useMenuMotion(true));
    expect(react.render(() => useMenuMotion(false))).toMatchObject({ shown: false, closing: false, exitProps: {} });
  });

  it("reopens a menu that is still closing as a live menu", () => {
    react.render(() => useMenuMotion(true));
    react.render(() => useMenuMotion(false));
    const reopened = react.render(() => useMenuMotion(true));
    expect(reopened).toMatchObject({ shown: true, closing: false, className: "animate-pop-in", exitProps: {} });
    vi.advanceTimersByTime(MENU_EXIT_MS * 2);
    expect(react.render(() => useMenuMotion(true)).shown).toBe(true);
  });

  it("holds the last payload while a positioned menu closes", () => {
    const anchor = { x: 10, y: 20 };
    react.render(() => useHeldMenuMotion(anchor));
    const closing = react.render(() => useHeldMenuMotion<typeof anchor>(null));
    expect(closing).toMatchObject({ shown: true, closing: true, value: anchor });
    expect(closing.exitProps).toEqual({ inert: true, "aria-hidden": true });
  });
});

describe("menu timing", () => {
  it("pops in over 100ms and out quicker, opacity and a tiny scale only", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toContain("--animate-pop-in: pop-in var(--transition-duration-fast) var(--ease-out-quint);");
    expect(css).toContain(`--animate-pop-out: pop-out ${MENU_EXIT_MS}ms var(--ease-exit) forwards;`);
    expect(MENU_EXIT_MS).toBeLessThan(100);
    const frames = css.match(/@keyframes pop-in \{[^@]*?\n\}/)?.[0] ?? "";
    expect(frames).toContain("scale(0.98)");
    expect(frames).not.toMatch(/height|width|translate/);
  });
});

describe("a revealed panel", () => {
  it("animates no height from script: the shell is a grid row the browser interpolates", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./MenuMotion.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(source).not.toMatch(/style\.height|offsetHeight|getBoundingClientRect|transition-\[height/);
    const shell = css.match(/\.reveal-shell \{[^}]*\}/)?.[0] ?? "";
    expect(shell).toContain("grid-template-rows: 1fr;");
    expect(shell).toContain("grid-template-rows var(--transition-duration-moderate) var(--ease-out-quint)");
    expect(shell).not.toMatch(/transition:[^;]*\bheight\b/);
    expect(css).toMatch(/@starting-style \{\s*\.reveal-shell \{\s*grid-template-rows: 0fr;\s*opacity: 0;/);
    expect(css).toMatch(/\.reveal-shell\[data-reveal="closing"\] \{\s*grid-template-rows: 0fr;\s*opacity: 0;\s*transition-duration: var\(--transition-duration-base\);/);
    expect(css).toContain(':root[data-reduced-motion="true"] .reveal-shell { transition: none; }');
  });

  it("readies the content before it shows: on open and when another panel takes its place", () => {
    const ready = vi.fn();
    react.render(() => useReveal(false, null, ready));
    expect(ready).not.toHaveBeenCalled();
    expect(react.render(() => useReveal(true, "transcript", ready))).toMatchObject({ shown: true, closing: false, shellProps: { "data-reveal": "open" } });
    expect(ready).toHaveBeenCalledTimes(1);
    react.render(() => useReveal(true, "transcript", ready));
    expect(ready).toHaveBeenCalledTimes(1);
    react.render(() => useReveal(true, "settings", ready));
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it("folds away over its exit time, out of reach, then unmounts", () => {
    react.render(() => useReveal(true, "settings"));
    const closing = react.render(() => useReveal(false, null));
    expect(closing).toMatchObject({ shown: true, closing: true, shellProps: { "data-reveal": "closing" } });
    expect(closing.exitProps).toEqual({ inert: true, "aria-hidden": true });
    vi.advanceTimersByTime(REVEAL_EXIT_MS);
    expect(react.render(() => useReveal(false, null)).shown).toBe(false);
  });

  it("under reduced motion the panel simply appears and goes", () => {
    reduced = true;
    react.render(() => useReveal(true, "transcript"));
    expect(react.render(() => useReveal(false, null)).shown).toBe(false);
  });
});
