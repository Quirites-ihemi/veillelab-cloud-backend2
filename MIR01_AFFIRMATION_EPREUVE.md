# MIR01 — Mettre une affirmation à l’épreuve

Version : `reflection-assist-v0.4-doc01-doc02-doc03-mir01`

## Finalité

MIR01 examine une affirmation fournie par l’utilisateur à partir du seul corpus actif.
Il ne décide pas si l’affirmation est vraie ou fausse et ne reformule pas le raisonnement de l’analyste.

La sortie distingue :
- des matériaux d’**appui** ;
- des matériaux de **nuance** ;
- des **contradictions explicites** lorsqu’elles sont réellement structurées dans le corpus ;
- du contexte documentaire éventuellement utile mais non classé comme appui/nuance/contradiction.

## Principe de prudence

La classification est documentaire, pas argumentative.

Pour une affirmation causale, MIR01 détecte le langage causal et conserve un garde-fou explicite :
une association ou une cooccurrence n’est jamais transformée en causalité.

Les matériaux d’appui peuvent donc être distingués selon qu’ils documentent :
- une séquence causale explicitement formulée dans la source ;
- ou seulement un appui descriptif / associatif.

Les formulations limitatives de la source (par exemple caractère temporaire ou non nécessaire) sont classées en nuance.

## Entrée

```json
{
  "action_id": "MIR01",
  "assertion": "Le renforcement des contrôles portuaires déplace les flux de cocaïne vers des ports secondaires."
}
```

`assertion` est obligatoire. `element` ou `query` restent acceptés comme alias techniques.

## Sortie principale

- `claim_analysis` : présence éventuelle d’un langage causal et précaution méthodologique ;
- `evidence.support` : matériaux allant dans le sens de l’affirmation ;
- `evidence.nuance` : matériaux qui limitent, déplacent ou complexifient l’affirmation ;
- `evidence.contradiction` : uniquement contradictions explicites repérées dans le corpus ;
- `documentary_state` : état de la matière documentaire, sans verdict ;
- `guardrails` : contraintes de non-substitution au raisonnement humain.

Chaque matériau conserve :
- publication ;
- type de résultat (chunk, nœud, relation) ;
- score de pertinence ;
- provenance A/B/C ;
- page/timecode uniquement s’il existe ;
- contenu réellement présent dans le corpus.

## Garde-fous

MIR01 :
- utilise uniquement le corpus actif ;
- ne réécrit pas l’affirmation ;
- ne décide pas vrai/faux ;
- ne produit pas de problématique ;
- ne produit pas de recommandation ;
- n’infère pas une causalité à partir d’une association ;
- n’invente pas de contre-argument ;
- ne considère jamais l’absence de contradiction trouvée comme preuve d’absence de contradiction.

## Tests intégrés

1. Affirmation causale sur contrôles portuaires / flux de cocaïne : appui + nuance, avec garde-fou causal.
2. « L’image des forces de sécurité intérieure est globalement positive » : appui + relations `NUANCE` de PUB013.
3. Vérité-adéquation : détection d’une relation explicite `REMET_EN_CAUSE` dans PUB062.

MIR01 V0.1 n’utilise ni Claude ni embeddings. Il s’appuie sur `corpus-search-v0.2-compound-concepts`, le graphe structuré et des marqueurs documentaires contrôlés.


## Correctif v0.4.1 — « REMET_EN_CAUSE » n'est pas une contradiction automatique

Une relation de graphe `REMET_EN_CAUSE` est désormais classée par défaut comme **nuance / tension documentée**. Elle ne devient pas une contradiction de l'affirmation testée du seul fait de son type de relation.

La catégorie `contradiction` est réservée aux matériaux explicitement structurés comme contradiction (`CONTREDIT`) ou, dans une évolution ultérieure, à un mécanisme suffisamment fiable permettant d'établir qu'un matériau nie effectivement le contenu propositionnel de l'affirmation.

Exemple de contrôle : pour « La vérité-adéquation correspond à une réalité extérieure indépendante de l'individu », la définition issue de PUB062 est un **appui** ; la relation indiquant que la post-vérité `REMET_EN_CAUSE` la vérité-adéquation est une **tension / nuance**, et non une contradiction de cette définition.
