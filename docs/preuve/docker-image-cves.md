# Preuve : CVE de l’image Docker

Trivy 0.75.0, `--scanners vuln --severity HIGH,CRITICAL`,
`--ignorefile` vide (aucun `.trivyignore` dans le dépôt). La porte
`scripts/vuln-attestation.mjs` reste à zéro CRITICAL et zéro HIGH.

Aucune URL de run CI, aucun identifiant d’infra.

## Avant (rouge) — 3819abbcc, runtime `node:24-trixie-slim`

Scan local amd64, même seuil que la publication. Une ligne Trivy = un
paquet ; une CVE unique peut compter plusieurs lignes.

```
Report Summary
┌──────────────────────────────────────┬────────────┬─────────────────┐
│ Target                               │ Type       │ Vulnerabilities │
├──────────────────────────────────────┼────────────┼─────────────────┤
│ sagax:cve-before (debian 13.7)       │ debian     │ 109             │
│ Node.js                              │ node-pkg   │ 10              │
│ Python                               │ python-pkg │ 9               │
└──────────────────────────────────────┴────────────┴─────────────────┘
vulnerability attestation summary: critical=3 high=125
```

CRITICAL : CVE-2026-6653 (`libxml2`, pas de `FixedVersion` sur trixie),
CVE-2026-102992 (`piscina` 4.9.3) et CVE-2026-102268 (`PyJWT` 2.13.0).

HIGH langage : `brace-expansion`, `http-cache-semantics`, `ip-address`,
`sharp`, `tar`, `undici`, encore `PyJWT`, `httpcore2`, `httpx2`.

HIGH OS (35 CVE, 108 lignes) : `libxml2`, `curl`, `util-linux`,
`python3.13`, `systemd`, `expat`, libX11 CVE-2026-88806, libXrender
CVE-2026-88807, et les autres paquets de trixie sans correctif.

La porte de publication fusionne amd64 et arm64, donc le même inventaire
lu des deux côtés.

## Après #444 (overlay sur trixie, toujours trop)

```
vulnerability attestation summary: critical=1 high=108
```

Les lignes node-pkg et python-pkg tombent à 0 (piscina 4.9.4, sharp
0.35.5, PyJWT 2.15.1, httpx2/httpcore2 2.13.1). Le CRITICAL `libxml2` et
les HIGH OS restent : trixie n’a pas de `FixedVersion`. Une liste
d’exceptions n’est pas une correction.

## Après ce correctif (vert) — runtime `debian:forky-slim`

Prototype `sagax-os-proof:stripped` : forky, Node 24.21.0 copié depuis
l’image officielle (sans sa base trixie), python3.14.8, libX11/libXrender
amont, npm/yarn absents. Même Trivy, même ignorefile vide.

```
Detected OS    family="debian" version="forky/sid"
Number of language-specific files    num=0

Report Summary
┌────────────────────────────────────────────┬────────┬─────────────────┐
│ Target                                     │ Type   │ Vulnerabilities │
├────────────────────────────────────────────┼────────┼─────────────────┤
│ sagax-os-proof:stripped (debian forky/sid) │ debian │        0        │
└────────────────────────────────────────────┴────────┴─────────────────┘
Legend:
- '0': Clean (no security findings detected)

vulnerability attestation summary: critical=0 high=0
```

Les CVE OS de trixie ont un correctif dans forky. CPython 3.14.8 ferme
les HIGH de 3.13. Les commits amont ferment CVE-2026-88806 et
CVE-2026-88807 ; les paquets Debian `libx11-6` / `libxrender1` ne sont
plus installés. Le CLI npm (ses `brace-expansion` imbriqués) n’est plus
dans l’image de production.

Le prototype ne pose pas les moteurs ni Chrome. L’overlay #444 reste
pour le venv Hermes et les modules npm des moteurs. La CI de cette
branche construit `ENGINE_SET=all` et applique le même seuil.
