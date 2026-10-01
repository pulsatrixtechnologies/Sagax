// Where the camera stands so the 3D owl lands exactly where the flat owl
// would (its box inside the stage, fit.ts) and no pose leaves the canvas:
// the stage is sized for the widest pose, the camera sees the whole stage.
import { PIVOT } from "../fit";

/** The top of the art's 256-unit box in model units (its feet line is 0), as baked by scripts/gen-owl-3d.ts. */
export const OWL_MODEL_HEIGHT = 2.506;

export interface OwlCameraFit {
  /** Distance from the owl's plane (z = 0). */
  distance: number;
  /** The point the camera looks at, in model units. */
  target: { x: number; y: number };
  /** Model units per stage px. */
  unitsPerPx: number;
}

/**
 * The stage (px) and the owl's box in it; the model's 256-unit art box
 * (2.56 model units) maps onto the owl box, so the flat and 3D owls overlay.
 */
export function fitOwlCamera(stage: { width: number; height: number; left: number; top: number }, owlSize: number, fovDeg: number): OwlCameraFit {
  const unitsPerPx = 2.56 / owlSize;
  const visibleHeight = stage.height * unitsPerPx;
  const distance = visibleHeight / 2 / Math.tan((fovDeg * Math.PI) / 360);
  // the art box's top-left corner (viewBox 0, 0) is model (-1.28, OWL_MODEL_HEIGHT)
  const boxLeft = -1.28;
  const boxTop = OWL_MODEL_HEIGHT;
  const centerX = stage.width / 2;
  const centerY = stage.height / 2;
  return {
    distance,
    target: {
      x: boxLeft + (centerX - stage.left) * unitsPerPx,
      y: boxTop - (centerY - stage.top) * unitsPerPx,
    },
    unitsPerPx,
  };
}

/** Whether a sphere around the owl's pivot (model units) stays inside the camera's view. */
export function sphereInView(fit: OwlCameraFit, stage: { width: number; height: number }, fovDeg: number, center: { x: number; y: number }, radius: number): boolean {
  const halfH = fit.distance * Math.tan((fovDeg * Math.PI) / 360);
  const halfW = halfH * (stage.width / stage.height);
  // a sphere seen in perspective: its silhouette grows a little; allow for it at the near side
  const grow = radius / Math.sqrt(Math.max(1e-6, 1 - (radius / fit.distance) ** 2));
  return (
    center.x - grow >= fit.target.x - halfW &&
    center.x + grow <= fit.target.x + halfW &&
    center.y - grow >= fit.target.y - halfH &&
    center.y + grow <= fit.target.y + halfH
  );
}

export const PIVOT_MODEL = { x: -1.28 + PIVOT.x * 2.56, y: OWL_MODEL_HEIGHT - PIVOT.y * 2.56 };
