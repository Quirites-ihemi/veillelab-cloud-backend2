# Quiritès Veille Lab — Backend Cloud Run

Backend public de Quiritès Veille Lab.

## Routes

- `GET /` et `GET /health` — état du service
- `POST /jobs` — création des jobs asynchrones T01/T03
- `GET /jobs/{id}` — suivi des jobs
- `POST /tasks/process` — traitement interne Cloud Tasks
- `POST /graph-chat` — chatbot de l’onglet 2, synchrone et strictement limité au graphe envoyé par le frontend

## Chatbot de graphe

Le frontend envoie uniquement la publication ouverte, ses nœuds et ses relations. Le backend ne complète pas avec des connaissances externes et demande au modèle de signaler explicitement quand le graphe est insuffisant.

Garde-fous :

- origine navigateur contrôlée ;
- longueur de question plafonnée ;
- nombre de nœuds et relations plafonné ;
- quota partagé via Firestore, sans stockage de l’IP brute ;
- timeout et 2 tentatives Anthropic maximum ;
- sortie structurée avec validation des `node_id` et `relation_id` ;
- logs avec `request_id`, sans journaliser le texte de la question.

### Variables d’environnement optionnelles

- `GRAPH_CHAT_ALLOWED_ORIGINS` — liste séparée par des virgules ; par défaut : `https://quirites-ihemi.github.io,http://localhost:5173,http://127.0.0.1:5173`
- `GRAPH_CHAT_RATE_LIMIT` — 30 requêtes par fenêtre par défaut
- `GRAPH_CHAT_RATE_WINDOW_MS` — 300000 ms par défaut
- `GRAPH_CHAT_MAX_QUESTION_CHARS` — 700 caractères par défaut
- `GRAPH_CHAT_MAX_NODES` — 160 par défaut
- `GRAPH_CHAT_MAX_RELATIONS` — 320 par défaut
- `GRAPH_CHAT_ANTHROPIC_TIMEOUT_MS` — 45000 ms par défaut

Le secret Anthropic reste dans Secret Manager via `ANTHROPIC_SECRET`.

Aucune clé API ni secret n’est stocké dans ce dépôt.
Migration du backend vers le dépôt Quiritès — septembre 2026.
