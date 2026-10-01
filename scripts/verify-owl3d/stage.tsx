// One 3D owl on the desktop mascot's stage, for scripts/verify-owl3d.mjs: the real
// Owl3D component, with the activity, facing, color and skin taken from the URL.
import { createRoot } from "react-dom/client";
import Owl3D from "@/components/floating-bots/owl3d/Owl3D";
import { REST, type ClipName } from "@/components/floating-bots/clips";
import { mascotStage } from "@/components/floating-bots/fit";

const params = new URLSearchParams(location.search);
const size = 120;
const stage = mascotStage(size);
const face = Number(params.get("face") ?? 1);
const started = performance.now();
// the facing flips halfway when asked (a turn in place)
const flipAt = Number(params.get("flip") ?? 0);
document.body.style.background = params.get("bg") ?? "transparent";
document.body.style.width = `${stage.width}px`;
document.body.style.height = `${stage.height}px`;

createRoot(document.getElementById("root")!).render(
  <div style={{ position: "absolute", left: stage.left, top: stage.top, width: size, height: size }}>
    <Owl3D
      color={params.get("color") ?? "green"}
      skin={params.get("skin") ?? "none"}
      activity={(params.get("activity") ?? "idle") as ClipName}
      stage={stage}
      owlSize={size}
      frame={(now) => ({ ...REST, face: flipAt && now - started > flipAt ? -face : face })}
      fps={() => 60}
      onHitTest={() => undefined}
      onFail={() => {
        document.title = "owl3d-failed";
      }}
    />
  </div>,
);
(window as unknown as { owlStage: unknown }).owlStage = stage;
