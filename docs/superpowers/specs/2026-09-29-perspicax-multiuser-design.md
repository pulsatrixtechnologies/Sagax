# Pulsa Bot multi-utilisateur par Perspicax

**Date:** 2026-09-29
**Branch:** `develop` (Pulsa Bot, `9c70b9c`), Perspicax `main` à `66c930d` (tag `v1.6.0`)
**Status:** proposition, à approuver par JC
**Remplace:** les décisions 1 et 2 (serveur quelconque, courriels émis par Pulsa Bot) et la tranche 1b de `2026-09-28-collaborative-org-design.md`, ainsi que le système intérim d'invitations et de codes par courriel.
**Garde:** les décisions 3 à 10 de ce même document (rôles, niveaux `use`/`run`/`edit`/`manage`, routines avec l'accès du propriétaire, conteneur par propriétaire, serveur comme VM derrière `computer:use`), réécrites ici avec l'identité et les équipes venant de Perspicax.

## 1. But, non-buts, les deux modes

### But

Une seule façon d'être plusieurs dans Pulsa Bot: le serveur privé Pulsatrix Perspicax. Perspicax est le fournisseur d'identité (comptes OAuth 2.1, mot de passe plus TOTP ou passkey, utilisateurs, équipes, comptes de service), il configure le MCP de chaque personne (`/mcp?profile=<slug>`) et il héberge une section « Pulsa Bot » dans sa console. Pulsa Bot continue d'exécuter les bots: engines CLI, ordinateurs, transcripts, routines.

Succès de la première tranche: JC ouvre `https://bot.<domaine>`, clique « Se connecter avec Perspicax », entre son mot de passe et son TOTP sur la page de Perspicax, revient connecté dans Pulsa Bot comme un principal stable, avec le rôle déduit de son rôle Perspicax.

### Non-buts

- Pas de fédération externe (Entra, Google) dans Perspicax: il reste le seul IdP de l'organisation. Pulsa Bot, lui, parle OIDC standard et accepterait un autre IdP, sans que ce soit testé ni promis.
- Pas de multi-utilisateur sans Perspicax. Un `pulsa serve` sans IdP est solo: une personne, ses appareils.
- Pas de courriel d'identité émis par Pulsa Bot en mode organisation.
- Pas de PR, d'issue ni de push vers OpenMausBot. Tout reste chez `pulsatrixtechnologies`.
- Pas de console Pulsa Bot dupliquée: la console Perspicax gère l'organisation, l'app Pulsa Bot gère les bots.

### Les deux modes

Le mode appartient à un **serveur** Pulsa Bot, pas à l'installation.

| | Solo | Organisation |
|---|---|---|
| Serveur de coordination | aucun: le harness local de l'app, ou un `pulsa serve` personnel | le `pulsa serve` de la compose Perspicax |
| Identité | l'opérateur local (`principals.ts`, `local: true`) | le compte Perspicax (`iss` + `sub`) |
| Appareils supplémentaires | codes d'appairage (`sessions.ts`, `openPairing`) | codes d'appairage liés au principal qui les crée, ou connexion OIDC native |
| Onboarding | garde l'étape « passer » (`src/components/onboarding/WelcomeFlow.tsx`) | l'étape Organisation propose « Rejoindre un serveur Perspicax » |
| Réglage qui l'active | rien | `OMB_IDENTITY=perspicax` plus le lien (section 6) |

L'app de bureau garde toujours son harness local en solo. Un serveur d'organisation s'ajoute comme un **environnement** de plus (`electron/environments.cjs`: l'app charge l'interface du serveur distant, la session vit dans le cookie HttpOnly de ce serveur). Être dans une organisation, c'est donc avoir un environnement de plus, pas changer d'installation.

### Passer de solo à organisation

1. Réglages > Organisation > « Rejoindre un serveur Perspicax »: on colle l'adresse du serveur Pulsa Bot. L'app lit `/.well-known/openmausbot/environment` (`server/environment.ts:122`), qui annonce désormais `identity: { kind: "oidc", issuer }`.
2. Connexion OIDC (section 2). L'environnement est enregistré.
3. L'app propose « Copier des bots vers l'organisation ». On choisit des bots; pour chacun, avec ou sans fils et mémoire.
4. Le transfert réutilise la sauvegarde d'équipe (`server/team-backup.ts`, `shared/team-backup.ts`: bots, tâches avec leurs messages, routines, mémoire), exportée par le harness local et importée par une route authentifiée du serveur d'organisation (`POST /api/org/import`, section 8). Les canaux (`GroupRecord`) suivent seulement si leurs seuls humains sont la personne qui migre.
5. Réécriture des personnes: le principal local (`local: true`) reçoit `linkedSubjects: [{ iss, sub, serverOrigin }]`. À l'import, chaque référence au principal local (`ownerUserId`, `humanIds`, `directGrants`, `runAs`) devient le principal d'organisation de la même personne. Toute autre référence (un ancien invité local) est retirée et listée dans le rapport d'import, jamais convertie en droit. Même mécanique que `server/identity-migration.ts`, avec une table de réécriture explicite au lieu d'une résolution par courriel.
6. C'est une **copie**. Rien n'est effacé localement. Après vérification, l'app offre « Retirer ces bots de cet ordinateur » bot par bot.
7. Les clés des fournisseurs ne voyagent pas (la sauvegarde les caviarde déjà, `redactSecretsInText`); le propriétaire les saisit dans le coffre du serveur (décision 7).

### Revenir en solo

- « Quitter l'organisation » sur le bureau: l'app appelle la déconnexion du serveur (révocation de la session Pulsa Bot et du refresh token Perspicax, section 2), puis retire l'environnement. Le harness local n'a jamais cessé d'être solo.
- Récupérer un bot: une personne qui a `manage` sur un bot d'organisation peut l'exporter en paquet (`server/package-export.ts`) et l'importer en local. Les fils ne suivent que si l'admin l'autorise (réglage d'organisation, désactivé par défaut: ce sont des données de l'organisation).
- Désactiver le compte dans Perspicax coupe tout accès au serveur d'organisation (section 2, déconnexion par le canal arrière). Les copies locales restent à la personne.

### Serveur intérim déjà en organisation

Un serveur de `develop` qui a déjà des principals créés par courriel (tranches du 2026-09-28) passe en mode Perspicax ainsi: à la première connexion OIDC d'un `sub` inconnu, si un principal intérim sans `subject` porte le même courriel, il est rattaché une seule fois, et le rattachement est écrit au journal d'audit. Après la période de migration (réglage admin, 30 jours par défaut), le rattachement par courriel est coupé et seul `iss` + `sub` compte.

## 2. Identité

### Recommandation sur le trou connu: jeton d'identité ES256 et JWKS

Aujourd'hui Perspicax annonce `"id_token_signing_alg_values_supported": ["none"]` (`crates/local-oauth/src/lib.rs:179`) et, en fait, **n'émet aucun `id_token`**: `TokenResponse` (`lib.rs:2337`) ne porte que `access_token`, `refresh_token`, `expires_in`, `refresh_expires_in` et `scope`. `/api/v1/me` (`crates/gateway/src/api/me.rs:14`) n'accepte que le cookie de console ou un jeton `pxat1.` (`api/auth.rs:226`, `resolve_caller`: les lignes `sessions` de type `console` ou `api_token`), pas un jeton d'accès OAuth `pxlo1.`.

**Recommandation: signer un vrai `id_token` en ES256 et publier un JWKS.** Raisons:

- C'est le standard OIDC; Pulsa Bot (Apache-2.0) reste un client OIDC générique, utilisable avec un autre IdP.
- La vérification est locale (clé publique en cache), sans appel à Perspicax par requête.
- La même clé signe les deux autres jetons courts dont on a besoin: le jeton de déconnexion par canal arrière (OpenID Connect Back-Channel Logout 1.0) et l'assertion que la console envoie au serveur Pulsa Bot (section 5). Une seule vérification côté Pulsa Bot.
- `/me` demanderait de toute façon un changement dans `resolve_caller` pour accepter `pxlo1.`, et lierait le client Apache à une API propriétaire.

`/api/v1/me` n'est pas utilisé par Pulsa Bot. Un `userinfo_endpoint` standard pourra s'ajouter plus tard si un besoin de rafraîchir les attributs sans refresh apparaît.

### Flux de connexion: Pulsa Bot comme BFF

Le serveur Pulsa Bot est le client OIDC (patron Backend for Frontend). Ni le navigateur, ni l'app de bureau, ni le téléphone ne voient un jeton Perspicax. Ils reçoivent la session Pulsa Bot qu'ils connaissent déjà (`server/sessions.ts`: cookie HttpOnly pour le web, bearer pour les apps natives).

```
navigateur ──GET /auth/oidc/start──▶ Pulsa Bot
                                     state, nonce, PKCE S256 (en mémoire, 10 min, usage unique)
          ◀──302 authorize──────────
          ──▶ Perspicax /oauth/authorize?client_id=pulsa-bot&resource=https://bot.x&scope=openid profile email offline_access
              mot de passe + TOTP, ou passkey (page existante, page.rs)
          ◀──302 https://bot.x/auth/oidc/callback?code&state&iss
          ──▶ Pulsa Bot /auth/oidc/callback
                 POST /oauth/token (code, verifier)  ──▶ Perspicax
                 ◀── access (aud https://bot.x), refresh pxlr1., id_token ES256
                 vérifie id_token, trouve ou crée le principal, scelle le refresh
          ◀──302 / + Set-Cookie session Pulsa Bot
```

- `resource` vaut l'origine publique du serveur Pulsa Bot, pas `/mcp`. Le jeton d'accès de connexion a donc l'audience de Pulsa Bot et **ne vaut rien sur `/mcp`**: `validate_access_token` compare l'audience (`lib.rs:1709`) et le connecteur valide contre `app.config.audience()` (`crates/connector/src/http/bearer.rs:240`). La séparation des jetons de connexion et des jetons MCP est structurelle.
- Client `pulsa-bot`: client public premier parti, PKCE S256, redirection exacte `https://<origine Pulsa Bot>/auth/oidc/callback`. Pas de sélecteur de profil pour lui (section 7). `iss` (RFC 9207, déjà émis par Perspicax) est vérifié au retour.
- Vérification de l'`id_token`: `alg` exactement `ES256` (jamais `none`), `kid` connu du JWKS (rechargé une fois sur `kid` inconnu), `iss` exact, `aud` = `pulsa-bot`, `exp`, `iat` avec 60 s de tolérance, `nonce` égal à celui de la tentative.
- Pas de nouvelle dépendance npm: `node:crypto` importe une clé JWK (`createPublicKey({ key, format: "jwk" })`) et vérifie ES256 (`dsaEncoding: "ieee-p1363"`). Même style que `server/mcp-oauth.ts`, dont on réutilise `pkcePair`, `authorizationServerMetadataUrls`, `readBounded` et `safeEndpoint`.

### Par client

| Client | Comment il se connecte | Ce qu'il garde |
|---|---|---|
| Web (navigateur) | `/pair` gagne un bouton « Se connecter avec Perspicax » (`src/pair/PairPage.tsx`), flux ci-dessus | cookie de session Pulsa Bot |
| Bureau (Electron) | tranche 1: le flux dans la fenêtre, comme le web, puisque l'environnement charge l'interface du serveur. Tranche 2: navigateur système (RFC 8252), parce qu'une passkey de plateforme ne marche pas bien dans une fenêtre Electron. Le callback du serveur émet alors un **identifiant d'appairage à usage unique lié au principal** (`sessions.openPairing({ principalId, ttlMs: 120_000 })`) et redirige vers `openmausbot://auth?origin=<o>#code=<c>`. L'app (`app.setAsDefaultProtocolClient("openmausbot")`, `electron/main.mjs:2979`; `open-url`, ligne 259) charge `<o>/pair#code=<c>` dans sa fenêtre: l'échange existant pose le cookie. | cookie de session dans le jar Chromium; aucun jeton Perspicax |
| Téléphone | tranche 1: code QR d'appairage ouvert par une personne connectée (web ou bureau), déjà lié à son principal (`server/index.ts:14957`); zéro changement natif. Tranche 2: `ASWebAuthenticationSession` (iOS) et Custom Tabs (Android) sur `/auth/oidc/start?client=phone`, retour par `openmausbot://pair?origin=…#code=…` puis `POST /api/pair` existant | bearer de session dans Keychain / Keystore |

Le schéma personnalisé ne transporte jamais de code Perspicax, seulement l'identifiant d'appairage Pulsa Bot: haute entropie, 2 minutes, usage unique, stocké haché, soumis au verrouillage par source (`LOCKOUT`, `sessions.ts:55`). Un code volé sur le schéma ne vaut qu'une session Pulsa Bot révocable, pour ce seul principal.

### Principal

Le principal de `server/principals.ts` reste la personne. On ajoute:

| Champ | Rôle |
|---|---|
| `subject` | `{ iss, sub }`, clé d'identité en mode organisation. `sub` est l'id ULID de l'utilisateur Perspicax (le `sub` des jetons est l'id de l'utilisateur de la gateway, `api/session.rs`, `store.get_user(&access.sub)`). Jamais réutilisé. |
| `email`, `name`, `login` | attributs tirés des claims, mis à jour à chaque connexion et rafraîchissement. Jamais une clé: Perspicax ne vérifie pas les adresses, donc `email_verified` vaut `false`. |
| `orgRole` | dernier rôle Pulsa Bot calculé (section 3), pour l'affichage hors ligne. |
| `disabledAt` | posé par la déconnexion par canal arrière ou quand l'annuaire dit `disabled`. |

`PrincipalRegistry.forSubject({ iss, sub, claims })` remplace `forAccount` en mode organisation. `controlPlaneUserId` reste lisible pour les anciens fichiers et n'est plus écrit.

### Session sur le serveur Pulsa Bot

- La session reste un `SessionRecord` (`sessions.ts:68`), avec `principalId` et un nouveau champ `idp: { iss, sub, grantRef }`. `grantRef` pointe vers l'enregistrement scellé du refresh token Perspicax de cette session, dans un coffre calqué sur `McpOAuthVault` (`mcp-oauth.ts:120`, fichier chiffré à côté des données, clé en fichier `0600` ou en variable d'environnement).
- Validation par requête: la session Pulsa Bot, comme aujourd'hui (`server/request-auth.ts`). Pas d'introspection.
- Fraîcheur: quand une session est utilisée et que son dernier rafraîchissement date de plus de 50 minutes (le jeton d'accès vit 3600 s, `ACCESS_TOKEN_TTL_SECS`, `lib.rs:229`), le serveur fait un `refresh_token` grant, en vol unique par session (même patron que `refreshing` dans `McpOAuthManager`). Le nouvel `id_token` met à jour les claims (rôle, équipes). Un `invalid_grant` révoque la session Pulsa Bot.
- Durée: la session suit le refresh Perspicax (30 jours glissants, `REFRESH_TOKEN_TTL_SECS`, `lib.rs:234`). `SESSION_TTL_MS` et `SESSION_MAX_AGE_MS` (`sessions.ts:36-41`) restent des plafonds.
- Révocation immédiate: Perspicax appelle `POST /api/auth/oidc/backchannel-logout` avec un `logout_token` ES256 (`sub`, `events`, `jti`) quand un utilisateur est désactivé, supprimé, ou révoque ses sessions. Pulsa Bot ferme les sessions de ce `sub` et leurs flux SSE (`closeSessionStreams` existe déjà).
- Déconnexion: `POST /api/auth/logout` (existant, `index.ts:14939`) révoque aussi le refresh Perspicax par un nouveau `/oauth/revoke` (RFC 7009). `mcp-oauth.ts` sait déjà lire un `revocation_endpoint`.

### Codes d'appairage et système intérim

| Mécanisme | Solo | Organisation |
|---|---|---|
| Code d'appairage lié au principal (`openPairing({ principalId })`) | gardé | gardé: c'est l'appareil de la personne qui l'a créé |
| Code d'appairage sans principal | gardé (l'opérateur) | refusé, sauf le code d'amorçage admin avant le lien (section 6) |
| Code par courriel (`email-otp.ts`, `account-signin.ts` serveur et control plane) | retiré: rien à envoyer à une seule personne | refusé, comme `HOSTED_WORKSPACE` le fait déjà (`index.ts:14647`) |
| Invitations `/join#token` (`org-routes.ts`, `org-record.ts::issueInvite`, `src/pair/JoinPage.tsx`) | retirées | remplacées par un compte Perspicax (section 3) |
| Liste d'accueil `OMB_SIGNIN_EMAILS` (`config.ts:1064`) | retirée | remplacée par les claims |
| Mailer SMTP / SendGrid (`mailer.ts`, `mail-config.ts`) | retiré (seuls usages: connexion et invitations, `index.ts:14584`) | non utilisé |

## 3. Autorisation

### Qui décide quoi

| Décision | Source de vérité | Pourquoi |
|---|---|---|
| La personne existe, est active, son nom, son courriel | Perspicax (`crates/gateway/src/model/users.rs`, `User`) | un seul annuaire |
| Rôle Perspicax (`admin`, `manager`, `employee`), type (`person`, `service`) | Perspicax (`users.rs:21`, `:57`) | idem |
| Équipes et gestionnaires (`model/teams.rs`, `Team { managers, members }`) | Perspicax | idem |
| Qui a droit à Pulsa Bot et à quel rôle d'organisation | Perspicax, section « Pulsa Bot > Membres » de la console, émis en claim | l'admin gère les gens à un seul endroit |
| Propriétaire de l'organisation Pulsa Bot | Pulsa Bot (`org-record.ts`, `ownerUserId`) | c'est un fait du serveur de bots |
| Propriété des bots, niveaux par bot, membres des canaux, visibilité des routines | Pulsa Bot | ce sont des objets de Pulsa Bot |
| Profils MCP qu'une personne détient | Perspicax (`profiles_of_user`, scopes `profile:<id>`) | le MCP est à Perspicax |

### Rôles

Perspicax calcule un claim `pulsabot_role` pour le client `pulsa-bot`:

| Perspicax | Claim | Pulsa Bot |
|---|---|---|
| personne `admin` | `admin` | `admin` (et `owner` si c'est le propriétaire enregistré) |
| personne `manager` ou `employee` dans une équipe autorisée | `member` | `member` |
| personne dans une équipe marquée « invités Pulsa Bot » | `guest` | `guest` (décision 3: canaux et bots donnés seulement, 30 jours, ni bot ni Direct) |
| personne hors des équipes autorisées | absent | connexion refusée par Perspicax à l'autorisation, et par Pulsa Bot si le claim manque |
| compte `service` | jamais | ne se connecte pas (il n'a ni mot de passe ni second facteur) |

Par défaut « équipes autorisées » = toutes les personnes actives, pour que la tranche 1 marche sans réglage. Le claim `px_teams` (`[{ id, name, manager }]`) accompagne le rôle, pour les droits donnés à une équipe.

Le scope de session Pulsa Bot suit: `owner` et `admin` reçoivent `["admin", "client"]`, `member` et `guest` reçoivent `["client"]` (`sessions.ts:17`). Le rôle d'organisation reste distinct du scope serveur (tranche 2 du document du 2026-09-28): `can()` décide, le scope ne sert que de premier filtre (`CLIENT_ALLOW`, `request-auth.ts`).

### `can(principal, action, resource)`

Un module `server/authz.ts` absorbe `channel-visibility.ts` et `direct-grants.ts`:

- Entrées: le principal (rôle, équipes à jour, `disabledAt`), l'action (`bot.use`, `bot.run`, `bot.edit`, `bot.manage`, `bot.approve`, `channel.read`, `channel.post`, `channel.moderate`, `routine.view`, `routine.edit`, `org.settings`, `computer.use`, `vault.read`), la ressource (bot, canal, routine, org).
- Niveaux par bot: `use` ⊂ `run` ⊂ `edit` ⊂ `manage` (décision 5). Un droit se donne à un principal **ou à une équipe Perspicax** (`team:<ulid>`); l'équipe est résolue par les claims et l'annuaire (section 5), jamais copiée en liste de personnes.
- L'approbation reste au propriétaire ou à son délégué `approver`, jamais à l'admin par défaut.
- Un admin règle l'organisation mais ne lit pas le Direct privé d'un autre: `bot.use` sur le bot d'autrui exige un droit.
- Un invité expiré ou un principal `disabledAt` n'a aucun droit; ses droits restent listés pour l'historique.
- Utilisé par le filtre SSE, la liste des canaux et des bots, la recherche (`searchHitVisible`) et chaque route qui modifie. Les fonctions pures de `channel-visibility.ts` deviennent des cas de `can()`, avec leurs tests.

La branche `fix/member-identity` (`server/viewer-identity.ts`, `memberBotFieldViolation` dans `request-auth.ts`) se garde telle quelle: le nom et le courriel viennent des claims au lieu de l'adresse de connexion.

## 4. MCP configuré automatiquement

### Recommandation: échange de jeton RFC 8693, pas un second OAuth par personne

Le client OAuth MCP existant (`server/mcp-oauth.ts`) ferait refaire à chaque personne une connexion complète par profil: la page d'autorisation de Perspicax ne garde aucune session de navigateur (aucun cookie posé par `routes.rs` ni `page.rs`), donc chaque autorisation redemande mot de passe et TOTP. De plus son coffre est indexé par nom de serveur, pas par personne (`McpOAuthVault.get(name)`, `withAuthHeaders`, `mcp-oauth.ts:784`): sur un serveur partagé, la connexion d'une personne servirait à toutes.

**Recommandation: le serveur Pulsa Bot échange le jeton de la personne contre un jeton MCP court, sur `/oauth/token`, en RFC 8693.**

```
POST /oauth/token
Authorization: Basic pulsa-bot-server:<jeton pxat1. du compte de service du lien>
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<jeton d'accès de la personne, aud = origine Pulsa Bot>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
resource=https://px.x/mcp?profile=<slug>
```

Perspicax vérifie le lien (section 5), le `subject_token` (audience = l'origine du serveur lié, client `pulsa-bot`, utilisateur actif), trouve le profil parmi ceux que la personne détient (`scope_for_hint` sur `profile_choices`, `routes.rs:326`, `lib.rs:1195`), puis appelle `mint_internal_access_token(sub, [scope], "pulsa-bot:<server id>", mcp_audience, ttl)` (`lib.rs:1655`). Cette primitive existe déjà pour le moteur de fils IA, intersecte avec ce que le compte détient (SEC2 du 2026-09-11) et ne crée pas de refresh. TTL: 15 minutes au plus, jamais au-delà de l'expiration du `subject_token`. Un profil non détenu répond `invalid_target`, comme un mauvais `resource` aujourd'hui.

Le jeton obtenu est un jeton MCP ordinaire: le journal de Perspicax (`mcp_requests`, `client`, `client_name`, `profile_ids`, `credential_id`) montre chaque appel au nom de la personne, avec le client `pulsa-bot:<server id>`. Le pont (ci-dessous) envoie `clientInfo.name = "Pulsa Bot (<bot id>)"`, donc la console voit aussi quel bot a appelé.

`mcp-oauth.ts` reste pour les serveurs MCP tiers qu'une personne ajoute. En mode organisation, son coffre s'indexe par `(principalId, name)`.

### Quel profil, pour qui

- Chaque bot porte `perspicax: { profiles: [slug] }`, choisi par qui a `edit`, parmi les profils que **cette personne** détient (liste lue par échange à blanc ou par l'annuaire).
- Tour interactif: le MCP tourne sous l'identité de **la personne qui a envoyé le message**, pas du propriétaire. Si elle ne détient pas le profil, l'outil n'apparaît pas et le bot le dit. C'est la seule façon de garder exacte la visibilité par personne de Perspicax (« per-user visibility staying exact through the scopes », AGENTS.md de Perspicax, décisions en vigueur).
- Tour déclenché par un autre bot (délégation, `server/delegations.ts`): l'identité de l'humain à la racine de la chaîne, transportée dans la boîte de délégation.
- Routine: son `runAs`, qui est son propriétaire (décision 7), par une délégation durable (ci-dessous).

### Délégation pour les routines

Une routine qui tourne pendant que son propriétaire est hors ligne n'a pas de jeton d'accès vivant à échanger. Le propriétaire consent une fois (« Autoriser mes routines à agir en mon nom »): un flux d'autorisation séparé avec `scope=openid offline_access pulsabot:routines` crée une famille de refresh distincte de celle de sa session, scellée sur le serveur Pulsa Bot. Avant chaque routine: rafraîchir cette famille (vol unique par principal), échanger, exécuter, révoquer. La famille survit à la déconnexion des appareils, pas à la désactivation du compte ni à une révocation depuis Pulsa Bot ou la console Perspicax.

### Injection par engine: un pont stdio tenu par le harness

Aujourd'hui un jeton OAuth MCP part dans les en-têtes de la configuration MCP de l'engine (`engineMcpServers`, `index.ts:13977`, puis `withAuthHeaders`): il est lisible par le processus de l'engine et par un shell en accès complet. Pour Perspicax on reprend le patron de `server/connector-proxy.ts` (le pont Composio: « credentials never pass through its transcript »):

- L'engine voit un serveur MCP **stdio**, `server/perspicax-mcp-bridge.ts`, pour chaque profil du bot. Tous les engines (Claude, Codex, Pi, ACP) savent parler stdio.
- Le pont ne reçoit aucun jeton en argument ni en variable: il demande au harness, en loopback, avec la capacité du tour (même mécanique que `OMB_CONNECTOR_TOKEN`), un jeton pour `(tour, profil)`. Le harness fait l'échange, garde le jeton en mémoire, le rend au pont, et le révoque à la fin du tour (`revoke_access_token`, `lib.rs:1765`, fait pour ces jetons internes).
- Le pont relaie en Streamable HTTP vers `https://px.x/mcp?profile=<slug>`; `tools/list` est déjà filtré par Perspicax selon les scopes.
- Risque résiduel, écrit tel quel: pendant un tour, un shell du bot qui lit la capacité du tour peut demander le même jeton au harness. Il n'obtient que les profils de ce bot, pour la personne de ce tour, jusqu'à la fin du tour, et chaque appel est au journal de Perspicax.

## 5. Section « Pulsa Bot » de la console Perspicax

### Pages

La barre latérale a les groupes Personnel, Équipe, Administration et Système (`console/src/components/shell.tsx:175-222`; seul l'élément choisi s'allume, jamais le groupe; le menu du compte est au pied). On ajoute un groupe `pulsabot` (« Pulsa Bot »), entre Administration et Système:

| Page | Route console | Rôle minimal | Contenu |
|---|---|---|---|
| Serveurs | `/pulsabot/servers` | admin | serveurs liés: nom, origine, version, dernier contact, santé; lier, renouveler le jeton du lien, délier |
| Bots | `/pulsabot/bots` | manager | bots de l'organisation: propriétaire, engine, profils MCP, droits (lecture); un manager ne voit que ceux de ses équipes |
| Membres | `/pulsabot/members` | admin | équipes autorisées, équipe invités, rôle calculé par personne, propriétaire, délégations de routines actives (révocables) |
| Utilisation | `/pulsabot/usage` | manager | tours, jetons de modèle et appels MCP par personne, bot et jour |
| Approbations | `/pulsabot/approvals` | employee | cartes en attente que **la personne connectée** peut trancher (décision 5), avec lien vers le fil dans Pulsa Bot |
| Audit | `/pulsabot/audit` | admin | journal d'audit de Pulsa Bot (droits, partages, propriété, lien) à côté de l'`admin_audit` de Perspicax |

Chaque page est une route paresseuse (`page(() => import(...), "Name")` dans `console/src/main.tsx`), ses styles vont dans `console/src/styles/routes.css` (l'entrée CSS est à environ 108,6 Ko sur 110), chaque route entre dans `console/e2e/routes.ts` et `docs/design/look-inventory.txt`, et marche de 360 à 430 px.

### API de Perspicax

Existant et réutilisé: utilisateurs, équipes, profils, comptes de service et rotation de leur jeton (`POST /api/v1/users/{id}/rotate-token`, `api/users.rs:178`), hôtes de redirection (`GET`/`PUT /api/v1/settings/oauth-redirect-hosts`, `api/oauth_redirect_hosts.rs`), journal filtré par `client`.

Nouveau, dans `crates/gateway/src/api/pulsabot.rs`, chaque route inscrite dans `crates/gateway/tests/route_roles.rs::DECLARED`:

| Route | Appelant | Rôle |
|---|---|---|
| `GET`, `POST /api/v1/pulsabot/servers`, `DELETE /api/v1/pulsabot/servers/{id}` | console | Admin |
| `POST /api/v1/pulsabot/servers/{id}/rotate-link` | console | Admin |
| `GET`, `PUT /api/v1/pulsabot/settings` (équipes autorisées, équipe invités) | console | Admin |
| `GET /api/v1/pulsabot/directory` (personnes, équipes, rôle calculé, statut; `ETag`) | serveur Pulsa Bot | `PulsaBotLink` |
| `GET /api/v1/pulsabot/servers/{id}/proxy/{*path}` et `POST` du même | console | Manager ou Any selon la page, puis `can()` côté Pulsa Bot |

`PulsaBotLink` est un nouvel extracteur (`api/auth.rs`): un `pxat1.` (`Via::ApiToken`) dont l'utilisateur est le compte de service d'un serveur lié, et rien d'autre. Le jeton du lien ne donne accès à aucune autre route, ni à `/mcp` hors échange de jeton.

### Console vers serveur Pulsa Bot

La console du navigateur ne parle jamais au serveur Pulsa Bot. Elle appelle le mandataire de Perspicax (même origine, cookie et CSRF double habituels). Perspicax signe une assertion ES256 de 60 s (`iss` Perspicax, `aud` origine Pulsa Bot, `sub` = la personne de la console, `act: { sub: "console" }`, `jti`) et appelle l'API d'administration du serveur Pulsa Bot (`/api/org/admin/*`, section 8) par l'URL interne du lien. Pulsa Bot vérifie avec le même JWKS que l'`id_token`, refuse un `jti` déjà vu, puis applique `can()` **au nom de la personne** de la console. Une personne en mode « voir comme » (`POST /api/v1/session/impersonate`) est refusée par le mandataire: on n'agit pas dans Pulsa Bot sous une identité empruntée.

Dans l'autre sens, le serveur Pulsa Bot appelle Perspicax avec le jeton `pxat1.` du compte de service du lien: annuaire toutes les 5 minutes (et à chaque connexion), échange de jeton.

## 6. Déploiement

### Une seule compose

Elle vit dans le dépôt privé (`pulsatrix-v3/deploy/docker-compose.pulsabot.yml`, avec un `Caddyfile.pulsabot`); le dépôt Pulsa Bot la documente et garde sa propre `compose.yaml` pour le solo.

| Service | Image | Rôle |
|---|---|---|
| `perspicax` | `pulsatrix-connector:<version>` | IdP, MCP, console. `bind = "0.0.0.0:8787"`, `trusted_proxies` du réseau de la compose (`deploy/docker-compose.caddy.yml` le documente déjà) |
| `pulsabot` | `pulsa-bot-server:<version>` | serveur de coordination; son Caddy latéral actuel (`network_mode: service:omb`, `deploy/local/Caddyfile`) reste pour garder la règle d'hôte loopback |
| `caddy` | `caddy:2.11.x` | arête: deux sites, `px.<domaine>` vers `perspicax:8787`, `bot.<domaine>` vers le Caddy de `pulsabot`. Deux noms parce que les deux produits utilisent `/api/*`. |

L'exposition réseau (DNS, Tailscale, tunnel, LAN) reste au propriétaire: la compose publie par défaut sur `127.0.0.1`, comme `compose.yaml` de Pulsa Bot (`OMB_BIND_ADDRESS`).

Volumes: `perspicax-config` (`gateway.db`, `state/vault.key`, `state/local_oauth/`, sauvegardes), `pulsabot-data` (`/data`), `link` (un seul fichier, section suivante), `caddy-data`, `caddy-config`.

Variables: côté Perspicax `PXC_CONFIG_DIR`, `PXC_VAULT_KEY` ou le fichier de clé, `PXC_PULSABOT_ORIGIN=https://bot.<domaine>` et `PXC_PULSABOT_INTERNAL_URL=http://pulsabot:80` (nouveaux). Côté Pulsa Bot `OMB_PUBLIC_URL=https://bot.<domaine>`, `OMB_IDENTITY=perspicax`, `OMB_PERSPICAX_ISSUER=https://px.<domaine>`, `OMB_PERSPICAX_LINK_FILE=/link/pulsabot.json` (nouveaux), `OMB_IDP_VAULT_KEY_FILE` (secret Docker).

### Premier démarrage

1. `docker compose up -d`.
2. Premier admin Perspicax: `pulsatrix-connector local-auth set-password` comme aujourd'hui (`deploy/README.md`, « First run in a container »), mot de passe temporaire, changement et TOTP à la première connexion (`must_change_password`). Une amorce sans `exec` (code dans le journal, comme la tranche 1b de Pulsa Bot) est souhaitable plus tard, hors de ce document.
3. Lien automatique: au démarrage, si `PXC_PULSABOT_ORIGIN` est posé et qu'aucun serveur n'est lié à cette origine, Perspicax crée dans une transaction: le compte de service `pulsa-bot-<nom>` et son `pxat1.`, le client `pulsa-bot` avec sa redirection exacte, l'audience supplémentaire, l'hôte exact `=bot.<domaine>` dans `redirect_hosts.txt`, une ligne `admin_audit` `pulsabot.link`. Il écrit `pulsabot.json` (`issuer`, `client_id`, `server_id`, `link_token`) dans le volume `link` en `0600`.
4. Pulsa Bot lit le fichier, vérifie la découverte et le JWKS, et passe en mode organisation.
5. Propriétaire: le premier **admin Perspicax** qui se connecte à un serveur fraîchement lié devient `owner` (seul un admin le peut, et le lien a été voulu). Hors compose unique, le lien se fait depuis la console (Pulsa Bot > Serveurs > Lier), qui affiche le paquet une fois, et le propriétaire est l'admin qui l'a créé.

### Mises à jour et sauvegardes

- Perspicax d'abord, Pulsa Bot ensuite. Les changements d'IdP sont additifs (claims, routes); les migrations de Perspicax sont à sens unique (`tests/store_migrations.rs`).
- Chaque produit garde ses sauvegardes: `gateway backup` et Litestream optionnel pour Perspicax (`store/backup.rs`), l'instantané chiffré de Pulsa Bot (`server/workspace-backup.ts`). Le lien entre les deux, c'est le `sub` ULID, stable: une restauration de Perspicax plus ancienne ne réattribue pas d'identité. Un `sub` absent de l'annuaire après restauration donne un principal `disabledAt`, jamais un autre propriétaire.

### Courriel

Perspicax n'envoie aucun courriel aujourd'hui (les tables de `0023_prefs_email.sql` n'ont plus d'écrivain). Pulsa Bot n'en envoie plus en mode organisation. En v1, un nouveau compte reçoit un lien d'inscription à usage unique que l'admin copie depuis la console (nouveau dans Perspicax, tranche 4). Voir la question 5.

## 7. Changements dans Perspicax

Rappels de ce dépôt: versions les plus récentes vérifiées sur crates.io au début de l'incrément, pins dans le `Cargo.toml` racine avec la date, `make ci` complet, aucun tiret long ni demi-cadratin (`make dash-check`), une ligne `route_roles` par route, `AGENTS.md` mis à jour. Ce travail inverse une partie du « Delta (MCP plane only) » de `local-oauth`: il faut l'écrire comme nouveau delta.

| # | Changement | Zones |
|---|---|---|
| P1 | Clé ES256 et JWS: génération, `kid`, signature. Crate `p256` (RustCrypto, `ecdsa`, `jwk`, `pkcs8`), cohérente avec `chacha20poly1305` et `sha2` déjà présents. | nouveau `crates/local-oauth/src/jwt.rs`; `Cargo.toml` racine; `make notices` (`legal/rust-crates.txt`) |
| P2 | Stockage de la clé: scellée par le coffre en mode gateway, fichier `0600` en mode fichier. Rotation: l'ancienne clé reste au JWKS 24 h. | migration `crates/gateway/src/store/migrations/0035_oidc_keys.sql`; `vault/rotate.rs::SEALED_COLUMNS`; `tests/vault.rs` (`every_sealed_column_of_the_migrated_schema_is_listed`); `tests/store_migrations.rs`; `store.rs` de `local-oauth` pour le mode fichier |
| P3 | `id_token` sur `authorization_code` et `refresh_token` quand `openid` est demandé: `iss`, `sub`, `aud`, `exp`, `iat`, `auth_time`, `nonce`, `amr`, `email`, `email_verified: false`, `name`, `preferred_username`, `locale`; pour le client `pulsa-bot` seulement: `pulsabot_role`, `px_teams`. Le `nonce` et `auth_time` voyagent avec le code. | `lib.rs`: `TokenResponse` (`:2337`), `exchange_code` (`:1368`), `refresh_grant_with_client` (`:1432`), l'entrée de code de `mint_code_with_scope` (`:1268`); `routes.rs`: `authorize` et `token` |
| P4 | Source des claims: une méthode `claims(id)` sur le trait `UserStore`, implantée par la gateway (utilisateur, équipes, réglages Pulsa Bot). | `crates/local-oauth/src/store.rs`; `crates/gateway/src/oauth_store.rs` (`SqliteUserStore`, `:48`) |
| P5 | Découverte: `jwks_uri`, `id_token_signing_alg_values_supported: ["ES256"]`, `revocation_endpoint`, `backchannel_logout_supported`, le grant d'échange dans `grant_types_supported`. Nouvelles routes `/oauth/jwks` et `/oauth/revoke` (RFC 7009). | `lib.rs::Deployment::discovery_document` (`:164`); `routes.rs::router` (`:92`); `tests/branding_golden.rs` (le JSON de découverte est figé en octets) |
| P6 | Audiences supplémentaires et client premier parti: `resource` accepte `/mcp` **ou** l'origine d'un serveur lié; le client `pulsa-bot` saute le sélecteur de profil **seulement** quand sa `redirect_uri` égale exactement celle qui est enregistrée (aujourd'hui `is_first_party_console` ne regarde que `client_id`, `page.rs:1449`). | `lib.rs` (`LocalOauthRuntime`, `resolve_mint_audience_any` `:385` déjà écrit); `routes.rs` (`authorize_audience`, `resolve_linked_scope` `:346`, la vérification de `resource` au jeton `:1321`); `page.rs` |
| P7 | Échange de jeton RFC 8693 sur `/oauth/token`, client `pulsa-bot-server` authentifié par le `pxat1.` du lien, au-dessus de `mint_internal_access_token`; événement `token_exchanged` dans `auth_events`. | `routes.rs::token`; `lib.rs`; `crates/gateway/src/hooks.rs` (journal); `model/journal.rs` |
| P8 | Désactivation: `set_status(Disabled)` révoque aussi les jetons OAuth locaux (`revoke_tokens_for_identity`, `lib.rs:1777`) et déclenche la déconnexion par canal arrière vers chaque serveur lié. TODO(verify): aujourd'hui `set_status` révoque les lignes `sessions` (`model/users.rs:616`) mais ce chemin ne touche pas le document `local_oauth_tokens`, et `validate_access_token` ne relit pas le statut. | `model/users.rs::set_status`; `api/users.rs::set_status` (`:277`); nouveau `crates/gateway/src/pulsabot_push.rs` |
| P9 | Serveurs liés: table, lien automatique au démarrage, API, extracteur `PulsaBotLink`, mandataire signé vers Pulsa Bot. | migration `0036_pulsabot_servers.sql`; nouveaux `model/pulsabot.rs`, `api/pulsabot.rs`; `api/mod.rs`; `api/auth.rs`; `crates/connector/src/boot.rs` (lien automatique); `crates/gateway/openapi.json` et `console/src/api/schema.d.ts` (`make console-types`); `tests/route_roles.rs` |
| P10 | Liens d'inscription à usage unique (un nouvel utilisateur choisit son mot de passe et son second facteur sur la page existante de première connexion). | `lib.rs` (session de configuration, `mint_setup_session`), `routes.rs`, `api/users.rs` |
| P11 | Console: groupe `pulsabot` et ses six pages. | `console/src/components/shell.tsx`; nouveaux `console/src/pages/pulsabot/*.tsx`; `console/src/main.tsx`; `messages.en.ts` et `messages.fr.ts` (`nav.pulsabot.*`); `console/src/styles/routes.css`; `console/e2e/routes.ts`; `docs/design/look-inventory.txt` |
| P12 | Déploiement: la compose unique et son Caddyfile, section du README. | `deploy/docker-compose.pulsabot.yml`, `deploy/Caddyfile.pulsabot`, `deploy/README.md` |

## 8. Changements dans Pulsa Bot

### Nouveau

| Module | Rôle |
|---|---|
| `server/oidc-rp.ts` | découverte, PKCE, `state` et `nonce` en mémoire (10 min, usage unique, 20 au plus comme `MAX_PENDING_FLOWS`), échange du code, vérification ES256 par `node:crypto`, cache JWKS |
| `server/idp-session.ts` | coffre des refresh Perspicax, rafraîchissement en vol unique, déconnexion par canal arrière, révocation |
| `server/perspicax-link.ts` | lecture du fichier de lien, annuaire (ETag), client d'échange de jeton |
| `server/authz.ts` | `can()` (section 3) |
| `server/perspicax-mcp-bridge.ts` | le pont stdio (section 4), sur le patron de `connector-proxy.ts` et `mcp-bridge.ts` |
| Routes | `GET /auth/oidc/start`, `GET /auth/oidc/callback`, `POST /api/auth/oidc/backchannel-logout`, `POST /api/org/import`, `/api/org/admin/*` (assertion de la console), `POST /api/org/routine-delegation` |
| `server/environment.ts` | `identity: { kind: "oidc", issuer }` dans le descripteur |
| Web | bouton Perspicax dans `src/pair/PairPage.tsx`; `src/components/OrganizationSettings.tsx` montre le lien, le rôle et « Gérer dans Perspicax » |
| Bureau | `electron/main.mjs` (`open-url` pour `openmausbot://auth`), `electron/environments.cjs` (analyse du retour), « Rejoindre un serveur Perspicax » |
| Téléphone | `ios/Sources/CompanionCore/DeepLink.swift` et l'équivalent Android pour `openmausbot://pair?origin=…`; `ASWebAuthenticationSession` et Custom Tabs (tranche 2) |

### Gardé, adapté, retiré

| Code intérim | Sort |
|---|---|
| `principals.ts` | gardé; `subject`, `forSubject`, `linkedSubjects`, `disabledAt` |
| `identity-migration.ts` | gardé; plus une table de réécriture explicite pour l'import solo vers organisation |
| `sessions.ts` | gardé; champ `idp`; appairage sans principal refusé en organisation |
| `request-auth.ts` | gardé; le serveur d'organisation tourne en `LoopbackTrust` `service` |
| `org-record.ts` | adapté: `identity: { kind: "perspicax", issuer, serverId }`; l'organisation naît du lien, plus de `createOrg` par formulaire; `issueInvite` et `memberListsAfterAccept` retirés |
| `org-directory.ts` | `roleOf` remplacé par les claims; invitations retirées |
| `org-routes.ts` | `GET /api/org` et le nom gardés; invitations retirées; état du lien ajouté |
| `channel-visibility.ts`, `direct-grants.ts` | absorbés par `authz.ts`, tests conservés; un droit peut viser `team:<ulid>` |
| `mcp-oauth.ts` | gardé pour les MCP tiers; coffre indexé par `(principalId, name)` en organisation; ses utilitaires servent à `oidc-rp.ts` |
| `email-otp.ts`, `mailer.ts`, `mail-config.ts`, `account-signin.ts`, `src/pair/JoinPage.tsx`, `SignInAccessCard.tsx`, `compose.mail-test.yaml` | retirés à la dernière tranche, après que plus rien ne les appelle; d'ici là refusés en organisation |
| `electron/control-plane-client.mjs` | hors sujet (le tunnel `server/tunnel.ts` l'utilise encore) |
| `server/viewer-identity.ts` (branche `fix/member-identity`) | gardé, nourri par les claims |

## 9. Revue de sécurité

| # | Menace | Mesure |
|---|---|---|
| T1 | Fuite d'un jeton vers un engine (configuration MCP, variables, transcript, `ps`) | pont stdio; aucun jeton dans la configuration de l'engine; jeton MCP de 15 min au plus, révoqué en fin de tour; caviardage existant (`redact.ts`) |
| T2 | Adjoint confus: jeton de connexion rejoué sur `/mcp`, ou jeton MCP rejoué ailleurs | audiences distinctes (origine Pulsa Bot contre `/mcp`), vérifiées par `validate_access_token`; échange limité aux profils détenus (`scopes::grant`); MCP sous l'identité de qui parle, pas du propriétaire |
| T3 | Refresh volé sur un poste | le bureau et le téléphone ne tiennent jamais de jeton Perspicax (BFF); la session Pulsa Bot est HttpOnly ou dans Keychain / Keystore, révocable; rotation et détection de réutilisation de Perspicax (famille révoquée hors des 30 s de grâce) |
| T4 | Interception sur le schéma `openmausbot://` | il ne porte qu'un identifiant d'appairage Pulsa Bot de 2 min, usage unique, haché, verrouillé par source; le PKCE de la jambe Perspicax reste sur le serveur |
| T5 | Vol du jeton du lien (`pxat1.`) | extracteur `PulsaBotLink` borné à l'annuaire et à l'échange; fichier `0600` ou secret Docker; rotation (`rotate-link`); l'échange exige aussi un `subject_token` valide de la personne, donc le lien seul ne donne aucun accès MCP |
| T6 | Rejeu d'une assertion de la console | ES256, 60 s, `aud` exact, `jti` mémorisé jusqu'à expiration; mandataire refusé en « voir comme » |
| T7 | Propriétaire Pulsa Bot contre admin Perspicax | l'admin Perspicax est la racine de confiance: il peut créer un compte, réinitialiser un second facteur, donc devenir n'importe qui. Accepté et écrit. Mesures: toute action d'identité est à l'`admin_audit` de Perspicax, toute action de droits à l'audit de Pulsa Bot, la page Audit les montre côte à côte; un admin Pulsa Bot n'obtient pas `bot.use` sur un Direct privé sans droit; un propriétaire Pulsa Bot ne peut rien élever dans Perspicax |
| T8 | Compte désactivé qui garde l'accès | déconnexion par canal arrière immédiate; rafraîchissement au plus tard 50 min; P8 révoque les jetons OAuth locaux à la désactivation |
| T9 | Hameçonnage par un client qui prétend être premier parti | saut du sélecteur et de l'avis de destination seulement si `client_id` **et** `redirect_uri` exacte correspondent; hôte exact dans la liste de redirection |
| T10 | Falsification d'un `id_token` | `alg` fixé à ES256, `none` refusé, `kid` connu, `iss`, `aud`, `exp`, `nonce`; JWKS en HTTPS seulement (sauf loopback de test) |
| T11 | Compromission de la clé de signature | scellée par le coffre, `kid`, rotation avec chevauchement, `gateway rotate-vault` la couvre (P2) |
| T12 | Compromission du serveur Pulsa Bot | il tient les refresh de toutes les sessions et délégations: jetons scellés, clé en secret Docker; bouton « Révoquer tous les jetons de ce serveur » dans la console (par `client_id`); jetons MCP courts |
| T13 | Shell d'un bot qui appelle le harness en loopback | risque déjà écrit dans `request-auth.ts` (`SERVICE_ALLOW`); en organisation, `LoopbackTrust` `service` partout, et la route qui donne un jeton au pont exige la capacité du tour |
| T14 | Rattachement par courriel d'un principal intérim | une seule fois, pendant la période de migration, écrit à l'audit, puis coupé |

## 10. Tranches

Chacune se livre seule, avec ses tests, dans l'ordre. Les tranches Perspicax passent `make ci`; les tranches Pulsa Bot suivent `docs/verification/README.md` (instance isolée, jamais l'app ou les données réelles).

1. **Connexion Perspicax, bout à bout.**
   Perspicax: P1, P2, P3 (claims de base: `sub`, `email`, `name`, `preferred_username`, `pulsabot_role` déduit du seul rôle Perspicax), P5 (JWKS, découverte), P6 pour une origine donnée par `PXC_PULSABOT_ORIGIN`.
   Pulsa Bot: `oidc-rp.ts`, `/auth/oidc/start` et `/callback`, `forSubject`, session avec `principalId`, rôle vers scopes, bouton sur `/pair`, descripteur `identity`, refus du courriel et des invitations quand `OMB_IDENTITY=perspicax`. Bureau: flux dans la fenêtre. Téléphone: QR d'appairage lié au principal (existant).
   Preuve: une compose de développement avec les deux; un compte Perspicax créé par la CLI se connecte au web de Pulsa Bot; `GET /api/auth/session` montre le principal, le courriel et le rôle; le jeton de connexion est refusé par `/mcp` (401).
2. **Cycle de vie de la session.** Rafraîchissement, `/oauth/revoke`, déconnexion, canal arrière et P8, navigateur système sur le bureau, OIDC natif sur le téléphone.
3. **Lien et annuaire.** P9, lien automatique, `perspicax-link.ts`, principals créés depuis l'annuaire (on peut partager avec quelqu'un qui ne s'est jamais connecté), compose unique (P12), page console Serveurs.
4. **Droits.** `authz.ts`, réglages Membres (équipes autorisées, invités), `px_teams`, droits d'équipe, niveaux par bot, invités 30 jours, liens d'inscription (P10).
5. **MCP automatique.** P7, pont stdio, profils par bot, identité de qui parle, provenance au journal.
6. **Routines au nom du propriétaire.** Délégation, `runAs`, révocation depuis les deux côtés.
7. **Console Pulsa Bot complète.** Bots, Utilisation, Approbations, Audit, mandataire signé.
8. **Solo vers organisation et ménage.** « Rejoindre », copie des bots, réécriture des personnes, rattachement intérim; retrait du code intérim de la section 8.

## 11. Questions pour JC

1. **Invités: comptes Perspicax ou courriel local?** Recommandation: comptes Perspicax dans une équipe « invités Pulsa Bot », avec second facteur. Un seul IdP, et le second facteur protège aussi les données clients qu'un invité voit. Coût: l'admin crée le compte.
2. **Sous quelle identité le MCP tourne quand quelqu'un parle au bot d'un autre?** Recommandation: celle de qui parle; celle du propriétaire seulement pour ses routines. L'inverse donnerait à tout utilisateur d'un bot l'accès ConnectWise de son propriétaire.
3. **Durée d'une délégation de routines.** Recommandation: 30 jours glissants renouvelés par chaque exécution, visible et révocable des deux côtés, coupée à la désactivation. Alternative plus stricte: 90 jours fixes puis nouveau consentement.
4. **Propriétaire de l'organisation Pulsa Bot.** Recommandation: l'admin Perspicax qui a lié le serveur (ou le premier admin connecté en compose unique); tout admin Perspicax est admin Pulsa Bot; transfert par le propriétaire, ou par un admin Perspicax depuis la console en dépannage, écrit à l'audit.
5. **Courriel.** Recommandation: aucun en v1, liens d'inscription copiés depuis la console; plus tard, le courriel d'identité (inscription, réinitialisation) vit dans Perspicax, et le mailer de Pulsa Bot disparaît.
6. **Où vit la compose unique.** Recommandation: `pulsatrix-v3/deploy/`, puisque Perspicax est le produit privé qui rend le multi-utilisateur possible; Pulsa Bot garde sa compose solo et pointe vers l'autre.
7. **Copier ou déplacer les bots en rejoignant.** Recommandation: copier, puis offrir le retrait local bot par bot après vérification; fils et mémoire au choix par bot.
8. **Bots appartenant à l'organisation.** Faut-il des bots sans propriétaire humain, exécutés sous un compte de service Perspicax? Recommandation: pas en v1; chaque bot a un propriétaire humain, et les comptes de service servent seulement au lien.
