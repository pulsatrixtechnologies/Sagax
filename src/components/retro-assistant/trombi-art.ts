// Generated from the final Trombi art (scratch build.py): geometry only.
// viewBox -50 0 310 380. Original artwork: a gem clip on a legal pad.

export const WIRE = "M 48 164 L 48 266 A 46 46 0 0 0 140 266 L 140 94 A 38 38 0 0 0 64 94 L 64 236 A 30 30 0 0 0 124 236 L 124 156";
export const SHEET = "M-40 338 L115 365 C165 318 222 222 248 156 C204 128 150 162 104 129 C78 180 -2 280 -40 338 Z";
export const RULED = [
  "M-30.8 324.4 L126.3 353.7",
  "M-20.7 309.8 L137.5 341.2",
  "M-9.8 294.5 L148.7 327.6",
  "M1.6 278.7 L159.6 313.3",
  "M13.2 262.8 L170.3 298.4",
  "M24.9 246.9 L180.5 283.2",
  "M36.3 231.2 L190.3 267.9",
  "M47.3 215.9 L199.6 252.7",
  "M57.7 201.3 L208.2 237.8",
  "M67.4 187.5 L216.2 223.3",
  "M76.2 174.5 L223.6 209.4",
  "M84.1 162.6 L230.1 196.2",
  "M90.9 152.0 L236.0 184.0",
  "M96.5 142.6 L241.0 172.9",
  "M101.0 134.7 L245.1 163.2"
] as const;
export const MARGIN = "M-21.4 341.2 L-13.6 330.1 L-5.0 318.2 L4.2 305.4 L13.9 292.1 L23.9 278.3 L34.2 264.1 L44.6 249.7 L55.0 235.3 L65.2 220.9 L75.1 206.6 L84.6 192.7 L93.6 179.2 L101.8 166.3 L109.3 154.1 L115.8 142.7 L121.3 132.2 M-17.5 341.9 L-9.7 330.9 L-1.1 318.9 L8.1 306.2 L17.8 292.9 L27.9 279.2 L38.1 265.0 L48.5 250.7 L58.8 236.2 L69.0 221.8 L78.9 207.5 L88.3 193.6 L97.2 180.1 L105.5 167.1 L112.9 154.8 L119.4 143.4 L124.9 132.9";
export const EYE_L = [58, 118] as const;
export const EYE_R = [140, 118] as const;
export const EYE_RADIUS = 28;

export type TrombiPose = "idle" | "speak" | "think" | "bored" | "sleep" | "celebrate" | "send";
export const TROMBI_POSES = ["idle", "speak", "think", "bored", "sleep", "celebrate", "send"] as const;

export interface PoseShape { tilt: number; pupil: readonly [number, number]; browL: string; browR: string }
export const POSE_SHAPES: Record<TrombiPose, PoseShape> = {
  idle: { tilt: -2, pupil: [1.7, 2.3], browL: "M34 83 Q58 62 80 81 Q58 75.5 34 83 Z", browR: "M118 81 Q140 62 164 83 Q140 75.5 118 81 Z" },
  speak: { tilt: -3, pupil: [-5.7, -1.1], browL: "M34 79 Q58 56 80 77 Q58 69.5 34 79 Z", browR: "M118 77 Q140 56 164 79 Q140 69.5 118 77 Z" },
  think: { tilt: 2, pupil: [5.7, -9.2], browL: "M34 76 Q58 51 80 74 Q58 64.5 34 76 Z", browR: "M118 85 Q140 69 164 85 Q140 82.5 118 85 Z" },
  bored: { tilt: -2, pupil: [-8, 5.7], browL: "M34 85 Q58 69 80 84 Q58 82.5 34 85 Z", browR: "M118 84 Q140 69 164 85 Q140 82.5 118 84 Z" },
  sleep: { tilt: 3, pupil: [0, 10.3], browL: "M34 86 Q58 70 80 85 Q58 83.5 34 86 Z", browR: "M118 85 Q140 70 164 86 Q140 83.5 118 85 Z" },
  celebrate: { tilt: 0, pupil: [0, -3.4], browL: "M34 75 Q58 49 80 72 Q58 62.5 34 75 Z", browR: "M118 72 Q140 49 164 75 Q140 62.5 118 72 Z" },
  send: { tilt: 2, pupil: [8, -5.7], browL: "M34 81 Q58 60 80 79 Q58 73.5 34 81 Z", browR: "M118 76 Q140 55 164 78 Q140 68.5 118 76 Z" },
};
