# Preuve : CVE de l’image Docker

Trivy 0.75.0, `--scanners vuln --severity HIGH,CRITICAL --format json`.
Le scan « brut » (garde-fou) passe `--ignorefile` vers un fichier vide :
Trivy chargerait sinon le `.trivyignore` du dépôt. Les identifiants
retenus restent dans `.trivyignore` (un id par ligne, sans joker) ; ce
fichier public ne reprend pas l’inventaire paquet par paquet.

Avant = recette `Dockerfile` à bee6b7728 (parent du premier commit de
durcissement). Après = recette de cette branche, `ENGINE_SET=all`.

linux/amd64 utilise la base épinglée
`node:24-trixie-slim@sha256:173f125896c3…`. linux/arm64 construit le
runtime de la même recette (apt, moteurs, Chromium Debian, overlay pip/npm)
sur le jumeau arm64 du tag `node:24-trixie-slim`
(`sha256:f78037e2794c…`) : le pin du Dockerfile est un digest d’image
amd64, pas un index multi-arch. L’arm64 installe Chromium Debian à la
place de Chrome for Testing, d’où davantage de paquets OS.

Aucune URL de run CI, aucun identifiant d’infra.

## Comptes

Une ligne Trivy = un paquet. Une CVE unique peut donc compter plusieurs
lignes. Les ids eux-mêmes ne sont pas listés ici.

| | amd64 avant | amd64 après | arm64 avant | arm64 après |
|---|---:|---:|---:|---:|
| CRITICAL (lignes) | 3 | 1 | 3 | 1 |
| HIGH (lignes) | 125 | 102 | 128 | 105 |
| CRITICAL (CVE uniques) | 3 | 1 | 3 | 1 |
| HIGH (CVE uniques) | 51 | 33 | 54 | 36 |
| CVE uniques HIGH+CRITICAL | 54 | 34 | 57 | 37 |
| node-pkg (lignes) | 10 | 0 | 10 | 0 |
| python-pkg (lignes) | 9 | 0 | 9 | 0 |
| os-pkgs (lignes) | 109 | 103 | 112 | 106 |

amd64 après, hors ignore : Node 0, Python 0, OS Debian seulement.
Les identifiants uniques HIGH+CRITICAL du scan amd64 sont les 34 de
`.trivyignore`. Plusieurs lignes HIGH, ce sont les mêmes ids sur
plusieurs paquets. Aucune de ces lignes n’a de `FixedVersion`.

arm64 après : les mêmes ids, plus 3 HIGH Chromium sans `FixedVersion`
(105 = 102 + 3). Ces 3 ids ne sont pas dans `.trivyignore`. La porte CI
construit linux/amd64 seulement.

## Porte avec `.trivyignore` (amd64 après)

```
gated remaining: critical=0 high=0
```

## Garde-fou (JSON sans exceptions, amd64 après)

```
[trivy-ignore] ok 34 exception(s), none have a FixedVersion
```

Le garde-fou échoue fermé (exit ≠ 0) : scan `{}` ou `Results: null`
(y compris `--gated`), `--gated` sur `{"Results":[]}`, `FixedVersion`
faite d’espaces, date `2099-99-99` ou deux dates de revue, `.trivyignore`
vide, sévérité `UNKNOWN`, identifiant listé absent du scan, entrée LOW
sans `VulnerabilityID` en `--gated`.
Un test par cas dans `scripts/trivy-ignore-guard.test.mjs`. Un id répété
dans `.trivyignore` est aussi une erreur.

## Overlay pip

`PIP_RUNTIME_PATCHES` déclare PyJWT 2.15.1, **httpx2 2.13.1** et
**httpcore2 2.13.1**. L’install Hermès est
`pip install --upgrade --require-hashes -r` avec les sha256 wheel et
sdist, plus les dépendances transitives épinglées que `--require-hashes`
exige. S’il n’y a aucun `venv` sous `--root`, le script échoue (exit ≠ 0)
au lieu de sauter l’overlay.

Hermes 0.21.5 demande `PyJWT[crypto]==2.13.0`. L’overlay garde **2.15.1**
(même API encode/decode, version corrigée). Le job Docker exécute
`scripts/hermes-jwt-overlay-smoke.py` dans le venv Hermès de l’image :
PyJWT 2.15.1, aller-retour RS256 (extra `[crypto]`), puis
`verify_nas_fire_token` (le vérificateur JWT d’Hermes, Chronos),
`hermes --version`.
