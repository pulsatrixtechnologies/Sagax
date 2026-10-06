import { nudgeLineText, type NudgeNote } from "@/lib/nudge-line";
import { viewerActorId } from "@/lib/viewer";
import { useStore } from "@/state/store";

/** A nudge in the transcript: one centred line, not a chat bubble. */
export function NudgeLine({ note }: { note: NudgeNote }) {
  const { state } = useStore();
  return (
    <div data-nudge-line className="flex justify-center px-6">
      <p className="max-w-full text-center text-[12.5px] leading-5 text-ink-secondary">
        {nudgeLineText(note, viewerActorId(state.config))}
      </p>
    </div>
  );
}
