# MIR04 — Faire apparaître les contradictions entre matériaux

Version : `reflection-assist-v0.5-mir04`

## Finalité

MIR04 examine des matériaux du corpus pour faire apparaître uniquement les oppositions **explicitement structurées** dans le graphe.

Il distingue strictement :
- les **contradictions explicites** (`CONTREDIT`) ;
- les **tensions documentées** (`NUANCE`, `REMET_EN_CAUSE`, `SE_DISTINGUE_DE`, `FREINE`, `CONTRIBUE_PARTIELLEMENT_A`).

Une nuance, une remise en cause ou une distinction n'est jamais assimilée automatiquement à une contradiction.

## Entrée recommandée

MIR04 est d'abord conçu pour comparer des matériaux déjà sélectionnés dans le canevas :

```json
{
  "action_id": "MIR04",
  "material_ids": ["node:N0366", "node:N0370"]
}
```

De 2 à 8 matériaux peuvent être sélectionnés.

Une recherche thématique reste également possible :

```json
{
  "action_id": "MIR04",
  "query": "image des forces de sécurité intérieure"
}
```

Le mode par matériaux sélectionnés est le plus prudent et doit être privilégié dans l'interface.

## Sortie

- `findings.explicit_contradictions` : uniquement les relations explicitement structurées comme contradictions ;
- `findings.documented_tensions` : nuances, remises en cause, distinctions ou limitations documentées ;
- `documentary_state` : indique si une contradiction ou une tension explicite a été retrouvée ;
- `guardrails` : rappelle que l'absence de relation explicite ne prouve pas la compatibilité des matériaux.

Chaque résultat conserve sa publication, sa provenance A/B/C et ses preuves fines lorsqu'elles sont disponibles.

## Garde-fous

MIR04 :
- utilise uniquement le corpus actif ;
- n'infère pas une contradiction à partir d'une simple différence ;
- ne traite pas `NUANCE` comme `CONTREDIT` ;
- ne traite pas `REMET_EN_CAUSE` comme `CONTREDIT` ;
- ne décide pas quel matériau est correct ;
- ne produit ni problématique ni recommandation ;
- ne conclut jamais que l'absence de contradiction trouvée signifie que les matériaux sont compatibles.

## Tests intégrés

1. `N0366` + `N0370` (PUB013) : la relation `R013_11 | NUANCE` doit apparaître comme tension documentée et non comme contradiction.
2. `N1040` + `N1044` (PUB062) : `R062_05 | REMET_EN_CAUSE` doit rester une tension documentée.
3. `N0672` + `N1010` : aucune opposition n'est forcée en l'absence de relation explicite.

Cette V0.1 n'utilise ni Claude ni embeddings. Elle privilégie la fiabilité à l'exhaustivité et s'appuie exclusivement sur les relations déjà validées dans le graphe.
