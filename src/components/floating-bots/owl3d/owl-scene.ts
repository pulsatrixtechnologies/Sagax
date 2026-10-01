// Draws the 3D owl into a transparent canvas: a small three.js scene with
// one camera and two lights, a draw loop that runs only as fast as the
// mascot needs (60 fps while it moves, slower at rest, slower still asleep)
// and stops whenever the page is hidden, and a hit test so clicks land on
// the owl's own pixels, not on the empty corners of its window.
import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import type { MascotFrame } from "../behavior";
import { buildOwl, poseOwl, type OwlRig } from "./owl-model";

export interface OwlSceneOptions {
  color: string;
  /** Where the owl should be at this instant (behavior.ts mascotMotion). */
  frame: (now: number) => MascotFrame;
  /** How many frames a second the mascot needs right now. */
  fps: () => number;
}

/** Head and eye motion eases toward its target so the pointer never makes it twitch. */
const SMOOTH_MS = 110;
const SMOOTHED = ["headYaw", "headPitch", "headTilt", "pupilX", "pupilY"] as const;

export class OwlScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 50);
  private readonly raycaster = new Raycaster();
  private rig: OwlRig;
  private color: string;
  private shown: MascotFrame | null = null;
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: OwlSceneOptions,
  ) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power", premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
    this.camera.position.set(0, 1.8, 6.0);
    this.camera.lookAt(0, 1.25, 0);
    this.scene.add(new AmbientLight(0xffffff, 1.15));
    const key = new DirectionalLight(0xffffff, 1.9);
    key.position.set(2.5, 4, 5);
    this.scene.add(key);
    this.color = options.color;
    this.rig = buildOwl(options.color);
    this.scene.add(this.rig.root);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  setColor(color: string): void {
    if (color === this.color) return;
    this.color = color;
    this.scene.remove(this.rig.root);
    this.rig.dispose();
    this.rig = buildOwl(color);
    this.scene.add(this.rig.root);
    this.draw(performance.now());
  }

  /** The canvas's size in CSS px. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.draw(performance.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Whether a point (client coordinates) falls on the owl itself. */
  hitTest(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    if (x < -1 || x > 1 || y < -1 || y > 1) return false;
    this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
    return this.raycaster.intersectObjects(this.rig.solids, false).length > 0;
  }

  dispose(): void {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly onVisibility = () => {
    // hidden (another space, a locked screen, a covered window): no drawing at all
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.running) this.schedule();
  };

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    if (!this.running || document.hidden) return;
    this.raf = requestAnimationFrame(this.tick);
    const interval = 1000 / Math.max(1, Math.min(60, this.options.fps()));
    // a small allowance so a 60 Hz display does not drop to 30 fps on jitter
    if (now - this.last < interval - 3) return;
    this.draw(now);
  };

  private draw(now: number) {
    const target = this.options.frame(now);
    const dt = this.last ? Math.min(250, now - this.last) : 1000;
    this.last = now;
    const blend = 1 - Math.exp(-dt / SMOOTH_MS);
    const shown = this.shown ? { ...target } : target;
    if (this.shown) {
      for (const key of SMOOTHED) shown[key] = this.shown[key] + (target[key] - this.shown[key]) * blend;
    }
    this.shown = shown;
    poseOwl(this.rig, shown);
    this.renderer.render(this.scene, this.camera);
  }
}
