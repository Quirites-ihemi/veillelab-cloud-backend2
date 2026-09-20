const assert = require('assert');
const {
  cadrerBesoinT06,
  proposerStructurationsT06,
  documenterAxesT06,
  construireGrilleGuetT06,
  fallbackStructurations,
  sanitizeStructurations,
  axisCoverageStatus,
  fallbackSubjectFromNeed
} = require('./t06');

function mk(id, pub, text, score=50){
  return {
    result_id:id, kind:'chunk', publication_id:pub, publication_title:`Publication ${pub}`,
    organisme_producteur:'Organisme test', annee_publication:'2026', locator:'4', provenance_level:'A',
    text, section:'Section', score, url_source:'https://example.test/source'
  };
}

function searchFn(body={}){
  const q=String(body.query||'').toLowerCase();
  let results=[];
  if(q.includes('données')||q.includes('mesure')||q.includes('statistique')) results=[mk('chunk:D1','PUB1','Base communale de la délinquance enregistrée et méthodes de mesure.'),mk('chunk:D2','PUB2','Comparaison de données territoriales et limites méthodologiques.')];
  else if(q.includes('territoire')||q.includes('commune')) results=[mk('chunk:T1','PUB3','Des écarts territoriaux sont observés entre communes selon les catégories d’infractions.'),mk('chunk:T2','PUB4','Les dynamiques locales diffèrent selon les territoires et les périodes observées.')];
  else if(q.includes('dispositifs')||q.includes('action publique')) results=[mk('chunk:A1','PUB5','Les dispositifs locaux de prévention associent plusieurs acteurs.'),mk('chunk:A2','PUB6','Les politiques locales de sécurité connaissent des évolutions de coordination.')];
  else results=[mk('chunk:G1','PUB1','La délinquance enregistrée est documentée à plusieurs échelles territoriales.'),mk('chunk:G2','PUB3','Des données communales existent pour plusieurs catégories d’infractions.')];
  return {engine:'corpus-search-v0.3-topic-first',results:results.slice(0,body.limit||results.length)};
}

async function callModel({tool}){
  if(tool.name==='cadrer_besoin_t06') return {
    sujet_central:'délinquance', requete_corpus:'délinquance commune', dimensions_deja_precisees:[{type:'echelle',valeur:'commune'}],
    questions:[
      {question_id:'Q1',question:'Pour quel destinataire ?',pourquoi:'Pour ajuster la veille.',dimension:'destinataire'},
      {question_id:'Q2',question:'Quel horizon ?',pourquoi:'Pour calibrer le suivi.',dimension:'horizon'},
      {question_id:'Q3',question:'Quel territoire ?',pourquoi:'Pour définir le périmètre.',dimension:'territoire'}
    ]
  };
  if(tool.name==='proposer_structurations_t06') return {
    structurations:[
      {structure_id:'A',titre:'Phénomène et territoires',logique:'Suivre ce qui change dans le phénomène et sa géographie.',axes:[
        {axis_id:'A1',titre:'Mesure de la délinquance',objectif_surveillance:'Suivre les évolutions de la mesure.',pourquoi:'La mesure conditionne la lecture.',questions:['Comment évolue la qualité des données ?'],requete_rag:'délinquance données mesure'},
        {axis_id:'A2',titre:'Différenciations territoriales',objectif_surveillance:'Suivre les écarts territoriaux.',pourquoi:'La géographie peut évoluer.',questions:['Quels écarts entre communes ?'],requete_rag:'délinquance territoire commune'},
        {axis_id:'A3',titre:'Réponses locales',objectif_surveillance:'Suivre les adaptations de l’action locale.',pourquoi:'Les réponses publiques évoluent.',questions:['Quels dispositifs changent ?'],requete_rag:'délinquance dispositifs action publique'}
      ]},
      {structure_id:'B',titre:'Connaissance et action publique',logique:'Suivre la chaîne allant de la mesure à l’action.',axes:[
        {axis_id:'B1',titre:'Production de la connaissance',objectif_surveillance:'Suivre méthodes et données.',pourquoi:'La connaissance évolue.',questions:['Quelles méthodes changent ?'],requete_rag:'délinquance méthodes données'},
        {axis_id:'B2',titre:'Lecture territoriale',objectif_surveillance:'Suivre les variations territoriales.',pourquoi:'Les écarts structurent la veille.',questions:['Quels territoires se distinguent ?'],requete_rag:'délinquance territoire commune'},
        {axis_id:'B3',titre:'Gouvernance locale',objectif_surveillance:'Suivre les coordinations.',pourquoi:'Les modes de réponse évoluent.',questions:['Quelles coordinations apparaissent ?'],requete_rag:'délinquance dispositifs action publique'}
      ]}
    ]
  };
  if(tool.name==='documenter_axes_t06') return {
    axes:[
      {axis_id:'A1',material_ids:['chunk:D1','chunk:D2'],apport_corpus:'Le corpus documente des données communales et leurs limites.',limite_corpus:'Les séries ne sont pas homogènes.'},
      {axis_id:'A2',material_ids:['chunk:T1','chunk:T2'],apport_corpus:'Le corpus documente des écarts territoriaux.',limite_corpus:'Les catégories ne sont pas toutes couvertes.'},
      {axis_id:'A3',material_ids:['chunk:A1'],apport_corpus:'Un document décrit des dispositifs locaux.',limite_corpus:'Appui concentré sur une seule publication.'},
      {axis_id:'B1',material_ids:['chunk:D1','chunk:D2'],apport_corpus:'Le corpus documente la production de données.',limite_corpus:'Couverture partielle.'},
      {axis_id:'B2',material_ids:['chunk:T1'],apport_corpus:'Un document traite des territoires.',limite_corpus:'Une seule publication.'},
      {axis_id:'B3',material_ids:[],apport_corpus:'',limite_corpus:'Aucun matériau suffisamment pertinent.'}
    ]
  };
  if(tool.name==='construire_grille_guet_t06') return {
    axes:[
      {axis_id:'A1',tendances:[{trend_id:'A1-T1',label:'Affinement progressif de la mesure locale',synthese:'Plusieurs matériaux documentent une attention croissante aux données territoriales fines.',limite:'Les séries restent hétérogènes.',material_ids:['chunk:D1','chunk:D2']}],signes_a_guetter:[
        {sign_id:'A1-S1',label:'Publication de nouvelles séries communales',pourquoi_guetter:'Cela améliorerait la comparabilité locale.',ce_qui_confirmerait:'Des séries régulières et comparables.',ce_qui_affaiblirait:'Des données ponctuelles non reconduites.',material_ids:['chunk:D1']},
        {sign_id:'A1-S2',label:'Évolution des catégories statistiques',pourquoi_guetter:'Cela pourrait modifier la lecture des évolutions.',ce_qui_confirmerait:'Des changements méthodologiques stabilisés.',ce_qui_affaiblirait:'Un ajustement ponctuel.',material_ids:['chunk:D2']}
      ],hypotheses_regroupement:[{hypothesis_id:'A1-H1',label:'Recomposition de l’appareil de mesure local',interpretation:'La convergence de nouvelles séries et de nouvelles catégories pourrait signaler une transformation de la mesure.',sign_ids:['A1-S1','A1-S2'],ce_qui_invaliderait:'Absence de pérennisation des changements.'}],sources_a_surveiller:[{label:'Publications statistiques territoriales',raison:'Elles documentent la mesure locale.',material_ids:['chunk:D1','chunk:D2']}],angles_morts:['Comparabilité de long terme']}
    ]
  };
  throw new Error(`outil inattendu ${tool.name}`);
}

(async()=>{
  const need='Je souhaite suivre l’évolution de la délinquance à l’échelle communale.';
  const framing=await cadrerBesoinT06({apiKey:'fake',besoin:need,searchFn,callModel});
  assert.equal(framing.engine,'t06-framing-v1.0-maieutique');
  assert.equal(framing.questions.length,3);
  assert.ok(framing.couverture_corpus.publication_count>=1);

  const axes=await proposerStructurationsT06({apiKey:'fake',besoin:need,cadrage:framing,reponses:[{question_id:'Q1',question:'Pour quel destinataire ?',answer:'Une direction territoriale'}],searchFn,callModel});
  assert.equal(axes.structurations.length,2);
  assert.equal(axes.structurations[0].axes.length,3);
  assert.equal(axes.structurations[0].axes[0].corpus_status,'non_evalue');
  assert.equal(axes.guardrails.corpus_documentation_after_choice,true);

  const selected=axes.structurations[0].axes.slice(0,1);
  const support=await documenterAxesT06({apiKey:'fake',besoin:need,cadrage:framing,reponses:[],axes:selected,searchFn,callModel});
  assert.equal(support.axes.length,1);
  assert.equal(support.axes[0].corpus_status,'documente');
  assert.equal(support.documentation_available,true);

  const dynamics=await construireGrilleGuetT06({apiKey:'fake',besoin:need,cadrage:framing,reponses:[],axes:support.axes,searchFn,callModel});
  assert.equal(dynamics.engine,'t06-watch-v1.0-axis-by-axis');
  assert.equal(dynamics.axes.length,1);
  assert.equal(dynamics.axes[0].tendances.length,1);
  assert.equal(dynamics.axes[0].signes_a_guetter.length,2);
  assert.equal(dynamics.axes[0].hypotheses_regroupement.length,1);
  assert.equal(dynamics.methodological_reference.origin,'enrichissement_controle');
  assert.equal(axisCoverageStatus([]),'a_instruire');
  assert.equal(fallbackStructurations('délinquance').length,2);

  // Régression 1 : une panne de documentation n'est jamais présentée comme une lacune du corpus.
  const failSupportModel=async ({tool}) => {
    if(tool.name==='documenter_axes_t06') throw new Error('simulation troncature');
    return callModel({tool});
  };
  const unavailable=await documenterAxesT06({apiKey:'fake',besoin:need,cadrage:framing,reponses:[],axes:selected,searchFn,callModel:failSupportModel});
  assert.equal(unavailable.documentation_available,false);
  assert.equal(unavailable.axes[0].corpus_status,'indisponible');
  assert.ok(unavailable.axes[0].limite_corpus.includes('indisponibilité technique'));

  // Régression 2 : un axe malformé ne jette pas l'autre structuration.
  const partial=sanitizeStructurations({structurations:[
    {structure_id:'A',titre:'A spécifique',logique:'A',axes:[
      {axis_id:'A1',titre:'Axe spécifique 1',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'},
      {axis_id:'A2',titre:'Axe spécifique 2',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'},
      {axis_id:'A3',titre:'',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'}
    ]},
    {structure_id:'B',titre:'B spécifique',logique:'B',axes:[
      {axis_id:'B1',titre:'B axe 1',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'},
      {axis_id:'B2',titre:'B axe 2',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'},
      {axis_id:'B3',titre:'B axe 3',objectif_surveillance:'Obj',questions:['Q'],requete_rag:'q'}
    ]}
  ]},'délinquance');
  assert.equal(partial.length,2);
  assert.equal(partial[0].titre,'A spécifique');
  assert.ok(partial[0].axes.some(a=>a.titre==='Axe spécifique 1'));
  assert.equal(partial[1].titre,'B spécifique');

  // Régression 3 : le fallback de cadrage produit un sujet, pas la phrase d'intention entière.
  const fallbackSubject=fallbackSubjectFromNeed('Je souhaite faire une veille sur l’évolution de la délinquance à l’échelle communale.');
  assert.ok(!fallbackSubject.toLowerCase().startsWith('je souhaite'));
  assert.ok(fallbackSubject.length < need.length);

  console.log('T06 V1.0.1 correction prioritaire 1 OK');
})().catch(err=>{console.error(err);process.exit(1)});
