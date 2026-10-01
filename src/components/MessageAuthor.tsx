// The name above a person's line when someone else wrote it: another member
// of the channel, or the operator seen from a member's session. Your own
// lines carry no name, as before.
import { otherAuthorName } from "@/lib/viewer";
import { InitialsAvatar } from "./Avatar";
import { useStore, type Message } from "@/state/store";

export function OtherAuthorLabel({ message }: { message: Pick<Message, "role" | "sender"> }) {
  const { state } = useStore();
  const name = otherAuthorName(message, state.config);
  if (!name) return null;
  return <div className="mb-1 mr-1.5 max-w-[80%] truncate text-[12px] leading-4 text-ink-secondary">{name}</div>;
}

/** A person's round avatar: their Perspicax picture when this server serves
 * one, else their initials (the same look as the group's people list). */
export function PersonAvatar({ avatarUrl, initials, size = 20 }: { avatarUrl?: string; initials: string; size?: number }) {
  return avatarUrl ? (
    <img src={avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <InitialsAvatar initials={initials} size={size} />
  );
}

/** Above the first line of another person's run in a group: avatar and name. */
export function RoomPersonLabel({ name, initials, avatarUrl }: { name: string; initials: string; avatarUrl?: string }) {
  return (
    <div data-testid="room-person" className="-mb-1.5 ms-1.5 mt-3 flex items-center gap-1.5 px-1.5">
      <PersonAvatar avatarUrl={avatarUrl} initials={initials} />
      <span className="max-w-[60vw] truncate text-[12px] font-medium leading-4 text-ink-secondary">{name}</span>
    </div>
  );
}
