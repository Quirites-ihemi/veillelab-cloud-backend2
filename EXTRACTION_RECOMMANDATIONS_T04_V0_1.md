# T04 — Extraction de recommandations V0.1

## Principe

T04 extrait uniquement les prescriptions explicitement formulées dans 1 à 4 publications sélectionnées.

Catégories conservées :
- recommandation ;
- préconisation ;
- proposition ;
- orientation.

Le moteur ne transforme jamais un constat, un résultat, une corrélation, une hypothèse, une difficulté ou un besoin observé en recommandation.

## Sortie

Pour chaque élément :
- identifiant ;
- type de prescription ;
- formulation fidèle ;
- objet, seulement s'il est explicite ;
- formulateur, seulement s'il est explicite ;
- destinataire, seulement s'il est explicite ;
- conditions/modalités, seulement si elles sont explicites ;
- provenance fine par chunk et page/timecode ;
- lien vers la source.

Un audit final vérifie le caractère réellement prescriptif et la fidélité documentaire avant restitution.

Moteur : `t04-v0.1-strict-recommendations`.
