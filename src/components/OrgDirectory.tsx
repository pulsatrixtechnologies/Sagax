import { useState, type FormEvent } from "react";
import type { OrgRole } from "../../server/org-directory.ts";
import { Card } from "./SettingsPrimitives";

export function OrgDirectory({
  org,
  people,
  onCreate,
  onInvite,
}: {
  org: { name: string } | null;
  people: { id: string; role: OrgRole }[];
  onCreate: (name: string) => void;
  onInvite: (email: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (!org) {
    return (
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const value = name.trim();
            if (value) onCreate(value);
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] text-ink">
            Nom
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
            />
          </label>
          <button type="submit" className="w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110">
            Créer l'organisation
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <div className="text-[15px] font-medium text-ink">{org.name}</div>
      <ul className="mt-4 divide-y divide-hairline/40">
        {people.map((person) => (
          <li key={person.id} className="flex justify-between gap-2 py-2 text-[13px] text-ink">
            <span>{person.id}</span>
            <span className="text-ink-secondary">{person.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const value = email.trim();
          if (value) {
            onInvite(value);
            setEmail("");
          }
        }}
      >
        <label className="flex flex-col gap-1.5 text-[13px] text-ink">
          Courriel
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
          />
        </label>
        <button type="submit" className="ui-button w-fit">
          Inviter
        </button>
      </form>
    </Card>
  );
}
