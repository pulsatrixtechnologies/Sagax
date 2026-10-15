// A settled turn's intermediate assistant messages. Providers such as Grok
// narrate before tools; the messages stay available without looking like six
// separate final answers after the turn is done. The fold is a quiet step
// row ("Worked for 12s"), like every other step in the thread.
import { StepRow } from "./StepRow";

export function TurnNarrationRun({
  label,
  forceOpen = false,
  children,
}: {
  label: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col" data-testid="turn-narration-run">
      <StepRow label={label} forceOpen={forceOpen} wide>
        {() => children}
      </StepRow>
    </div>
  );
}
