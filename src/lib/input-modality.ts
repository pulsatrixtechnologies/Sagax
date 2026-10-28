// How focus last moved: a pointer (a click, a right click whose menu hands
// focus back) or the keyboard (Tab, an arrow key). Chromium counts a
// programmatic focus() after a click on a menu as :focus-visible, so a
// control focused by script after a click would draw the keyboard ring.
// A control that takes focus that way marks itself `data-pointer-focus`
// (styles.css hides the ring under it) until Tab or an arrow key moves on.
let lastInput: "pointer" | "keyboard" = "keyboard";
let listening = false;

export function trackInputModality(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" || event.key.startsWith("Arrow")) lastInput = "keyboard";
  }, true);
}

/** True when the last input was a pointer press (no keyboard move since). */
export function lastInputWasPointer(): boolean {
  return lastInput === "pointer";
}

/** Test seam: the input the next check reads. */
export function setLastInputForTests(input: "pointer" | "keyboard"): void {
  lastInput = input;
}
