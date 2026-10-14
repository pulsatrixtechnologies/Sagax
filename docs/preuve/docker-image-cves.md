# Preuve : scan de l’image

Trivy 0.75.0, `--scanners vuln --severity HIGH,CRITICAL`.
Les deux portes (smoke et publication) lisent le même fichier
combiné : `.trivyignore` public plus la liste privée du secret
(exceptions privées revues périodiquement). Secret absent ou vide :
échec fermé.

Aucune URL de run, aucun identifiant d’infra, aucun identifiant
listé ici.

Avant = recette de main (`029f7c2c`), publication sans
`--ignorefile` sur le scan des deux plateformes.
Après = cette branche, `ENGINE_SET=all`, même fichier combiné
que le smoke.

## Comptes

Une ligne Trivy = un paquet.

| | publication avant (amd64+arm64) | après amd64 | après arm64 | publication après |
|---|---:|---:|---:|---:|
| critical | 0 | (scan local) | (scan local) | (scan local) |
| high | 3 | (scan local) | (scan local) | (scan local) |

```
vulnerability attestation summary: critical=0 high=3
```

```
vulnerability attestation summary: critical=0 high=0
```

Le smoke `agent-browser` ouvre une page `data:` sur l’image
construite (amd64 natif ; arm64 via la même recette).
