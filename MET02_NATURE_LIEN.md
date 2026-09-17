# MET02 — Vérifier la nature du lien

## Finalité

MET02 aide l'analyste à qualifier un lien déjà présent dans le graphe sans le surinterpréter. Il ne crée pas de relation et ne transforme jamais une association en causalité.

## Entrée V1

Une relation précise du corpus :

```json
{
  "action_id": "MET02",
  "material_id": "relation:R018_07"
}
```

`relation_id: "R018_07"` est également accepté.

## Règles méthodologiques

- `ASSOCIATION` est traitée comme une association statistique : aucune causalité ne peut en être déduite.
- `ASSOCIE_A` est un lien sémantique générique : il n'est ni une preuve statistique ni une preuve causale.
- Les relations formulées en termes de contribution, influence, renforcement, accentuation, etc. sont signalées comme des formulations causales ou contributives à vérifier méthodologiquement ; le libellé seul ne démontre jamais une causalité.
- Le sens `source -> cible` du graphe n'est jamais assimilé automatiquement à une direction causale.
- Les liens descriptifs (`ILLUSTRE`, `CARACTERISE`, `QUANTIFIE`, etc.) restent descriptifs.
- Les marqueurs trouvés dans la source sont recherchés dans les segments de preuve les plus proches des deux nœuds de la relation, afin de limiter les faux signaux issus d'un chunk plus large.
- Une formulation prudente de la source (`peut`, `pourrait`, `susceptible`, etc.) est conservée comme telle.
- Même si une source utilise un vocabulaire causal, MET02 ne valide pas la causalité à la place de l'analyste.

## Cas de contrôle principal

`R018_07` — PUB018 — *Les disparités communales en matière de vols sans violence* :

- relation : `ASSOCIATION` ;
- famille : `statistical_association` ;
- statut : `association_does_not_establish_causality` ;
- preuve fine : niveau A, notamment `C0418` ;
- le passage source précise qu'un modèle économétrique isole des **corrélations** ;
- `causal_inference_allowed = false`.

Ce cas est décisif car il empêche de transformer une relation statistique entre présence de police municipale et fréquence des vols enregistrés en relation de cause à effet.

## Cas complémentaire

`R014_13` — `PEUT_CONTRIBUER_A` : la source dit que la hausse des refus d'obtempérer **pourrait** s'expliquer par l'intensification des contrôles. MET02 conserve cette prudence et renvoie `causal_or_contributive_wording_requires_methodological_verification`.

## Garde-fous

MET02 :
- travaille uniquement sur le corpus actif ;
- vérifie une relation explicite ;
- ne convertit pas association en causalité ;
- ne traite pas la direction du graphe comme une direction causale ;
- ne déclare pas une causalité sur la seule base d'un libellé ou d'une formulation ;
- ne juge pas la vérité ou la fausseté du lien ;
- ne réécrit pas la relation.
