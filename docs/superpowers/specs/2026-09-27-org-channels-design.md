# Organisation, canaux et bots partagés

**Date:** 2026-09-27
**Branch:** `main` at `4f48957`
**Status:** approved 2026-09-27

## Goal

Jean-Christophe invite Zachary dans sa flotte. Zachary parle aux bots qu'on lui a ouverts, dans des canaux. Chacun possède ses bots et choisit où ils tournent. L'approbation reste au propriétaire du bot, sur la machine qui exécute le tour.

Succès: Zachary accepte une invitation, voit seulement ses canaux et sa zone Direct, fait travailler un bot posé dans un canal, et ne peut ni approuver à la place du propriétaire, ni voir les bots qu'on ne lui a pas ouverts.

## Background

Aujourd'hui l'app est un poste, une personne.

- Un canal est un `Group`. `memberIds` liste des bots. Le seul humain est la personne devant l'app.
- Les fils 1:1 d'un bot sont ses `tasks`. Les canaux bot à bot sont des groupes `dm`.
- Le tour d'un canal tient un verrou (`busyBotId`). Les approbations sont des cartes déjà livrées à la session locale.
- L'écran Organization est une connexion à un contrôle d'entreprise (modèles, licence, image). Ce n'est pas un annuaire.
- Un client distant existe déjà (téléphone, `remoteClient`). Il agit comme l'opérateur, sans nom de membre.

## Decisions

| Question | Decision |
|---|---|
| Où un tour part-il? | Sur l'hôte configuré. Le poste, s'il est le serveur de la flotte. Sinon le serveur. Jamais une copie installée chez l'invité. |
| Que veut dire « son bot »? | Le bot a un propriétaire. Le propriétaire choisit l'hôte: `fleet`, ou la machine enregistrée d'un membre. |
| Que peut faire un membre du canal? | Parler au bot et le faire travailler. L'approbation reste au propriétaire, sur la machine qui exécute. |
| La colonne de gauche? | Navigation type Discord. Organisation, canaux, zone Direct. |
| Quelle forme? | Étendre les canaux actuels. L'hôte de la flotte garde l'organisation, les gens, les canaux et les transcripts. Une machine personnelle s'enregistre comme worker. |
| L'écran Organization actuel? | Il reste une carte à part (connexion entreprise). Le nouvel écran crée l'organisation et gère ses gens. |

## Design

### Objets

Un canal reste un `Group`. `memberIds` reste la liste des bots. Les humains vivent à côté, dans `humanIds`. On ne mélange pas les deux listes. Les groupes `dm` (bot à bot) ne gagnent pas d'humains.

| Objet | Rôle |
|---|---|
| Organisation | Nom, hôte (`this-computer` ou une adresse de serveur), membres |
| Membre | `userId`, rôle `owner`, `admin` ou `member` |
| Bot | Gagne `ownerUserId` et `host`. `host` vaut `fleet` ou `{ kind: "machine", userId, deviceId }` |
| Canal | `humanIds` + `memberIds`. Y poser un bot est le partage |
| Accord direct | Le propriétaire ouvre un 1:1 à une personne. Elle le voit dans Direct, sans siège dans un canal |

Visibilité:

- Un membre voit les canaux dont l'`userId` est dans `humanIds`.
- Il voit dans Direct ses propres bots, et les bots pour lesquels il a un accord direct.
- Le bot d'un autre n'apparaît pas ailleurs.

Approbation:

- La carte existante est livrée à la session du propriétaire, sur la machine qui exécute le tour.
- Les autres membres voient que le bot attend son propriétaire. Ils n'ont pas le bouton.
- Être dans le canal ne donne pas les fichiers, ni l'ordinateur, ni les clés du propriétaire.

### Navigation

La colonne de gauche cesse d'être une liste de bots.

- En haut, le nom de l'organisation. Le menu crée l'organisation, invite, et ouvre les rôles. L'hôte (ce poste ou le serveur) est un état dans ces réglages, pas un second arbre.
- Ensuite, les canaux. Une rangée montre le nom et l'aperçu du dernier message. Cliquer ouvre le transcript de groupe déjà là. Le panneau du canal liste les gens et les bots.
- Ajouter un bot que l'on possède l'écrit dans `memberIds`. Ajouter une personne l'écrit dans `humanIds`.
- Sous les canaux, la zone Direct: fils 1:1 des bots que l'on possède, plus les accords directs reçus.
- Le bas de la colonne est la ligne de profil. Elle ouvre la gestion de l'organisation: membres, invitations en attente, rôles. La connexion entreprise reste une carte séparée dans ce même écran.

Droits:

- `member`: voit ses canaux et Direct. Crée ses bots. Ne pose que ses propres bots. Peut quitter un canal.
- `admin`: invite, crée des canaux, y ajoute et en retire des gens, supprime un canal.
- `owner`: mêmes droits qu'un admin, plus retirer des admins et supprimer l'organisation. Il n'en existe qu'un, la personne qui a créé l'organisation sur l'hôte.
- Seul le propriétaire d'un bot le pose dans un canal ou l'ouvre en 1:1. Un admin ne le fait pas à sa place.

### Parcours

Créer l'organisation se fait sur l'hôte de la flotte. Le créateur devient `owner`. L'hôte enregistré est ce poste, ou l'adresse du serveur déjà configurée.

Inviter produit un lien à usage unique, révocable, valable 7 jours. Zachary ouvre l'app, accepte, et devient `member`. Son client se branche sur l'hôte comme le client distant d'aujourd'hui, avec son `userId`. Il ne reçoit pas une copie des bots.

Il crée ses bots. Tant qu'il ne les partage pas, ils restent dans sa zone Direct. L'hôte se choisit à la création et se change ensuite, par le propriétaire seulement. Avant la tranche Workers, ce choix n'existe pas: tout bot est `fleet`. `fleet` exécute sur l'hôte de l'organisation. `machine` exige que cette machine soit enregistrée comme worker auprès de l'hôte. Le transcript d'un canal est toujours écrit sur l'hôte de la flotte, même si le tour tourne sur un worker.

Poser un bot dans un canal l'ajoute à `memberIds`. Les humains du canal lui parlent et le font travailler. Le tour part vers le worker enregistré. Les événements reviennent à l'hôte, qui les écrit dans le canal.

Une approbation ouvre la carte existante chez le propriétaire, sur la machine qui exécute. Les autres voient l'attente.

Un accord direct suit la même route d'exécution et d'approbation. La personne le voit dans Direct.

### Pannes et refus

L'hôte de la flotte est injoignable. Les canaux et la zone Direct de l'organisation n'ouvrent pas de compositeur. L'app dit que l'organisation est hors ligne. Les bots créés avant l'organisation, qui ne lui appartiennent pas, restent utilisables sur la machine où ils tournent.

Le worker d'un bot est éteint. Le message est écrit dans le canal. Le tour ne démarre pas et ne bascule pas sur l'hôte. La rangée dit que la machine est hors ligne. Le message reste en file jusqu'au retour du worker, ou jusqu'à l'annulation par l'auteur.

Le propriétaire est absent au moment d'une approbation. Le tour reste en attente sur la carte actuelle. Le canal nomme la personne attendue. Rien ne s'approuve seul. L'auteur peut annuler.

Le worker coupe pendant un tour. Le tour s'arrête et le canal le marque échoué. Le texte déjà écrit reste. Rien n'est marqué approuvé sans un geste du propriétaire.

Une invitation expirée, déjà utilisée ou révoquée dit lequel des trois états. Seul un admin, ou l'owner, en émet une nouvelle. Une personne déjà membre retrouve l'organisation, sans deuxième adhésion.

Un member retiré d'un canal, ou un bot retiré d'un canal, voit son geste en cours refusé. L'historique reste. Le compositeur de la personne retirée se ferme. Ajouter le bot d'un autre, ou approuver à sa place, n'a pas de contrôle. L'appel d'API correspondant répond par un refus.

Deux messages vers le même bot dans un canal gardent le verrou actuel: un tour à la fois, le suivant attend.

### Tests

Les règles sont des fonctions pures, sans interface:

- visibilité d'un canal et d'un bot dans Direct
- droit de poser un bot (`ownerUserId` seulement)
- destination d'un tour (`fleet` ou worker)
- destinataire de la carte d'approbation (session du propriétaire sur la machine qui exécute)
- worker éteint: message en file, pas de repli vers l'hôte

Le serveur se teste avec un faux worker, sur le modèle du faux engine déjà là.

- Créer l'organisation fixe l'owner.
- Invitation expirée, utilisée ou révoquée: refus. Membre déjà là: retour à l'organisation, une seule adhésion.
- Poser un bot écrit dans `memberIds`. Le transcript reste sur l'hôte pendant que le faux worker exécute.
- La carte d'approbation n'est livrée qu'à la session du propriétaire.
- Deux messages vers le même bot: le second attend.

Trois échecs sont des tests de serveur:

- Le worker coupe au milieu du tour: canal marqué échoué, texte conservé, rien d'approuvé.
- Retirer un member ou un bot annule le geste en cours et garde l'historique.
- Hôte injoignable: le compositeur de l'organisation ne s'ouvre pas.

L'interface a trois rendus:

- colonne avec canaux et Direct
- écran d'organisation vide, puis avec des membres
- état « en attente du propriétaire », sans bouton Approuver

## Delivery slices

Une spec, trois tranches. Chaque tranche est livrable seule. La suivante ne commence pas tant que les tests de la précédente passent. Jusqu'à la tranche 3, tout bot a `host: fleet`. Le choix d'une machine personnelle apparaît avec l'enregistrement des workers.

1. **Annuaire.** Organisation, rôles, invitation, visibilité. Les bots restent sur l'hôte comme aujourd'hui. Pas de worker.
2. **Canaux humains.** `humanIds`, partage par `memberIds`, accords directs, colonne Discord, écran d'organisation.
3. **Workers.** Enregistrement de machine, routage du tour, carte d'approbation épinglée au propriétaire, file si le worker est éteint, échec si le worker coupe.

## Out of scope

- Copier un bot sur le disque d'un invité.
- Laisser un member du canal approuver.
- Exécuter sur l'hôte un tour dont l'hôte choisi est une machine éteinte.
- Remplacer ou fusionner la connexion entreprise (modèles, licence).
- Changer les canaux bot à bot (`dm`).
- Redessiner le panneau Computer.
