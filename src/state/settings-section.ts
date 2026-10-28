// Section ids for Settings and the bot panel. A leaf: src/state/store.tsx
// imports the modules that name these ids, so the ids cannot live in the store.

/** A page of the app Settings dialog. */
export type AppSettingsSection =
  /** Who is signed in, with Security keys and the vault under it (2026-10-26). */
  | "account"
  | "general"
  | "memory"
  | "privacy"
  | "notifications"
  /** Security keys and passkeys for sensitive approvals (2026-10-16). */
  | "security"
  | "organization"
  | "appearance"
  | "experimental"
  /** Merged into "engines" (Models and voice) on 2026-10-14; still accepted
   * from old links and redirected (src/lib/settings-link.ts). */
  | "connections"
  | "connectedApps"
  | "decisionModel"
  | "engines"
  | "companion"
  | "computer"
  | "usage"
  /** The person's credential vault (2026-10-16): logins bots fill by reference. */
  | "credentials"
  | "people"
  | "mail"
  | "activity"
  | "backups"
  /** Bring a shared Grok Bot in (port of OpenMausBot #3073). */
  | "import"
  | "workspaces"
  /** This app's updates and the pre-release channel (0.5.6; were in General). */
  | "updates"
  /** Pages a bot proposed and the person published (src/components/PublishedPages.tsx). */
  | "pages";

/** A page of the bot settings panel or the persona editor. */
export type BotSettingsSection =
  | "overview"
  /** The persona editor's Appearance: the mascot gallery and the picture sources. */
  | "appearance"
  /** The persona editor's What it does: the server's summary of what the
   * bot does, reaches and won't do, and the prompt preview. */
  | "summary"
  /** Deep link to the Details tab. */
  | "details"
  | "slack"
  | "soul"
  /** RULES.md: hard constraints loaded every turn (docs/bot-workspace.md). */
  | "rules"
  | "skills"
  | "memory"
  /** The whole bot workspace: SOUL.md, RULES.md, memory, docs/, skills. */
  | "files"
  | "routines"
  | "access"
  /** More > Computer. The Works on control. Not a row of the Computer tab. */
  | "worksOn"
  | "model"
  | "permissions"
  | "voice"
  | "visibility"
  | "sharing"
  | "perspicax"
  | "history"
  | "usage";
