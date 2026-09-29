// The name above a person's line when someone else wrote it: another member
// of the channel, or the operator seen from a member's session. Your own
// lines carry no name, as before.
import { otherAuthorName } from "@/lib/viewer";
import { useStore, type Message } from "@/state/store";

export function OtherAuthorLabel({ message }: { message: Pick<Message, "role" | "sender"> }) {
  const { state } = useStore();
  const name = otherAuthorName(message, state.config);
  if (!name) return null;
  return <div className="mb-1 mr-1.5 max-w-[80%] truncate text-[12px] leading-4 text-ink-secondary">{name}</div>;
}
