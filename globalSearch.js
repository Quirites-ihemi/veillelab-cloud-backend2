const { getCorpusStore } = require("./corpusStore");

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const DEFAULT_MAX_PER_PUBLICATION = 3;

// Expansion contrôlée, volontairement courte et auditable.
// Elle sert uniquement au rappel lexical : elle n'ajoute aucun fait au corpus.
//
// V0.2 : les expressions composées sont reconnues AVANT les mots isolés.
// Exemple : « trafic de cocaïne infrastructures portuaires » devient deux
// concepts (« narcotrafic » + « port »), et non quatre mots indépendants.
// Cela évite que les mots génériques « trafic » et « infrastructures »
// produisent des faux positifs une fois qu'ils appartiennent déjà à une
// expression métier plus précise.
const CONTROLLED_COMPOUND_CONCEPTS = [
  {
    id: "narcotrafic",
    patterns: [
      ["trafic", "cocaine"],
      ["trafics", "cocaine"],
      ["trafic", "stupefiants"],
      ["trafics", "stupefiants"],
      ["drug", "trafficking"],
      ["cocaine", "smuggling"]
    ],
    alternatives: [
      "narcotrafic",
      "trafic de cocaine",
      "trafics de cocaine",
      "trafic de stupefiants",
      "trafics de stupefiants",
      "drug trafficking",
      "cocaine smuggling"
    ]
  },
  {
    id: "port",
    patterns: [
      ["infrastructure", "portuaire"],
      ["infrastructures", "portuaires"],
      ["port", "infrastructure"],
      ["port", "infrastructures"],
      ["shipping", "port"],
      ["shipping", "ports"],
      ["commercial", "port"],
      ["commercial", "ports"]
    ],
    alternatives: [
      "port",
      "ports",
      "portuaire",
      "portuaires",
      "infrastructure portuaire",
      "infrastructures portuaires",
      "port infrastructure",
      "port infrastructures",
      "shipping port",
      "shipping ports",
      "commercial port",
      "commercial ports"
    ]
  }
];

const CONTROLLED_CONCEPTS = [
  {
    id: "narcotrafic",
    triggers: ["narcotrafic", "cocaine", "stupefiants"],
    alternatives: CONTROLLED_COMPOUND_CONCEPTS.find(c => c.id === "narcotrafic").alternatives
  },
  {
    id: "port",
    triggers: ["port", "ports", "portuaire", "portuaires"],
    alternatives: CONTROLLED_COMPOUND_CONCEPTS.find(c => c.id === "port").alternatives
  }
];

// V0.3 : certains mots expriment l'intention documentaire de la requête
// plutôt que son sujet. Exemple : dans « quelles perspectives d'avenir pour
// la cybercriminalité », « perspectives / avenir » demandent une lecture
// prospective, tandis que « cybercriminalité » est le sujet qui doit être
// présent dans chaque résultat retenu.
//
// Ces intentions ne sont séparées du sujet QUE si au moins un concept sujet
// reste disponible. Une requête générique comme « perspectives d'avenir »
// conserve donc son comportement lexical antérieur au lieu de devenir vide.
const CONTROLLED_QUERY_INTENTS = [
  {
    id: "future_outlook",
    triggers: [
      "perspective", "perspectives",
      "avenir",
      "futur", "future", "futures",
      "prospective", "prospectives", "prospectif", "prospectifs", "prospective",
      "tendance", "tendances",
      "evolution", "evolutions",
      "emergence", "emergences", "emergent", "emergents", "emerger"
    ],
    alternatives: [
      "perspective", "perspectives",
      "avenir", "futur", "future", "futures",
      "prospective", "prospectives", "prospectif", "prospectifs",
      "tendance", "tendances",
      "evolution", "evolutions", "evolue", "evoluent",
      "emergence", "emergences", "emergent", "emergents", "emerger",
      "a venir", "dans les annees a venir", "points d attention"
    ]
  }
];

const STOPWORDS = new Set([
  "a","ai","au","aux","avec","ce","ces","cette","cet","dans","de","des","du","elle","en","est","et","eux","il","ils","je","la","le","les","leur","leurs","mais","me","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","quel","quelle","quelles","quels","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous","y",
  "comment","quoi","peut","peuvent","plus","moins","faire","fait","faits","element","elements","sujet","question","corpus","publication","publications"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

function unique(values) {
  return [...new Set(values)];
}

function findPatternStart(tokens, pattern, consumedIndexes) {
  if (!pattern.length || pattern.length > tokens.length) return -1;
  for (let start = 0; start <= tokens.length - pattern.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      const index = start + offset;
      if (consumedIndexes.has(index) || tokens[index] !== pattern[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function buildQueryConcepts(queryTokens) {
  const concepts = [];
  const consumedIndexes = new Set();
  const emittedControlledIds = new Set();

  // 1) Expressions composées : elles ont priorité et consomment tous leurs mots.
  for (const definition of CONTROLLED_COMPOUND_CONCEPTS) {
    for (const pattern of definition.patterns) {
      const start = findPatternStart(queryTokens, pattern, consumedIndexes);
      if (start < 0) continue;

      const sourceTokens = [];
      for (let offset = 0; offset < pattern.length; offset += 1) {
        const index = start + offset;
        consumedIndexes.add(index);
        sourceTokens.push(queryTokens[index]);
      }

      if (!emittedControlledIds.has(definition.id)) {
        concepts.push({
          id: definition.id,
          source_tokens: sourceTokens,
          alternatives: unique(definition.alternatives.map(normalizeText).filter(Boolean)),
          compound: true
        });
        emittedControlledIds.add(definition.id);
      }
      break;
    }
  }

  // 2) Concepts contrôlés sur les mots restants seulement.
  for (const definition of CONTROLLED_CONCEPTS) {
    if (emittedControlledIds.has(definition.id)) continue;
    const matchingIndexes = [];
    for (let index = 0; index < queryTokens.length; index += 1) {
      if (consumedIndexes.has(index)) continue;
      if (definition.triggers.includes(queryTokens[index])) matchingIndexes.push(index);
    }
    if (!matchingIndexes.length) continue;

    const matchingTokens = matchingIndexes.map(index => queryTokens[index]);
    matchingIndexes.forEach(index => consumedIndexes.add(index));
    concepts.push({
      id: definition.id,
      source_tokens: matchingTokens,
      alternatives: unique(definition.alternatives.map(normalizeText).filter(Boolean)),
      compound: false
    });
    emittedControlledIds.add(definition.id);
  }

  // 3) Les mots encore libres restent des concepts lexicaux ordinaires.
  for (let index = 0; index < queryTokens.length; index += 1) {
    if (consumedIndexes.has(index)) continue;
    const token = queryTokens[index];
    concepts.push({
      id: token,
      source_tokens: [token],
      alternatives: [token],
      compound: false
    });
  }

  return concepts;
}

function splitSubjectAndIntentConcepts(queryConcepts) {
  const intentDefinitions = new Map(CONTROLLED_QUERY_INTENTS.map(item => [item.id, item]));
  const intentTokenToDefinition = new Map();
  for (const definition of CONTROLLED_QUERY_INTENTS) {
    for (const trigger of definition.triggers) {
      intentTokenToDefinition.set(normalizeText(trigger), definition);
    }
  }

  const subjectConcepts = [];
  const intentBuckets = new Map();

  for (const concept of queryConcepts) {
    // Les concepts contrôlés métier (narcotrafic, port...) restent toujours des sujets.
    if (concept.compound || CONTROLLED_CONCEPTS.some(item => item.id === concept.id)) {
      subjectConcepts.push(concept);
      continue;
    }

    const definition = intentTokenToDefinition.get(normalizeText(concept.id));
    if (!definition) {
      subjectConcepts.push(concept);
      continue;
    }

    if (!intentBuckets.has(definition.id)) {
      intentBuckets.set(definition.id, {
        id: definition.id,
        source_tokens: [],
        alternatives: unique(definition.alternatives.map(normalizeText).filter(Boolean)),
        compound: false,
        role: "intent"
      });
    }
    const bucket = intentBuckets.get(definition.id);
    bucket.source_tokens.push(...concept.source_tokens);
  }

  const intentConcepts = [...intentBuckets.values()].map(item => ({
    ...item,
    source_tokens: unique(item.source_tokens)
  }));

  // Ne jamais laisser une requête sans sujet exploitable.
  if (!subjectConcepts.length) {
    return { subjectConcepts: queryConcepts, intentConcepts: [] };
  }

  return { subjectConcepts, intentConcepts };
}

function tokenSimilarity(queryToken, candidateToken) {
  if (queryToken === candidateToken) return 1;
  const minLen = Math.min(queryToken.length, candidateToken.length);
  if (minLen >= 5 && (queryToken.startsWith(candidateToken) || candidateToken.startsWith(queryToken))) {
    return 0.82;
  }
  if (minLen >= 6 && queryToken.slice(0, 6) === candidateToken.slice(0, 6)) return 0.68;
  return 0;
}

function buildSearchIndex(store) {
  const publicationMeta = new Map();
  for (const pub of store.publications) {
    const id = String(pub.publication_id);
    const manifest = store.manifestByPublicationId.get(id) || {};
    publicationMeta.set(id, {
      publication_id: id,
      titre: String(pub.titre || manifest.titre || ""),
      organisme_producteur: String(pub.organisme_producteur || manifest.organisme_producteur || ""),
      annee_publication: String(pub.année_publication || pub.annee_publication || manifest.annee_publication || ""),
      type_document: String(pub.type_document || manifest.type_document || ""),
      domaine: String(pub.domaine || manifest.domaine || ""),
      url_contenu: String(pub.url_contenu || manifest.url_contenu || ""),
      url_source: String(pub.url_source || manifest.url_source || ""),
      provenance_level: String(manifest.provenance_level || ""),
      provenance_detail: String(manifest.provenance_detail || ""),
      text_searchable: Boolean(manifest.text_searchable),
      graph_searchable: Boolean(manifest.graph_searchable)
    });
  }

  const nodeById = new Map(store.nodes.map(n => [String(n.node_id), n]));

  const docs = [];
  for (const chunk of store.contents) {
    const pid = String(chunk.publication_id);
    const pub = publicationMeta.get(pid) || {};
    const mainText = String(chunk.texte || "");
    const sectionText = String(chunk.section || "");
    const titleText = String(pub.titre || "");
    const metadataText = [pub.organisme_producteur, pub.domaine, pub.type_document].join(" ");
    const searchable = [mainText, sectionText, titleText, metadataText].join(" ");
    docs.push({
      kind: "chunk",
      id: String(chunk.chunk_id),
      publication_id: pid,
      raw: chunk,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable)),
      mainNormalized: normalizeText(mainText),
      mainTokens: unique(tokenize(mainText)),
      sectionNormalized: normalizeText(sectionText),
      sectionTokens: unique(tokenize(sectionText)),
      titleNormalized: normalizeText(titleText),
      titleTokens: unique(tokenize(titleText)),
      metadataNormalized: normalizeText(metadataText),
      metadataTokens: unique(tokenize(metadataText))
    });
  }

  for (const node of store.nodes) {
    const pid = String(node.publication_id);
    const pub = publicationMeta.get(pid) || {};
    const mainText = [node.libelle, node.libelle_normalise].join(" ");
    const sectionText = String(node.type_noeud || "");
    const titleText = String(pub.titre || "");
    const metadataText = [pub.organisme_producteur, pub.domaine].join(" ");
    const searchable = [mainText, sectionText, titleText, metadataText].join(" ");
    docs.push({
      kind: "node",
      id: String(node.node_id),
      publication_id: pid,
      raw: node,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable)),
      mainNormalized: normalizeText(mainText),
      mainTokens: unique(tokenize(mainText)),
      sectionNormalized: normalizeText(sectionText),
      sectionTokens: unique(tokenize(sectionText)),
      titleNormalized: normalizeText(titleText),
      titleTokens: unique(tokenize(titleText)),
      metadataNormalized: normalizeText(metadataText),
      metadataTokens: unique(tokenize(metadataText))
    });
  }

  for (const rel of store.relations) {
    const pid = String(rel.publication_id);
    const pub = publicationMeta.get(pid) || {};
    const source = nodeById.get(String(rel.source_id));
    const target = nodeById.get(String(rel.cible_id));
    const mainText = [
      source?.libelle,
      source?.libelle_normalise,
      rel.type_relation,
      target?.libelle,
      target?.libelle_normalise
    ].join(" ");
    const sectionText = String(rel.type_relation || "");
    const titleText = String(pub.titre || "");
    const metadataText = [pub.organisme_producteur, pub.domaine].join(" ");
    const searchable = [mainText, sectionText, titleText, metadataText].join(" ");
    docs.push({
      kind: "relation",
      id: String(rel.relation_id),
      publication_id: pid,
      raw: rel,
      source,
      target,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable)),
      mainNormalized: normalizeText(mainText),
      mainTokens: unique(tokenize(mainText)),
      sectionNormalized: normalizeText(sectionText),
      sectionTokens: unique(tokenize(sectionText)),
      titleNormalized: normalizeText(titleText),
      titleTokens: unique(tokenize(titleText)),
      metadataNormalized: normalizeText(metadataText),
      metadataTokens: unique(tokenize(metadataText))
    });
  }

  return Object.freeze({ publicationMeta, nodeById, docs });
}

const INDEX = buildSearchIndex(getCorpusStore());

function parseFilters(body) {
  const publicationIds = Array.isArray(body.publication_ids)
    ? new Set(body.publication_ids.map(v => String(v || "").trim()).filter(Boolean))
    : null;
  const kinds = Array.isArray(body.kinds) && body.kinds.length
    ? new Set(body.kinds.map(v => String(v || "").trim().toLowerCase()).filter(v => ["chunk","node","relation"].includes(v)))
    : null;
  const domaine = normalizeText(body.domaine || "");
  const organisme = normalizeText(body.organisme || "");
  const provenanceLevels = Array.isArray(body.provenance_levels) && body.provenance_levels.length
    ? new Set(body.provenance_levels.map(v => String(v || "").trim().toUpperCase()).filter(v => ["A","B","C"].includes(v)))
    : null;
  return { publicationIds, kinds, domaine, organisme, provenanceLevels };
}

function matchesFilters(doc, filters) {
  if (filters.publicationIds && !filters.publicationIds.has(doc.publication_id)) return false;
  if (filters.kinds && !filters.kinds.has(doc.kind)) return false;
  if (filters.domaine && !normalizeText(doc.pub.domaine).includes(filters.domaine)) return false;
  if (filters.organisme && !normalizeText(doc.pub.organisme_producteur).includes(filters.organisme)) return false;
  if (filters.provenanceLevels && !filters.provenanceLevels.has(String(doc.pub.provenance_level || "").toUpperCase())) return false;
  return true;
}

function alternativeMatchScore(alternative, normalized, tokens) {
  if (!alternative || !normalized) return 0;

  // Une alternative composée est recherchée comme expression.
  if (alternative.includes(" ")) {
    return normalized.includes(alternative) ? 1 : 0;
  }

  // Un mot isolé doit correspondre à un token, jamais à une sous-chaîne
  // (évite par exemple que « port » matche « rapport » ou « comporte »).
  let best = 0;
  for (const candidate of tokens) {
    const sim = tokenSimilarity(alternative, candidate);
    if (sim > best) best = sim;
    if (best === 1) break;
  }
  return best;
}

function conceptMatchScore(concept, normalized, tokens) {
  let best = 0;
  for (const alternative of concept.alternatives) {
    const score = alternativeMatchScore(alternative, normalized, tokens);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

function scoreDocument(doc, queryNormalized, subjectConcepts, intentConcepts = []) {
  if (!queryNormalized || !subjectConcepts.length) return 0;

  let score = 0;
  let matchedSubjectConcepts = 0;
  let matchedSubjectsInMain = 0;

  // Une expression exacte complète reste un bonus, mais elle ne peut jamais
  // contourner l'obligation de correspondre au sujet principal.
  if (doc.mainNormalized.includes(queryNormalized)) score += 24;
  else if (doc.normalized.includes(queryNormalized)) score += 10;

  // 1) Le sujet est la condition d'entrée dans les résultats.
  for (const concept of subjectConcepts) {
    const main = conceptMatchScore(concept, doc.mainNormalized, doc.mainTokens);
    const section = conceptMatchScore(concept, doc.sectionNormalized, doc.sectionTokens);
    const title = conceptMatchScore(concept, doc.titleNormalized, doc.titleTokens);
    const metadata = conceptMatchScore(concept, doc.metadataNormalized, doc.metadataTokens);

    const weighted = Math.max(
      main * 8.0,
      section * 4.0,
      title * 3.5,
      metadata * 1.25
    );

    if (weighted > 0) {
      matchedSubjectConcepts += 1;
      if (main >= 0.68) matchedSubjectsInMain += 1;
      score += weighted;
    }
  }

  const subjectCoverage = matchedSubjectConcepts / subjectConcepts.length;
  if (subjectCoverage <= 0) return 0;

  // Deux concepts sujets ou plus : même discipline de couverture que la V0.2.
  if (subjectConcepts.length >= 2) {
    if (subjectCoverage === 1) score += 18;
    else score *= 0.32;

    if (matchedSubjectsInMain === subjectConcepts.length) score += 10;
  }

  if (subjectConcepts.length >= 3 && subjectCoverage < 0.5) return 0;

  // 2) L'intention (prospective, tendances, émergence...) ne rend jamais un
  // document pertinent à elle seule. Elle ne sert qu'à ordonner les documents
  // déjà pertinents pour le sujet.
  let matchedIntentConcepts = 0;
  for (const intent of intentConcepts) {
    const main = conceptMatchScore(intent, doc.mainNormalized, doc.mainTokens);
    const section = conceptMatchScore(intent, doc.sectionNormalized, doc.sectionTokens);
    const title = conceptMatchScore(intent, doc.titleNormalized, doc.titleTokens);
    const metadata = conceptMatchScore(intent, doc.metadataNormalized, doc.metadataTokens);

    const weightedIntent = Math.max(
      main * 4.0,
      section * 5.0,
      title * 2.5,
      metadata * 0.5
    );
    if (weightedIntent > 0) {
      matchedIntentConcepts += 1;
      score += weightedIntent;
    }
  }

  if (intentConcepts.length && matchedIntentConcepts === intentConcepts.length) score += 3;

  // Préférence légère pour la preuve textuelle, sans exclure le graphe.
  if (doc.kind === "chunk") score += 1.5;
  if (doc.kind === "node") score += 1.0;

  return score >= 5 ? score : 0;
}

function buildLocator(doc) {
  if (doc.kind === "chunk") {
    const start = String(doc.raw.page_debut || "").trim();
    const end = String(doc.raw.page_fin || "").trim();
    if (start && end && start !== end) return `${start};${end}`;
    return start || end || null;
  }
  return String(doc.raw.page_source || "").trim() || null;
}

function buildResult(doc, score) {
  const base = {
    result_id: `${doc.kind}:${doc.id}`,
    kind: doc.kind,
    score: Number(score.toFixed(3)),
    publication_id: doc.publication_id,
    publication_title: doc.pub.titre,
    organisme_producteur: doc.pub.organisme_producteur,
    annee_publication: doc.pub.annee_publication,
    type_document: doc.pub.type_document,
    domaine: doc.pub.domaine,
    url_source: doc.pub.url_source,
    url_contenu: doc.pub.url_contenu,
    provenance_level: doc.pub.provenance_level,
    provenance_detail: doc.pub.provenance_detail,
    locator: buildLocator(doc)
  };

  if (doc.kind === "chunk") {
    return {
      ...base,
      chunk_id: doc.id,
      section: String(doc.raw.section || ""),
      page_debut: String(doc.raw.page_debut || ""),
      page_fin: String(doc.raw.page_fin || ""),
      text: String(doc.raw.texte || ""),
      proof_mode: "chunk"
    };
  }

  if (doc.kind === "node") {
    return {
      ...base,
      node_id: doc.id,
      node_type: String(doc.raw.type_noeud || ""),
      label: String(doc.raw.libelle || ""),
      normalized_label: String(doc.raw.libelle_normalise || ""),
      chunk_id_source: String(doc.raw.chunk_id_source || ""),
      proof_mode: doc.pub.provenance_level === "A" ? "graph_with_chunk_refs" : "graph_only"
    };
  }

  return {
    ...base,
    relation_id: doc.id,
    relation_type: String(doc.raw.type_relation || ""),
    source_id: String(doc.raw.source_id || ""),
    source_label: String(doc.source?.libelle || ""),
    target_id: String(doc.raw.cible_id || ""),
    target_label: String(doc.target?.libelle || ""),
    chunk_id_source: String(doc.raw.chunk_id_source || ""),
    proof_mode: doc.pub.provenance_level === "A" ? "graph_with_chunk_refs" : "graph_only"
  };
}

function diversifyResults(scored, limit, maxPerPublication) {
  const selected = [];
  const counts = new Map();
  for (const item of scored) {
    const count = counts.get(item.doc.publication_id) || 0;
    if (count >= maxPerPublication) continue;
    selected.push(item);
    counts.set(item.doc.publication_id, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function searchCorpus(body = {}) {
  const query = String(body.query || "").trim();
  if (!query) {
    const error = new Error("Le champ query est obligatoire.");
    error.statusCode = 400;
    throw error;
  }
  if (query.length > 2000) {
    const error = new Error("La requête est trop longue (2000 caractères maximum). ");
    error.statusCode = 400;
    throw error;
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || DEFAULT_LIMIT));
  const maxPerPublication = Math.max(1, Math.min(8, Number(body.max_per_publication) || DEFAULT_MAX_PER_PUBLICATION));
  const diversify = body.diversify_by_publication !== false;
  const filters = parseFilters(body);
  const queryNormalized = normalizeText(query);
  const queryTokens = unique(tokenize(query));
  const rawQueryConcepts = buildQueryConcepts(queryTokens);
  const { subjectConcepts: queryConcepts, intentConcepts: queryIntents } = splitSubjectAndIntentConcepts(rawQueryConcepts);

  if (!queryTokens.length) {
    const error = new Error("La requête ne contient aucun terme exploitable.");
    error.statusCode = 400;
    throw error;
  }

  const scored = [];
  let scanned = 0;
  let scannedChunks = 0;
  let scannedNodes = 0;
  let scannedRelations = 0;

  for (const doc of INDEX.docs) {
    if (!matchesFilters(doc, filters)) continue;
    scanned += 1;
    if (doc.kind === "chunk") scannedChunks += 1;
    if (doc.kind === "node") scannedNodes += 1;
    if (doc.kind === "relation") scannedRelations += 1;
    const score = scoreDocument(doc, queryNormalized, queryConcepts, queryIntents);
    if (score > 0) scored.push({ doc, score });
  }

  scored.sort((a, b) => b.score - a.score || a.doc.publication_id.localeCompare(b.doc.publication_id));
  const chosen = diversify
    ? diversifyResults(scored, limit, maxPerPublication)
    : scored.slice(0, limit);
  const results = chosen.map(({ doc, score }) => buildResult(doc, score));

  const byKind = { chunk: 0, node: 0, relation: 0 };
  const publications = new Set();
  for (const result of results) {
    byKind[result.kind] += 1;
    publications.add(result.publication_id);
  }

  return {
    ok: true,
    engine: "corpus-search-v0.3-topic-first",
    query,
    normalized_query: queryNormalized,
    query_tokens: queryTokens,
    query_concepts: queryConcepts.map(c => ({ id: c.id, source_tokens: c.source_tokens, compound: Boolean(c.compound) })),
    query_intents: queryIntents.map(c => ({ id: c.id, source_tokens: c.source_tokens })),
    corpus: {
      active_publications: getCorpusStore().status.active_publications,
      chunks: getCorpusStore().status.chunks,
      nodes: getCorpusStore().status.nodes,
      relations: getCorpusStore().status.relations
    },
    search: {
      scanned,
      scanned_chunks: scannedChunks,
      scanned_nodes: scannedNodes,
      scanned_relations: scannedRelations,
      matching_candidates: scored.length,
      returned: results.length,
      returned_publications: publications.size,
      returned_by_kind: byKind,
      diversify_by_publication: diversify,
      max_per_publication: maxPerPublication
    },
    results
  };
}

module.exports = {
  searchCorpus,
  normalizeText,
  tokenize
};
