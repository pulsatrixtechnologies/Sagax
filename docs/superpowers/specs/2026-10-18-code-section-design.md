# Section « Code » : les agents cloud de Perspicax dans Sagax

Date : 2026-10-18. Statut : ébauche, résumé côté Sagax. La spec complète (modèle, sécurité, API, phases, décisions) vit dans le dépôt Perspicax : `docs/superpowers/specs/2026-10-18-cloud-agents-design.md`.

## 0. Orientation

Perspicax devient le plan de contrôle d'agents de code cloud : environnements (dépôts, image, setup, secrets, réseau, portée), runs (tâche, moteur, modèle, branche, état, durée, coût), artefacts (diff, commits, PR, terminal, bureau, fichiers) et automatisations. Un run tourne dans son propre Pod du cluster de sandboxes, jamais dans le sandbox personnel. Sagax est un client : il lance, suit, relance et arrête ; les réglages (environnements, intégrations Git, automatisations) restent dans la console Perspicax.

## 1. Ce que Sagax change

### 1.1 Serveur

- `shared/cloud-agents.ts` : nouveau fournisseur `perspicax` dans `CLOUD_AGENT_PROVIDERS`. `CloudAgentRecord` gagne `stats` (fichiers, `+lignes`, `-lignes`, commits), `pr` (numéro, URL, état draft/open/merged/closed), `unread`, `envId`, `origin` ; `botId` et `threadId` deviennent optionnels (runs lancés hors Sagax). `CloudAgentStatus` gagne `queued`, `waiting_for_approval`, `expired`.
- `server/cloud-agents/providers/perspicax.ts` : appelle `/api/agents/v1` de Perspicax avec le jeton OAuth de la personne ; aucune clé à coller. Remplace, pour Claude Code et Codex, les fournisseurs `claude` (chemin d'API non confirmé) et `codex` (refuse tout appel).
- Direct : abonnement au flux SSE de Perspicax, relayé sur l'événement SSE existant `cloud.agent` ; notification push à la fin et à chaque demande d'approbation.
- Provisionneur (`server/sandboxd-k8s*.ts`) : nouvelle ressource `run` (Pod `run-<id>`, PVC `run-<id>-ws`, NetworkPolicy `run-<id>-net`, TTL dur, balayage des orphelins, ResourceQuota séparée, pool de nœuds dédié). Appelée par Perspicax seulement, avec la clé existante.
- Runner (`sagax-runner`) : point d'entrée du paquet serveur qui réutilise les pilotes (`server/drivers/claude.ts`, `codex.ts`, puis ACP) en mode sans tête, dans l'image `sagax-run` (base `sagax-sandbox` + CLI figées par `engines.lock.json`). Connexion sortante seulement, garde Git (`pre-push` limité à `px/*`), masquage des secrets.

### 1.2 Bureau

- Entrée **Code** dans la barre latérale, au niveau des conversations. Elle liste tous les runs de la personne, quel que soit le bot ou l'origine (console, automatisation, client MCP). Aujourd'hui les agents cloud ne vivent que dans l'activité de chaque bot.
- **Liste** : en tête, sélecteur d'environnement (« Partir de zéro ⌄ »), composer de lancement, moteur et modèle, micro et voix, puces. Rangée : carte gauche (`N fichiers`, `+X`, `-Y`, pastille Fusionnée / Brouillon / PR ouverte / Branche / En cours / En attente / Échec), puis titre, point de non-lu, état de PR, modèle, dépôt, âge.
- **Vue d'un run** : à gauche la conversation (tâche, « A travaillé 8 min », messages, outils repliés, approbations en ligne, lien de PR), alertes d'environnement avec « Voir les détails », composer **« Ajouter une suite »** (queue, steer, interrupt) ; à droite un panneau à onglets **Changements** | **Bureau** | **Terminal** | **Fichiers** | `+`. Changements : en-tête de PR (état, `branche -> main`, « Voir la PR »), sous-onglets **Diff** | **Revue** | **Commits**, diff par fichier repliable avec **Aperçu**. Panneau redimensionnable, plein écran, repliable.
- **Conversation** : carte « Agents cloud (N) » sous le message du bot qui a lancé, rangées compactes, bouton Ouvrir (dans Sagax), menu Arrêter / Copier le lien de PR / Ouvrir la PR.
- **Lancement depuis un fil** : « lance un agent cloud sur le dépôt X » -> outil `launch_cloud_agent` (fournisseur `perspicax`, environnement trouvé par dépôt, question si plusieurs). Gate existante des outils d'écriture. Le bot est réveillé à la fin (`completionNotified`).
- Un fil confidentiel n'envoie que le prompt montré à la personne ; le run, lui, n'est pas confidentiel (il produit une PR), et l'UI le dit.

### 1.3 iOS (phase 2)

Onglet **Code** : même liste ; vue de run plein écran avec segments Conversation / Changements / Terminal / Fichiers ; suite ; push à la fin et sur approbation. Bureau en lecture plus tard.

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
