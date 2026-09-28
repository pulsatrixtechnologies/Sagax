/** What a channel shows for `waiting-on-owner`. No approval control. */
export function OwnerWait({ ownerName }: { ownerName: string }) {
  return (
    <p className="px-4 py-2.5 text-[15px] leading-relaxed text-ink-secondary">
      {`En attente de ${ownerName}`}
    </p>
  );
}
