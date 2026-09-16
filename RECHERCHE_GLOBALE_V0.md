# Recherche globale V0.2 — Quiritès Veille Lab

## Objectif
Améliorer la compréhension déterministe des requêtes multi-termes de `POST /corpus-search`, sans modifier T01, T03 ni `/graph-chat`, sans appel LLM et sans nouvelle dépendance.

## Changements V0.2
- conservation du ranking V0.1 (pondération des champs, couverture des concepts, diversification, provenance A/B/C) ;
- reconnaissance prioritaire d'expressions métier composées avant l'analyse des mots isolés ;
- consommation des mots qui appartiennent déjà à une expression composée, afin qu'ils ne deviennent pas ensuite des concepts génériques indépendants ;
- premier jeu contrôlé et auditable :
  - `trafic de cocaïne` / `trafic de stupéfiants` / variantes anglaises → concept `narcotrafic` ;
  - `infrastructure(s) portuaire(s)` / variantes anglaises → concept `port` ;
- aucune information n'est ajoutée au corpus : il s'agit uniquement d'une normalisation de la requête pour améliorer le rappel et le classement.

## Exemple de référence
La requête :

`trafic de cocaïne infrastructures portuaires`

est analysée comme :

- `narcotrafic` (source : `trafic cocaine`) ;
- `port` (source : `infrastructures portuaires`).

Elle n'est plus analysée comme quatre concepts indépendants (`narcotrafic`, `port`, `trafic`, `infrastructures`).

## Résultat attendu sur le corpus actuel
Pour cette reformulation, les résultats pertinents proviennent de PUB024 et PUB025. Les faux positifs observés en V0.1 dans PUB006 et PUB008 sont écartés du Top 12.

La requête `narcotrafic ports` reste inchangée et continue à retourner PUB024/PUB025 en tête.

La requête `terrorisme masculiniste` continue à retrouver PUB058 par le graphe seul, avec provenance C et sans fabrication de chunk ou de timecode.

## Route
`POST /corpus-search`

Exemple :

```json
{
  "query": "trafic de cocaïne infrastructures portuaires",
  "limit": 12
}
```

## Tests

```bash
node test_global_search.js
```

Les tests couvrent :
- publications textuelles et publications sans chunks ;
- régression du ranking V0.1 ;
- reconnaissance des expressions composées ;
- absence de PUB006/PUB008 dans le Top 12 de la requête de référence V0.2.
