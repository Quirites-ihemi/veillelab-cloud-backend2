const assert = require('assert');
const { nettoyerCorpusT02, mergeEntries } = require('./t02');

const corpus = [
  {
    publication_id:'PUBX', titre:'Test', organisme_producteur:'Org', annee_publication:'2026',
    chunks:[
      {chunk_id:'C1', ordre:2, page_debut:2, page_fin:2, texte:'Le PAPI est cité dans le document.'},
      {chunk_id:'C2', ordre:1, page_debut:1, page_fin:1, texte:'Le plan de prévention est présenté.'},
      {chunk_id:'C2', ordre:3, texte:'doublon'}
    ]
  }
];
const cleaned = nettoyerCorpusT02(corpus);
assert.equal(cleaned.length,1);
assert.deepEqual(cleaned[0].chunks.map(c=>c.chunk_id),['C2','C1']);

const merged = mergeEntries([
  {terme:'PAPI',explicitation:'Contexte.',statut:'explicitation_contextuelle',chunk_ids:['C1']},
  {terme:'papi',explicitation:'Définition explicite plus solide.',statut:'definition_source',chunk_ids:['C2']},
  {terme:'PGRI',explicitation:'Le corpus sélectionné ne permet pas de définir précisément ce terme.',statut:'insuffisamment_defini',chunk_ids:['C1']}
]);
assert.equal(merged.length,2);
assert.equal(merged[0].statut,'definition_source');
assert.deepEqual(new Set(merged[0].chunk_ids),new Set(['C1','C2']));
console.log('OK T02 helpers');
