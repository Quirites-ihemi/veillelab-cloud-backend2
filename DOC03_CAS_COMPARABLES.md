# DOC03 — Chercher des cas comparables

## Principe

DOC03 ne conclut jamais que deux cas sont méthodologiquement comparables.
Il propose uniquement des **cas candidats à examiner** lorsqu'il retrouve, dans
d'autres publications du corpus actif, plusieurs caractéristiques documentées
communes avec l'élément de départ.

La vérification de la comparabilité reste une opération distincte (MET01).

## Entrées

`POST /reflection-assist`

Exemple à partir d'un matériau du graphe :

```json
{
  "action_id": "DOC03",
  "material_id": "node:N0672"
}
```

DOC03 accepte aussi `element` ou `query`. Dans ce cas, `origin_publication_id`
peut être fourni pour exclure la publication de départ.

## Règles V0.1

- corpus uniquement ;
- chunks + graphe via `corpus-search-v0.2-compound-concepts` ;
- exclusion de la publication d'origine lorsqu'elle est connue ;
- rapprochements à partir de caractéristiques explicitement repérées ;
- 4 cas maximum par défaut ;
- pas d'analyse, pas d'équivalence, pas de transposition ;
- aucun résultat n'est forcé si les critères sont insuffisants.

Pour les concepts déjà contrôlés par le moteur global, DOC03 réutilise une
formulation canonique. Pour le reste, il se limite à des ancres lexicales
sélectives présentes dans le corpus. Cette V0.1 reste volontairement
explicable et déterministe : pas de Claude, pas d'embeddings.

## Sortie

Chaque cas précise :

- la publication ;
- les caractéristiques communes repérées ;
- la nature du rapprochement ;
- `comparability_verified: false` ;
- jusqu'à deux matériaux du corpus justifiant le rapprochement, avec leur
  provenance A/B/C.
