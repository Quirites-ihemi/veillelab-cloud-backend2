'use strict';
const assert = require('assert');
const v2 = require('./t06_pipeline_v2');

const C = [
 {result_id:'chunk:P1:12', kind:'chunk', publication_id:'P1', publication_title:'Rapport sur les violences sexuelles faites aux mineurs', locator:'p. 12',
  text:"La pédocriminalité en ligne connaît une hausse des signalements de contenus d'abus sexuels sur mineurs depuis 2019, selon le rapport annuel de l'Observatoire national de la protection de l'enfance."},
 {result_id:'chunk:P2:4', kind:'chunk', publication_id:'P2', publication_title:'Cybercriminalité et protection des enfants', locator:'p. 4',
  text:"Les enquêteurs observent une augmentation des signalements liés à la pédocriminalité sur les messageries chiffrées, ce qui complique l'identification des auteurs."},
 {result_id:'chunk:P3:88', kind:'chunk', publication_id:'P3', publication_title:'Identification de lignes directrices pour des plans de résilience des Alpes françaises', locator:'p. 88',
  text:"Les territoires de montagne présentent des écarts importants de vulnérabilité face aux effets du changement climatique, notamment dans les communes isolées."},
 {result_id:'node:P1:n5', kind:'node', publication_id:'P1', publication_title:'x', label:'Territoire'}
];
const search = () => ({ results: C });

// Modèle simulé : filtre correct pour P1/P2, tente de garder P3 avec un extrait inventé.
async function callModel({ tool }) {
  if (tool.name.startsWith('filtrer')) return { evaluations: [
    {id:'M1', pertinent_sujet:true, pertinent_axe:true, extrait_appui:"hausse des signalements de contenus d'abus sexuels sur mineurs", raison:'traite du sujet'},
    {id:'M2', pertinent_sujet:true, pertinent_axe:true, extrait_appui:"augmentation des signalements liés à la pédocriminalité", raison:'traite du sujet'},
    {id:'M3', pertinent_sujet:true, pertinent_axe:true, extrait_appui:"les communes exposées à la pédocriminalité", raison:'territorial'} // extrait inventé
  ]};
  if (tool.name.startsWith('proposer')) return { axes: [
    {titre:'Signalements en ligne', objectif_surveillance:'o', question_veille:'q', termes_discriminants:['signalements','darkweb'], material_ids:['M1','M2'], justification:'j'},
    {titre:'Axe fragile', objectif_surveillance:'o', question_veille:'q', termes_discriminants:[], material_ids:['P1'], justification:'j'} // ID publication, 1 seul
  ]};
  return {
    tendances:[
      {label:'Hausse des signalements', synthese:'s', limite:'l', material_ids:['M1','M2']},
      {label:'Tendance mono-source', synthese:'s', limite:'l', material_ids:['M1']},
    ],
    signes_a_guetter:[
      {label:'Messageries chiffrées', pourquoi_guetter:'p', ce_qui_confirmerait:'c', ce_qui_affaiblirait:'a', material_ids:['M2'], extrait_appui:"signalements liés à la pédocriminalité sur les messageries chiffrées"},
      {label:'Signe inventé', pourquoi_guetter:'p', ce_qui_confirmerait:'c', ce_qui_affaiblirait:'a', material_ids:['M1'], extrait_appui:"les plateformes de jeux vidéo deviennent le premier vecteur"},
    ],
    sources_a_surveiller:[
      {label:"Observatoire national de la protection de l'enfance", type_source:'observatoire', indice_recurrence:"selon le rapport annuel de l'Observatoire national de la protection de l'enfance", raison:'r', material_ids:['M1']},
      {label:'Cybercriminalité et protection des enfants', type_source:'organisme_producteur_recurrent', indice_recurrence:"Les enquêteurs observent une augmentation des signalements", raison:'publication du corpus', material_ids:['M2']},
      {label:'Europol', type_source:'organisme_producteur_recurrent', indice_recurrence:"selon le rapport annuel de l'Observatoire national", raison:'r', material_ids:['M1']},
    ],
    angles_morts:['Aucune donnée territoriale']
  };
}

(async () => {
  assert.strictEqual(v2.subjectQueryFromNeed('Je veux faire une veille sur les évolutions de la pédocriminalité.'), 'pédocriminalité');
  assert.strictEqual(v2.subjectQueryFromNeed("Je veux faire une veille sur la délinquance à l'échelle communale"), 'délinquance communale');
  assert.strictEqual(v2.withAccentVariant('pédocriminalité'), 'pédocriminalité pedocriminalite');

  const s1 = await v2.proposerAxesV2({ apiKey:'x', besoin:'Je veux faire une veille sur les évolutions de la pédocriminalité', searchFn: search, callModel });
  assert.deepStrictEqual(s1.materiaux_valides.map(m=>m.publication_id), ['P1','P2']);
  const alpes = s1.materiaux_ecartes.find(m=>m.publication_id==='P3');
  assert.strictEqual(alpes.motif, 'extrait_introuvable');
  assert.strictEqual(s1.diagnostic.resultats_non_probants_ecartes, 1); // le nœud "Territoire"
  assert.strictEqual(s1.axes.length, 1);
  assert.deepStrictEqual(s1.axes[0].termes_discriminants, ['signalements']);
  console.log('Étape axes OK — rejets :', s1.rejets.map(r=>r.motif).join(', '));

  const s2 = await v2.construireObjetsAxeV2({ apiKey:'x', besoin:s1.need, subject_query:s1.subject_query, axis:s1.axes[0], searchFn: search, callModel });
  assert.strictEqual(s2.statut, 'ok');
  assert.deepStrictEqual(s2.tendances.map(t=>t.label), ['Hausse des signalements']);
  assert.deepStrictEqual(s2.signes_a_guetter.map(t=>t.label), ['Messageries chiffrées']);
  assert.deepStrictEqual(s2.sources_a_surveiller.map(t=>t.label), ["Observatoire national de la protection de l'enfance"]);
  assert.ok(!JSON.stringify(s2.tendances.concat(s2.signes_a_guetter, s2.sources_a_surveiller)).includes('P3'));
  assert.strictEqual(s2.diagnostic.ancres_retrouvees, 2);
  console.log('Étape objets OK — rejets :', s2.rejets.map(r=>`${r.objet} → ${r.motif}`).join(' | '));

  const s3 = await v2.construireObjetsAxeV2({ apiKey:'x', besoin:s1.need, subject_query:s1.subject_query, axis:s1.axes[0], searchFn: search,
    callModel: async () => { throw new Error('HTTP 529'); } });
  assert.strictEqual(s3.statut, 'erreur_technique');
  console.log('Erreur technique isolée OK');
  console.log('\nTOUS LES TESTS PASSENT');
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
