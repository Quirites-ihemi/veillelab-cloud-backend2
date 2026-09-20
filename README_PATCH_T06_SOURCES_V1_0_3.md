# T06 — V1.0.3 — Traçabilité des objets de veille

Correctif backend ciblé sur l'étape 3 « Objets de la veille ».

## Changements

- Chaque tendance documentée conserve ses `material_ids` et ses sources enrichies.
- Chaque signe de changement affichable doit désormais avoir au moins un `material_id` valide.
- Chaque source à surveiller affichable doit désormais avoir au moins un `material_id` valide.
- Les objets sans référence valide sont écartés au lieu d'être envoyés au front avec « référence non associée ».
- Les métadonnées de source renvoyées au front contiennent : publication, titre, organisme, année, repère, URL et indicateur `access_available`.
- Si le matériau sélectionné n'a pas d'URL mais qu'un autre résultat de la même publication en possède une, cette URL est utilisée comme accès de repli.
- Les « sources à surveiller » doivent correspondre à des publications réellement représentées dans les matériaux ; aucune URL n'est inventée.
- La génération reste isolée axe par axe : l'échec d'un axe ne vide pas les autres.

## Tests

`node test_t06.js` passe avec :
- conservation de la provenance publication + repère ;
- présence des URLs dans les sources test ;
- filtrage des signes/sources sans `material_id` valide ;
- maintien du test d'isolement des pannes par axe.

Moteur renvoyé : `t06-watch-v1.0.3-source-traceability`.
