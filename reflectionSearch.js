// =====================================================
// QUIRITÈS VEILLE LAB — RECHERCHE DÉDIÉE
// « AVANCER AVEC LE CORPUS »
// V1.1 : contexte du canevas -> sujet réel -> retrieval large -> centralité -> diversification finale.
//
// Ce moteur est volontairement isolé de /corpus-search :
// - globalSearch.js reste inchangé ;
// - la recherche large sert uniquement à constituer des candidats ;
// - aucun candidat n'est affiché sans validation sémantique explicite ;
// - la diversification n'intervient qu'après validation.
// =====================================================

const { searchCorpus } = require('./globalSearch');

const MODEL_REFLECTION_SEARCH = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ATTEMPTS = 4;
const MAX_RETRIEVAL_QUERIES = 4;
const RETRIEVAL_LIMIT_PER_QUERY = 24;
const MAX_VALIDATION_CANDIDATES = 48;
const MAX_CANVAS_CONTEXT_CARDS = 10;

const NEED_LABELS = {
  overview: 'comprendre rapidement ce que le corpus contient sur un thème',
  precise: 'trouver une information précise dans le corpus',
  trends: 'voir ce qui évolue ou émerge',
  actors: 'identifier les acteurs concernés et leur rôle',
  'public-action': 'voir comment l’action publique répond au problème'
};

const CORPUS_SCOPE = {
  corpus_type: 'bulletin_quirites',
  closed_corpus: true,
  label: 'Publications du bulletin Quiritès intégrées au corpus actif',
  limitation_message: 'Une absence ou une faible couverture dans ce corpus ne signifie pas que le sujet est absent de la littérature ou des connaissances disponibles en dehors du bulletin.'
};

const QUERY_NOISE = new Set([
  'je','j','veux','voudrais','souhaite','souhaiterais','cherche','recherche','rechercher','trouver','avoir','obtenir','repérer','reperer',
  'des','de','du','d','un','une','le','la','les','l','en','dans','sur','pour','au','aux','avec','qui','que','quoi','dit','dire',
  'matiere','matière','sujet','theme','thème','corpus','element','elements','élément','éléments','analyse','analyses','information','informations',
  'aujourd','hui','rapidement','premiere','première','vue','faire','point','réfléchir','reflechir','recherche'
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value, max = 480) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function meaningfulTokens(query) {
  return normalize(query)
    .split(/\s+/)
    .filter(token => token.length >= 3 && !QUERY_NOISE.has(token));
}

function dedupeStrings(values, limit = MAX_RETRIEVAL_QUERIES) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

async function callClaudeWithTool({ apiKey, system, tool, userText, maxTokens = 2600 }) {
  if (!apiKey) throw new Error('Clé Anthropic absente pour la recherche « Avancer avec le corpus ».');

  const payload = {
    model: MODEL_REFLECTION_SEARCH,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: [{ type: 'text', text: String(userText) }] }]
  };

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 1600)}`);
        error.status = response.status;
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter * 1000, 60000);
        throw error;
      }
      const json = JSON.parse(text);
      const toolUse = (json.content || []).find(block => block && block.type === 'tool_use' && block.name === tool.name);
      if (!toolUse?.input) {
        const error = new Error(`Claude n'a pas retourné l'appel structuré attendu pour ${tool.name}.`);
        error.status = 503;
        throw error;
      }
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = error?.name === 'AbortError' || !status || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;
      const wait = error?.retryAfterMs || Math.min(1200 * Math.pow(2, attempt - 1), 16000);
      await sleep(wait + Math.floor(Math.random() * 400));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Échec de l’appel Anthropic pour la recherche du canevas.');
}

const INTERPRET_TOOL = {
  name: 'interpreter_recherche_corpus',
  description: 'Isole le sujet documentaire réel de la formulation utilisateur et propose quelques requêtes de retrieval strictement fidèles au sujet.',
  input_schema: {
    type: 'object',
    properties: {
      sufficient: { type: 'boolean' },
      subject_query: { type: 'string' },
      retrieval_queries: { type: 'array', items: { type: 'string' } },
      intent_note: { type: 'string' },
      intent_type: { type: 'string', enum: ['overview', 'precise', 'trends', 'actors', 'public-action', 'unspecified'] },
      context_used: { type: 'boolean' },
      context_subject: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['sufficient', 'subject_query', 'retrieval_queries', 'intent_note', 'intent_type', 'context_used', 'context_subject', 'reason'],
    additionalProperties: false
  }
};

const VALIDATE_TOOL = {
  name: 'valider_materiaux_corpus',
  description: 'Sélectionne uniquement les matériaux qui répondent réellement au sujet et au besoin documentaire, sans raccord externe.',
  input_schema: {
    type: 'object',
    properties: {
      selected: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            result_id: { type: 'string' },
            relevance: { type: 'string', enum: ['directe', 'contexte_necessaire'] },
            centrality: { type: 'string', enum: ['objet_central', 'appui_explicite'] },
            reason: { type: 'string' }
          },
          required: ['result_id', 'relevance', 'centrality', 'reason'],
          additionalProperties: false
        }
      },
      summary: { type: 'string' }
    },
    required: ['selected', 'summary'],
    additionalProperties: false
  }
};

function needInstruction(needId) {
  if (needId === 'precise') {
    return 'Retenir uniquement les matériaux qui apportent l’information ciblée ou une preuve directement nécessaire pour l’établir.';
  }
  if (needId === 'trends') {
    return 'Retenir uniquement les matériaux qui portent réellement sur le sujet ET documentent une évolution, une émergence, une hausse/baisse, une récurrence ou un signal.';
  }
  if (needId === 'actors') {
    return 'Retenir uniquement les matériaux qui portent réellement sur le sujet ET documentent un acteur ou son rôle sur ce sujet.';
  }
  if (needId === 'public-action') {
    return 'Retenir uniquement les matériaux qui documentent une politique, une réponse, un dispositif, un instrument, une mise en œuvre ou un acteur d’action publique DONT LE SUJET DEMANDÉ EST EXPLICITEMENT L’OBJET. Une politique portant sur un autre problème qui mentionne seulement le sujet dans une liste, une priorité voisine ou une phrase de contexte doit être rejetée.';
  }
  return 'Pour une vue d’ensemble, accepter plusieurs facettes du sujet, mais uniquement si le matériau traite réellement du sujet demandé. Une mention incidente ne constitue pas une facette.';
}

async function interpretQuery({ apiKey, query, needId, contextSubject = '', canvasContext = [], callClaudeFn }) {
  const tokens = meaningfulTokens(query);
  const cleanContextSubject = String(contextSubject || '').trim().slice(0, 300);
  const cleanCanvasContext = (Array.isArray(canvasContext) ? canvasContext : [])
    .slice(0, MAX_CANVAS_CONTEXT_CARDS)
    .map(card => ({
      title: String(card?.title || '').trim().slice(0, 140),
      kind: String(card?.kind || '').trim().slice(0, 80),
      text: String(card?.text || '').replace(/\s+/g, ' ').trim().slice(0, 420),
      selected: Boolean(card?.selected)
    }))
    .filter(card => card.title || card.text);

  if (!tokens.length && !cleanContextSubject && !cleanCanvasContext.length) {
    return {
      sufficient: false,
      subject_query: '',
      retrieval_queries: [],
      intent_note: '',
      intent_type: 'unspecified',
      context_used: false,
      context_subject: '',
      reason: 'La demande ne contient pas encore de sujet documentaire suffisamment précis.'
    };
  }

  const system = `
Tu prépares une recherche documentaire dans un corpus fermé Quiritès.
Tu ne réponds jamais à la question et tu n'ajoutes aucun fait.

OBJECTIF
Isoler le SUJET DOCUMENTAIRE réel de la formulation naturelle de l'utilisateur, et distinguer ce sujet de son intention documentaire.

CONTEXTE DU CANEVAS
Un contexte actif et quelques post-it peuvent être fournis. Ils servent uniquement à résoudre une formulation elliptique ou anaphorique : « ce sujet », « cela », « ces politiques », « et les acteurs ? », « qu'en est-il ? », etc.
- Une requête explicite prévaut TOUJOURS sur le contexte du canevas.
- Si la requête nomme un nouveau sujet, ignore l'ancien contexte pour définir le sujet.
- Si la requête ne nomme pas son sujet mais renvoie clairement au travail en cours, utilise le contexte minimal nécessaire.
- N'additionne jamais tous les thèmes du canevas : choisis uniquement le sujet nécessaire pour comprendre la demande courante.
- Si ni la requête ni le contexte ne permettent d'identifier un sujet thématique, sufficient=false.

SÉPARER SUJET ET INTENTION
- subject_query = uniquement le thème/objet substantiel recherché, avec ses qualificatifs discriminants.
- Ne mets pas dans subject_query les mots qui expriment seulement l'action attendue : « politiques publiques », « acteurs », « évolutions », « éléments d'analyse », « que dit la recherche », etc., sauf s'ils font réellement partie du thème lui-même.
- intent_type décrit l'intention : overview, precise, trends, actors, public-action, ou unspecified.
- Le besoin documentaire sélectionné dans l'interface est un indice d'intention, pas un sujet.

RÈGLES
- Retire les formulations conversationnelles ou fonctionnelles : « je souhaite », « je veux », « avoir des éléments d'analyse », « que dit la recherche », « en matière de », etc.
- Conserve impérativement les qualificatifs qui changent le sens du sujet : territoire, population, type de radicalité, modalité criminelle, période, dispositif, etc.
- subject_query doit être court, fidèle et suffisamment discriminant.
- retrieval_queries : quelques variantes sémantiquement équivalentes ou très proches, utiles pour retrouver des formulations différentes dans le corpus.
- Les variantes peuvent utiliser des synonymes ou variantes grammaticales, mais ne doivent jamais élargir vers un thème voisin.
- Ne transforme pas une sous-catégorie en thème général et ne transforme pas un thème général en sous-catégorie arbitraire.
- Un mot générique comme « analyse », « recherche », « évolution », « sécurité », « risque », « territoire » ne doit jamais devenir le sujet à lui seul.
- Une demande portant seulement sur « les politiques publiques », « les acteurs » ou « les évolutions », sans thème explicite ni contexte exploitable, est insuffisante.
- context_used=true uniquement si le contexte du canevas a réellement été nécessaire pour résoudre le sujet de cette requête.
- context_subject = le sujet contextuel effectivement utilisé ; sinon chaîne vide.
`;

  const input = await callClaudeFn({
    apiKey,
    system,
    tool: INTERPRET_TOOL,
    userText: JSON.stringify({
      besoin_documentaire: NEED_LABELS[needId] || NEED_LABELS.overview,
      requete_utilisateur: query,
      contexte_actif: cleanContextSubject || null,
      contexte_canevas: cleanCanvasContext
    }, null, 2),
    maxTokens: 1200
  });

  const subject = String(input?.subject_query || '').trim();
  const sufficient = Boolean(input?.sufficient && subject);
  const retrieval = dedupeStrings([subject, ...(Array.isArray(input?.retrieval_queries) ? input.retrieval_queries : [])]);
  const allowedIntents = new Set(['overview', 'precise', 'trends', 'actors', 'public-action', 'unspecified']);
  const intentType = allowedIntents.has(input?.intent_type) ? input.intent_type : 'unspecified';

  return {
    sufficient,
    subject_query: sufficient ? subject : '',
    retrieval_queries: sufficient ? retrieval : [],
    intent_note: String(input?.intent_note || '').trim(),
    intent_type: intentType,
    context_used: Boolean(input?.context_used && sufficient),
    context_subject: input?.context_used && sufficient ? String(input?.context_subject || cleanContextSubject || subject).trim() : '',
    reason: String(input?.reason || '').trim()
  };
}

function searchBodyForQuery(query, body) {
  const result = {
    query,
    limit: RETRIEVAL_LIMIT_PER_QUERY,
    max_per_publication: 8,
    diversify_by_publication: false
  };
  if (Array.isArray(body.kinds) && body.kinds.length) result.kinds = body.kinds;
  if (Array.isArray(body.publication_ids) && body.publication_ids.length) result.publication_ids = body.publication_ids;
  if (Array.isArray(body.provenance_levels) && body.provenance_levels.length) result.provenance_levels = body.provenance_levels;
  if (body.domaine) result.domaine = body.domaine;
  if (body.organisme) result.organisme = body.organisme;
  return result;
}

function mergeCandidateResults(searchRuns) {
  const map = new Map();

  // On assure d'abord une couverture des différentes reformulations du sujet,
  // sans diversifier artificiellement par publication. Cela évite qu'une seule
  // formulation lexicale monopolise tout le pool de validation.
  const maxRank = Math.max(0, ...searchRuns.map(run => (run?.result?.results || []).length));
  for (let rank = 0; rank < maxRank && map.size < MAX_VALIDATION_CANDIDATES; rank += 1) {
    for (const run of searchRuns) {
      const item = (run?.result?.results || [])[rank];
      if (!item) continue;
      const id = String(item?.result_id || '').trim();
      if (!id) continue;
      const current = map.get(id);
      if (!current) {
        map.set(id, {
          item: { ...item },
          bestScore: Number(item.score) || 0,
          hits: 1,
          matchedQueries: [run.query]
        });
      } else {
        current.bestScore = Math.max(current.bestScore, Number(item.score) || 0);
        current.hits += 1;
        if (!current.matchedQueries.includes(run.query)) current.matchedQueries.push(run.query);
      }
      if (map.size >= MAX_VALIDATION_CANDIDATES) break;
    }
  }

  // Un candidat retrouvé par plusieurs requêtes fidèles au même sujet est
  // présenté en premier au validateur ; cela n'en fait pas un résultat final.
  return [...map.values()]
    .sort((a, b) => b.hits - a.hits || b.bestScore - a.bestScore);
}

function candidateText(item) {
  if (item?.kind === 'chunk') return String(item.text || '').trim();
  if (item?.kind === 'node') return String(item.label || '').trim();
  if (item?.kind === 'relation') {
    return [item.source_label, item.relation_type, item.target_label].filter(Boolean).join(' — ');
  }
  return String(item?.text || item?.label || '').trim();
}

function validationPayload(candidates) {
  return candidates.map(entry => {
    const item = entry.item || {};
    return {
      result_id: item.result_id,
      kind: item.kind,
      publication_id: item.publication_id,
      publication_title: item.publication_title,
      organisme: item.organisme_producteur,
      domaine: item.domaine,
      section: item.section || '',
      locator: item.locator || '',
      matched_queries: entry.matchedQueries,
      material: clip(candidateText(item), 1000)
    };
  });
}

async function validateCandidates({ apiKey, query, needId, interpretation, candidates, callClaudeFn }) {
  if (!candidates.length) return { selected: [], summary: 'Aucun candidat lexical/sémantique à valider.' };

  const system = `
Tu valides la pertinence de matériaux issus d'un corpus documentaire fermé.
Tu n'utilises aucune connaissance extérieure et tu ne complètes aucun manque.

SUJET À RESPECTER
Le sujet documentaire interprété est fourni séparément. La requête originale sert seulement à conserver l'intention de l'utilisateur.

RÈGLE FONDAMENTALE
Un matériau n'est retenu que s'il apporte réellement quelque chose au sujet demandé.
Une simple proximité de vocabulaire, un mot générique commun, un thème voisin, un contexte institutionnel proche ou le titre d'une publication ne suffisent jamais.

TEST DE CENTRALITÉ OBLIGATOIRE
Avant de sélectionner un matériau, demande-toi : « si je retirais la mention du sujet demandé, le passage continuerait-il à traiter essentiellement d'un autre problème ? »
- Si oui, le sujet n'est qu'une mention incidente : REJET.
- objet_central = le passage porte principalement sur le sujet demandé ou sur une composante explicitement rattachée à ce sujet.
- appui_explicite = le passage ne porte pas principalement sur le sujet, mais établit un lien explicite et indispensable avec lui. Cette catégorie doit rester rare.
- Une simple occurrence dans une liste, une priorité voisine, une comparaison, un exemple périphérique ou une phrase de transition n'est jamais un appui explicite.

À REJETER NOTAMMENT
- un passage qui contient seulement une partie générique des mots de la demande ;
- un passage où le même mot est employé dans un autre sens ;
- un passage sur un domaine voisin sans lien explicite avec le sujet ;
- un passage qui traite d'une autre politique publique et ne fait que citer le sujet demandé parmi d'autres enjeux ;
- un passage rendu « pertinent » uniquement par une inférence extérieure au matériau ;
- un résultat ajouté uniquement pour diversifier les publications.

EXEMPLES DE REJET DE PRINCIPE
- un passage consacré aux discriminations qui mentionne la radicalisation parmi d'autres priorités n'est pas une politique publique de lutte contre la radicalisation ;
- un passage consacré au changement climatique qui mentionne des « risques cyber » n'est pas, pour cette seule raison, un matériau sur la cybercriminalité.

À RETENIR
- pertinence directe : le matériau traite explicitement du sujet ;
- contexte nécessaire : seulement si le lien avec le sujet est explicite et réellement nécessaire pour répondre à la demande.

${needInstruction(needId)}

La fiabilité prime sur le nombre de résultats. Il est préférable de sélectionner zéro matériau plutôt qu'un faux positif.
Pour chaque résultat sélectionné, indique aussi sa centralité et donne une justification très brève fondée uniquement sur le matériau fourni.
`;

  const input = await callClaudeFn({
    apiKey,
    system,
    tool: VALIDATE_TOOL,
    userText: JSON.stringify({
      besoin_documentaire: NEED_LABELS[needId] || NEED_LABELS.overview,
      requete_originale: query,
      sujet_documentaire: interpretation.subject_query,
      indication_intention: interpretation.intent_note,
      candidats: validationPayload(candidates)
    }, null, 2),
    maxTokens: 3200
  });

  return {
    selected: Array.isArray(input?.selected) ? input.selected : [],
    summary: String(input?.summary || '').trim()
  };
}

function finalizeValidated(candidates, validation, body, effectiveNeedId = 'overview') {
  const selectedMap = new Map();
  for (const selected of validation.selected || []) {
    const id = String(selected?.result_id || '').trim();
    if (!id || selectedMap.has(id)) continue;
    selectedMap.set(id, {
      relevance: selected?.relevance === 'contexte_necessaire' ? 'contexte_necessaire' : 'directe',
      centrality: selected?.centrality === 'appui_explicite' ? 'appui_explicite' : 'objet_central',
      reason: String(selected?.reason || '').trim()
    });
  }

  const validated = [];
  for (const entry of candidates) {
    const id = String(entry?.item?.result_id || '').trim();
    const decision = selectedMap.get(id);
    if (!decision) continue;
    // Pour une recherche d'action publique, une simple information d'appui ne suffit pas :
    // le matériau retenu doit réellement avoir le sujet comme objet central.
    if (effectiveNeedId === 'public-action' && decision.centrality !== 'objet_central') continue;
    validated.push({
      ...entry,
      validation: decision
    });
  }

  validated.sort((a, b) => {
    const ac = a.validation.centrality === 'objet_central' ? 2 : 1;
    const bc = b.validation.centrality === 'objet_central' ? 2 : 1;
    const ar = a.validation.relevance === 'directe' ? 2 : 1;
    const br = b.validation.relevance === 'directe' ? 2 : 1;
    return bc - ac || br - ar || b.hits - a.hits || b.bestScore - a.bestScore;
  });

  const limit = Math.max(1, Math.min(60, Number(body.limit) || 30));
  const maxPerPublication = Math.max(1, Math.min(8, Number(body.max_per_publication) || 3));
  const diversify = body.diversify_by_publication !== false;
  const output = [];
  const counts = new Map();

  for (const entry of validated) {
    const publicationId = String(entry.item?.publication_id || '');
    if (diversify) {
      const count = counts.get(publicationId) || 0;
      if (count >= maxPerPublication) continue;
      counts.set(publicationId, count + 1);
    }
    output.push({
      ...entry.item,
      score: Number(entry.bestScore.toFixed(3)),
      semantic_validation: {
        relevance: entry.validation.relevance,
        centrality: entry.validation.centrality,
        reason: entry.validation.reason,
        matched_queries: entry.matchedQueries
      }
    });
    if (output.length >= limit) break;
  }

  return output;
}

async function searchReflectionCorpus({
  apiKey,
  body = {},
  callClaudeFn = callClaudeWithTool,
  searchFn = searchCorpus
} = {}) {
  const query = String(body.query || '').trim();
  if (!query) {
    const error = new Error('Le champ query est obligatoire.');
    error.statusCode = 400;
    throw error;
  }
  if (query.length > 4000) {
    const error = new Error('La requête est trop longue (4000 caractères maximum).');
    error.statusCode = 400;
    throw error;
  }

  const needId = Object.prototype.hasOwnProperty.call(NEED_LABELS, body.need_id) ? body.need_id : 'overview';
  const contextSubject = String(body.context_subject || '').trim();
  const canvasContext = Array.isArray(body.canvas_context) ? body.canvas_context : [];
  const interpretation = await interpretQuery({ apiKey, query, needId, contextSubject, canvasContext, callClaudeFn });
  const detectedSpecialIntent = ['trends', 'actors', 'public-action'].includes(interpretation.intent_type) ? interpretation.intent_type : null;
  const effectiveNeedId = detectedSpecialIntent && (needId === 'overview' || needId === 'precise') ? detectedSpecialIntent : needId;

  if (!interpretation.sufficient) {
    return {
      ok: true,
      engine: 'reflection-search-v1.1-context-centrality',
      scope: CORPUS_SCOPE,
      query,
      need_id: needId,
      effective_need_id: effectiveNeedId,
      interpretation,
      search: {
        retrieval_queries: [],
        candidate_count: 0,
        validated_count: 0,
        returned: 0,
        returned_publications: 0,
        diversify_by_publication: body.diversify_by_publication !== false,
        max_per_publication: Math.max(1, Math.min(8, Number(body.max_per_publication) || 3))
      },
      validation_summary: interpretation.reason,
      results: []
    };
  }

  const retrievalQueries = dedupeStrings([
    interpretation.subject_query,
    ...interpretation.retrieval_queries
  ]);

  const searchRuns = [];
  let corpusMeta = null;
  for (const retrievalQuery of retrievalQueries) {
    const result = searchFn(searchBodyForQuery(retrievalQuery, body));
    if (!corpusMeta && result?.corpus) corpusMeta = result.corpus;
    searchRuns.push({ query: retrievalQuery, result });
  }

  const candidates = mergeCandidateResults(searchRuns);
  const validation = await validateCandidates({
    apiKey,
    query,
    needId: effectiveNeedId,
    interpretation,
    candidates,
    callClaudeFn
  });
  const results = finalizeValidated(candidates, validation, body, effectiveNeedId);
  const publications = new Set(results.map(item => item.publication_id).filter(Boolean));

  return {
    ok: true,
    engine: 'reflection-search-v1.1-context-centrality',
    scope: CORPUS_SCOPE,
    query,
    need_id: needId,
    effective_need_id: effectiveNeedId,
    interpretation,
    corpus: corpusMeta,
    search: {
      retrieval_queries: retrievalQueries,
      candidate_count: candidates.length,
      validated_count: validation.selected.length,
      returned: results.length,
      returned_publications: publications.size,
      diversify_by_publication: body.diversify_by_publication !== false,
      max_per_publication: Math.max(1, Math.min(8, Number(body.max_per_publication) || 3))
    },
    validation_summary: validation.summary,
    results
  };
}

module.exports = {
  searchReflectionCorpus,
  meaningfulTokens,
  mergeCandidateResults,
  finalizeValidated
};
