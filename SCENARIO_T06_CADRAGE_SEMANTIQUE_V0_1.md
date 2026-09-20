# T06 — Cadrage sémantique du besoin V0.1

Nouvelle route directe : `POST /scenario-framing`.

Objectif : remplacer les heuristiques lexicales fragiles de l'étape 1 du scénario de veille par une sélection sémantique, mais strictement ancrée dans le corpus.

Pipeline :
1. le LLM décompose le besoin sans le reformuler : sujet central + dimensions secondaires ;
2. le moteur `corpus-search-v0.3-topic-first` récupère les matériaux sur le sujet central ;
3. le LLM propose 0 à 5 notions de cadrage utiles ;
4. un second passage LLM audite chaque notion et écarte les sous-thèmes trop étroits, les proximités lexicales et les éléments insuffisamment soutenus ;
5. chaque notion est restituée avec `pourquoi`, `limite` et une ou plusieurs sources précises.

Principes :
- le besoin utilisateur n'est jamais reformulé automatiquement ;
- les dimensions secondaires (territoire, échelle, temporalité...) orientent l'évaluation mais ne bloquent pas la récupération initiale ;
- aucune connaissance extérieure n'est autorisée à cette étape ;
- zéro notion est préférable à une notion faible ;
- toute proposition est sourcée.

Moteur : `t06-framing-v0.1-llm-grounded`.
Backend health : `cloud-v0.11.0-t06-framing`.
