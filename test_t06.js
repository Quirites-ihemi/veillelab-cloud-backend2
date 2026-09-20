const assert = require('assert');
const { proposerNotionsT06, sanitizeNeedAnalysis, sanitizeSelectedNotions } = require('./t06');

async function test() {
  const analysis = sanitizeNeedAnalysis({
    sujet_central: 'délinquance',
    requete_recherche: 'délinquance',
    dimensions: [
      { type: 'echelle', valeur: 'échelle communale', role: 'contrainte' },
      { type: 'territoire', valeur: 'communes franciliennes', role: 'contrainte' },
      { type: 'temporalite', valeur: 'évolution', role: 'intention' },
    ]
  }, 'besoin');
  assert.equal(analysis.requete_recherche, 'délinquance');
  assert.equal(analysis.dimensions.length, 3);

  const allowed = new Set(['node:N1']);
  const sanitized = sanitizeSelectedNotions([
    { label: 'Prévention locale', dimension_eclairee: 'action locale', pourquoi: 'x', limite: 'y', niveau: 'structurante', material_ids: ['node:N1', 'node:BAD'] }
  ], allowed);
  assert.deepEqual(sanitized[0].material_ids, ['node:N1']);

  const fakeResults = [
    {
      result_id: 'node:N1', kind: 'node', score: 18, publication_id: 'PUB1', publication_title: 'Politiques locales de sécurité',
      organisme_producteur: 'Institut public', annee_publication: '2026', type_document: 'Rapport', provenance_level: 'A', locator: '12',
      node_id: 'N1', node_type: 'notion_idee', label: 'Prévention locale de la délinquance', url_source: 'https://example.org/1'
    },
    {
      result_id: 'node:N2', kind: 'node', score: 16, publication_id: 'PUB2', publication_title: 'Mineurs et délinquance',
      organisme_producteur: 'Institut public', annee_publication: '2026', type_document: 'Rapport', provenance_level: 'A', locator: '3',
      node_id: 'N2', node_type: 'notion_idee', label: "Prévention de l'implication des mineurs dans les actes de délinquance", url_source: 'https://example.org/2'
    }
  ];

  const searchFn = body => ({ ok: true, engine: 'corpus-search-v0.3-topic-first', results: fakeResults.filter(r => !body.kinds || body.kinds.includes(r.kind)) });
  const callModel = async ({ tool }) => {
    if (tool.name === 'analyser_besoin_t06') {
      return {
        sujet_central: 'délinquance',
        requete_recherche: 'délinquance',
        dimensions: [
          { type: 'echelle', valeur: 'échelle communale', role: 'contrainte' },
          { type: 'territoire', valeur: 'communes franciliennes', role: 'contrainte' },
          { type: 'temporalite', valeur: 'évolution', role: 'intention' }
        ]
      };
    }
    if (tool.name === 'selectionner_notions_t06') {
      return {
        notions: [
          {
            label: 'Prévention locale de la délinquance', dimension_eclairee: 'action locale',
            pourquoi: "Elle éclaire une dimension du besoin liée à l'action locale contre la délinquance.",
            limite: "Elle ne renseigne pas directement l'évolution de la délinquance ni le périmètre francilien.",
            niveau: 'structurante', material_ids: ['node:N1']
          },
          {
            label: "Prévention de l'implication des mineurs", dimension_eclairee: 'public',
            pourquoi: 'Sous-thème lié à la délinquance.', limite: 'Le besoin ne cible pas les mineurs.',
            niveau: 'utile', material_ids: ['node:N2']
          }
        ],
        limites_couverture: ['Le périmètre francilien est peu documenté dans les matériaux retrouvés.']
      };
    }
    if (tool.name === 'auditer_notions_t06') {
      return {
        notions: [
          {
            label: 'Prévention locale de la délinquance', dimension_eclairee: 'action locale',
            pourquoi: "Elle éclaire une dimension du besoin liée à l'action locale contre la délinquance.",
            limite: "Elle ne renseigne pas directement l'évolution de la délinquance ni le périmètre francilien.",
            niveau: 'structurante', material_ids: ['node:N1'], conserver: true
          },
          {
            label: "Prévention de l'implication des mineurs", dimension_eclairee: 'public',
            pourquoi: 'Sous-thème lié à la délinquance.', limite: 'Le besoin ne cible pas les mineurs.',
            niveau: 'utile', material_ids: ['node:N2'], conserver: false
          }
        ]
      };
    }
    throw new Error(`outil inattendu ${tool.name}`);
  };

  const result = await proposerNotionsT06({
    apiKey: 'fake',
    besoin: "Je souhaite suivre l'évolution de la délinquance à l'échelle communale dans les communes franciliennes.",
    searchFn,
    callModel
  });

  assert.equal(result.engine, 't06-framing-v0.1-llm-grounded');
  assert.equal(result.analysis.requete_recherche, 'délinquance');
  assert.equal(result.notions.length, 1);
  assert.equal(result.notions[0].label, 'Prévention locale de la délinquance');
  assert.equal(result.notions[0].sources[0].publication_id, 'PUB1');
  assert.equal(result.limites_couverture.length, 1);
  console.log('T06 tests OK');
}

test().catch(error => {
  console.error(error);
  process.exit(1);
});
