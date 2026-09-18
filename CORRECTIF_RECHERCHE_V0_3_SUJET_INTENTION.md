# Correctif recherche corpus V0.3 — sujet d'abord

## Problème corrigé

La requête « quelles perspectives d'avenir pour la cybercriminalité » faisait remonter `chunk:C0558` (PUB026, jeunesses et discriminations) parce que le moteur V0.2 comptait `perspectives` et `avenir` comme deux concepts sur trois, même sans aucune correspondance avec `cybercriminalité`.

## Nouvelle règle

Le moteur sépare désormais :
- le **sujet central** de la requête, qui doit être présent dans tout résultat retenu ;
- l'**intention documentaire**, qui ne sert qu'à classer les résultats déjà pertinents pour le sujet.

Pour la requête de contrôle :
- sujet : `cybercriminalite` ;
- intention : `future_outlook` (`perspectives`, `avenir`).

Un texte contenant seulement « perspectives d'avenir » mais pas le sujet `cybercriminalité` est donc exclu.

## Moteur

`corpus-search-v0.3-topic-first`

## Régressions vérifiées

- `terrorisme masculiniste` : OK
- `sécurité nationale` : OK
- `Ukrainiens protection temporaire` : OK
- `confiance police population` : OK
- `ports narcotrafic` : OK
- concepts composés narcotrafic + port : OK
- `quelles perspectives d'avenir pour la cybercriminalité` : `C0558/PUB026` exclu ; PUB006 en tête
- `avenir cybercriminalité` : retourne désormais des résultats pertinents au lieu de zéro résultat
- tous les tests Reflection Assist DOC/MIR/MET : OK

## Fichiers modifiés

- `globalSearch.js`
- `test_global_search.js`

Aucun changement du front n'est requis pour ce correctif.
