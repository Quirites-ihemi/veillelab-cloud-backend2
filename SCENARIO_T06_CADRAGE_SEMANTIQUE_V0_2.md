# T06 — Cadrage sémantique V0.2

## Objectif
Améliorer l'étape « Formulation du besoin » du scénario de veille sans reformuler la demande à la place du veilleur.

## Évolutions
- récupération multi-requêtes : sujet central + dimensions secondaires utiles (échelle, territoire, temporalité, angle) ;
- dimensions secondaires utilisées pour améliorer le rappel, jamais comme conditions bloquantes ;
- 2 à 4 notions de cadrage privilégiées lorsque les matériaux le permettent ;
- les notions peuvent être synthétisées à partir de plusieurs chunks/nœuds/relations ;
- aucun libellé synthétique n'est accepté sans matériaux sources explicites ;
- rejet des sous-thèmes trop étroits non demandés ;
- audit final conservé ;
- zéro notion reste possible si les matériaux sont réellement insuffisants.

## Transparence
Le moteur répond avec `engine: t06-framing-v0.2-synthesized` et expose les requêtes documentaires utilisées dans `retrieval.queries`.
