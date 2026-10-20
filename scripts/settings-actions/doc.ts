// Writes docs/settings-actions.md from the settings registry
// (shared/settings-actions.ts): `pnpm gen:settings-doc`. The hand-written
// part (what stays outside sagax_settings, the Perspicax console) is HEAD
// and TAIL below. shared/settings-actions.test.ts fails when the file is
// stale.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SETTING_FAMILIES, SETTINGS, type SettingSpec } from "../../shared/settings-actions.ts";

const FAMILY_FR: Record<string, string> = {
  bot: "Bots", thread: "Conversations", routine: "Routines", group: "Groupes et salles", section: "Équipes (sections)",
  rules: "Règles d'approbation", account: "Compte", appearance: "Apparence", notifications: "Notifications et confidentialité",
  models: "Modèles et voix", connections: "Connexions", credentials: "Coffre et clés", server: "Serveur",
  organization: "Organisation", computer: "Ordinateur",
};

const CLASS_FR: Record<string, string> = {
  own: "simple", "rule-change": "élargit les droits", secret: "secret", others: "autrui", bulk: "en lot", delete: "suppression", org: "organisation",
};

function classes(spec: SettingSpec): string {
  const solo = spec.classes ? spec.classes(null, { organization: false }) : ["own"];
  const org = spec.classes ? spec.classes(null, { organization: true }) : ["own"];
  const sample = spec.key === "bot.outbound" ? spec.classes!({ policy: "allow" }, { organization: false })
    : spec.key === "rules.custom" ? spec.classes!({ behavior: "deny" }, { organization: false }) : solo;
  const label = (list: string[]) => list.map((name) => CLASS_FR[name] ?? name).join(" + ");
  let out = label(solo);
  if (label(sample) !== out) out += spec.key === "rules.custom" ? ` (${label(sample)} pour une règle deny ou ask écrite)` : ` (${label(sample)} si allow)`;
  const self = spec.classes ? spec.classes(null, { organization: false, self: true }) : ["own"];
  if (label(self) !== label(solo)) out += ` (${label(self)} pour le bot qui parle lui-même)`;
  if (label(org) !== label(solo)) out += `; organisation : ${label(org)}`;
  return out;
}

function tool(spec: SettingSpec): string {
  const ops = spec.read ? "get, set" : "set";
  return `\`sagax_settings\` ${ops} \`${spec.key}\``;
}

const HEAD = `# Tout est modifiable par les bots (sagax_settings)

Exigence de JC (2026-10-19) : « Tout doit être modifiable via les bots.
Absolument tout. » Chaque réglage de Sagax est une action : un bot le lit et
le change pour la personne qui lui parle, avec les droits de cette personne,
par la même route que l'écran. Fichier généré par \`pnpm gen:settings-doc\`
depuis \`shared/settings-actions.ts\` ; ne pas l'éditer à la main sauf les
parties hors tableau du script.

## Comment ça marche

- Outil : \`sagax_settings\` (\`action\` list, get ou set ; \`key\`, \`target\`,
  \`value\`). \`list\` (avec \`family\`) donne les clés : rien n'est figé dans
  l'invite du bot.
- Droits : la route de l'écran est rejouée avec la session de la personne
  (\`server/bot-act.ts\`). Un membre ne peut pas faire par bot ce qu'il ne
  peut pas faire à la main : la route répond son refus, que le bot relaie.
- Décision (\`shared/settings-actions-policy.ts\`), dans l'ordre :
  1. une classe que la personne protège par clé de sécurité : carte signée ;
  2. secret, autrui, en lot, suppression, organisation : carte, à tout
     niveau, Full compris (comme un paiement ou un changement de masse) ;
  3. pas le travail du propriétaire (la personne ne possède pas le bot qui
     parle ou ce qui change) : carte ;
  4. bot à Ask ou Auto-accept edits : carte ;
  5. élargit les droits (niveau d'approbation, mode du propriétaire,
     règle allow, valeurs par défaut des nouveaux bots, outils, applis ou
     coéquipiers du bot qui parle lui-même, où travaillent les bots) :
     un niveau est appliqué jusqu'à celui du bot qui parle, jamais Full ni
     Custom sans carte ; le reste demande la carte ;
  6. sinon appliqué tout de suite.
- Journal : chaque changement appliqué (tout de suite ou après Allow) écrit
  une ligne \`setting.change\` (catégorie \`setting\`) dans le journal
  d'administration ; la valeur d'un secret est \`[hidden]\`.
- Une carte autorisée rejoue la route avec un jeton à usage unique
  (\`x-sagax-act-confirmed\`, 60 s, lié à la méthode et au chemin) : la route
  sait que la personne a dit Allow et que sa clé a couvert ces classes.
- Préférences de l'appareil (apparence, notifications) : la commande
  d'écran \`setPreference\` les écrit dans l'app ouverte de la personne ; sur
  un serveur d'organisation elles suivent la personne comme à la main.

## Inventaire

Classe : simple (appliqué pour le propriétaire en Approuver pour moi ou
Full), élargit les droits, secret, autrui, en lot, suppression, organisation
(carte).
`;

const TAIL = `
## Hors de sagax_settings

| Réglage | Où | Pourquoi |
|---|---|---|
| Plugins d'un bot | Connecter des applications | \`act\` avec \`plugins\` (list, install, setEnabled, uninstall) |
| Écran, navigation, envoi | partout | \`act\` avec \`ui\` (commandes d'écran) |
| Toute autre route /api | partout | \`act\` avec \`method\` et \`path\`, mêmes droits, carte pour une écriture |
| Clés de sécurité (ajout, retrait, classes) | Réglages > Sécurité | la clé physique de la personne : l'outil ouvre l'écran (\`act\` ui toggleAppSettings section security) |
| Export et import du coffre | Réglages > Identifiants | la personne seule (données en clair) ; les éléments du coffre restent modifiables (\`credentials.*\`) |
| Full ou Custom sur un serveur personnel | Éditeur du bot > Permissions | canal de confirmation de l'app de bureau ; sur un serveur d'organisation \`bot.approvalMode\` full passe par une carte |
| Mode serveur, mises à jour, icône, diagnostics | Réglages > Système, Mises à jour | IPC de l'app de bureau, pas de route |
| Répondre à une carte | conversation | une carte est la réponse de la personne, jamais d'un bot |

## Console Perspicax (exposée à Sagax)

Ces réglages vivent dans Perspicax (\`server/self-knowledge/perspicax.snapshot.json\`).
Sagax les lit (\`GET /api/org/directory\`) ; un bot les atteint par les outils
Perspicax de la personne quand Perspicax les sert (\`api_list\`), sinon par la
console. Suite à faire côté Perspicax : les servir comme actions à son MCP
avec les mêmes classes.

| Réglage | Où (console) | Outil du bot | Classe |
|---|---|---|---|
| Compte, apparence, général, sécurité, sessions | Réglages > Personnel | console (personne) | simple ; sécurité : clé |
| Bots, courriel, Gateway API, MCP, mémoire, système | Réglages > Organisation | console (admins) | organisation |
| Équipes | /teams | console (gestionnaires, admins) | autrui |
| Personnes, profils, rôles | /users, /profiles | console | autrui |
| Droits sur les bots | /sagax/permissions | console (admins) | autrui |
| Moteurs et outils, ordinateurs | /sagax/connections, /sagax/computers | console (admins) | organisation |
| Bots et routines (vue) | /sagax/bots, /sagax/routines | \`sagax_settings\` côté Sagax | voir plus haut |
| Clés de la personne | /credentials | console | secret |
| Comptes de service | /settings/service-accounts | console (admins) | secret + organisation |
`;

export function settingsDoc(): string {
  const parts = [HEAD];
  for (const family of SETTING_FAMILIES) {
    const specs = SETTINGS.filter((spec) => spec.family === family);
    if (!specs.length) continue;
    parts.push(`\n### ${FAMILY_FR[family] ?? family}\n\n| Réglage | Où dans l'UI | Outil du bot | Classe |\n|---|---|---|---|`);
    for (const spec of specs) parts.push(`| ${spec.label.replace(/\|/g, "/")} | ${spec.where} | ${tool(spec)} | ${classes(spec)} |`);
  }
  parts.push(TAIL);
  return parts.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("../../docs/settings-actions.md", import.meta.url), settingsDoc());
  console.log("docs/settings-actions.md written");
}
