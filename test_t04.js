const assert = require('assert');
const { nettoyerCorpusT04, mergeRecommendations, pageLabel } = require('./t04');

const corpus = nettoyerCorpusT04([
  {
    publication_id: 'PUBX', titre: 'Test', organisme_producteur: 'Org', annee_publication: '2026',
    chunks: [
      { chunk_id: 'C1', ordre: 2, page_debut: 4, page_fin: 4, texte: 'Le rapport recommande de renforcer la coordination.' },
      { chunk_id: 'C2', ordre: 1, page_debut: 3, page_fin: 3, texte: 'Constat préalable.' }
    ]
  }
]);
assert.equal(corpus.length, 1);
assert.deepEqual(corpus[0].chunks.map(c => c.chunk_id), ['C2','C1']);
assert.equal(pageLabel({page_debut:'4',page_fin:'4'}), '4');
assert.equal(pageLabel({page_debut:'4',page_fin:'5'}), '4-5');

const merged = mergeRecommendations([
  { formulation:'Renforcer la coordination', type_prescription:'recommandation', objet:'coordination', formulateur:'', destinataire:'', conditions_modalites:'', chunk_ids:['C1'] },
  { formulation:'Renforcer la coordination', type_prescription:'recommandation', objet:'', formulateur:'Auteur', destinataire:'', conditions_modalites:'', chunk_ids:['C1','C3'] }
]);
assert.equal(merged.length, 1);
assert.deepEqual(merged[0].chunk_ids, ['C1','C3']);
assert.equal(merged[0].formulateur, 'Auteur');
console.log('T04 tests OK');
