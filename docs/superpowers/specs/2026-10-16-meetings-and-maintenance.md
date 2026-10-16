# Réunions avec preneur de notes, mise à jour planifiée et économiseur de disque

Date : 2026-10-16. Responsable : JC. Statut : vague 2 de la parité Grok Bot,
paquet D. Deux PR, une par élément. La pause des routines pendant l'absence
est déjà livrée (#609) et n'est pas reprise ici.

Référence fonctionnelle : l'application de bureau Grok Bot (chaînes « Donne à
ton Bot des liens pour rejoindre Google Meet ou Zoom », « Je vous ai envoyé
une carte de consentement ci-dessous », « Économiseur de disque », « Échec de
la mise à jour de l'ordinateur »). Aucun code n'en est repris.

## 1. Le bot rejoint une réunion et prend des notes

### Ce que la personne voit

1. Elle colle un lien Google Meet, Zoom ou Teams dans une conversation, ou un
   événement de calendrier en porte un (déclencheur typé Outlook Calendar,
   `event.starting`, ou rappel de calendrier interne).
2. Le bot appelle l'outil `join_meeting` (catalogue `agents`). Le serveur
   publie une **carte de consentement** dans le fil : lien, plateforme, nom
   affiché (« <bot> (notes) »), rappel « Prévenez les autres participants
   avant d'ajouter le bot ». La carte ne s'applique **jamais** toute seule :
   ni l'accès complet, ni une règle « toujours permettre » ne la passent.
   Chaque réunion demande son propre clic.
3. Approuvée, la carte devient une carte de réunion en direct : état
   (connexion, salle d'attente, en réunion, terminée, échec), transcription
   qui défile, bouton Quitter.
4. À la fin, le bot publie dans le fil un résumé et des actions à mener,
   produits par son propre moteur à partir de la transcription.

### Comment

- **L'ordinateur du bot, pas un service tiers.** Le navigateur intégré du
  bot (`server/browser-runtime.ts`, agent-browser) ouvre le lien, remplit le
  nom « <bot> (notes) », coupe micro et caméra, et demande à entrer. Aucun
  service externe de bot de réunion, aucune clé de plus.
- **Consentement d'abord, enregistrement ensuite.** Une fois admis, le bot
  publie une annonce dans le clavardage de la réunion (« <bot> (notes)
  prend des notes pour <personne>. Dites-le si vous préférez que je
  quitte. »). L'enregistrement ne commence qu'après cette annonce. Si elle
  échoue, le bot n'enregistre rien et quitte (échec fermé, Loi 25).
- **Transcription.** Un script injecté dans la page avant l'entrée récupère
  les pistes audio distantes (WebRTC), les mélange (Web Audio) et en fait des
  segments `audio/webm` de 30 secondes (MediaRecorder). Le serveur les relève
  par `agent_browser_eval` (rien ne sort de la page par le réseau) et les
  transcrit avec la transcription existante (xAI STT, la même clé et le même
  registre d'usage que le mode Voix). L'audio n'est jamais conservé ; seul le
  texte l'est, dans `DATA_DIR/meetings/<id>.json` (0600).
- **Fin.** La personne clique Quitter, la réunion se termine (page « Vous
  avez quitté »), ou la durée maximale (3 h) est atteinte. Le serveur ferme
  l'onglet et lance un tour du bot avec la transcription, balisée comme
  donnée non fiable, et la consigne de produire résumé et actions.

### Livré d'abord, documenté ensuite

- Livré : Google Meet (invité, salle d'attente), transcription en direct,
  résumé et actions.
- Zoom et Teams : les liens sont reconnus et la carte le dit ; le client web
  de Zoom (`/wc/join/`) et de Teams (« Continuer sur ce navigateur ») suivent
  le même pilote, à brancher après validation sur Meet.
- Risque connu : Google peut refuser un Chrome sans tête comme invité. Le
  pilote le détecte (« Vous ne pouvez pas rejoindre cet appel ») et le dit
  dans le fil. Validation en direct à faire par JC.

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
