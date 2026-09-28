# Organisation collaborative

**Date:** 2026-09-28
**Branch:** `feat/org-channels`
**Status:** décisions approuvées 2026-09-28 (les 10 recommandations ci-dessous)
**S'appuie sur:** `docs/superpowers/specs/2026-09-27-org-channels-design.md`

## Goal

Rendre Pulsa Bot collaboratif de bout en bout, comme Buzz (block/buzz):

- On invite des personnes de l'organisation et des invités externes.
- On gère, membre par membre, quels bots ils utilisent ou éditent, et quelles automations ils voient.
- Tout propriétaire de bot peut le partager, pas seulement un admin.
- Les channels mêlent bots et vraies personnes, comme Discord ou Teams.
- En mode organisation, un serveur de coordination est obligatoire. Chacun s'y authentifie, et il sert de relais.
- Ce serveur peut servir de VM distante, si les droits le permettent.
- Les routines tournent sur ce serveur, avec les accès du propriétaire du bot, pour survivre à un poste client éteint.

## Background (état au 2026-09-28)

- Une personne est une chaîne: l'email, sinon `session.userId`, sinon `session.id` (`server/index.ts` `channelActorId`). L'opérateur local est `cfg.profile.email` ou la chaîne `"local-owner"`.
- La connexion par email passe par un control plane externe (OTP). Par défaut c'est `accounts.openmausbot.com`, celui d'OpenMausBot (`electron/companion-account-service.mjs`).
- Une organisation par serveur, dans `config.json` (`cfg.org`, `cfg.invites`). Les rôles viennent de la liste `cfg.signIn` (admins, members). Cette même liste donne le scope de session: un admin d'organisation est aussi admin complet du serveur.
- Une session créée par code d'appairage n'a ni email ni userId. `channelViewerId` la traite comme l'opérateur local: elle voit tous les channels. C'est un trou.
- Trois couches de visibilité se chevauchent: rôles, `humanIds` et `directGrants`, puis `bot.visibility` hérité d'OpenMausBot.
- Les routines tournent déjà dans le harness du serveur, avec des accès fournisseurs communs à tout le serveur. Elles n'ont pas de propriétaire.
- Les workers sont une ébauche: registre en mémoire, pas d'exécuteur.

## Decisions

| # | Question | Décision |
|---|---|---|
| 1 | Serveur obligatoire? | Oui. Une organisation a toujours une adresse de serveur. Un poste peut être ce serveur s'il est joignable (tunnel, Tailscale, domaine). |
| 2 | Qui gère les connexions? | Le serveur de coordination lui-même. Il émet les codes de connexion et les invitations, et les envoie par courriel via un fournisseur que l'admin configure sur le web: SMTP, ou l'API Twilio SendGrid. Plus de dépendance à `accounts.openmausbot.com` en mode organisation. (Révisé 2026-09-28: remplace le control plane du fork.) |
| 3 | Portée d'un invité? | Limité aux channels et bots qu'on lui donne. Expire après 30 jours. Ne crée ni bot ni Direct. |
| 4 | Les membres invitent-ils des externes? | Seulement si l'admin active l'option. Désactivé par défaut. Alors seulement dans les channels qu'ils modèrent. |
| 5 | Niveaux d'accès à un bot? | `use`, `run`, `edit`, `manage`. L'approbation reste au propriétaire, avec un délégué `approver` optionnel. |
| 6 | Garder `bot.visibility`? | Non. On le migre vers les droits, puis on le retire. |
| 7 | Accès par défaut sans clé fournie? | La clé API du propriétaire, chiffrée sur le serveur. Un abonnement (connexion Claude ou ChatGPT) seulement pour le travail que le propriétaire lance lui-même, jamais pour les tours d'autres personnes. |
| 8 | Isolation sur le serveur? | Un conteneur par propriétaire. |
| 9 | Garder les workers? | Plus tard. Le serveur exécute tout d'abord. |
| 10 | Qui utilise le serveur comme VM? | Sur autorisation de l'admin, membre par membre (`computer:use`). |

## Design

### Identité: le principal

Une personne devient un **principal** avec un id stable, `pr_<uuid>`. L'email n'est plus qu'un attribut.

| Champ | Rôle |
|---|---|
| `id` | `pr_<uuid>`, jamais réutilisé |
| `kind` | `human` ou `guest` |
| `email` | attribut, peut changer sans casser la propriété |
| `controlPlaneUserId` | id du compte chez le control plane, quand la personne s'est connectée par email |
| `local` | `true` pour l'opérateur de ce poste (remplace `"local-owner"`) |

- Une session porte `principalId`. La connexion par email résout le principal par `controlPlaneUserId`, puis par email, sinon le crée. Quand le serveur émet lui-même le code (décision 2), il n'y a pas de `controlPlaneUserId`: le principal est trouvé par email, et un changement d'email passe par l'admin ou par la personne connectée.
- Un code d'appairage garde le principal de celui qui l'a créé. Le téléphone du propriétaire reste le propriétaire.
- Une session sans principal ne voit aucun channel d'organisation.
- Au démarrage, une migration unique remplace les emails et `"local-owner"` stockés (propriétaire d'organisation, `humanIds`, `ownerUserId` des bots, `directGrants`) par des ids de principal. La liste `cfg.signIn` reste en emails: c'est la liste d'accueil pour la connexion.

### Rôles et droits

Rôles d'organisation (séparés du scope `admin` du serveur, tranche 2):

| Rôle | Réglages org | Inviter membres | Inviter invités | Créer channel | Créer bot | Serveur comme VM | Coffre de clés |
|---|---|---|---|---|---|---|---|
| owner | oui | oui | oui | oui | oui | oui | les siennes + org |
| admin | oui, sauf supprimer l'org | oui | oui | oui | oui | si la politique le permet | les siennes + org en lecture |
| member | non | non | si l'option est active | oui | oui | sur autorisation | les siennes |
| guest | non | non | non | non | non | non | aucune |

Droits par bot, donnés par son propriétaire à une personne ou un invité:

- `use`: lui parler, voir ses channels et ses fils.
- `run`: `use`, plus lancer ses routines.
- `edit`: `run`, plus modifier ses instructions, outils, modèle et skills.
- `manage`: `edit`, plus le partager et le supprimer.
- L'approbation reste au propriétaire, ou au délégué `approver`.

Par routine: `visibility` (`owner`, `bot-grantees`, `org`), `editors`, et `runAs` = propriétaire de la routine.

Channels: `private` ou `org-public`. `humanIds` devient `members[{ principalId, role: moderator | participant | readonly }]`.

Tout passe par une seule fonction `can(principal, action, resource)`. Elle sert au filtre SSE, à la liste des channels et à chaque route qui modifie.

### Serveur de coordination

- `pulsa serve` devient obligatoire pour une organisation. Il garde les principals, l'organisation, les channels, les transcripts, le planificateur et le coffre de clés.
- Les clients (bureau, web, téléphone) s'y branchent en HTTPS. Le harness local d'un poste reste pour les bots personnels, hors organisation.
- Tours et routines d'organisation s'exécutent sur le serveur, dans le conteneur du propriétaire du bot.

### Envoi de courriels

- Le serveur émet lui-même les codes à usage unique (OTP) de connexion et les liens d'invitation.
- Fournisseurs: `smtp` (hôte, port, TLS, utilisateur, mot de passe, adresse d'expédition) ou `sendgrid` (clé API Twilio SendGrid, adresse d'expédition). Un seul actif à la fois.
- Deux façons de configurer, au choix de l'opérateur:
  - **Docker:** variables d'environnement dans `.env` ou `compose.yaml`, lues au démarrage. `OMB_MAIL_PROVIDER` (`smtp` ou `sendgrid`), `OMB_MAIL_FROM`; pour SMTP `OMB_SMTP_HOST`, `OMB_SMTP_PORT`, `OMB_SMTP_SECURE` (`tls`, `starttls` ou `none`), `OMB_SMTP_USER`, `OMB_SMTP_PASSWORD`; pour SendGrid `OMB_SENDGRID_API_KEY`. Chaque secret accepte aussi une variante `_FILE` (chemin d'un Docker secret).
  - **Web:** les réglages du serveur, par un admin. Les secrets sont en écriture seule, comme les autres clés de l'app.
- Priorité: une valeur venue de l'environnement gagne. Le réglage web l'affiche en lecture seule, avec la mention « configuré par Docker ». Les champs absents de l'environnement restent modifiables sur le web.
- Un bouton « Envoyer un courriel de test » valide la configuration, d'où qu'elle vienne.
- `.env.example` liste ces variables, vides, avec un commentaire.
- Sans fournisseur configuré: pas de connexion par courriel ni d'invitation par courriel. L'appairage par code reste possible.
- Code: 8 chiffres, valide 10 minutes, 5 essais au plus, limité par adresse et par source.

### Serveur géré par le web

Tout se gère dans l'interface web du serveur de coordination, jamais par `docker compose exec`:

- **Premier admin:** au tout premier démarrage (aucune session, aucune liste de connexion), le serveur écrit dans son journal un code d'appairage à usage unique, lisible dans Docker Desktop. On ouvre l'adresse, on entre le code, on devient owner. Jamais « le premier arrivé est admin ».
- **Connexions des fournisseurs** (Claude, ChatGPT, clés API): les écrans existants (Réglages, Engines et Connections).
- **Envoi de courriels:** la section ci-dessus.
- **Redémarrer le serveur:** un bouton admin. Le processus s'arrête proprement et Docker le relance (`restart: unless-stopped`).
- **Journal du serveur:** les dernières lignes du processus (démarrage, erreurs), dans les réglages, pour un admin.
- **Mise à jour de l'image:** reste côté hôte (`docker compose up -d --build`). Donner au conteneur l'accès au socket Docker serait un risque trop grand.

### Accès pour les tâches du propriétaire

Ordre de résolution: clé de la routine, puis `credentialRef` du bot, puis clé par défaut du propriétaire, puis clé d'organisation si l'admin l'autorise. Les clés sont chiffrées au repos et injectées seulement dans le conteneur du propriétaire.

## Pannes et refus

- Serveur injoignable: pas de compositeur dans les channels d'organisation. L'app dit que l'organisation est hors ligne.
- Session sans principal (vieux code d'appairage): elle ne voit aucun channel d'organisation. Elle garde les bots personnels de ce poste.
- Email changé chez le control plane: même principal, retrouvé par `controlPlaneUserId`. La propriété ne bouge pas.
- Principal inconnu dans un id stocké après migration: traité comme personne, jamais comme l'opérateur local.
- Invité expiré: sa session est refusée, ses droits restent listés pour l'historique.

## Delivery slices

Chaque tranche se livre seule. La suivante attend que les tests de la précédente passent.

1. **Identité.** Principals, `principalId` sur les sessions, appairage lié au principal qui l'a créé, migration des ids stockés, fermeture du trou des sessions sans email, adresse de serveur obligatoire pour une organisation.
1b. **Serveur géré par le web.** Premier admin par code dans le journal, envoi de courriels (SMTP ou SendGrid) configuré sur le web avec OTP émis par le serveur, bouton de redémarrage, visionneuse du journal, README Docker réécrit autour du web.
2. **Moteur de droits.** `can()`, rôle d'organisation séparé du scope admin du serveur, création de bot par un membre, journal d'audit.
3. **Invitations complètes.** Lien et courriel, écran d'acceptation, rôle invité.
4. **Partage de bot** par niveaux, par tout propriétaire, avec révocation.
5. **Droits des routines.** Propriétaire, visibilité, éditeurs, `runAs`.
6. **Coffre de clés et conteneur par propriétaire.**
7. **Serveur comme VM**, derrière `computer:use`.
8. **Finition des channels.** Privé ou public, rôles de channel, mentions, présence.
9. **Optionnel:** exécuteur de workers.

## Out of scope

- Copier un bot sur le disque d'un invité.
- Faire répondre l'abonnement Claude ou ChatGPT d'une personne aux messages des autres.
- Le control plane Cloudflare du fork: remplacé par l'envoi de courriels du serveur (décision 2 révisée).
