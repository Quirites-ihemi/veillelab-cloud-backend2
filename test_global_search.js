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

// Régression de ranking : sur une requête à deux concepts, les résultats qui ne
// couvrent qu'un seul concept ne doivent plus polluer les premiers résultats.
const ranking = searchCorpus({ query: 'narcotrafic ports', limit: 12 });
const rankingPubs = [...new Set(ranking.results.map(r => r.publication_id))];
const topRelevant = ranking.results.length > 0 && ['PUB024', 'PUB025'].includes(ranking.results[0].publication_id);
const noisyPubs = rankingPubs.filter(id => ['PUB006', 'PUB051', 'PUB008', 'PUB026'].includes(id));
console.log(`${topRelevant ? 'OK' : 'ECHEC'} | ranking narcotrafic ports | premier: ${ranking.results[0]?.publication_id || 'aucun'}`);
console.log(`${noisyPubs.length === 0 ? 'OK' : 'ECHEC'} | bruit partiel écarté | bruit: ${noisyPubs.join(', ') || 'aucun'}`);
if (!topRelevant || noisyPubs.length) failed += 1;

if (failed) process.exit(1);
