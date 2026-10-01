// The 3D owl as a React element. Loaded lazily by FloatingBotView, so
// three.js lives in its own chunk, fetched only by a floating mascot (never
// by the main app bundle). When WebGL is missing (the renderer cannot be
// made) or its context is lost, it reports the failure and
// the view falls back to the flat 2D owl.
import { useEffect, useRef } from "react";
import type { MascotFrame } from "../behavior";
import { OwlScene } from "./owl-scene";

export interface Mascot3DProps {
  color: string;
  width: number;
  height: number;
  frame: (now: number) => MascotFrame;
  fps: () => number;
  /** Receives the owl's hit test once drawn, null when gone. */
  onHitTest: (test: ((clientX: number, clientY: number) => boolean) | null) => void;
  onFail: () => void;
}

export default function Mascot3D({ color, width, height, frame, fps, onHitTest, onFail }: Mascot3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<OwlScene | null>(null);
  // the callbacks change identity with every render; the scene reads the latest
  const live = useRef({ frame, fps });
  live.current = { frame, fps };

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let made: OwlScene;
    try {
      made = new OwlScene(node, {
        color,
        frame: (now) => live.current.frame(now),
        fps: () => live.current.fps(),
      });
    } catch {
      onFail();
      return;
    }
    scene.current = made;
    made.resize(width, height);
    made.start();
    onHitTest((x, y) => made.hitTest(x, y));
    const lost = (event: Event) => {
      event.preventDefault();
      onFail();
    };
    node.addEventListener("webglcontextlost", lost);
    return () => {
      node.removeEventListener("webglcontextlost", lost);
      onHitTest(null);
      scene.current = null;
      made.dispose();
    };
    // the scene is made once; color and size follow below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => scene.current?.setColor(color), [color]);
  useEffect(() => scene.current?.resize(width, height), [width, height]);

  return <canvas ref={canvas} className="fb-canvas" width={width} height={height} style={{ width, height }} aria-hidden="true" />;
}
