# Réunions avec preneur de notes, mise à jour planifiée et économiseur de disque

Date : 2026-10-16. Responsable : JC. Statut : vague 2 de la parité Grok Bot,
paquet D. Deux PR, une par élément. La pause des routines pendant l'absence
est déjà livrée (#609) et n'est pas reprise ici.

Référence fonctionnelle : l'application de bureau Grok Bot (chaînes « Donne à
ton Bot des liens pour rejoindre Google Meet ou Zoom », « Je vous ai envoyé
une carte de consentement ci-dessous », « Économiseur de disque », « Échec de
la mise à jour de l'ordinateur »). Aucun code n'en est repris.

## 1. Le bot rejoint une réunion et prend des notes

Statut : implanté dans `feat/meeting-notetaker` pour Google Meet, derrière un
réglage **expérimental désactivé par défaut** (Réglages > Fonctions
expérimentales > Preneur de notes en réunion (Google Meet), config
`features.meetingNotetaker`). Validation sur une vraie réunion à faire par
JC avant de l'activer.

Le serveur applique ce réglage : désactivé, l'outil `join_meeting` n'est pas
offert aux bots (`SAGAX_MEETINGS`), et la route interne, `/api/meetings/*` et
la réponse à une carte déjà publiée refusent (403, `meetings_disabled`,
« The meeting notetaker is off. Turn it on in Settings > Experimental. »).
Le désactiver, ou désactiver le navigateur intégré, fait quitter toute
réunion en cours.

### Ce que la personne voit

1. Elle colle un lien Google Meet, Zoom ou Teams dans une conversation
   directe avec le bot, ou un événement de calendrier en porte un (une
   routine ou un déclencheur typé Outlook Calendar, `event.starting`, fait
   travailler le bot, qui voit le lien).
2. Le bot appelle l'outil `join_meeting` (catalogue `agents`, capacité
   `meetings:join`). Le serveur publie une **carte de consentement** dans le
   fil (`card.meetingRequest`, `server/meetings/meeting-requests.ts`) : lien,
   plateforme, nom affiché (« <bot> (transcription) »), et le rappel que la
   personne est responsable d'obtenir le consentement de chaque participant
   et que l'audio est transcrit par xAI, hors du Québec. Rien ne rejoint avant le clic.
   La carte ne s'applique **jamais** toute seule : aucun chemin d'accès
   complet ni de règle « toujours permettre » ne la lit, un appel Live la
   refuse (`liveCardKind` = `review`), le stepper d'approbations du
   compositeur ne la montre pas, la console Perspicax et `sagax_approve` ne
   peuvent pas y répondre (`approvalTypeOf` = `other`), et seule la personne qui peut répondre à
   une approbation du bot (son propriétaire) y répond. Chaque réunion
   demande son propre clic.
3. Approuvée, la carte devient la carte de la réunion en direct
   (`src/components/MeetingCard.tsx`) : état (connexion, salle d'attente,
   annonce, prise de notes, terminée, échec), dernières lignes de la
   transcription, bouton Quitter la réunion (`POST /api/meetings/leave`).
4. À la fin, le bot reçoit un tour avec la transcription et publie dans le
   fil un résumé, les actions à mener et les questions ouvertes.

Depuis une salle (room), l'outil refuse : une salle n'a pas une seule
personne pour consentir.

### Comment

- **Un navigateur à lui, pas un service tiers.** Chaque réunion ouvre une
  session privée du moteur de navigateur intégré (`meeting-<id>`, invité :
  aucune connexion enregistrée, rien de restauré, rien de gardé), distincte
  du navigateur que le bot utilise dans ses tours. Le serveur la pilote par
  `BrowserRuntime.harnessCall` (pas de mise en forme des résultats, pour
  recevoir un segment audio entier). Il ouvre le lien avec la lecture
  automatique de l'audio permise, choisit « continuer sans micro ni
  caméra », coupe micro et caméra, tape le nom « <bot> (transcription) » et clique
  « Demander à participer » par un vrai clic.
- **Consentement d'abord, enregistrement ensuite.** Une fois admis, le bot
  publie une annonce bilingue dans le clavardage de la réunion (« <bot>
  (transcription) prend des notes pour <personne>. L'audio est transcrit
  par un fournisseur externe (xAI), hors du Québec ; l'audio n'est pas
  gardé, le texte reste dans la conversation de <personne> pour les notes.
  Écrivez « stop » ici et je quitte. ») et vérifie qu'elle apparaît dans
  l'historique. L'enregistrement ne commence qu'après. Si l'annonce ne peut
  pas être publiée et vue, ou si le clavardage ne peut pas être lu, le bot
  quitte sans rien enregistrer (échec fermé, Loi 25). L'annonce est publiée
  de nouveau quand quelqu'un arrive (nombre de participants en hausse) et
  au moins toutes les 10 minutes ; si elle ne passe plus, le bot cesse de
  prendre des notes et quitte.
- **Objection.** À chaque relevé (3 s), le bot lit les nouvelles lignes du
  clavardage (pas les siennes, reconnues par égalité exacte avec ce qu'il a
  publié et par son propre nom d'auteur ; une citation partielle de
  l'annonce par un participant compte). Les lignes écrites pendant une
  annonce ou une réannonce comptent aussi. Une ligne qui le nomme, qui dit
  non, ou qui contient stop, arrête, quitte, leave, je refuse, I object,
  non merci, no thanks, pas de notes, opt out, pas d'accord, not ok,
  enregistrement, transcription, bot, consentement, etc. (dans le doute, il
  part) le fait quitter tout de suite : il arrête l'enregistrement, jette
  l'audio pas encore transcrit, écrit « Je quitte. / Leaving. ». Rien de
  cette réunion n'est gardé (Loi 25, choix prudent) : pas de résumé, la
  transcription en mémoire est jetée, la carte n'affiche plus de lignes et
  dit « Quitté à la demande d'un participant : rien n'a été conservé ».
  Après une fin normale, les dernières lignes quittent la carte quand le
  tour de résumé est demandé.
- **Page muette.** Trois relevés de suite sans état lisible de la page ou du
  clavardage comptent comme la fin de la réunion (jamais d'enregistrement à
  l'aveugle).
- **Limites.** Une réunion à la fois par bot, réservée avant toute attente
  (deux clics ne lancent pas deux réunions) ; au plus 2 navigateurs de
  réunion à la fois sur le serveur. Un refus reste affiché sur la carte.
- **Transcription.** Un script injecté avant l'entrée enveloppe
  `RTCPeerConnection` et recueille les pistes audio distantes ; à
  l'annonce faite, il les mélange (Web Audio) et produit des segments
  `audio/webm` autonomes de 30 secondes (MediaRecorder relancé à chaque
  segment). Le serveur les relève par `agent_browser_eval` toutes les
  10 secondes (rien ne sort de la page par le réseau) et les transcrit avec
  la transcription du mode Voix (xAI STT : la clé de la personne qui a
  approuvé, sinon celle du serveur ; même registre d'usage, `grok-stt`).
  Sans clé, la carte reste ouverte et dit d'en ajouter une.
- **Rétention.** Aucun fichier d'audio ni de transcription : l'audio ne
  quitte la page que pour la transcription, le texte reste en mémoire le
  temps de la réunion, puis entre dans le tour de résumé du bot et y reste
  comme tout tour de la conversation (supprimé avec elle). Seul
  `DATA_DIR/meetings/live.json` (0600) garde les identifiants des réunions
  en cours, pour fermer leurs cartes après un redémarrage.
- **Fin.** La personne clique Quitter, la réunion se termine, un hôte
  retire le bot, ou la durée maximale (3 h) est atteinte ; personne ne
  l'admet en 10 minutes : échec. Le serveur arrête l'enregistrement, relève
  les derniers segments, clique Quitter dans la réunion et ferme le
  navigateur. Le tour de résumé reçoit la transcription derrière une
  clôture de données non fiables (`wrapUntrusted`), avec la consigne de ne
  suivre aucune instruction dite en réunion et de ne rien faire d'autre
  que les notes.
- **Redémarrage.** Les réunions en cours sont notées dans
  `DATA_DIR/meetings/live.json` ; au démarrage, leurs cartes passent à
  « échec : le serveur s'est arrêté pendant la réunion ». À l'arrêt, le
  serveur demande à chaque réunion de quitter.

### Livré d'abord, documenté ensuite

- Livré : Google Meet en invité (salle d'attente comprise), transcription
  en direct, résumé et actions.
- Zoom et Teams : les liens sont reconnus (liste d'hôtes stricte,
  `shared/meeting-links.ts`) et la carte dit « pas encore pris en charge »
  sans offrir de rejoindre. Le client web de Zoom (`/wc/join/`) et celui de
  Teams (« Continuer sur ce navigateur ») se brancheraient sur le même
  `MeetingSession` avec leurs propres scripts, après validation sur Meet.
- Risques connus, à valider en direct :
  - Google peut refuser un Chrome sans tête comme invité ; le pilote le
    détecte (« You can't join this video call ») et le dit. Sagax ne
    déguise pas son navigateur pour contourner ce refus.
  - Les libellés de Meet (boutons, clavardage) sont lus en anglais et en
    français ; un changement d'interface de Google fait échouer l'annonce,
    donc rien n'est enregistré (échec fermé), jamais l'inverse.
  - Pas de nom de locuteur : la transcription est un seul flux mélangé.

## 2. Ordinateur du bot : mise à jour planifiée et économiseur de disque

Les deux vivent dans Réglages > Ordinateur, pour l'ordinateur que la
personne gère : son environnement serveur sur un serveur d'organisation, la
Local VM de cet ordinateur sur un serveur personnel (mêmes cibles que
`/api/computer/status`, `server/routes/computer-status.ts`).

### Mise à jour planifiée

- Réglage : activé ou non, jours de la semaine, heure de début, durée de la
  fenêtre (1 à 6 h), dans le fuseau du serveur.
- Mettre à jour = l'action « update » existante : sur une organisation,
  reconstruire l'environnement à partir de l'image courante en gardant
  `/workspace` ; en local, tirer l'image courante puis recréer le conteneur
  quand l'image a changé (le dossier de travail reste). Les paquets du
  système viennent de l'image : mettre l'image à jour, c'est mettre les
  paquets à jour.
- Jamais pendant un travail : si une commande ou un tour utilise
  l'ordinateur, la mise à jour attend dans la fenêtre ; la fenêtre passée,
  elle est reportée et le résultat le dit (« Reportée : l'ordinateur était
  occupé »).
- Une seule par fenêtre. Le dernier résultat (heure, succès ou échec, raison)
  s'affiche sous le réglage.

### Économiseur de disque

- **Aperçu d'abord.** « Analyser » mesure des catégories connues et affiche
  ce qui serait libéré, catégorie par catégorie. Rien n'est supprimé à
  l'analyse.
- Catégories dans l'ordinateur du bot : caches de paquets (apt, pip, npm,
  pnpm, yarn), cache du navigateur, vignettes, fichiers temporaires de plus
  d'un jour. Sur un serveur personnel, en plus : les points de reprise
  (checkpoints) de plus de 30 jours et les anciennes images de la Local VM.
- **Fichiers de la personne : jamais sans confirmation.** La corbeille de
  l'ordinateur du bot est la seule catégorie qui touche des fichiers de la
  personne ; elle est décochée par défaut et demande une confirmation
  explicite. `/workspace` et le dossier de travail ne sont jamais touchés.
- Les chemins sont fixés par le serveur ; aucune entrée de la personne ou du
  modèle n'atteint la commande de nettoyage. Chaque nettoyage est journalisé.

## 3. Vérification

`pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, vitest ciblé
(`--testTimeout=120000`) sur les nouveaux modules et routes.
