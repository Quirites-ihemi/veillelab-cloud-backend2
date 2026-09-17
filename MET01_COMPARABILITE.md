# MET01 — Vérifier la comparabilité

## Finalité

MET01 est un **aiguillon méthodologique**. Il aide l’analyste à vérifier si deux matériaux peuvent raisonnablement être mis en regard, sans effectuer la comparaison à sa place et sans déclarer automatiquement qu’ils sont équivalents ou incomparables.

## Entrée V0.7

Deux matériaux exactement :

```json
{
  "action_id": "MET01",
  "material_ids": ["node:N0366", "node:N0367"]
}
```

Les identifiants acceptés sont `chunk:...`, `node:...` et `relation:...`.

## Cinq critères vérifiés

1. **Période** — années d’observation explicitement repérées dans les matériaux ou leurs preuves fines. L’année de publication n’est jamais utilisée comme substitut de période d’observation.
2. **Population / champ** — champ d’enquête et groupes explicitement mentionnés.
3. **Unité géographique** — périmètres territoriaux explicitement nommés.
4. **Définition de l’indicateur** — type de mesure effectivement repéré ; un thème commun ne suffit pas à établir que deux indicateurs sont identiques.
5. **Source / méthode** — publication, producteur, type documentaire et marqueurs méthodologiques disponibles.

## Statuts

MET01 peut notamment renvoyer :

- `documented_alignment` / `documented_overlap` : élément commun explicitement documenté ;
- `different_periods_to_review` ;
- `different_populations_to_review` ;
- `different_geographic_scopes_to_review` ;
- `different_indicator_definitions_to_review` ;
- `same_publication_context` ;
- `partially_aligned_source_context` ;
- `different_sources_to_review` ;
- `insufficient_documentation`.

Ces statuts sont des **signaux de contrôle**, pas des verdicts de comparabilité.

## Garde-fous

- corpus actif uniquement ;
- exactement deux matériaux ;
- aucune comparaison substantielle produite à la place de l’analyste ;
- aucune équivalence automatique ;
- aucune incomparabilité automatique ;
- aucun périmètre manquant inféré ;
- l’année de publication n’est jamais assimilée à la période observée ;
- conservation de la provenance disponible (publication + preuve/repère lorsque présent).

## Cas de contrôle

### Même publication, mêmes champ et territoire, indicateurs différents

`node:N0366` — *Image globalement positive des forces de sécurité intérieure*  
`node:N0367` — *Confiance élevée envers les forces de sécurité intérieure locales*

Attendu :
- population : `documented_alignment` ;
- géographie : `documented_overlap` ;
- indicateur : `different_indicator_definitions_to_review` ;
- source/méthode : `same_publication_context` ;
- décision finale : `analyst_required`.

### Contextes territoriaux et mesures différents

`node:N0672` (PUB025) et `chunk:C0460` (PUB024).

Attendu :
- géographie : `different_geographic_scopes_to_review` ;
- indicateur : `different_indicator_definitions_to_review` ;
- état : `comparability_requires_caution` ;
- aucun verdict d’incomparabilité.
