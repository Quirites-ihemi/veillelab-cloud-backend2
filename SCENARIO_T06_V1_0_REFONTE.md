# T06 — Scénario de veille V1.0

Refonte du traitement T06 selon le principe **besoin d'abord, corpus ensuite**.

## Parcours

1. **Cadrer le besoin** : le besoin utilisateur reste inchangé ; Quiritès pose 3 à 5 questions facultatives et affiche un aperçu brut de couverture du corpus.
2. **Choisir des axes de veille** : deux structurations rivales sont proposées par l'IA à partir du besoin et d'une grille de veille. Le corpus documente ensuite chaque axe, sans pouvoir l'interdire.
3. **Construire la grille de guet** : par axe, distinction entre tendances documentées, signes de changement à guetter, hypothèses de regroupement, sources à surveiller et angles morts.
4. **Prévisualiser et générer** : assemblage déterministe des seuls éléments retenus par le veilleur. Aucun nouvel appel IA.

## Statuts visibles

- `Corpus` : énoncé documentaire sourcé.
- `Proposition IA à valider` : axe, question, signe à guetter ou hypothèse ; jamais présenté comme un fait.
- `Enrichissement contrôlé` : ressource extérieure explicitement séparée du corpus (ESPAS Horizon à l'étape 3).
- `À instruire` : axe utile mais peu ou pas documenté dans le corpus ; il n'est pas supprimé.

## Routes

- `POST /scenario-framing`
- `POST /scenario-axes`
- `POST /scenario-dynamics`

Version `/health` attendue : `cloud-v0.13.0-t06-scenario-refonte`.

## Garde-fous

- Le corpus ne décide plus des axes de veille.
- Une tendance exige au moins deux matériaux provenant de publications différentes.
- Les signes de changement sont formulés comme éléments **à guetter**, pas comme faits déjà observés.
- Les hypothèses de regroupement ne sont jamais présentées comme des signaux faibles établis.
- L'étape finale ne génère aucun contenu nouveau.
