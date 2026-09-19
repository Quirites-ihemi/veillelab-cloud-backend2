# T02 — Glossaire activé

## Fonction
T02 identifie et explicite le vocabulaire spécialisé, professionnel ou technique présent dans une à quatre publications sélectionnées.

## Règles de fiabilité
- extraction stricte : aucune connaissance extérieure ;
- provenance obligatoire par chunk et page/timecode quand disponible ;
- distinction entre définition explicite dans la source, explicitation contextuelle et définition insuffisante ;
- audit final de fidélité avant affichage ;
- si le corpus ne permet pas de définir précisément un terme, le moteur le signale au lieu de compléter par supposition.

## Backend
`POST /jobs` accepte désormais `treatment_id: "T02"`.
Le résultat est retourné dans `job.result.output.entries`.

Moteur : `t02-v0.1-strict-glossary`.
