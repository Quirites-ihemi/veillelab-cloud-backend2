# MIR08 — Vérifier l’ancrage empirique

## Finalité
MIR08 examine un ou plusieurs segments rédigés par l’utilisateur et vérifie si le corpus actif contient des matériaux empiriques suffisamment proches et précisément sourcés.

MIR08 ne juge pas la vérité d’une affirmation. Il vérifie uniquement son ancrage empirique dans le corpus actif.

## Règles V0.1 — correctif v0.6.1
- Seuls les segments reconnus comme empiriques sont évalués comme « ancrés » ou « faiblement ancrés ».
- Une proposition conceptuelle ou évaluative n’est pas automatiquement qualifiée de faiblement étayée : elle est marquée `outside_empirical_check_scope`.
- Un ancrage empirique exige une provenance fine de niveau A.
- Un matériau marqué `ILLUSTRE` n’est pas compté comme preuve empirique à lui seul.
- Lorsqu’un segment comporte une quantification, les valeurs numériques du matériau doivent correspondre ; une donnée seulement voisine n’est pas traitée comme preuve.
- L’absence d’ancrage dans le corpus actif ne signifie ni que l’affirmation est fausse, ni qu’aucune preuve n’existe hors corpus.
- MIR08 ne choisit pas d’exemples pour construire l’argument de l’utilisateur et ne produit pas de généralisation.
- `empirical_anchor_count` compte uniquement les matériaux effectivement restitués dans `materials` et retenus comme ancrages empiriques après filtrage/dédoublonnage.

## Entrée
`POST /reflection-assist`

```json
{
  "action_id": "MIR08",
  "text": "En 2024, 78 % du volume de cocaïne saisi en France l'a été par voie maritime."
}
```

## États possibles par segment
- `empirical_anchor_found`
- `documentary_support_without_matching_empirical_anchor`
- `no_sufficient_corpus_anchor`
- `outside_empirical_check_scope`

## Cas de contrôle
1. `78 % ... voie maritime` : retrouve C0523 et valide l’ancrage empirique.
2. `90 % ... voie maritime` : retrouve éventuellement des matériaux proches, mais refuse de les compter comme preuve car la quantification ne correspond pas.
3. Une proposition évaluative comme « X est supérieur à Y » : hors périmètre de la vérification empirique V0.1, et non étiquetée automatiquement comme insuffisamment étayée.
