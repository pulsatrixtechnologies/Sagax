// The balloon's "Mascot" tab: every character of the registry (mascots.tsx)
// with a thumbnail, the original body shapes when that family is chosen,
// and the owl's 2D / 3D (preview) style. A choice goes back to the brain as
// a "mascot" event and is saved per bot (src/lib/floating-bots.ts).
import { cn } from "@/lib/cn";
import type { FloatingMascotChoice } from "@/lib/floating-bots";
import { BODY_CHOICES, DEFAULT_MASCOT, MASCOTS } from "./mascots";
import type { FloatingPickerLabels } from "./protocol";

export interface MascotPickerProps {
  color: string;
  skin: string;
  choice: FloatingMascotChoice | undefined;
  labels: FloatingPickerLabels;
  onChoose: (choice: FloatingMascotChoice) => void;
}

const THUMB = 40;

export function MascotPicker({ color, skin, choice = DEFAULT_MASCOT, labels, onChoose }: MascotPickerProps) {
  return (
    <div className="fb-picker">
      <div className="fb-picker-row" role="radiogroup" aria-label={labels.mascot}>
        {MASCOTS.map((entry) => {
          const chosen = choice.kind === entry.id;
          const sample: FloatingMascotChoice = { ...choice, kind: entry.id };
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              data-mascot={entry.id}
              className={cn("fb-picker-card", chosen && "fb-picker-on")}
              onClick={() => onChoose({ ...choice, kind: entry.id })}
            >
              <span className="fb-picker-thumb" aria-hidden="true">
                <entry.Thumb color={color} skin={skin} choice={sample} size={THUMB} />
              </span>
              <span className="fb-picker-name">{labels.kinds[entry.id]}</span>
            </button>
          );
        })}
      </div>
      {choice.kind === "body" && (
        <div className="fb-picker-row fb-picker-shapes" role="radiogroup" aria-label={labels.shape}>
          {BODY_CHOICES.map((body) => {
            const entry = MASCOTS.find((candidate) => candidate.id === "body")!;
            const chosen = (choice.body ?? "cursor") === body;
            return (
              <button
                key={body}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={labels.bodies[body] ?? body}
                title={labels.bodies[body] ?? body}
                data-body={body}
                className={cn("fb-picker-shape", chosen && "fb-picker-on")}
                onClick={() => onChoose({ ...choice, kind: "body", body })}
              >
                <entry.Thumb color={color} skin={skin} choice={{ kind: "body", body }} size={26} />
              </button>
            );
          })}
        </div>
      )}
      {choice.kind === "owl" && (
        <div className="fb-picker-row fb-picker-style" role="radiogroup" aria-label={labels.style}>
          {(["2d", "3d"] as const).map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={(choice.style ?? "2d") === style}
              data-style={style}
              className={cn("fb-picker-pill", (choice.style ?? "2d") === style && "fb-picker-on")}
              onClick={() => onChoose({ ...choice, kind: "owl", style })}
            >
              {style === "2d" ? labels.flat : labels.threeD}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
