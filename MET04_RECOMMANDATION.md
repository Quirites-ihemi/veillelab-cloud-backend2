# MET04 — Éprouver une recommandation

## Finalité

MET04 aide l’analyste à éprouver la **documentation** d’une recommandation déjà structurée dans le corpus. Il ne juge ni son opportunité, ni sa faisabilité, ni son efficacité.

## Entrée V1

Une recommandation précise du graphe :

```json
{
  "action_id": "MET04",
  "material_id": "node:N1207"
}
```

`node_id` ou `recommendation_id` sont également acceptés. Le nœud doit être typé `recommandation` dans le corpus actif.

## Dimensions contrôlées

MET04 recherche uniquement les relations explicitement structurées autour de la recommandation :

1. **Problème ou besoin** — relations comme `REPOND_A`.
2. **Acteur de mise en œuvre ou destinataire** — `MOBILISE` ou `EST_DESTINATAIRE_DE`.
3. **Effet attendu ou mécanisme d’action** — `CONTRIBUE_A`, `PERMET_DE`, `RENFORCE`, etc.
4. **Conditions, appuis ou dépendances** — `S_APPUIE_SUR`, `REPOSE_SUR`.
5. **Limites, tensions ou contrepoints** — `NUANCE`, `REMET_EN_CAUSE`, `CONTREDIT`, `FREINE`.

L’origine de la recommandation (`PRECONISE`, `PORTE`, `IMPULSE`) est restituée séparément afin de ne pas confondre **auteur/porteur** et **acteur de mise en œuvre**.

## Règles méthodologiques

- L’absence d’un lien dans le graphe signifie seulement que cette dimension n’est **pas documentée dans le graphe**.
- Une absence de limite documentée ne signifie jamais absence de risque.
- Un effet attendu documenté n’est pas transformé en causalité démontrée.
- MET04 ne réécrit pas la recommandation.
- MET04 ne produit pas de nouvelle recommandation.
- Les décisions de faisabilité, d’efficacité et d’opportunité restent à l’analyste.

## Cas de contrôle principal

`N1207` — PUB101 — *Confier au Conseil national des activités privées de sécurité une mission d’observatoire du secteur de la sécurité privée* :

- problème/besoin documenté par `R101_17 | REPOND_A` ;
- acteur documenté par `R101_18 | MOBILISE` ;
- preuve fine A via `C0900` ;
- pas d’effet/mécanisme, condition ou limite explicitement reliés dans le graphe.

Le résultat doit donc signaler les deux dimensions documentées et les trois dimensions manquantes **sans conclure que la recommandation est mauvaise, irréaliste ou inefficace**.

## Cas complémentaire

`N1173` — *Détection des signaux faibles et prévention ciblée des infractions sexuelles sur mineurs* :

- effet/mécanisme documenté par `R090_22 | CONTRIBUE_A` ;
- appui documenté par `R090_23 | S_APPUIE_SUR` ;
- aucune conclusion automatique d’efficacité ou de faisabilité.
