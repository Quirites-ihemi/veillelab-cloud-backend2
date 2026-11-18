#!/usr/bin/env node
'use strict';
const assert = require('assert');
const {getCorpusStore,getCorpusStatus,getPublicationCorpus}=require('./corpusStore');
const s=getCorpusStore(), st=getCorpusStatus();
assert.equal(st.active_publications,62);
assert.equal(st.publications_with_chunks,55);
assert.equal(st.graph_only_publications,7);
assert.equal(st.nodes,1562);
assert.equal(st.relations,1333);
assert.equal(st.chunks,1272);
assert.equal(new Set(s.nodes.map(n=>n.node_id)).size,1538);
assert.equal(getPublicationCorpus('PUB121').chunks.some(c=>c.chunk_id==='C1071'),true);
assert.equal(getPublicationCorpus('PUB121').chunks.some(c=>c.chunk_id==='C1072'),true);
assert.equal(getPublicationCorpus('PUB133').chunks.length,0);
assert.equal(getPublicationCorpus('PUB133').nodes.length,18);
assert.equal(getPublicationCorpus('PUB133').relations.length,12);
for(const id of ['N1408','N1525']) {
  const pubs=s.nodes.filter(n=>n.node_id===id).map(n=>n.publication_id);
  assert(pubs.length>1);
  for(const p of pubs) assert(getPublicationCorpus(p).nodes.some(n=>n.node_id===id));
}
require('./globalSearch');
require('./reflectionAssist');
require('./t06_pipeline_v2');
const {runReflectionAssist}=require('./reflectionAssist');
const exact=runReflectionAssist({action_id:'DOC02', material_id:'node:N1408', publication_id:'PUB123'});
assert.equal(exact.publication.publication_id, 'PUB123');
let ambiguousRejected=false;
try { runReflectionAssist({action_id:'DOC02',material_id:'node:N1408'}); }
catch(e) { ambiguousRejected=e.statusCode===400; }
assert(ambiguousRejected, 'une preuve multi-publications doit exiger publication_id');
const {searchCorpus}=require('./globalSearch');
const results=searchCorpus({query:'renseignement allemand',limit:30,diversify_by_publication:false});
assert(results.results.some(r=>r.publication_id==='PUB128'));
console.log('OK — Corpus 62 publications, 1 562 nœuds, 1 333 relations, 1 272 chunks; moteurs chargés sans erreur.');
