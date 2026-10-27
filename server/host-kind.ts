// Whether this server is a shared host (#1098, 2026-10-27): an organization
// server (SAGAX_IDENTITY=perspicax) runs every member's work on one machine,
// so its ceilings (parallel tasks, attachment sizes) protect the others. A
// solo server is the person's own machine: those ceilings are lifted there.
// server/index.ts sets it once at startup; until then (tests, tools) it
// reads as shared, the stricter answer.
let shared = true;

export function setSharedHost(value: boolean): void {
  shared = value;
}

export function isSharedHost(): boolean {
  return shared;
}
