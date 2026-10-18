# Section « Code » : les agents cloud de Perspicax dans Sagax

Date : 2026-10-18. Statut : décisions tranchées le 2026-10-18, résumé côté Sagax. La spec complète (modèle, sécurité, API, phases, décisions) vit dans le dépôt Perspicax : `docs/superpowers/specs/2026-10-18-cloud-agents-design.md`.

## 0. Orientation

Perspicax devient le plan de contrôle d'agents de code cloud : environnements (dépôts, image, setup, secrets, réseau, portée), runs (tâche, moteur, modèle, branche, état, durée, coût), artefacts (diff, commits, PR, terminal, bureau, fichiers) et automatisations. Un run tourne dans son propre Pod du cluster de sandboxes, jamais dans le sandbox personnel. Sagax est un client : il lance, suit, relance et arrête ; les réglages (environnements, intégrations Git, automatisations) restent dans la console Perspicax.

## 1. Ce que Sagax change

### 1.1 Serveur

- `shared/cloud-agents.ts` : nouveau fournisseur `perspicax` dans `CLOUD_AGENT_PROVIDERS`. `CloudAgentRecord` gagne `stats` (fichiers, `+lignes`, `-lignes`, commits), `pr` (numéro, URL, état draft/open/merged/closed), `unread`, `envId`, `origin` ; `botId` et `threadId` deviennent optionnels (runs lancés hors Sagax). `CloudAgentStatus` gagne `queued`, `waiting_for_approval`, `expired`.
- `server/cloud-agents/providers/perspicax.ts` : appelle `/api/v1/agents` de Perspicax avec le jeton OAuth de la personne ; aucune clé à coller. Remplace, pour Claude Code et Codex, les fournisseurs `claude` (chemin d'API non confirmé) et `codex` (refuse tout appel).
- Direct : abonnement au flux SSE de Perspicax, relayé sur l'événement SSE existant `cloud.agent` ; notification push à la fin et à chaque demande d'approbation.
- Provisionneur (`server/sandboxd-k8s*.ts`) : nouvelle ressource `run` (Pod `run-<id>`, PVC `run-<id>-ws`, NetworkPolicy `run-<id>-net`, TTL dur, balayage des orphelins, ResourceQuota séparée, pool de nœuds dédié). Appelée par Perspicax seulement, avec une clé distincte (`sagax-sandboxd-runs-key`, routes `/v1/runs` seulement) et mTLS obligatoire.
- Runner (`sagax-runner`) : point d'entrée du paquet serveur qui réutilise les pilotes (`server/drivers/claude.ts`, `codex.ts`, puis ACP) en mode sans tête, dans l'image `sagax-run` (base `sagax-sandbox` + CLI figées par `engines.lock.json`). Connexion sortante seulement ; jeton GitHub en lecture seulement : le runner ne pousse jamais, il envoie un `git bundle` de la branche du run que Perspicax vérifie et pousse ; aucune clé de modèle dans le Pod (le moteur passe par le proxy de modèle de Perspicax) ; masquage des secrets. Clé distincte du provisionneur pour les runs (`/v1/runs` seulement), mTLS obligatoire.

### 1.2 Bureau

- Entrée **Code** dans la barre latérale, au niveau des conversations. Elle liste tous les runs de la personne, quel que soit le bot ou l'origine (console, automatisation, client MCP). Aujourd'hui les agents cloud ne vivent que dans l'activité de chaque bot.
- **Liste** : en tête, sélecteur d'environnement (« Partir de zéro ⌄ »), composer de lancement, moteur et modèle, micro et voix, puces. Rangée : carte gauche (`N fichiers`, `+X`, `-Y`, pastille Fusionnée / Brouillon / PR ouverte / Branche / En cours / En attente / Échec), puis titre, point de non-lu, état de PR, modèle, dépôt, âge.
- **Vue d'un run** : à gauche la conversation (tâche, « A travaillé 8 min », messages, outils repliés, approbations en ligne, lien de PR), alertes d'environnement avec « Voir les détails », composer **« Ajouter une suite »** (queue, steer, interrupt) ; à droite un panneau à onglets **Changements** | **Bureau** | **Terminal** | **Fichiers** | `+`. Changements : en-tête de PR (état, `branche -> main`, « Voir la PR »), sous-onglets **Diff** | **Revue** | **Commits**, diff par fichier repliable avec **Aperçu**. Panneau redimensionnable, plein écran, repliable.
- **Conversation** : carte « Agents cloud (N) » sous le message du bot qui a lancé, rangées compactes, bouton Ouvrir (dans Sagax), menu Arrêter / Copier le lien de PR / Ouvrir la PR.
- **Lancement depuis un fil** : « lance un agent cloud sur le dépôt X » -> outil `launch_cloud_agent` (fournisseur `perspicax`, environnement trouvé par dépôt, question si plusieurs). Gate existante des outils d'écriture. Le bot est réveillé à la fin (`completionNotified`).
- Un fil confidentiel n'envoie que le prompt montré à la personne ; le run, lui, n'est pas confidentiel (il produit une PR), et l'UI le dit.

### 1.3 iOS (phase 2)

Onglet **Code** : même liste ; vue de run plein écran avec segments Conversation / Changements / Terminal / Fichiers ; suite ; push à la fin et sur approbation. Bureau en lecture plus tard.

### 1.4 Décisions qui touchent Sagax

- **Source des jetons** : clé de l'organisation (défaut) ou abonnement personnel de la personne qui lance, réglé par environnement dans la console (`org`, `personnel`, `au_choix`). Avec `personnel`, Sagax remet seulement un jeton d'accès court (jamais le jeton de rafraîchissement) au proxy de modèle de Perspicax, qui le garde en mémoire pour la durée du run ; il n'entre jamais dans le Pod. Jamais pour une automatisation, un run lancé au nom de quelqu'un d'autre, ni un environnement d'équipe ou d'organisation (ceux-ci forcent la clé de l'organisation). Les conditions du fournisseur s'appliquent à l'abonné ; un refus du fournisseur fait échouer le run avec un message clair, sans bascule vers la clé de l'organisation.
- **Quotas par défaut** : 4 runs simultanés par personne, 12 par organisation, 4 h max (prolongation jusqu'à 12 h), Pod 4 vCPU / 8 Gi. Plafond mensuel du pool de runs réglable par l'organisation (alerte à 80 %, refus des nouveaux runs au plafond). Sagax affiche ces refus tels quels.
- **Rétention** : conversation et logs 30 jours, audit 1 an, Pod supprimé 15 min après la fin, disque après 24 h. Une suite après 24 h repart d'un clone de la branche du run.
- **Portée par défaut** : Personnelle.

### 1.5 Composants

`src/components/code/` reprend le contrat des composants de la console Perspicax (même nom, mêmes props, même rendu) : `RunCard` (rangée et version compacte des cartes en conversation), `DiffView` (unifié ou côte à côte, contexte replié, Aperçu, virtualisé, texte seulement), `RunTimeline`, `StatCard`, `MiniBars`. Le contrat est dans la spec Perspicax, section 8.0.

## 2. Phases qui touchent Sagax

| Lot | Contenu | Taille |
|---|---|---|
| P1.3 | Provisionneur : ressource `run` | M |
| P1.4 | Image `sagax-run` et `sagax-runner` (Claude Code, Codex) | L |
| P1.7 | Fournisseur `perspicax`, modèle enrichi, section Code du bureau (liste, vue de run avec conversation, Changements, Fichiers en lecture, suite, carte en conversation) | L |
| P2.1 | Terminal en direct | M |
| P2.2 | Bureau VNC relayé | M |
| P2.3 | Section Code iOS | L |
| P2.5 | Moteurs ACP supplémentaires dans le runner | M |

Critère MVP : depuis le bureau, un run Claude Code ou Codex lancé dans une conversation tourne dans un Pod `run-<id>`, pousse une branche `px/...`, ouvre une PR brouillon, apparaît en direct dans Code et accepte une suite. Aucune poussée sur la branche par défaut n'est possible.

## 3. Règles

- Les noms de cette section restent neutres (aucun nom de client, d'organisation ni de personne dans les exemples).
- Aucune CI payante : le runner exécute les commandes de vérification de l'environnement dans son Pod.
- Une option = un seul endroit : réglages dans la console Perspicax, Sagax y renvoie.
