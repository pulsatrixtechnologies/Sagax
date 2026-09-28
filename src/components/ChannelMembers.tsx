// Presentational roster. The booleans only hide controls. Ajouter calls the matching callback.

export function ChannelMembers(props: {
  humans: { id: string }[];
  bots: { id: string; name: string }[];
  canAddHuman: boolean;
  canAddBot: boolean;
  onAddHuman?: () => void;
  onAddBot?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <section>
        <h2 className="px-2 text-[12px] font-semibold text-ink-secondary">Gens</h2>
        <ul className="mt-1 flex flex-col gap-0.5">
          {props.humans.map((human) => (
            <li key={human.id} className="truncate px-2 py-1 text-[14px] text-ink">{human.id}</li>
          ))}
          {props.canAddHuman && (
            <li>
              <button type="button" onClick={() => props.onAddHuman?.()} className="rounded-md px-2 py-1 text-left text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">
                Ajouter
              </button>
            </li>
          )}
        </ul>
      </section>
      <section>
        <h2 className="px-2 text-[12px] font-semibold text-ink-secondary">Bots</h2>
        <ul className="mt-1 flex flex-col gap-0.5">
          {props.bots.map((bot) => (
            <li key={bot.id} className="truncate px-2 py-1 text-[14px] text-ink">{bot.name}</li>
          ))}
          {props.canAddBot && (
            <li>
              <button type="button" onClick={() => props.onAddBot?.()} className="rounded-md px-2 py-1 text-left text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">
                Ajouter
              </button>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
