const assert = require('assert');
const { proposerNotionsT06, proposerAxesT06, proposerDynamiquesT06, sanitizeNeedAnalysis, buildRetrievalQueries } = require('./t06');

async function main(){
  const need="Je souhaite suivre l'évolution de la délinquance à l'échelle communale dans les communes franciliennes.";
  const analysis=sanitizeNeedAnalysis({sujet_central:'délinquance',requete_recherche:'délinquance',dimensions:[
    {type:'echelle',valeur:'échelle communale',role:'contrainte'},
    {type:'territoire',valeur:'communes franciliennes',role:'contrainte'},
    {type:'temporalite',valeur:'évolution',role:'intention'}
  ]},need);
  assert.deepEqual(buildRetrievalQueries(analysis),['délinquance','délinquance commune','délinquance Île-de-France','délinquance évolution']);

  const results=[
    {result_id:'chunk:C1',kind:'chunk',score:45,publication_id:'PUB018',publication_title:'Les disparités communales en matière de vols sans violence',organisme_producteur:'SSMSI',annee_publication:'2026',type_document:'Étude',provenance_level:'A',locator:'4',section:'Base communale',text:"La base communale de la délinquance enregistrée permet d'observer les faits enregistrés par commune et par année.",url_source:'https://e/1'},
    {result_id:'chunk:C2',kind:'chunk',score:44,publication_id:'PUB018',publication_title:'Les disparités communales en matière de vols sans violence',organisme_producteur:'SSMSI',annee_publication:'2026',type_document:'Étude',provenance_level:'A',locator:'8',section:'Disparités',text:'Les niveaux enregistrés diffèrent selon les caractéristiques territoriales et communales.',url_source:'https://e/1'},
    {result_id:'chunk:C3',kind:'chunk',score:38,publication_id:'PUB052',publication_title:'Une généalogie des politiques publiques de sécurité',organisme_producteur:'Les Cahiers français',annee_publication:'2026',type_document:'Article web',provenance_level:'B',locator:'article web',section:'Prévention locale',text:'La prévention locale de la délinquance se structure autour de dispositifs communaux et partenariaux.',url_source:'https://e/2'},
    {result_id:'chunk:C4',kind:'chunk',score:34,publication_id:'PUB018',publication_title:'Les disparités communales en matière de vols sans violence',organisme_producteur:'SSMSI',annee_publication:'2026',type_document:'Étude',provenance_level:'A',locator:'10',section:'Évolution',text:'Sur plusieurs années, les niveaux de vols sans violence enregistrés présentent des évolutions différentes selon les communes.',url_source:'https://e/1'},
    {result_id:'chunk:C5',kind:'chunk',score:30,publication_id:'PUB070',publication_title:'Sécurité locale et prévention',organisme_producteur:'Institut public',annee_publication:'2025',type_document:'Rapport',provenance_level:'A',locator:'12',section:'Coordination locale',text:'Plusieurs collectivités renforcent les dispositifs locaux de coordination et de prévention.',url_source:'https://e/3'},
    {result_id:'chunk:C6',kind:'chunk',score:29,publication_id:'PUB071',publication_title:'Évolutions territoriales de la délinquance',organisme_producteur:'Observatoire public',annee_publication:'2025',type_document:'Étude',provenance_level:'A',locator:'7',section:'Territoires',text:'Des écarts persistants entre espaces urbains et périurbains sont observés dans les niveaux de délinquance enregistrée.',url_source:'https://e/4'},
  ];
  const searchFn=body=>({ok:true,engine:'corpus-search-v0.3-topic-first',results:results.filter(r=>!body.kinds||body.kinds.includes(r.kind))});

  const callModel=async({tool,userText})=>{
    if(tool.name==='analyser_besoin_t06') return {sujet_central:'délinquance',requete_recherche:'délinquance',dimensions:[{type:'echelle',valeur:'échelle communale',role:'contrainte'},{type:'territoire',valeur:'communes franciliennes',role:'contrainte'},{type:'temporalite',valeur:'évolution',role:'intention'}]};
    if(tool.name==='synthetiser_cadrage_t06') return {notions:[
      {label:"Délinquance enregistrée à l'échelle communale",dimension_eclairee:'mesure et échelle',pourquoi:"Elle aide à préciser que la veille porte sur les faits enregistrés et leur observation par commune.",limite:"Les matériaux ne permettent pas d'isoler spécifiquement les communes franciliennes.",material_ids:['chunk:C1','chunk:C2']},
      {label:'Disparités territoriales de la délinquance',dimension_eclairee:'comparaison territoriale',pourquoi:'Elle permet de structurer une veille comparative entre espaces locaux.',limite:"Les unités territoriales ne sont pas toutes strictement communales.",material_ids:['chunk:C2','chunk:C6']}
    ],limites_couverture:['Le périmètre francilien est peu documenté dans les matériaux retrouvés.']};
    if(tool.name==='auditer_cadrage_t06') return {notions:[
      {label:"Délinquance enregistrée à l'échelle communale",pourquoi:"Elle aide à préciser que la veille porte sur les faits enregistrés et leur observation par commune.",limite:"Les matériaux ne permettent pas d'isoler spécifiquement les communes franciliennes.",material_ids:['chunk:C1','chunk:C2'],statut:'solide'},
      {label:'Disparités territoriales de la délinquance',pourquoi:'Elle permet de structurer une veille comparative entre espaces locaux.',limite:"Les unités territoriales ne sont pas toutes strictement communales.",material_ids:['chunk:C2','chunk:C6'],statut:'partiel'}
    ]};
    if(tool.name==='synthetiser_axes_t06') return {axes:[
      {titre:'Différenciation territoriale de la délinquance enregistrée',objectif_surveillance:'Suivre les écarts et leurs évolutions entre communes ou types de territoires.',pourquoi:'Les matériaux documentent des écarts territoriaux et des évolutions différenciées.',questions:['Quels écarts se creusent ou se réduisent entre territoires ?','Quels types de faits évoluent le plus selon les communes ?'],limite:"Le corpus ne couvre pas spécifiquement l'ensemble des communes franciliennes.",material_ids:['chunk:C1','chunk:C2','chunk:C4','chunk:C6']},
      {titre:'Évolution des réponses locales de prévention',objectif_surveillance:'Suivre la transformation des dispositifs locaux de prévention et de coordination.',pourquoi:'Plusieurs sources documentent la structuration de réponses locales.',questions:['Quels dispositifs se renforcent ou apparaissent ?','Comment évoluent les coopérations locales ?'],limite:'Les effets de ces dispositifs sur la délinquance ne sont pas démontrés par ces matériaux.',material_ids:['chunk:C3','chunk:C5']}
    ],limites_couverture:[]};
    if(tool.name==='auditer_axes_t06') return {axes:[
      {titre:'Différenciation territoriale de la délinquance enregistrée',objectif_surveillance:'Suivre les écarts et leurs évolutions entre communes ou types de territoires.',pourquoi:'Les matériaux documentent des écarts territoriaux et des évolutions différenciées.',questions:['Quels écarts se creusent ou se réduisent entre territoires ?','Quels types de faits évoluent le plus selon les communes ?'],limite:"Le corpus ne couvre pas spécifiquement l'ensemble des communes franciliennes.",material_ids:['chunk:C1','chunk:C2','chunk:C4','chunk:C6'],statut:'solide'},
      {titre:'Évolution des réponses locales de prévention',objectif_surveillance:'Suivre la transformation des dispositifs locaux de prévention et de coordination.',pourquoi:'Plusieurs sources documentent la structuration de réponses locales.',questions:['Quels dispositifs se renforcent ou apparaissent ?','Comment évoluent les coopérations locales ?'],limite:'Les effets de ces dispositifs sur la délinquance ne sont pas démontrés par ces matériaux.',material_ids:['chunk:C3','chunk:C5'],statut:'partiel'}
    ]};
    if(tool.name==='synthetiser_dynamiques_t06') return {axes:[
      {axis_id:'T06A01',tendances:[{label:'Persistance de disparités territoriales dans la délinquance enregistrée',interpretation:'Les matériaux convergent vers des niveaux durablement différenciés entre territoires.',pourquoi:'Plusieurs matériaux décrivent des écarts entre communes et espaces.',limite:'La profondeur temporelle reste inégale selon les catégories de faits.',material_ids:['chunk:C2','chunk:C6']}],signes_changement:[{label:'Évolutions divergentes entre communes sur certaines catégories de faits',interpretation:'Des trajectoires locales distinctes apparaissent dans les données disponibles.',pourquoi:'Un matériau longitudinal signale des évolutions différentes selon les communes.',limite:'Ce signe porte surtout sur les catégories documentées dans la source.',material_ids:['chunk:C4']}],limites_couverture:[]},
      {axis_id:'T06A02',tendances:[{label:'Institutionnalisation progressive de la prévention locale',interpretation:'Les dispositifs locaux de prévention et de coordination prennent une place plus structurée.',pourquoi:'Deux matériaux convergent sur la structuration et le renforcement des dispositifs locaux.',limite:'Les matériaux ne démontrent pas un effet causal sur la délinquance.',material_ids:['chunk:C3','chunk:C5']}],signes_changement:[{label:'Renforcement récent de dispositifs locaux de coordination',interpretation:'Plusieurs collectivités renforcent leurs mécanismes de coordination.',pourquoi:'La source décrit un renforcement de dispositifs locaux.',limite:'La couverture territoriale est partielle.',material_ids:['chunk:C5']},{label:'Diversification des formes de prévention locale',interpretation:'Les dispositifs documentés combinent davantage prévention et partenariats.',pourquoi:'La source décrit une structuration partenariale de la prévention locale.',limite:'Le caractère récent de cette évolution doit être confirmé.',material_ids:['chunk:C3']}],limites_couverture:[]}
    ]};
    if(tool.name==='clusteriser_signaux_faibles_t06') return {axes:[{axis_id:'T06A02',signaux_faibles:[{label:'Vers une coordination locale plus intégrée de la prévention',interpretation:'Le rapprochement de plusieurs signes suggère une évolution vers des dispositifs plus intégrés.',pourquoi:'Deux signes convergent sur le renforcement et la diversification de la coordination locale.',limite:'Cette dynamique reste à confirmer par davantage de territoires et de séries temporelles.',sign_ids:['T06A02-S1','T06A02-S2']}]}]};
    throw new Error('outil inattendu '+tool.name+'\n'+userText.slice(0,200));
  };

  const framing=await proposerNotionsT06({apiKey:'fake',besoin:need,searchFn,callModel});
  assert.equal(framing.engine,'t06-framing-v0.3-grounded-synthesis');
  assert.equal(framing.notions.length,2);
  assert.equal(framing.notions[1].statut,'partiel');

  const axes=await proposerAxesT06({apiKey:'fake',besoin:need,notions:framing.notions,searchFn,callModel});
  assert.equal(axes.axes.length,2);
  assert.equal(axes.axes[0].titre,'Différenciation territoriale de la délinquance enregistrée');
  assert.equal(axes.axes[0].sources.length,4);

  const dynamics=await proposerDynamiquesT06({apiKey:'fake',besoin:need,axes:axes.axes,searchFn,callModel});
  assert.equal(dynamics.axes.length,2);
  assert.equal(dynamics.axes[0].tendances.length,1);
  assert.equal(dynamics.axes[1].signaux_faibles.length,1);
  assert.equal(dynamics.axes[1].signaux_faibles[0].based_on_sign_ids.length,2);
  assert.equal(dynamics.methodological_reference.origin,'enrichissement_controle');
  console.log('T06 V0.3 synthesis tests OK');
}

main().catch(err=>{console.error(err);process.exit(1)});
