const { getCorpusStore } = require("./corpusStore");

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const DEFAULT_MAX_PER_PUBLICATION = 3;

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
    const searchable = [
      chunk.texte,
      chunk.section,
      pub.titre,
      pub.organisme_producteur,
      pub.domaine,
      pub.type_document
    ].join(" ");
    docs.push({
      kind: "chunk",
      id: String(chunk.chunk_id),
      publication_id: pid,
      raw: chunk,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable))
    });
  }

  for (const node of store.nodes) {
    const pid = String(node.publication_id);
    const pub = publicationMeta.get(pid) || {};
    const searchable = [
      node.libelle,
      node.libelle_normalise,
      node.type_noeud,
      pub.titre,
      pub.organisme_producteur,
      pub.domaine
    ].join(" ");
    docs.push({
      kind: "node",
      id: String(node.node_id),
      publication_id: pid,
      raw: node,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable))
    });
  }

  for (const rel of store.relations) {
    const pid = String(rel.publication_id);
    const pub = publicationMeta.get(pid) || {};
    const source = nodeById.get(String(rel.source_id));
    const target = nodeById.get(String(rel.cible_id));
    const searchable = [
      source?.libelle,
      source?.libelle_normalise,
      rel.type_relation,
      target?.libelle,
      target?.libelle_normalise,
      pub.titre,
      pub.organisme_producteur,
      pub.domaine
    ].join(" ");
    docs.push({
      kind: "relation",
      id: String(rel.relation_id),
      publication_id: pid,
      raw: rel,
      source,
      target,
      pub,
      normalized: normalizeText(searchable),
      tokens: unique(tokenize(searchable))
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

function scoreDocument(doc, queryNormalized, queryTokens) {
  if (!queryNormalized || !queryTokens.length) return 0;
  let score = 0;

  // Bonus fort pour phrase exacte / quasi exacte.
  if (doc.normalized.includes(queryNormalized)) score += 18;

  // Pondération du contenu principal par type.
  const rawMain = doc.kind === "chunk"
    ? normalizeText(doc.raw.texte)
    : doc.kind === "node"
      ? normalizeText(`${doc.raw.libelle || ""} ${doc.raw.libelle_normalise || ""}`)
      : normalizeText(`${doc.source?.libelle || ""} ${doc.raw.type_relation || ""} ${doc.target?.libelle || ""}`);
  if (rawMain.includes(queryNormalized)) score += 8;

  let matched = 0;
  let exactMatched = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const ct of doc.tokens) {
      const sim = tokenSimilarity(qt, ct);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    if (best > 0) {
      matched += best;
      if (best === 1) exactMatched += 1;
    }
  }

  const coverage = matched / queryTokens.length;
  score += matched * 4.5;
  score += coverage * 7;
  score += exactMatched * 1.2;

  // Exiger un minimum de recouvrement lorsque la requête comporte plusieurs termes.
  if (queryTokens.length >= 3 && coverage < 0.34) return 0;
  if (queryTokens.length >= 2 && coverage < 0.28) return 0;

  // Le texte brut est meilleur pour la preuve, le graphe reste pleinement mobilisable.
  if (doc.kind === "chunk") score += 1.5;
  if (doc.kind === "node") score += 1.0;

  return score;
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
    const score = scoreDocument(doc, queryNormalized, queryTokens);
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
    engine: "corpus-search-v0-lexical-graph",
    query,
    normalized_query: queryNormalized,
    query_tokens: queryTokens,
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
