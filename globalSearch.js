const { getCorpusStore } = require("./corpusStore");

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const DEFAULT_MAX_PER_PUBLICATION = 3;

// Expansion contrôlée, volontairement courte et auditable.
// Elle sert uniquement au rappel lexical : elle n'ajoute aucun fait au corpus.
const CONTROLLED_CONCEPTS = [
  {
    id: "narcotrafic",
    triggers: ["narcotrafic", "cocaine", "stupefiants"],
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
    triggers: ["port", "ports", "portuaire", "portuaires"],
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

function buildQueryConcepts(queryTokens) {
  const concepts = [];
  const consumed = new Set();

  for (const definition of CONTROLLED_CONCEPTS) {
    const matchingTokens = queryTokens.filter(token => definition.triggers.includes(token));
    if (!matchingTokens.length) continue;
    matchingTokens.forEach(token => consumed.add(token));
    concepts.push({
      id: definition.id,
      source_tokens: matchingTokens,
      alternatives: unique(definition.alternatives.map(normalizeText).filter(Boolean))
    });
  }

  for (const token of queryTokens) {
    if (consumed.has(token)) continue;
    concepts.push({
      id: token,
      source_tokens: [token],
      alternatives: [token]
    });
  }

  return concepts;
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

function scoreDocument(doc, queryNormalized, queryConcepts) {
  if (!queryNormalized || !queryConcepts.length) return 0;

  let score = 0;
  let matchedConcepts = 0;
  let matchedInMain = 0;

  // Une expression exacte dans le contenu principal doit rester extrêmement discriminante.
  if (doc.mainNormalized.includes(queryNormalized)) score += 24;
  else if (doc.normalized.includes(queryNormalized)) score += 10;

  for (const concept of queryConcepts) {
    const main = conceptMatchScore(concept, doc.mainNormalized, doc.mainTokens);
    const section = conceptMatchScore(concept, doc.sectionNormalized, doc.sectionTokens);
    const title = conceptMatchScore(concept, doc.titleNormalized, doc.titleTokens);
    const metadata = conceptMatchScore(concept, doc.metadataNormalized, doc.metadataTokens);

    // Pondération des champs : la matière documentaire / graphe prime nettement sur les métadonnées.
    const weighted = Math.max(
      main * 8.0,
      section * 4.0,
      title * 3.5,
      metadata * 1.25
    );

    if (weighted > 0) {
      matchedConcepts += 1;
      if (main >= 0.68) matchedInMain += 1;
      score += weighted;
    }
  }

  const coverage = matchedConcepts / queryConcepts.length;
  if (coverage <= 0) return 0;

  // Deux concepts ou plus : la couverture complète doit dominer très nettement un résultat partiel.
  if (queryConcepts.length >= 2) {
    if (coverage === 1) score += 18;
    else score *= 0.32;

    // Bonus supplémentaire si tous les concepts sont réellement présents dans le contenu principal.
    if (matchedInMain === queryConcepts.length) score += 10;
  }

  // Trois concepts ou plus : écarter les documents trop éloignés de la requête.
  if (queryConcepts.length >= 3 && coverage < 0.5) return 0;

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
  const queryConcepts = buildQueryConcepts(queryTokens);

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
    const score = scoreDocument(doc, queryNormalized, queryConcepts);
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
    engine: "corpus-search-v0.1-controlled-ranking",
    query,
    normalized_query: queryNormalized,
    query_tokens: queryTokens,
    query_concepts: queryConcepts.map(c => ({ id: c.id, source_tokens: c.source_tokens })),
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
