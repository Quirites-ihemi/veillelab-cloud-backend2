# Recherche globale V0.1 — Quiritès Veille Lab

## Objectif
Améliorer le classement déterministe de `POST /corpus-search` sans modifier T01, T03 ni `/graph-chat`, et sans ajouter d'appel LLM ou de dépendance.

## Changements V0.1
- pondération distincte du contenu principal, des sections, du titre et des métadonnées ;
- forte priorité aux résultats qui couvrent tous les concepts importants d'une requête ;
- pénalisation des résultats qui ne couvrent qu'une partie d'une requête multi-concepts ;
- suppression des correspondances par sous-chaîne pour les mots isolés (`port` ne matche plus `rapport`) ;
- petite expansion lexicale contrôlée et auditable pour les concepts actuellement testés (`narcotrafic` / trafic de cocaïne / stupéfiants ; `port` / portuaire / variantes anglaises) ;
- conservation de la diversification par publication et des trois niveaux de provenance A/B/C.

## Test de référence
Pour `narcotrafic ports`, la V0.1 retourne uniquement des résultats couvrant les deux concepts parmi les candidats suffisamment pertinents. Les premiers résultats viennent de PUB024 et PUB025 ; PUB006, PUB051 et autres résultats ne couvrant qu'un terme ne polluent plus le haut du classement.

## Route
`POST /corpus-search`

Exemple :

```json
{
  "query": "narcotrafic ports",
  "limit": 12
}
```

## Tests

```bash
node test_global_search.js
```

Les tests couvrent les publications sans chunks (via le graphe), les publications textuelles et un contrôle spécifique du ranking multi-concepts.
