# Patch T06 — Objets de veille V1.0.2

Correction ciblée du bug de l'étape 3 « Objets de la veille ».

## Correction

- génération LLM désormais isolée **axe par axe** ;
- un échec sur un axe ne vide plus silencieusement les autres axes ;
- suppression du fallback trompeur qui transformait une panne technique en trois colonnes vides ;
- ajout d'un statut explicite par axe :
  - `object_generation_status: "disponible"`
  - ou `object_generation_status: "indisponible"` + `object_generation_error: true` ;
- ajout au niveau de la réponse : `generation_available` et `failed_axis_ids` ;
- budget de sortie limité à 2600 tokens **par axe**, réduisant le risque de troncature.

## Non modifié

- les routes HTTP ;
- l'étape de documentation des axes ;
- les règles de preuve des tendances (au moins deux publications) ;
- le frontend.

## Test ajouté

Une régression simule une panne sur le deuxième axe et vérifie que :
- le premier axe conserve ses objets ;
- le deuxième axe est marqué `indisponible` ;
- la panne n'est pas présentée comme une absence de contenu du corpus.
