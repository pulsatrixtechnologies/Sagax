# Preuve : CVE de l’image Docker

Trivy 0.75.0, `--scanners vuln --severity HIGH,CRITICAL --format json`.
Chaque scan passe `--ignorefile` vers un fichier vide : Trivy charge sinon
le `.trivyignore` du dépôt et le JSON « après » d’amd64 tomberait à 0 ligne.

JSON brut (objet Trivy, pas un résumé) :

- [`trivy/amd64-before.json`](trivy/amd64-before.json)
- [`trivy/amd64-after.json`](trivy/amd64-after.json)
- [`trivy/arm64-before.json`](trivy/arm64-before.json)
- [`trivy/arm64-after.json`](trivy/arm64-after.json)

Avant = recette `Dockerfile` à bee6b7728 (parent du premier commit de
durcissement). Après = recette de cette branche, `ENGINE_SET=all`.

linux/amd64 utilise la base épinglée
`node:24-trixie-slim@sha256:173f125896c3…`. linux/arm64 construit le
runtime de la même recette (apt, moteurs, Chromium Debian, overlay pip/npm)
sur le jumeau arm64 du tag `node:24-trixie-slim`
(`sha256:f78037e2794c…`) : le pin du Dockerfile est un digest d’image
amd64, pas un index multi-arch. L’arm64 installe Chromium Debian à la
place de Chrome for Testing, d’où 41 paquets OS de plus.

Aucune URL de run CI, aucun identifiant d’infra.

## Comptes

Une ligne Trivy = un paquet. Une CVE unique peut donc compter plusieurs
lignes.

| | amd64 avant | amd64 après | arm64 avant | arm64 après |
|---|---:|---:|---:|---:|
| CRITICAL (lignes) | 3 | 1 | 3 | 1 |
| HIGH (lignes) | 125 | **108** | 128 | 111 |
| CRITICAL (CVE uniques) | 3 | 1 | 3 | 1 |
| HIGH (CVE uniques) | 51 | **35** | 54 | 38 |
| CVE uniques HIGH+CRITICAL | 54 | **36** | 57 | 39 |
| node-pkg (lignes) | 10 | 0 | 10 | 0 |
| python-pkg (lignes) | 9 | 0 | 9 | 0 |
| os-pkgs (lignes) | 109 | 109 | 112 | 112 |

amd64 après, hors ignore : Node 0, Python 0, OS Debian 109 (108 HIGH + 1
CRITICAL). Les 36 CVE uniques sont **exactement** les 36 ids de
`.trivyignore`. 108 lignes HIGH = la même CVE sur plusieurs paquets
(util-linux × 9, python3.13 × 5, …), pas 108 identifiants.

arm64 après : les mêmes 36 ids, plus 3 HIGH Chromium sans `FixedVersion`
(`CVE-2022-4055` xdg-utils, `CVE-2026-37555` libsndfile1, `CVE-2026-94286`
libxtst6). 111 = 108 + 3. La porte CI construit linux/amd64 seulement.

## Correspondance 108 HIGH / 36 CVE (amd64 après)

| CVE | Sévérité | Lignes (paquets) |
|---|---|---:|
| CVE-2026-6653 | CRITICAL | 1 |
| CVE-2025-69720 | HIGH | 4 |
| CVE-2026-12064 | HIGH | 3 |
| CVE-2026-15308 | HIGH | 5 |
| CVE-2026-16742 | HIGH | 6 |
| CVE-2026-19445 | HIGH | 5 |
| CVE-2026-19553 | HIGH | 5 |
| CVE-2026-23949 | HIGH | 1 |
| CVE-2026-34980 | HIGH | 1 |
| CVE-2026-36849 | HIGH | 1 |
| CVE-2026-52490 | HIGH | 1 |
| CVE-2026-54369 | HIGH | 1 |
| CVE-2026-66046 | HIGH | 1 |
| CVE-2026-7210 | HIGH | 5 |
| CVE-2026-74860 | HIGH | 1 |
| CVE-2026-76642 | HIGH | 9 |
| CVE-2026-76956 | HIGH | 1 |
| CVE-2026-76957 | HIGH | 1 |
| CVE-2026-77214 | HIGH | 1 |
| CVE-2026-78408 | HIGH | 9 |
| CVE-2026-78409 | HIGH | 9 |
| CVE-2026-78410 | HIGH | 9 |
| CVE-2026-82049 | HIGH | 5 |
| CVE-2026-8286 | HIGH | 3 |
| CVE-2026-8458 | HIGH | 3 |
| CVE-2026-86138 | HIGH | 1 |
| CVE-2026-86139 | HIGH | 1 |
| CVE-2026-86140 | HIGH | 1 |
| CVE-2026-86142 | HIGH | 1 |
| CVE-2026-86143 | HIGH | 1 |
| CVE-2026-86144 | HIGH | 1 |
| CVE-2026-88806 | HIGH | 3 |
| CVE-2026-88807 | HIGH | 1 |
| CVE-2026-8927 | HIGH | 3 |
| CVE-2026-93990 | HIGH | 1 |
| CVE-2026-9538 | HIGH | 4 |
| **total HIGH** | | **108** |
| **CVE uniques** | | **36** |

Aucune de ces lignes n’a de `FixedVersion`. Vérifié par
`scripts/trivy-preuve.test.mjs` à partir des JSON du dépôt.

## Porte avec `.trivyignore` (amd64 après)

```
gated remaining: critical=0 high=0
```

## Garde-fou (JSON sans exceptions, amd64 après)

```
[trivy-ignore] ok 36 exception(s), none have a FixedVersion
```

Le garde-fou échoue fermé (exit ≠ 0) : scan `{}` ou `Results: null`
(y compris `--gated`), `FixedVersion` faite d’espaces, date `2099-99-99`
ou deux dates de revue, `.trivyignore` vide, sévérité `UNKNOWN`, CVE
listée absente du scan. Un test par cas dans
`scripts/trivy-ignore-guard.test.mjs`.

## Overlay pip

`PIP_RUNTIME_PATCHES` déclare PyJWT 2.15.1, **httpx2 2.13.1** et
**httpcore2 2.13.1**. L’install Hermès est
`pip install --upgrade --require-hashes -r` avec les sha256 wheel et
sdist, plus les dépendances transitives épinglées que `--require-hashes`
exige.
