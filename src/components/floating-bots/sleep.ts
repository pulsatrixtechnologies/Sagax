// When the desktop mascot reads as asleep. Every character shares this look
// on top of its own sleep move: the stage carries `data-asleep`, which dims
// the character a little and floats bold "z Z" glyphs beside its head
// (floating-bots.css). Under reduced motion the glyphs stand still and the
// character keeps its sleeping face (closed eyes), with no bob.
import type { MascotActivity, MascotPose } from "./behavior";

/** Activities that wake it or carry it: never drawn asleep, whatever the brain's pose says. */
const AWAKE: ReadonlySet<MascotActivity> = new Set<MascotActivity>(["drag", "walk", "fly", "flyOut", "return", "wake", "petted"]);

/** Whether the mascot is asleep: its own nap (the idle timer), or the brain's sleep pose while it rests. */
export function mascotAsleep(activity: MascotActivity, pose: MascotPose | string): boolean {
  if (activity === "sleep") return true;
  return pose === "sleep" && !AWAKE.has(activity);
}
