const { searchCorpus } = require('./globalSearch');

const tests = [
  { query: 'terrorisme masculiniste', expectPublication: 'PUB058' },
  { query: 'sécurité nationale', expectPublication: 'PUB060' },
  { query: 'Ukrainiens protection temporaire', expectPublication: 'PUB001' },
  { query: 'confiance police population', expectPublication: 'PUB068' },
  { query: 'ports narcotrafic', expectPublication: 'PUB024' }
];

let failed = 0;
for (const test of tests) {
  const result = searchCorpus({ query: test.query, limit: 12 });
  const found = result.results.some(r => r.publication_id === test.expectPublication);
  console.log(`${found ? 'OK' : 'ECHEC'} | ${test.query} | attendu ${test.expectPublication} | pubs: ${[...new Set(result.results.map(r => r.publication_id))].join(', ')}`);
  if (!found) failed += 1;
}

// Régression V0.1 : les résultats ne couvrant qu'un des deux concepts
// ne doivent pas polluer le haut du classement.
const ranking = searchCorpus({ query: 'narcotrafic ports', limit: 12 });
const rankingPubs = [...new Set(ranking.results.map(r => r.publication_id))];
const topRelevant = ranking.results.length > 0 && ['PUB024', 'PUB025'].includes(ranking.results[0].publication_id);
const noisyPubs = rankingPubs.filter(id => ['PUB006', 'PUB051', 'PUB008', 'PUB026'].includes(id));
console.log(`${topRelevant ? 'OK' : 'ECHEC'} | ranking narcotrafic ports | premier: ${ranking.results[0]?.publication_id || 'aucun'}`);
console.log(`${noisyPubs.length === 0 ? 'OK' : 'ECHEC'} | bruit partiel écarté | bruit: ${noisyPubs.join(', ') || 'aucun'}`);
if (!topRelevant || noisyPubs.length) failed += 1;

// Régression V0.2 : les expressions métier composées doivent être reconnues
// comme deux concepts précis, sans réintroduire « trafic » et « infrastructures »
// comme concepts génériques indépendants.
const compound = searchCorpus({
  query: 'trafic de cocaïne infrastructures portuaires',
  limit: 12
});
const compoundIds = compound.query_concepts.map(c => c.id);
const compoundSources = compound.query_concepts.map(c => c.source_tokens.join(' '));
const compoundPubs = [...new Set(compound.results.map(r => r.publication_id))];
const compoundConceptsOk =
  compoundIds.length === 2 &&
  compoundIds.includes('narcotrafic') &&
  compoundIds.includes('port') &&
  compound.query_concepts.every(c => c.compound === true);
const compoundNoise = compoundPubs.filter(id => ['PUB006', 'PUB008', 'PUB051', 'PUB026'].includes(id));
const compoundRelevantOnly = compoundPubs.length > 0 && compoundPubs.every(id => ['PUB024', 'PUB025'].includes(id));
const preciseNodeAboveNoise = compound.results.some(r => r.result_id === 'node:N0672');

console.log(`${compoundConceptsOk ? 'OK' : 'ECHEC'} | concepts composés | ${compoundIds.join(', ')} | sources: ${compoundSources.join(' / ')}`);
console.log(`${compoundRelevantOnly && compoundNoise.length === 0 ? 'OK' : 'ECHEC'} | reformulation portuaire | pubs: ${compoundPubs.join(', ') || 'aucune'} | bruit: ${compoundNoise.join(', ') || 'aucun'}`);
console.log(`${preciseNodeAboveNoise ? 'OK' : 'ECHEC'} | nœud précis N0672 présent`);
if (!compoundConceptsOk || !compoundRelevantOnly || compoundNoise.length || !preciseNodeAboveNoise) failed += 1;


// Régression V0.3 : distinguer le sujet de la demande et son intention.
// « perspectives / avenir » ne doit jamais suffire à faire remonter un texte
// hors sujet si « cybercriminalité » est le thème demandé.
const futureCyber = searchCorpus({
  query: "quelles perspectives d'avenir pour la cybercriminalité",
  limit: 12,
  diversify_by_publication: false
});
const futureCyberIds = futureCyber.results.map(r => r.result_id);
const futureCyberPubs = [...new Set(futureCyber.results.map(r => r.publication_id))];
const futureCyberSubjectOk =
  futureCyber.query_concepts.length === 1 &&
  futureCyber.query_concepts[0].id === 'cybercriminalite';
const futureCyberIntentOk =
  futureCyber.query_intents.length === 1 &&
  futureCyber.query_intents[0].id === 'future_outlook';
const futureCyberNoFalsePositive = !futureCyberIds.includes('chunk:C0558') && !futureCyberPubs.includes('PUB026');
const futureCyberTopRelevant = futureCyber.results.length > 0 && futureCyber.results[0].publication_id === 'PUB006';
console.log(`${futureCyberSubjectOk ? 'OK' : 'ECHEC'} | sujet central cybercriminalité | concepts: ${futureCyber.query_concepts.map(c => c.id).join(', ')}`);
console.log(`${futureCyberIntentOk ? 'OK' : 'ECHEC'} | intention prospective séparée | intents: ${futureCyber.query_intents.map(c => c.id).join(', ')}`);
console.log(`${futureCyberNoFalsePositive ? 'OK' : 'ECHEC'} | faux positif C0558/PUB026 écarté | pubs: ${futureCyberPubs.join(', ')}`);
console.log(`${futureCyberTopRelevant ? 'OK' : 'ECHEC'} | prospective cybercriminalité en tête | premier: ${futureCyber.results[0]?.result_id || 'aucun'} / ${futureCyber.results[0]?.publication_id || 'aucune'}`);
if (!futureCyberSubjectOk || !futureCyberIntentOk || !futureCyberNoFalsePositive || !futureCyberTopRelevant) failed += 1;

// La formulation courte « avenir cybercriminalité » ne doit plus renvoyer zéro résultat.
const shortFutureCyber = searchCorpus({ query: 'avenir cybercriminalité', limit: 6 });
const shortFutureCyberOk = shortFutureCyber.results.length > 0 && shortFutureCyber.results[0].publication_id === 'PUB006';
console.log(`${shortFutureCyberOk ? 'OK' : 'ECHEC'} | avenir cybercriminalité | premier: ${shortFutureCyber.results[0]?.publication_id || 'aucun'}`);
if (!shortFutureCyberOk) failed += 1;

if (failed) process.exit(1);
