// A bot on an organization server works on the computer of the PERSON who
// asks, never on the server's own machine (managed-policy.ts
// HOST_COMPUTER_REFUSAL) and never on anyone else's.
//
// A person's computer is reached through a target:
//   "user-desktop"  their own Sagax desktop app, connected to this server
//                   (Settings > Organization > Share this computer), which
//                   runs each action on that computer within the folders and
//                   capabilities they shared (server/shared-computers.ts,
//                   electron/computer-sharing.mjs);
//   "user-sandbox"  a per-person sandbox on the server's side, provided by
//                   its own module when it exists.
// Each target is a provider; the router only decides WHOSE computer a call
// may reach: the speaking person's, only while it is connected. Pure, so the
// rules are tested on their own (user-computers.test.ts).
import type { TurnSpeaker } from "./engine-access.ts";

export const USER_COMPUTER_TARGETS = ["user-desktop", "user-sandbox"] as const;
export type UserComputerTarget = (typeof USER_COMPUTER_TARGETS)[number];

export interface UserComputerProvider<Computer = unknown, Operation extends { computer_id: string } = { computer_id: string }> {
  target: UserComputerTarget;
  /** This person's computers that are connected right now. */
  list(principalId: string): Computer[];
  /** Whether this computer is this person's and connected. */
  owns(principalId: string, computerId: string): boolean;
  /** Run one action on it. Called only after `owns` said yes. */
  request(principalId: string, operation: Operation, active: () => boolean): Promise<unknown>;
}

export const USER_COMPUTER_MESSAGES = {
  noPerson: "No person asked in this turn, so no one's computer can be used: a routine or another bot cannot reach a person's computer on its own. Ask the person to request it themselves.",
  notConnected: "The computer of the person asking is not connected. Ask them to open the Sagax desktop app on their computer, signed in to this server, and turn on Share this computer (Settings > Organization). Nothing runs on the server instead.",
  notTheirs: "That computer is not the computer of the person asking. Only their own computer can be used; list it with list_shared_computers.",
} as const;

const refusal = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });

/** The person a turn speaks for, when a PERSON asked: their own message, or
 * a bot hop that carries that person's request. A routine, the operator's
 * loopback and an unattributed hop speak for nobody here. */
export function speakingPerson(speaker: TurnSpeaker | undefined): string | null {
  if (!speaker) return null;
  if (speaker.origin !== "person" && speaker.origin !== "peer") return null;
  if (speaker.origin === "peer" && speaker.routine) return null;
  const id = speaker.principalId?.trim().toLowerCase();
  return id || null;
}

export interface UserComputerRouter {
  /** The speaking person's connected computers, across targets. */
  list(speaker: TurnSpeaker | undefined): { target: UserComputerTarget; computer: unknown }[];
  /** One action on the speaking person's own computer. */
  request(speaker: TurnSpeaker | undefined, operation: { computer_id: string }, active: () => boolean): Promise<unknown>;
}

export function createUserComputerRouter(providers: readonly UserComputerProvider<unknown, never>[]): UserComputerRouter {
  const all = providers as readonly UserComputerProvider<unknown, { computer_id: string }>[];
  return {
    list(speaker) {
      const person = speakingPerson(speaker);
      if (!person) throw refusal(USER_COMPUTER_MESSAGES.noPerson, 403, "no_person");
      const computers = all.flatMap((provider) => provider.list(person).map((computer) => ({ target: provider.target, computer })));
      if (!computers.length) throw refusal(USER_COMPUTER_MESSAGES.notConnected, 409, "not_connected");
      return computers;
    },
    async request(speaker, operation, active) {
      const person = speakingPerson(speaker);
      if (!person) throw refusal(USER_COMPUTER_MESSAGES.noPerson, 403, "no_person");
      const provider = all.find((candidate) => candidate.owns(person, operation.computer_id));
      if (!provider) {
        const connected = all.some((candidate) => candidate.list(person).length > 0);
        throw connected
          ? refusal(USER_COMPUTER_MESSAGES.notTheirs, 403, "not_theirs")
          : refusal(USER_COMPUTER_MESSAGES.notConnected, 409, "not_connected");
      }
      return provider.request(person, operation, active);
    },
  };
}
