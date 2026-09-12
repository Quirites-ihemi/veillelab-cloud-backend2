CORRECTIF CHATBOT v0.8.2 — VERSION MINIMALE ET SÛRE

Base de référence : veillelab-cloud-backend2-main(1).zip
Version /health de cette base : cloud-v0.8.1-public-chat-stable

IMPORTANT
- Ce paquet ne contient volontairement QUE graphChat.js.
- Ne remplacez PAS server.js.
- Ne modifiez PAS t01.js ni t03.js.
- Ne modifiez PAS package.json.
- Le /health restera donc cloud-v0.8.1-public-chat-stable : c'est volontaire.

Déploiement
1. Dans le dépôt actuel Nath76/veillelab-cloud-backend2, ouvrir graphChat.js.
2. Remplacer uniquement ce fichier par le graphChat.js fourni ici.
3. Valider le commit et attendre le déploiement Cloud Run.
4. Vérifier d'abord /health : il doit toujours répondre normalement et afficher cloud-v0.8.1-public-chat-stable.
5. Tester ensuite /graph-chat avec les 3 questions de contrôle convenues.

Corrections contenues dans graphChat.js uniquement
- distinction relation directe / chemin indirect ;
- REPOND_A ne peut plus être remplacé par PERMET_DE, MOBILISE ou CONTRIBUE_A ;
- meilleure limitation au périmètre exact de la question ;
- réponses courtes pour « en gros », « une seule idée », « à retenir » ;
- pas de décompte annoncé si la question ne demande pas de compter ;
- suppression robuste des marqueurs internes INTRO / SECTION / ITEM ;
- consignes de français standard et de réponse non tronquée ;
- refus hors-graphe maintenu ;
- aucune modification de T01/T03 ou de l'architecture Cloud Run.

Contrôles effectués avant livraison
- syntaxe Node.js : OK (node --check) ;
- parsing des marqueurs INTRO/SECTION/ITEM sur une même ligne : OK ;
- réponse « une seule idée » limitée à l'introduction : OK ;
- réponse « en gros » limitée à 2 sections / 2 items par section : OK ;
- dans le candidat complet, server.js, t01.js, t03.js, package.json et README.md sont strictement identiques à la base v0.8.1.
