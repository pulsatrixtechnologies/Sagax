// The permission catalogue of an organization server (2026-10-09).
//
// Every "admin only" decision a person meets on a Sagax server linked to
// Perspicax is one key here. Perspicax holds permission sets (roles), each
// granting keys; a person's effective permissions are the union of the
// default set, the sets given to them and the sets of their teams, computed
// by Perspicax and sent in the directory (`permissions` on each person). An
// organization admin holds every key. Keys marked `adminOnly` are true
// security boundaries: no set grants them, whatever Perspicax sends.
//
// When Perspicax sends no list (an older Perspicax, a person missing from
// the directory, the directory not read yet), a person holds the member
// defaults: exactly what a plain member could do before this catalogue.
//
// Browser-safe: the server enforces it, the app hides or disables with it,
// and GET /api/org/admin/capabilities hands it to the Perspicax console,
// which draws its permission matrix from these rows. Keys are stable: never
// rename one; retire it and add another.
//
// Spec: docs/superpowers/specs/2026-10-09-sagax-permission-matrix.md.

export const PERMISSION_CATALOGUE_VERSION = 1;

export type PermissionGroupId =
  | "bots" | "sharing" | "engines" | "apps" | "skills" | "folders"
  | "routines" | "people" | "usage" | "backup" | "host" | "server" | "clients";

export interface LocalizedText {
  en: string;
  fr: string;
}

export interface PermissionGroup {
  id: PermissionGroupId;
  label: LocalizedText;
}

export interface PermissionDefinition<K extends string = string> {
  key: K;
  group: PermissionGroupId;
  label: LocalizedText;
  description: LocalizedText;
  /** What a plain member holds when Perspicax sends nothing. */
  memberDefault: boolean;
  /** Only an organization admin, whatever a profile grants. */
  adminOnly: boolean;
  /** Why it stays with admins (adminOnly keys only). */
  adminOnlyReason?: LocalizedText;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: "bots", label: { en: "Bots", fr: "Bots" } },
  { id: "sharing", label: { en: "Sharing", fr: "Partage" } },
  { id: "engines", label: { en: "Engines", fr: "Moteurs" } },
  { id: "apps", label: { en: "Connect apps and plugins", fr: "Applications et plugiciels" } },
  { id: "skills", label: { en: "Skills", fr: "Compétences" } },
  { id: "folders", label: { en: "Working folders", fr: "Dossiers de travail" } },
  { id: "routines", label: { en: "Routines", fr: "Routines" } },
  { id: "people", label: { en: "People", fr: "Personnes" } },
  { id: "usage", label: { en: "Usage", fr: "Utilisation" } },
  { id: "backup", label: { en: "Backups", fr: "Sauvegardes" } },
  { id: "host", label: { en: "Server host", fr: "Hôte du serveur" } },
  { id: "server", label: { en: "Server", fr: "Serveur" } },
  { id: "clients", label: { en: "AI clients through Perspicax", fr: "Clients IA par Perspicax" } },
];

const definitions = [
  {
    key: "bots.create", group: "bots", memberDefault: true, adminOnly: false,
    label: { en: "Create and own bots", fr: "Créer et posséder des bots" },
    description: {
      en: "Create bots, bring them from a solo Sagax, and rename, instruct, change the model of or delete the bots they own.",
      fr: "Créer des bots, les apporter d'un Sagax solo, et renommer, instruire, changer le modèle ou supprimer les bots qu'ils possèdent.",
    },
  },
  {
    key: "bots.approvalLevel", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose Ask or Auto on their bots", fr: "Choisir Demander ou Auto sur leurs bots" },
    description: {
      en: "Set the approval level of a bot they own to Ask or Auto. Full access has its own permission.",
      fr: "Régler le niveau d'approbation d'un bot qu'ils possèdent à Demander ou Auto. L'accès complet a sa propre permission.",
    },
  },
  {
    key: "bots.fullAccess", group: "bots", memberDefault: true, adminOnly: false,
    label: { en: "Turn on Full access on their bots", fr: "Activer l'accès complet sur leurs bots" },
    description: {
      en: "Turn on Full access for a bot they own, while the organization allows Full access.",
      fr: "Activer l'accès complet pour un bot qu'ils possèdent, tant que l'organisation le permet.",
    },
  },
  {
    key: "bots.behaviour", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Change memory, voice notes and fallback of their bots", fr: "Changer la mémoire, les notes vocales et le repli de leurs bots" },
    description: {
      en: "Turn memory and its upkeep, voice notes, the fallback model and parked direct messages on or off for a bot they own.",
      fr: "Activer ou désactiver la mémoire et son entretien, les notes vocales, le modèle de repli et les messages directs en attente d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.computer", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose where their bots work", fr: "Choisir où travaillent leurs bots" },
    description: {
      en: "Choose the computer, the cloud computer, the built-in browser and the browser profile of a bot they own.",
      fr: "Choisir l'ordinateur, l'ordinateur infonuagique, le navigateur intégré et le profil de navigateur d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.tools", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose the tools of their bots", fr: "Choisir les outils de leurs bots" },
    description: {
      en: "Change the tool selection, MCP servers, connected apps, outbound rules and peers of a bot they own.",
      fr: "Changer la sélection d'outils, les serveurs MCP, les applications connectées, les règles sortantes et les pairs d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.catalogFeature", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Feature bots in Browse Bots", fr: "Mettre des bots en vedette dans Parcourir les bots" },
    description: {
      en: "Feature or unfeature a published bot in the organization's bot catalogue.",
      fr: "Mettre en vedette ou retirer de la vedette un bot publié dans le catalogue de bots de l'organisation.",
    },
  },
  {
    key: "sharing.grants", group: "sharing", memberDefault: true, adminOnly: false,
    label: { en: "Share their bots", fr: "Partager leurs bots" },
    description: {
      en: "Give people and teams access to a bot they own, and take it back.",
      fr: "Donner à des personnes et des équipes l'accès à un bot qu'ils possèdent, et le retirer.",
    },
  },
  {
    key: "sharing.visibility", group: "sharing", memberDefault: false, adminOnly: false,
    label: { en: "Choose who sees their bots", fr: "Choisir qui voit leurs bots" },
    description: {
      en: "Set the visibility and the sidebar section of a bot they own, at creation and afterwards.",
      fr: "Régler la visibilité et la section de la barre latérale d'un bot qu'ils possèdent, à la création et ensuite.",
    },
  },
  {
    key: "engines.manage", group: "engines", memberDefault: false, adminOnly: false,
    label: { en: "Manage the server's engines", fr: "Gérer les moteurs du serveur" },
    description: {
      en: "Install, update, sign in, rename and refresh the engines of the server. Changing an engine's program path stays with admins.",
      fr: "Installer, mettre à jour, connecter, renommer et rafraîchir les moteurs du serveur. Changer le chemin du programme d'un moteur reste aux admins.",
    },
  },
  {
    key: "apps.ownIntegrations", group: "apps", memberDefault: true, adminOnly: false,
    label: { en: "Manage their own plugins, skills and MCP servers", fr: "Gérer leurs propres plugiciels, compétences et serveurs MCP" },
    description: {
      en: "Add and change their own MCP servers and GitHub account, and the plugins and skills of the bots they own or manage.",
      fr: "Ajouter et changer leurs propres serveurs MCP et compte GitHub, ainsi que les plugiciels et compétences des bots qu'ils possèdent ou gèrent.",
    },
  },
  {
    key: "apps.serverPlugins", group: "apps", memberDefault: false, adminOnly: false,
    label: { en: "Add plugins to the server", fr: "Ajouter des plugiciels au serveur" },
    description: {
      en: "Install a plugin from the catalog or the registry for the whole server: every bot can then reach it. A plugin that would run a command on the server is still skipped.",
      fr: "Installer un plugiciel du catalogue ou du registre pour tout le serveur : chaque bot peut alors l'atteindre. Un plugiciel qui lancerait une commande sur le serveur reste ignoré.",
    },
  },
  {
    key: "apps.marketplaces", group: "apps", memberDefault: false, adminOnly: false,
    label: { en: "Manage plugin marketplaces", fr: "Gérer les marchés de plugiciels" },
    description: {
      en: "Add, refresh and remove the server's plugin marketplaces, and install or remove their plugins for the whole server. A plugin that would run a command on the server is still skipped.",
      fr: "Ajouter, rafraîchir et retirer les marchés de plugiciels du serveur, et installer ou retirer leurs plugiciels pour tout le serveur. Un plugiciel qui lancerait une commande sur le serveur reste ignoré.",
    },
  },
  {
    key: "skills.library", group: "skills", memberDefault: false, adminOnly: false,
    label: { en: "Change the skills library", fr: "Changer la bibliothèque de compétences" },
    description: {
      en: "Read, save, approve, disable and delete the skills of the server's shared library.",
      fr: "Lire, enregistrer, approuver, désactiver et supprimer les compétences de la bibliothèque partagée du serveur.",
    },
  },
  {
    key: "folders.botWorkingFolder", group: "folders", memberDefault: false, adminOnly: false,
    label: { en: "Set the working folder of their bots", fr: "Choisir le dossier de travail de leurs bots" },
    description: {
      en: "Choose the folder a bot they own works in, at creation and afterwards.",
      fr: "Choisir le dossier où travaille un bot qu'ils possèdent, à la création et ensuite.",
    },
  },
  {
    key: "folders.roomWorkingFolder", group: "folders", memberDefault: false, adminOnly: false,
    label: { en: "Set the working folder of their groups", fr: "Choisir le dossier de travail de leurs groupes" },
    description: {
      en: "Choose the folder a group they own works in.",
      fr: "Choisir le dossier où travaille un groupe qu'ils possèdent.",
    },
  },
  {
    key: "routines.runAsAnyone", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "Choose anyone a routine runs as", fr: "Choisir n'importe qui comme exécutant d'une routine" },
    description: {
      en: "Pick any active person of the directory in a routine's Runs as field, like an admin. Team managers already reach their teams.",
      fr: "Choisir toute personne active du répertoire dans le champ S'exécute en tant que d'une routine, comme un admin. Les gestionnaires d'équipe atteignent déjà leurs équipes.",
    },
  },
  {
    key: "routines.runNowAny", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "Run any routine now", fr: "Lancer n'importe quelle routine maintenant" },
    description: {
      en: "Use Run now on a routine they can see, even when they neither own its bot nor are the person it runs as.",
      fr: "Utiliser Lancer maintenant sur une routine qu'ils voient, même s'ils ne possèdent pas son bot et ne sont pas la personne qui l'exécute.",
    },
  },
  {
    key: "people.labelAnyone", group: "people", memberDefault: false, adminOnly: false,
    label: { en: "Change anyone's label", fr: "Changer l'étiquette de n'importe qui" },
    description: {
      en: "Change the custom label of any person. Everyone changes their own; team managers change their teams' people.",
      fr: "Changer l'étiquette personnalisée de n'importe quelle personne. Chacun change la sienne; les gestionnaires changent celles de leurs équipes.",
    },
  },
  {
    key: "people.activityLog", group: "people", memberDefault: false, adminOnly: false,
    label: { en: "Read the admin activity log", fr: "Lire le journal d'activité admin" },
    description: {
      en: "Read and export who changed settings, people, access and bots, and who answered approval cards.",
      fr: "Lire et exporter qui a changé les réglages, les personnes, les accès et les bots, et qui a répondu aux cartes d'approbation.",
    },
  },
  {
    key: "people.manage", group: "people", memberDefault: false, adminOnly: true,
    label: { en: "Manage other people", fr: "Gérer les autres personnes" },
    description: {
      en: "Disable, enable and reset people, revoke their connections, attach interim people and act on bots they own.",
      fr: "Désactiver, réactiver et réinitialiser des personnes, révoquer leurs connexions, rattacher des personnes intérimaires et agir sur les bots qu'elles possèdent.",
    },
    adminOnlyReason: {
      en: "It reaches other people's accounts and data.",
      fr: "Elle touche aux comptes et aux données des autres personnes.",
    },
  },
  {
    key: "usage.view", group: "usage", memberDefault: false, adminOnly: false,
    label: { en: "See usage and spend", fr: "Voir l'utilisation et les dépenses" },
    description: {
      en: "Read the server's usage, spend and budget, and export them.",
      fr: "Lire l'utilisation, les dépenses et le budget du serveur, et les exporter.",
    },
  },
  {
    key: "backup.workspace", group: "backup", memberDefault: false, adminOnly: true,
    label: { en: "Back up and restore the server", fr: "Sauvegarder et restaurer le serveur" },
    description: {
      en: "Export, schedule and restore the server's backups.",
      fr: "Exporter, planifier et restaurer les sauvegardes du serveur.",
    },
    adminOnlyReason: {
      en: "A backup holds everyone's conversations and files; a restore replaces them.",
      fr: "Une sauvegarde contient les conversations et les fichiers de tout le monde; une restauration les remplace.",
    },
  },
  {
    key: "host.shell", group: "host", memberDefault: false, adminOnly: true,
    label: { en: "Run commands on the server", fr: "Exécuter des commandes sur le serveur" },
    description: {
      en: "Approve a member bot's server-level commands, save command rules, change the server's own MCP servers, an engine's program path, its computers and this computer.",
      fr: "Approuver les commandes de niveau serveur des bots des membres, enregistrer des règles de commande, changer les serveurs MCP du serveur, le chemin du programme d'un moteur, ses ordinateurs et cet ordinateur.",
    },
    adminOnlyReason: {
      en: "It runs programs on the server's own machine, outside anyone's space.",
      fr: "Elle exécute des programmes sur la machine du serveur, hors de l'espace de chacun.",
    },
  },
  {
    key: "server.settings", group: "server", memberDefault: false, adminOnly: true,
    label: { en: "Change the server's settings", fr: "Changer les réglages du serveur" },
    description: {
      en: "Change the installation's settings, keys, mail, webhooks and organization policies (Full access, marketplaces, GitHub app).",
      fr: "Changer les réglages de l'installation, les clés, le courriel, les webhooks et les politiques de l'organisation (accès complet, marchés, application GitHub).",
    },
    adminOnlyReason: {
      en: "It changes security and payment settings for everyone.",
      fr: "Elle change les réglages de sécurité et de paiement pour tout le monde.",
    },
  },
  {
    key: "server.link", group: "server", memberDefault: false, adminOnly: true,
    label: { en: "Link the server", fr: "Lier le serveur" },
    description: {
      en: "Link or unlink the server to Perspicax and change who may sign in.",
      fr: "Lier ou délier le serveur à Perspicax et changer qui peut se connecter.",
    },
    adminOnlyReason: {
      en: "It decides who can reach the server at all.",
      fr: "Elle décide qui peut joindre le serveur.",
    },
  },
  // 2026-10-09 (Perspicax plan, lot C.1): what a person may do with their
  // bots from an AI client attached to Perspicax (Claude Code, claude.ai,
  // Cursor), through the member API (server/org-member-routes.ts). Each key
  // is checked on top of the rule the same action meets in Sagax.
  {
    key: "clients.botsRead", group: "clients", memberDefault: true, adminOnly: false,
    label: { en: "See their bots and conversations from an AI client", fr: "Voir leurs bots et leurs conversations depuis un client IA" },
    description: {
      en: "List the bots they can use and read their own conversations with them from Claude Code, claude.ai or another client attached to Perspicax.",
      fr: "Lister les bots qu'ils peuvent utiliser et lire leurs propres conversations avec eux depuis Claude Code, claude.ai ou un autre client relié à Perspicax.",
    },
  },
  {
    key: "clients.botsMessage", group: "clients", memberDefault: true, adminOnly: false,
    label: { en: "Message their bots from an AI client", fr: "Écrire à leurs bots depuis un client IA" },
    description: {
      en: "Send a message to a bot they can use from a client attached to Perspicax, under their own name, and wait for its answer.",
      fr: "Envoyer un message à un bot qu'ils peuvent utiliser depuis un client relié à Perspicax, en leur propre nom, et attendre sa réponse.",
    },
  },
  {
    key: "clients.routinesRun", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Run routines from an AI client", fr: "Lancer des routines depuis un client IA" },
    description: {
      en: "Run a routine now and follow its run from a client attached to Perspicax. The routine's own Run now rule still applies.",
      fr: "Lancer une routine maintenant et suivre son exécution depuis un client relié à Perspicax. La règle Lancer maintenant de la routine s'applique toujours.",
    },
  },
  {
    key: "clients.approvalsAnswer", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Answer approvals from an AI client", fr: "Répondre aux approbations depuis un client IA" },
    description: {
      en: "Allow or deny an approval card they may answer in Sagax, from a client attached to Perspicax.",
      fr: "Autoriser ou refuser une carte d'approbation à laquelle ils peuvent répondre dans Sagax, depuis un client relié à Perspicax.",
    },
  },
  {
    key: "clients.peopleNudge", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Nudge people from an AI client", fr: "Faire signe à des personnes depuis un client IA" },
    description: {
      en: "Nudge a person of the organization from a client attached to Perspicax, like the nudge button in Sagax.",
      fr: "Faire signe à une personne de l'organisation depuis un client relié à Perspicax, comme le bouton Faire signe de Sagax.",
    },
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof definitions)[number]["key"];

export const PERMISSIONS: readonly PermissionDefinition<PermissionKey>[] = definitions;

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((entry) => entry.key);

const BY_KEY = new Map<string, PermissionDefinition<PermissionKey>>(PERMISSIONS.map((entry) => [entry.key, entry]));

/** Dotted, stable: a group, a dot, a camelCase name. */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && BY_KEY.has(value);
}

export function permissionDefinition(key: string): PermissionDefinition<PermissionKey> | undefined {
  return BY_KEY.get(key);
}

/** What a plain member holds when Perspicax sends no list. */
export const MEMBER_DEFAULT_PERMISSIONS: readonly PermissionKey[] = PERMISSIONS
  .filter((entry) => entry.memberDefault && !entry.adminOnly)
  .map((entry) => entry.key);

/** The keys no profile grants. */
export const ADMIN_ONLY_PERMISSIONS: readonly PermissionKey[] = PERMISSIONS
  .filter((entry) => entry.adminOnly)
  .map((entry) => entry.key);

export interface NormalizedPermissions {
  /** Known, grantable keys, in catalogue order. */
  granted: PermissionKey[];
  /** Strings that name no key of this catalogue (a newer Perspicax, a typo). */
  unknown: string[];
  /** Known keys a profile may not grant (adminOnly). */
  ignored: PermissionKey[];
}

/** Read a list Perspicax sent: keep the known, grantable keys; report the
 * rest. Never throws. */
export function normalizePermissions(input: unknown): NormalizedPermissions {
  const seen = new Set<string>();
  const unknown: string[] = [];
  const ignored: PermissionKey[] = [];
  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value !== "string" || seen.has(value)) continue;
      seen.add(value);
      const definition = BY_KEY.get(value);
      if (!definition) unknown.push(value.slice(0, 64));
      else if (definition.adminOnly) ignored.push(definition.key);
    }
  }
  const granted = PERMISSION_KEYS.filter((key) => seen.has(key) && !BY_KEY.get(key)!.adminOnly);
  return { granted, unknown, ignored };
}

/** Who asks: an organization admin, or a person and what they hold.
 * Undefined is the operator at the server's own computer (everything). */
export interface PermissionPrincipal {
  admin: boolean;
  permissions: ReadonlySet<string> | readonly string[];
}

/** The one question every gate asks. An admin may everything; an adminOnly
 * key is an admin's only; anyone else needs the key in their list. */
export function can(principal: PermissionPrincipal | undefined | null, key: PermissionKey): boolean {
  if (!principal) return true;
  if (principal.admin) return true;
  const definition = BY_KEY.get(key);
  if (!definition || definition.adminOnly) return false;
  const held = principal.permissions;
  return Array.isArray(held) ? held.includes(key) : (held as ReadonlySet<string>).has(key);
}

/** The bot fields a member sets on a bot they own only with a key (on top
 * of MEMBER_BOT_FIELDS in shared/viewer-capabilities.ts, which need
 * bots.create). A field missing here stays an admin's. */
export const BOT_FIELD_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {
  approvalMode: "bots.approvalLevel",
  autoApprove: "bots.approvalLevel",
  acknowledgeLocalAuto: "bots.approvalLevel",
  memoryEnabled: "bots.behaviour",
  memoryUpkeep: "bots.behaviour",
  voiceNotes: "bots.behaviour",
  fallback: "bots.behaviour",
  parkDirectMessages: "bots.behaviour",
  computer: "bots.computer",
  cloudBackend: "bots.computer",
  autoStartVps: "bots.computer",
  browser: "bots.computer",
  browserProfile: "bots.computer",
  toolScope: "bots.tools",
  mcpServers: "bots.tools",
  composio: "bots.tools",
  connectorTools: "bots.tools",
  connectorScopes: "bots.tools",
  outbound: "bots.tools",
  peers: "bots.tools",
  approvePeerComms: "bots.tools",
  acknowledgePeerScope: "bots.tools",
  visibility: "sharing.visibility",
  section: "sharing.visibility",
  cwd: "folders.botWorkingFolder",
};

/** The label of a key in a language (English unless French). */
export function permissionLabel(key: string, locale = "en"): string {
  const definition = BY_KEY.get(key);
  if (!definition) return key;
  return locale.toLowerCase().startsWith("fr") ? definition.label.fr : definition.label.en;
}

/** The refusal body a gate answers: `{ error: "forbidden", permission }`
 * plus a sentence for older clients that show `message`. */
export function permissionRefusal(key: PermissionKey): { error: "forbidden"; permission: PermissionKey; message: string } {
  return {
    error: "forbidden",
    permission: key,
    message: `Your profile does not include ${permissionLabel(key)}. Ask an admin to add it in Perspicax.`,
  };
}

/** The catalogue as GET /api/org/admin/capabilities returns it. */
export function permissionCatalogue(): { version: number; groups: readonly PermissionGroup[]; permissions: readonly PermissionDefinition<PermissionKey>[] } {
  return { version: PERMISSION_CATALOGUE_VERSION, groups: PERMISSION_GROUPS, permissions: PERMISSIONS };
}
