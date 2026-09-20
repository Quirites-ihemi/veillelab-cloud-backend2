const assert = require('assert');
const {
  proposerNotionsT06,
  sanitizeNeedAnalysis,
  sanitizeSelectedNotions,
  buildRetrievalQueries,
  mergeSearchResults
} = require('./t06');

async function test() {
  const need = "Je souhaite suivre l'évolution de la délinquance à l'échelle communale dans les communes franciliennes.";
  const analysis = sanitizeNeedAnalysis({
    sujet_central: 'délinquance',
    requete_recherche: 'délinquance',
    dimensions: [
      { type: 'echelle', valeur: 'échelle communale', role: 'contrainte' },
      { type: 'territoire', valeur: 'communes franciliennes', role: 'contrainte' },
      { type: 'temporalite', valeur: 'évolution', role: 'intention' },
    ]
  }, need);

  assert.equal(analysis.requete_recherche, 'délinquance');
  assert.equal(analysis.dimensions.length, 3);
  assert.deepEqual(buildRetrievalQueries(analysis), [
    'délinquance',
    'délinquance commune',
    'délinquance Île-de-France',
    'délinquance évolution'
  ]);

  const merged = mergeSearchResults([
    { query: 'délinquance', response: { results: [{ result_id: 'chunk:C1', kind: 'chunk', score: 3 }] } },
    { query: 'délinquance commune', response: { results: [{ result_id: 'chunk:C1', kind: 'chunk', score: 8 }] } }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].score, 8);
  assert.deepEqual(merged[0]._t06_queries, ['délinquance', 'délinquance commune']);

  const allowed = new Set(['chunk:C1', 'chunk:C2']);
  const sanitized = sanitizeSelectedNotions([
    {
      label: "Délinquance enregistrée à l'échelle communale",
      dimension_eclairee: "mesure et échelle",
      pourquoi: 'x',
      limite: 'y',
      niveau: 'structurante',
      material_ids: ['chunk:C1', 'chunk:C2', 'chunk:BAD']
    }
  ], allowed);
  assert.deepEqual(sanitized[0].material_ids, ['chunk:C1', 'chunk:C2']);

  const fakeResults = [
    {
      result_id: 'chunk:C1', kind: 'chunk', score: 45.5, publication_id: 'PUB018', publication_title: 'Les disparités communales en matière de vols sans violence',
      organisme_producteur: 'Service statistique ministériel de la sécurité intérieure', annee_publication: '2026', type_document: 'Étude', provenance_level: 'A', locator: '4',
      section: 'Base communale', text: "Le nombre de vols sans violence contre des personnes par commune et par an est issu de la base statistique communale de la délinquance enregistrée.", url_source: 'https://example.org/1'
    },
    {
      result_id: 'chunk:C2', kind: 'chunk', score: 53.5, publication_id: 'PUB018', publication_title: 'Les disparités communales en matière de vols sans violence',
      organisme_producteur: 'Service statistique ministériel de la sécurité intérieure', annee_publication: '2026', type_document: 'Étude', provenance_level: 'A', locator: '8',
      section: 'Disparités territoriales', text: "À caractéristiques identiques, les niveaux enregistrés diffèrent selon les territoires et les caractéristiques communales.", url_source: 'https://example.org/1'
    },
    {
      result_id: 'node:N1', kind: 'node', score: 17, publication_id: 'PUB052', publication_title: 'Une généalogie des politiques publiques de sécurité',
      organisme_producteur: 'Les Cahiers français', annee_publication: '2026', type_document: 'Article web', provenance_level: 'B', locator: 'article web',
      node_id: 'N1', node_type: 'action', label: 'Développement de la prévention locale de la délinquance', url_source: 'https://example.org/2'
    },
    {
      result_id: 'node:N2', kind: 'node', score: 16, publication_id: 'PUB2', publication_title: 'Mineurs et délinquance',
      organisme_producteur: 'Institut public', annee_publication: '2026', type_document: 'Rapport', provenance_level: 'A', locator: '3',
      node_id: 'N2', node_type: 'notion_idee', label: "Prévention de l'implication des mineurs dans les actes de délinquance", url_source: 'https://example.org/3'
    }
  ];

  const searchCalls = [];
  const searchFn = body => {
    searchCalls.push(body.query);
    const results = fakeResults.filter(r => !body.kinds || body.kinds.includes(r.kind));
    return { ok: true, engine: 'corpus-search-v0.3-topic-first', results };
  };

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
            label: "Délinquance enregistrée à l'échelle communale",
            dimension_eclairee: 'mesure du phénomène et échelle d’observation',
            pourquoi: "Elle précise que la veille peut s'appuyer sur des faits enregistrés par commune et sur des indicateurs calculés à une échelle territoriale fine.",
            limite: "Les matériaux mobilisés ne permettent pas d'isoler spécifiquement les communes franciliennes ni, à eux seuls, de reconstituer une série longue d'évolution.",
            niveau: 'structurante', material_ids: ['chunk:C1', 'chunk:C2']
          },
          {
            label: 'Disparités territoriales de la délinquance',
            dimension_eclairee: 'comparaison entre territoires',
            pourquoi: "Elle permet d'envisager le besoin sous l'angle des écarts observés entre territoires et caractéristiques communales.",
            limite: "Les unités territoriales mobilisées dans les sources ne correspondent pas toutes exactement à la commune ni au périmètre francilien.",
            niveau: 'structurante', material_ids: ['chunk:C2', 'chunk:C1']
          },
          {
            label: "Prévention de l'implication des mineurs",
            dimension_eclairee: 'public',
            pourquoi: 'Sous-thème lié à la délinquance.',
            limite: 'Le besoin ne cible pas les mineurs.',
            niveau: 'utile', material_ids: ['node:N2']
          }
        ],
        limites_couverture: [
          'Le périmètre francilien est peu documenté dans les matériaux retrouvés.',
          "La profondeur temporelle des matériaux est insuffisante pour caractériser seule une évolution de long terme."
        ]
      };
    }
    if (tool.name === 'auditer_notions_t06') {
      return {
        notions: [
          {
            label: "Délinquance enregistrée à l'échelle communale",
            dimension_eclairee: 'mesure du phénomène et échelle d’observation',
            pourquoi: "Elle précise que la veille peut s'appuyer sur des faits enregistrés par commune et sur des indicateurs calculés à une échelle territoriale fine.",
            limite: "Les matériaux mobilisés ne permettent pas d'isoler spécifiquement les communes franciliennes ni, à eux seuls, de reconstituer une série longue d'évolution.",
            niveau: 'structurante', material_ids: ['chunk:C1', 'chunk:C2'], conserver: true
          },
          {
            label: 'Disparités territoriales de la délinquance',
            dimension_eclairee: 'comparaison entre territoires',
            pourquoi: "Elle permet d'envisager le besoin sous l'angle des écarts observés entre territoires et caractéristiques communales.",
            limite: "Les unités territoriales mobilisées dans les sources ne correspondent pas toutes exactement à la commune ni au périmètre francilien.",
            niveau: 'structurante', material_ids: ['chunk:C2', 'chunk:C1'], conserver: true
          },
          {
            label: "Prévention de l'implication des mineurs",
            dimension_eclairee: 'public',
            pourquoi: 'Sous-thème lié à la délinquance.',
            limite: 'Le besoin ne cible pas les mineurs.',
            niveau: 'utile', material_ids: ['node:N2'], conserver: false
          }
        ]
      };
    }
    throw new Error(`outil inattendu ${tool.name}`);
  };

  const result = await proposerNotionsT06({ apiKey: 'fake', besoin: need, searchFn, callModel });

  assert.equal(result.engine, 't06-framing-v0.2-synthesized');
  assert.deepEqual(result.retrieval.queries, [
    'délinquance',
    'délinquance commune',
    'délinquance Île-de-France',
    'délinquance évolution'
  ]);
  assert.equal(result.notions.length, 2);
  assert.equal(result.notions[0].label, "Délinquance enregistrée à l'échelle communale");
  assert.equal(result.notions[0].sources.length, 2);
  assert.equal(result.notions[1].label, 'Disparités territoriales de la délinquance');
  assert.equal(result.limites_couverture.length, 2);
  assert(searchCalls.includes('délinquance commune'));
  assert(searchCalls.includes('délinquance Île-de-France'));
  console.log('T06 V0.2 tests OK');
}

test().catch(error => {
  console.error(error);
  process.exit(1);
});
