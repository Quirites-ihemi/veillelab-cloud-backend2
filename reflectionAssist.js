const { searchCorpus, normalizeText, tokenize } = require("./globalSearch");
const { getCorpusStore } = require("./corpusStore");

const SUPPORTED_ACTIONS = Object.freeze({
  DOC01: Object.freeze({
    id: "DOC01",
    label: "Documenter cet élément",
    role: "documentaliste_augmentee",
    mode: "retrieval_only"
  }),
  DOC02: Object.freeze({
    id: "DOC02",
    label: "Remonter à la preuve",
    role: "documentaliste_augmentee",
    mode: "exact_provenance_lookup"
  }),
  DOC03: Object.freeze({
    id: "DOC03",
    label: "Chercher des cas comparables",
    role: "documentaliste_augmentee",
    mode: "comparison_candidates_only"
  }),
  MIR01: Object.freeze({
    id: "MIR01",
    label: "Mettre une affirmation à l’épreuve",
    role: "miroir_critique",
    mode: "evidence_stress_test"
  })
});

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function buildProofStatus(result) {
  const level = cleanString(result.provenance_level);
  const locator = result.locator == null ? null : cleanString(result.locator) || null;
  const proofMode = cleanString(result.proof_mode);

  if (level === "A") {
    return {
      level,
      status: "fine_proof_available",
      fine_proof_available: true,
      locator,
      proof_mode: proofMode,
      message: "Preuve fine disponible dans le corpus."
    };
  }

  if (level === "B") {
    return {
      level,
      status: "source_level_only",
      fine_proof_available: false,
      locator,
      proof_mode: proofMode,
      message: "Source identifiée, sans repérage fin disponible."
    };
  }

  return {
    level: level || "C",
    status: "structured_without_fine_locator",
    fine_proof_available: false,
    locator: null,
    proof_mode: proofMode || "graph_only",
    message: "Connaissance structurée disponible, sans repérage fin dans la source."
  };
}

function buildContent(result) {
  if (result.kind === "chunk") {
    return {
      type: "excerpt",
      text: cleanString(result.text),
      section: cleanString(result.section) || null,
      page_debut: cleanString(result.page_debut) || null,
      page_fin: cleanString(result.page_fin) || null
    };
  }

  if (result.kind === "node") {
    return {
      type: "graph_node",
      text: cleanString(result.label),
      node_id: cleanString(result.node_id),
      node_type: cleanString(result.node_type) || null
    };
  }

  return {
    type: "graph_relation",
    text: [
      cleanString(result.source_label),
      cleanString(result.relation_type),
      cleanString(result.target_label)
    ].filter(Boolean).join(" | "),
    relation_id: cleanString(result.relation_id),
    relation_type: cleanString(result.relation_type) || null,
    source_id: cleanString(result.source_id) || null,
    source_label: cleanString(result.source_label) || null,
    target_id: cleanString(result.target_id) || null,
    target_label: cleanString(result.target_label) || null
  };
}

function buildMaterial(result) {
  const chunkId = cleanString(result.chunk_id || result.chunk_id_source) || null;
  return {
    material_id: cleanString(result.result_id),
    result_kind: cleanString(result.kind),
    relevance_score: Number(result.score || 0),
    publication: {
      publication_id: cleanString(result.publication_id),
      title: cleanString(result.publication_title),
      organisme_producteur: cleanString(result.organisme_producteur),
      annee_publication: cleanString(result.annee_publication),
      type_document: cleanString(result.type_document),
      domaine: cleanString(result.domaine),
      url_source: cleanString(result.url_source),
      url_contenu: cleanString(result.url_contenu)
    },
    content: buildContent(result),
    provenance: {
      ...buildProofStatus(result),
      detail: cleanString(result.provenance_detail),
      chunk_id: chunkId
    }
  };
}

function runDoc01(body) {
  const action = SUPPORTED_ACTIONS.DOC01;
  const element = cleanString(body.element || body.query);
  if (!element) {
    const error = new Error("Le champ element est obligatoire pour DOC01.");
    error.statusCode = 400;
    throw error;
  }

  const searchRequest = {
    query: element,
    limit: Math.max(1, Math.min(20, Number(body.limit) || 12)),
    max_per_publication: Math.max(1, Math.min(6, Number(body.max_per_publication) || 3)),
    diversify_by_publication: body.diversify_by_publication !== false
  };

  for (const key of ["publication_ids", "kinds", "domaine", "organisme", "provenance_levels"]) {
    if (body[key] !== undefined) searchRequest[key] = body[key];
  }

  const search = searchCorpus(searchRequest);
  const materials = search.results.map(buildMaterial);
  const publicationIds = [...new Set(materials.map(m => m.publication.publication_id).filter(Boolean))];

  return {
    ok: true,
    engine: "reflection-assist-v0.4-doc01-doc02-doc03-mir01",
    action,
    element,
    guardrails: {
      generates_analysis: false,
      generates_problem_statement: false,
      generates_recommendation: false,
      corpus_only: true,
      note: "DOC01 restitue des matériaux du corpus ; il ne construit pas le raisonnement de l'utilisateur."
    },
    search: {
      engine: search.engine,
      query_concepts: search.query_concepts,
      returned_materials: materials.length,
      returned_publications: publicationIds.length,
      publication_ids: publicationIds,
      returned_by_kind: search.search.returned_by_kind
    },
    materials
  };
}

function splitChunkRefs(value) {
  return cleanString(value)
    .split(/[;,]/)
    .map(cleanString)
    .filter(Boolean);
}

function parseMaterialSelector(body) {
  const explicit = cleanString(body.material_id);
  if (explicit) {
    const match = explicit.match(/^(chunk|node|relation):(.+)$/i);
    if (!match) {
      const error = new Error("material_id doit être de la forme chunk:Cxxxx, node:Nxxxx ou relation:Rxxxx.");
      error.statusCode = 400;
      throw error;
    }
    return { kind: match[1].toLowerCase(), id: cleanString(match[2]) };
  }

  const candidates = [
    ["chunk", cleanString(body.chunk_id)],
    ["node", cleanString(body.node_id)],
    ["relation", cleanString(body.relation_id)]
  ].filter(([, id]) => Boolean(id));

  if (candidates.length !== 1) {
    const error = new Error("DOC02 exige un matériau précis : material_id, ou exactement un de chunk_id, node_id, relation_id.");
    error.statusCode = 400;
    throw error;
  }

  return { kind: candidates[0][0], id: candidates[0][1] };
}

function publicationMeta(store, publicationId) {
  const publication = store.publicationById.get(publicationId) || {};
  const manifest = store.manifestByPublicationId.get(publicationId) || {};
  return {
    publication_id: publicationId,
    title: cleanString(publication.titre || manifest.titre),
    organisme_producteur: cleanString(publication.organisme_producteur || manifest.organisme_producteur),
    annee_publication: cleanString(publication.année_publication || publication.annee_publication || manifest.annee_publication),
    type_document: cleanString(publication.type_document || manifest.type_document),
    domaine: cleanString(publication.domaine || manifest.domaine),
    url_source: cleanString(publication.url_source || manifest.url_source),
    url_contenu: cleanString(publication.url_contenu || manifest.url_contenu)
  };
}

function nodeSummary(node) {
  return {
    type: "graph_node",
    node_id: cleanString(node.node_id),
    node_type: cleanString(node.type_noeud) || null,
    text: cleanString(node.libelle),
    page_source: cleanString(node.page_source) || null,
    chunk_id_source: cleanString(node.chunk_id_source) || null
  };
}

function relationSummary(relation, nodeById) {
  const source = nodeById.get(cleanString(relation.source_id));
  const target = nodeById.get(cleanString(relation.cible_id));
  return {
    type: "graph_relation",
    relation_id: cleanString(relation.relation_id),
    relation_type: cleanString(relation.type_relation) || null,
    source_id: cleanString(relation.source_id) || null,
    source_label: cleanString(source?.libelle) || null,
    target_id: cleanString(relation.cible_id) || null,
    target_label: cleanString(target?.libelle) || null,
    text: [
      cleanString(source?.libelle),
      cleanString(relation.type_relation),
      cleanString(target?.libelle)
    ].filter(Boolean).join(" | "),
    page_source: cleanString(relation.page_source) || null,
    chunk_id_source: cleanString(relation.chunk_id_source) || null
  };
}

function chunkProof(chunk) {
  const pageStart = cleanString(chunk.page_debut) || null;
  const pageEnd = cleanString(chunk.page_fin) || null;
  const locator = pageStart && pageEnd
    ? (pageStart === pageEnd ? pageStart : `${pageStart};${pageEnd}`)
    : (pageStart || pageEnd || null);

  return {
    proof_id: `chunk:${cleanString(chunk.chunk_id)}`,
    chunk_id: cleanString(chunk.chunk_id),
    section: cleanString(chunk.section) || null,
    locator,
    page_debut: pageStart,
    page_fin: pageEnd,
    text: cleanString(chunk.texte)
  };
}

function exactMaterial(store, selector) {
  if (selector.kind === "chunk") {
    const item = store.contents.find(chunk => cleanString(chunk.chunk_id) === selector.id);
    if (item) return { kind: "chunk", raw: item };
  }
  if (selector.kind === "node") {
    const item = store.nodes.find(node => cleanString(node.node_id) === selector.id);
    if (item) return { kind: "node", raw: item };
  }
  if (selector.kind === "relation") {
    const item = store.relations.find(relation => cleanString(relation.relation_id) === selector.id);
    if (item) return { kind: "relation", raw: item };
  }

  const error = new Error(`Matériau introuvable dans le corpus actif : ${selector.kind}:${selector.id}.`);
  error.statusCode = 404;
  throw error;
}

function runDoc02(body) {
  const action = SUPPORTED_ACTIONS.DOC02;
  const selector = parseMaterialSelector(body);
  const store = getCorpusStore();
  const selected = exactMaterial(store, selector);
  const publicationId = cleanString(selected.raw.publication_id);
  const manifest = store.manifestByPublicationId.get(publicationId) || {};
  const level = cleanString(manifest.provenance_level) || "C";
  const nodeById = new Map(store.nodes.map(node => [cleanString(node.node_id), node]));
  const chunkById = new Map(store.contents.map(chunk => [cleanString(chunk.chunk_id), chunk]));

  let selectedMaterial;
  let sourceLocator = null;
  let referencedChunkIds = [];

  if (selected.kind === "chunk") {
    selectedMaterial = {
      type: "excerpt",
      chunk_id: cleanString(selected.raw.chunk_id),
      section: cleanString(selected.raw.section) || null,
      text: cleanString(selected.raw.texte),
      page_debut: cleanString(selected.raw.page_debut) || null,
      page_fin: cleanString(selected.raw.page_fin) || null
    };
    referencedChunkIds = [cleanString(selected.raw.chunk_id)];
  } else if (selected.kind === "node") {
    selectedMaterial = nodeSummary(selected.raw);
    sourceLocator = cleanString(selected.raw.page_source) || null;
    referencedChunkIds = splitChunkRefs(selected.raw.chunk_id_source);
  } else {
    selectedMaterial = relationSummary(selected.raw, nodeById);
    sourceLocator = cleanString(selected.raw.page_source) || null;
    referencedChunkIds = splitChunkRefs(selected.raw.chunk_id_source);
  }

  const missingChunkRefs = referencedChunkIds.filter(id => !chunkById.has(id));
  if (missingChunkRefs.length) {
    const error = new Error(`Référence(s) de chunk absente(s) du corpus : ${missingChunkRefs.join(", ")}.`);
    error.statusCode = 500;
    throw error;
  }

  const proofs = referencedChunkIds.map(id => chunkProof(chunkById.get(id)));
  if (!sourceLocator && proofs.length === 1) sourceLocator = proofs[0].locator;

  const exactExcerptAvailable = proofs.length > 0;
  const locatorAvailable = Boolean(sourceLocator || proofs.some(proof => proof.locator));

  let status;
  let message;
  let displayInstruction;

  if (level === "A" && exactExcerptAvailable) {
    status = "fine_proof_available";
    message = locatorAvailable
      ? "Extrait(s) source identifié(s) dans le corpus avec repérage disponible."
      : "Extrait(s) source identifié(s) dans le corpus ; aucun numéro de page ou timecode n’est disponible pour ce passage.";
    displayInstruction = "Afficher uniquement les extraits et repères réellement présents dans le corpus.";
  } else if (level === "B") {
    status = "source_level_only";
    message = "La source est identifiée mais aucun extrait source fin n’est disponible dans le corpus.";
    displayInstruction = "Afficher la publication et le repère de source disponible ; ne pas fabriquer d’extrait, de page ni de timecode.";
  } else {
    status = "structured_without_fine_locator";
    message = "Le graphe contient une connaissance structurée issue de cette publication, mais aucun extrait ni repérage fin n’est disponible.";
    displayInstruction = "Afficher la publication source et signaler explicitement que le repérage fin est indisponible.";
  }

  return {
    ok: true,
    engine: "reflection-assist-v0.4-doc01-doc02-doc03-mir01",
    action,
    selected_material_id: `${selector.kind}:${selector.id}`,
    selected_material: selectedMaterial,
    publication: publicationMeta(store, publicationId),
    provenance: {
      level,
      detail: cleanString(manifest.provenance_detail),
      status,
      source_locator: sourceLocator,
      exact_excerpt_available: exactExcerptAvailable,
      locator_available: locatorAvailable,
      message,
      display_instruction: displayInstruction
    },
    proofs,
    guardrails: {
      corpus_only: true,
      exact_material_lookup: true,
      generates_analysis: false,
      generates_problem_statement: false,
      generates_recommendation: false,
      invents_excerpt: false,
      invents_locator: false,
      note: "DOC02 remonte uniquement vers la provenance réellement disponible pour le matériau sélectionné."
    }
  };
}


const COMPARISON_CONTROLLED_FACETS = Object.freeze([
  Object.freeze({
    id: "narcotrafic",
    label: "trafic de cocaïne / stupéfiants",
    query_term: "narcotrafic",
    matches(text) {
      const normalized = normalizeText(text);
      return /\bnarcotrafic\b/.test(normalized)
        || /\bcocaine\b/.test(normalized)
        || /\bstupefiant/.test(normalized)
        || /\bdrug trafficking\b/.test(normalized)
        || /\bcocaine smuggling\b/.test(normalized);
    }
  }),
  Object.freeze({
    id: "port",
    label: "ports / infrastructures portuaires",
    query_term: "ports",
    matches(text) {
      const normalized = normalizeText(text);
      const tokens = new Set(tokenize(normalized));
      return tokens.has("port")
        || tokens.has("ports")
        || tokens.has("portuaire")
        || tokens.has("portuaires")
        || normalized.includes("port infrastructure")
        || normalized.includes("port infrastructures")
        || normalized.includes("shipping port")
        || normalized.includes("commercial port");
    }
  })
]);

const COMPARISON_NOISE = new Set([
  "accrue", "accru", "notamment", "francais", "francaise", "francaises", "france",
  "mentionne", "mentionnee", "mentionnes", "mentionnees", "selon", "entre", "contre",
  "risque", "risques", "enjeu", "enjeux", "probleme", "problemes", "public", "publique",
  "publics", "publiques", "politique", "politiques", "evolution", "evolutions", "situation",
  "situations", "cadre", "part", "niveau", "niveaux", "effet", "effets", "role", "roles"
]);

let COMPARISON_TOKEN_STATS = null;

function comparisonTokenStats(store) {
  if (COMPARISON_TOKEN_STATS) return COMPARISON_TOKEN_STATS;

  const byPublication = new Map();
  for (const publication of store.publications) {
    byPublication.set(cleanString(publication.publication_id), new Set());
  }

  const add = (publicationId, text) => {
    const target = byPublication.get(cleanString(publicationId));
    if (!target) return;
    for (const token of tokenize(text)) target.add(token);
  };

  for (const chunk of store.contents) add(chunk.publication_id, `${chunk.section || ""} ${chunk.texte || ""}`);
  for (const node of store.nodes) add(node.publication_id, `${node.type_noeud || ""} ${node.libelle || ""}`);

  const nodeById = new Map(store.nodes.map(node => [cleanString(node.node_id), node]));
  for (const relation of store.relations) {
    const source = nodeById.get(cleanString(relation.source_id));
    const target = nodeById.get(cleanString(relation.cible_id));
    add(relation.publication_id, `${source?.libelle || ""} ${relation.type_relation || ""} ${target?.libelle || ""}`);
  }

  const df = new Map();
  for (const tokens of byPublication.values()) {
    for (const token of tokens) df.set(token, (df.get(token) || 0) + 1);
  }

  COMPARISON_TOKEN_STATS = {
    publication_count: byPublication.size,
    byPublication,
    df
  };
  return COMPARISON_TOKEN_STATS;
}

function comparisonIdf(token, stats) {
  const count = stats.df.get(token) || 0;
  return Math.log((stats.publication_count + 1) / (count + 1)) + 1;
}

function tokenApproxMatch(anchor, candidate) {
  if (anchor === candidate) return true;
  const minLen = Math.min(anchor.length, candidate.length);
  if (minLen >= 6 && anchor.slice(0, 6) === candidate.slice(0, 6)) return true;
  if (minLen >= 5 && (anchor.startsWith(candidate) || candidate.startsWith(anchor))) return true;
  return false;
}

function resultComparisonText(result) {
  if (result.kind === "chunk") return `${result.section || ""} ${result.text || ""}`;
  if (result.kind === "node") return `${result.node_type || ""} ${result.label || ""}`;
  return `${result.source_label || ""} ${result.relation_type || ""} ${result.target_label || ""}`;
}

function selectedMaterialText(selected, store) {
  if (selected.kind === "chunk") {
    return `${selected.raw.section || ""} ${selected.raw.texte || ""}`.trim();
  }
  if (selected.kind === "node") return cleanString(selected.raw.libelle);
  const nodeById = new Map(store.nodes.map(node => [cleanString(node.node_id), node]));
  return relationSummary(selected.raw, nodeById).text;
}

function extractComparisonBasis(text, store) {
  const raw = cleanString(text);
  const normalized = normalizeText(raw);
  const sourceTokens = [...new Set(tokenize(normalized))];
  const anchors = [];
  const consumed = new Set();

  for (const facet of COMPARISON_CONTROLLED_FACETS) {
    if (!facet.matches(raw)) continue;
    anchors.push({
      id: facet.id,
      label: facet.label,
      type: "controlled_concept",
      query_term: facet.query_term
    });
    if (facet.id === "narcotrafic") {
      ["narcotrafic", "cocaine", "stupefiants", "stupefiant", "trafic", "trafics", "drug", "trafficking", "smuggling"].forEach(t => consumed.add(t));
    }
    if (facet.id === "port") {
      ["port", "ports", "portuaire", "portuaires", "infrastructure", "infrastructures", "shipping", "commercial"].forEach(t => consumed.add(t));
    }
  }

  const stats = comparisonTokenStats(store);
  const fallbackLimit = anchors.length >= 2 ? 0 : (anchors.length === 1 ? 2 : 3);
  const fallbackCandidates = sourceTokens
    .filter(token => token.length >= 4)
    .filter(token => !consumed.has(token) && !COMPARISON_NOISE.has(token))
    .map((token, index) => ({
      token,
      index,
      df: stats.df.get(token) || 0,
      idf: comparisonIdf(token, stats)
    }))
    .filter(item => item.df > 0 && item.df <= Math.max(10, Math.floor(stats.publication_count * 0.4)))
    .sort((a, b) => b.idf - a.idf || a.index - b.index)
    .slice(0, fallbackLimit);

  for (const item of fallbackCandidates) {
    anchors.push({
      id: `lex:${item.token}`,
      label: item.token,
      type: "lexical_anchor",
      query_term: item.token,
      document_frequency: item.df
    });
  }

  return {
    source_text: raw,
    anchors,
    query: anchors.map(anchor => anchor.query_term).join(" ").trim()
  };
}

function anchorMatchesResult(anchor, result) {
  const text = resultComparisonText(result);
  if (anchor.type === "controlled_concept") {
    const facet = COMPARISON_CONTROLLED_FACETS.find(item => item.id === anchor.id);
    return Boolean(facet && facet.matches(text));
  }

  const tokens = tokenize(text);
  const wanted = cleanString(anchor.query_term);
  return tokens.some(token => tokenApproxMatch(wanted, token));
}

function runDoc03(body) {
  const action = SUPPORTED_ACTIONS.DOC03;
  const store = getCorpusStore();

  let selectedMaterialId = null;
  let originPublicationId = cleanString(body.origin_publication_id) || null;
  let basisText = cleanString(body.element || body.query);
  let selectedMaterial = null;

  if (cleanString(body.material_id) || cleanString(body.chunk_id) || cleanString(body.node_id) || cleanString(body.relation_id)) {
    const selector = parseMaterialSelector(body);
    const selected = exactMaterial(store, selector);
    selectedMaterialId = `${selector.kind}:${selector.id}`;
    originPublicationId = cleanString(selected.raw.publication_id) || originPublicationId;
    basisText = selectedMaterialText(selected, store);

    if (selected.kind === "chunk") {
      selectedMaterial = {
        type: "excerpt",
        chunk_id: cleanString(selected.raw.chunk_id),
        section: cleanString(selected.raw.section) || null,
        text: cleanString(selected.raw.texte),
        page_debut: cleanString(selected.raw.page_debut) || null,
        page_fin: cleanString(selected.raw.page_fin) || null
      };
    } else if (selected.kind === "node") {
      selectedMaterial = nodeSummary(selected.raw);
    } else {
      const nodeById = new Map(store.nodes.map(node => [cleanString(node.node_id), node]));
      selectedMaterial = relationSummary(selected.raw, nodeById);
    }
  }

  if (!basisText) {
    const error = new Error("DOC03 exige un élément à comparer : element/query ou un material_id précis.");
    error.statusCode = 400;
    throw error;
  }

  const basis = extractComparisonBasis(basisText, store);
  if (!basis.anchors.length || !basis.query) {
    return {
      ok: true,
      engine: "reflection-assist-v0.4-doc01-doc02-doc03-mir01",
      action,
      selected_material_id: selectedMaterialId,
      selected_material: selectedMaterial,
      origin_publication_id: originPublicationId,
      comparison_basis: { source_text: basis.source_text, anchors: [], query: null },
      search: { returned_cases: 0, returned_publications: 0 },
      cases: [],
      guardrails: {
        corpus_only: true,
        excludes_origin_publication: Boolean(originPublicationId),
        comparability_verified: false,
        generates_analysis: false,
        generates_recommendation: false,
        forces_candidate: false,
        note: "DOC03 ne force aucun cas comparable lorsqu'aucun critère documentaire suffisamment précis n'est détecté."
      }
    };
  }

  const search = searchCorpus({
    query: basis.query,
    limit: 30,
    max_per_publication: 4,
    diversify_by_publication: true
  });

  const byPublication = new Map();
  for (const result of search.results) {
    if (originPublicationId && result.publication_id === originPublicationId) continue;
    if (!byPublication.has(result.publication_id)) byPublication.set(result.publication_id, []);
    byPublication.get(result.publication_id).push(result);
  }

  const minShared = basis.anchors.length >= 2 ? 2 : 1;
  const candidates = [];

  for (const [publicationId, results] of byPublication.entries()) {
    const shared = basis.anchors.filter(anchor => results.some(result => anchorMatchesResult(anchor, result)));
    if (shared.length < minShared) continue;

    const coverage = shared.length / basis.anchors.length;
    if (basis.anchors.length >= 2 && coverage < (2 / basis.anchors.length)) continue;

    const bestScore = Math.max(...results.map(result => Number(result.score || 0)));
    const score = bestScore + shared.length * 3 + coverage * 5;
    const evidence = results
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 2)
      .map(buildMaterial);

    const publication = evidence[0]?.publication || publicationMeta(store, publicationId);
    candidates.push({
      publication_id: publicationId,
      score,
      publication,
      shared_features: shared.map(anchor => ({
        id: anchor.id,
        label: anchor.label,
        type: anchor.type
      })),
      shared_feature_count: shared.length,
      feature_coverage: Number(coverage.toFixed(3)),
      rapprochement_nature: coverage === 1 && shared.length >= 2
        ? "documented_shared_features"
        : "thematic_proximity_only",
      comparability_verified: false,
      evidence_materials: evidence
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.publication_id.localeCompare(b.publication_id));
  const maxCases = Math.max(1, Math.min(4, Number(body.limit_cases) || 4));
  const cases = candidates.slice(0, maxCases).map((candidate, index) => ({
    rank: index + 1,
    publication: candidate.publication,
    shared_features: candidate.shared_features,
    rapprochement_nature: candidate.rapprochement_nature,
    comparability_verified: false,
    comparison_note: candidate.rapprochement_nature === "documented_shared_features"
      ? "Plusieurs caractéristiques explicitement présentes dans le corpus sont communes. La comparabilité méthodologique reste à vérifier avec MET01."
      : "Le rapprochement est seulement thématique à ce stade. La comparabilité méthodologique n'est pas établie.",
    evidence_materials: candidate.evidence_materials
  }));

  return {
    ok: true,
    engine: "reflection-assist-v0.4-doc01-doc02-doc03-mir01",
    action,
    selected_material_id: selectedMaterialId,
    selected_material: selectedMaterial,
    origin_publication_id: originPublicationId,
    comparison_basis: {
      source_text: basis.source_text,
      query: basis.query,
      anchors: basis.anchors.map(anchor => ({
        id: anchor.id,
        label: anchor.label,
        type: anchor.type
      }))
    },
    search: {
      engine: search.engine,
      returned_candidates_before_filter: search.search.returned,
      returned_cases: cases.length,
      returned_publications: cases.length,
      origin_excluded: Boolean(originPublicationId)
    },
    cases,
    guardrails: {
      corpus_only: true,
      excludes_origin_publication: Boolean(originPublicationId),
      comparability_verified: false,
      generates_analysis: false,
      generates_problem_statement: false,
      generates_recommendation: false,
      infers_transferability: false,
      forces_candidate: false,
      note: "DOC03 propose des cas candidats à examiner à partir de caractéristiques documentées ; il ne conclut ni à l'équivalence, ni à la comparabilité méthodologique, ni à la transposabilité."
    }
  };
}


const MIR01_NUANCE_RELATIONS = new Set(["NUANCE", "SE_DISTINGUE_DE", "FREINE", "CONTRIBUE_PARTIELLEMENT_A"]);
const MIR01_CONTRADICTION_RELATIONS = new Set(["REMET_EN_CAUSE", "CONTREDIT"]);
const MIR01_SUPPORT_RELATIONS = new Set([
  "CONFIRME", "MET_EN_EVIDENCE", "ILLUSTRE", "CARACTERISE", "QUANTIFIE", "DOCUMENTE",
  "FAIT_SUITE_A", "CONTRIBUE_A", "FAVORISE", "ACCENTUE", "RENFORCE", "INFLUENCE",
  "PERMET_DE", "SE_TRADUIT_PAR", "TAUX_ELEVE_DE", "TAUX_FAIBLE_DE"
]);
const MIR01_CAUSAL_RELATIONS = new Set([
  "FAIT_SUITE_A", "CONTRIBUE_A", "FAVORISE", "ACCENTUE", "RENFORCE", "INFLUENCE",
  "PERMET_DE", "SE_TRADUIT_PAR"
]);

const MIR01_NUANCE_MARKERS = [
  "toutefois", "cependant", "neanmoins", "mais", "malgre", "en revanche",
  "temporaire", "temporairement", "pas necessairement", "sans pour autant",
  "however", "although", "despite", "temporary", "temporarily", "not necessarily", "yet"
];

const MIR01_STRONG_LIMIT_MARKERS = [
  "temporaire", "temporairement", "pas necessairement", "sans pour autant",
  "temporary", "temporarily", "not necessarily", "despite", "malgre"
];

const MIR01_CAUSAL_PATTERNS = [
  /\bentraine\b/, /\bentrainent\b/, /\bprovoque\b/, /\bprovoquent\b/, /\bcause\b/,
  /\bconduit a\b/, /\bconduisent a\b/, /\bdeplace\b/, /\bdeplacent\b/,
  /\breoriente\b/, /\breorientent\b/, /\bfavorise\b/, /\bfavorisent\b/,
  /\baccentue\b/, /\baccentuent\b/, /\bexplique\b/, /\bexpliquent\b/,
  /\ba pour effet\b/, /\bont pour effet\b/, /\bproduit\b/, /\bproduisent\b/
];

const MIR01_TEXT_CAUSAL_MARKERS = [
  "a entraine", "ont entraine", "contribue a", "fait suite a", "pour contourner",
  "en reponse a", "sous l effet de", "a conduit a", "ont conduit a", "reorientation",
  "responding to", "produces temporary shifts", "led to", "resulting in", "as a result"
];

function mir01ResultText(result) {
  return resultComparisonText(result);
}

function mir01ConceptMatch(concept, result) {
  const text = mir01ResultText(result);
  if (concept.id === "narcotrafic") {
    const facet = COMPARISON_CONTROLLED_FACETS.find(item => item.id === "narcotrafic");
    return Boolean(facet && facet.matches(text));
  }
  if (concept.id === "port") {
    const facet = COMPARISON_CONTROLLED_FACETS.find(item => item.id === "port");
    return Boolean(facet && facet.matches(text));
  }

  const wanted = cleanString(concept.id);
  if (!wanted) return false;
  return tokenize(text).some(token => tokenApproxMatch(wanted, token));
}

function mir01Coverage(search, result) {
  const concepts = search.query_concepts || [];
  if (!concepts.length) return { matched: 0, total: 0, ratio: 0, matched_ids: [] };
  const matched = concepts.filter(concept => mir01ConceptMatch(concept, result));
  return {
    matched: matched.length,
    total: concepts.length,
    ratio: matched.length / concepts.length,
    matched_ids: matched.map(concept => concept.id)
  };
}

function mir01RequiredControlledFacets(assertion) {
  return COMPARISON_CONTROLLED_FACETS
    .filter(facet => facet.matches(assertion))
    .map(facet => facet.id);
}

function mir01HasAllControlledFacets(result, requiredFacetIds) {
  if (!requiredFacetIds.length) return true;
  const text = mir01ResultText(result);
  return requiredFacetIds.every(id => {
    const facet = COMPARISON_CONTROLLED_FACETS.find(item => item.id === id);
    return Boolean(facet && facet.matches(text));
  });
}

function mir01DetectCausalClaim(assertion) {
  const normalized = normalizeText(assertion);
  const markers = MIR01_CAUSAL_PATTERNS
    .filter(pattern => pattern.test(normalized))
    .map(pattern => String(pattern).replace(/^\/\\b|\\b\/$/g, ""));
  return {
    causal_language_detected: markers.length > 0,
    markers
  };
}

function mir01TextHasMarker(text, markers) {
  const normalized = normalizeText(text);
  return markers.some(marker => normalized.includes(normalizeText(marker)));
}

function mir01Classify(result, coverage, causalClaim) {
  const relationType = cleanString(result.relation_type).toUpperCase();
  const text = mir01ResultText(result);

  if (result.kind === "relation" && MIR01_CONTRADICTION_RELATIONS.has(relationType)) {
    return { position: "contradiction", reason: `relation_explicit:${relationType}`, causal_scope: "not_inferred" };
  }

  if (result.kind === "relation" && MIR01_NUANCE_RELATIONS.has(relationType)) {
    return { position: "nuance", reason: `relation_explicit:${relationType}`, causal_scope: "not_inferred" };
  }

  let support = false;
  let reason = "";
  if (result.kind === "relation" && MIR01_SUPPORT_RELATIONS.has(relationType)) {
    support = true;
    reason = `relation_explicit:${relationType}`;
  } else if (result.kind === "node" && coverage.ratio >= 0.6) {
    support = true;
    reason = "high_concept_overlap_node";
  } else if (result.kind === "chunk" && coverage.ratio >= 0.5) {
    support = true;
    reason = "high_concept_overlap_excerpt";
  }

  const hasNuanceMarker = mir01TextHasMarker(text, MIR01_NUANCE_MARKERS);
  const hasStrongLimitMarker = mir01TextHasMarker(text, MIR01_STRONG_LIMIT_MARKERS);

  if (causalClaim.causal_language_detected) {
    const causalRelation = result.kind === "relation" && MIR01_CAUSAL_RELATIONS.has(relationType);
    const causalText = mir01TextHasMarker(text, MIR01_TEXT_CAUSAL_MARKERS);

    if (support && (causalRelation || causalText) && !hasStrongLimitMarker) {
      return {
        position: "support",
        reason,
        causal_scope: "causal_sequence_documented_in_source"
      };
    }

    if (hasStrongLimitMarker || hasNuanceMarker) {
      return {
        position: "nuance",
        reason: hasStrongLimitMarker ? "limitation_marker_in_source" : "nuance_marker_in_source",
        causal_scope: (causalRelation || causalText) ? "causal_sequence_documented_but_limited" : "not_inferred"
      };
    }

    if (support) {
      return {
        position: "support",
        reason,
        causal_scope: "descriptive_or_associative_support_only"
      };
    }

    return { position: "context", reason: "relevant_context_only", causal_scope: "not_inferred" };
  }

  if (hasNuanceMarker) {
    return { position: "nuance", reason: "nuance_marker_in_source", causal_scope: "not_applicable" };
  }

  if (support) return { position: "support", reason, causal_scope: "not_applicable" };
  return { position: "context", reason: "relevant_context_only", causal_scope: "not_applicable" };
}

function mir01Material(result, coverage, classification) {
  return {
    ...buildMaterial(result),
    stress_test: {
      position: classification.position,
      classification_reason: classification.reason,
      query_concept_coverage: Number(coverage.ratio.toFixed(3)),
      matched_query_concepts: coverage.matched_ids,
      causal_scope: classification.causal_scope
    }
  };
}

function runMir01(body) {
  const action = SUPPORTED_ACTIONS.MIR01;
  const assertion = cleanString(body.assertion || body.element || body.query);
  if (!assertion) {
    const error = new Error("Le champ assertion est obligatoire pour MIR01.");
    error.statusCode = 400;
    throw error;
  }

  const causalClaim = mir01DetectCausalClaim(assertion);
  const search = searchCorpus({
    query: assertion,
    limit: Math.max(12, Math.min(30, Number(body.search_limit) || 24)),
    max_per_publication: Math.max(3, Math.min(8, Number(body.max_per_publication) || 6)),
    diversify_by_publication: true
  });

  const requiredControlledFacets = mir01RequiredControlledFacets(assertion);
  const topScore = Math.max(0, ...search.results.map(result => Number(result.score || 0)));
  const scoreFloor = topScore > 0 ? Math.max(5, topScore * 0.5) : Infinity;
  const queryConceptCount = (search.query_concepts || []).length;
  const minMatchedConcepts = queryConceptCount <= 2 ? 1 : Math.max(2, Math.ceil(queryConceptCount * 0.5));

  const relevant = [];
  for (const result of search.results) {
    const score = Number(result.score || 0);
    if (score < scoreFloor) continue;
    if (!mir01HasAllControlledFacets(result, requiredControlledFacets)) continue;
    const coverage = mir01Coverage(search, result);
    if (!requiredControlledFacets.length && coverage.matched < minMatchedConcepts) continue;
    const classification = mir01Classify(result, coverage, causalClaim);
    relevant.push({ result, coverage, classification });
  }

  const byPosition = { support: [], nuance: [], contradiction: [], context: [] };
  for (const item of relevant) {
    byPosition[item.classification.position].push(mir01Material(item.result, item.coverage, item.classification));
  }

  for (const values of Object.values(byPosition)) {
    values.sort((a, b) => b.relevance_score - a.relevance_score || a.material_id.localeCompare(b.material_id));
  }

  const maxPerPosition = Math.max(1, Math.min(4, Number(body.max_per_position) || 3));
  const support = byPosition.support.slice(0, maxPerPosition);
  const nuance = byPosition.nuance.slice(0, maxPerPosition);
  const contradiction = byPosition.contradiction.slice(0, maxPerPosition);
  const context = byPosition.context.slice(0, Math.min(2, maxPerPosition));
  const classifiedCount = support.length + nuance.length + contradiction.length;
  const insufficient = classifiedCount === 0;

  return {
    ok: true,
    engine: "reflection-assist-v0.4-doc01-doc02-doc03-mir01",
    action,
    assertion,
    claim_analysis: {
      causal_language_detected: causalClaim.causal_language_detected,
      causal_markers: causalClaim.markers,
      required_controlled_concepts: requiredControlledFacets,
      methodological_caution: causalClaim.causal_language_detected
        ? "La présence d'éléments convergents ne suffit pas, à elle seule, à établir une causalité générale. MIR01 distingue ce que la source documente d'une inférence causale plus large."
        : null
    },
    search: {
      engine: search.engine,
      query_concepts: search.query_concepts,
      candidates_returned: search.search.returned,
      relevance_score_floor: Number.isFinite(scoreFloor) ? Number(scoreFloor.toFixed(3)) : null,
      relevant_after_guardrails: relevant.length,
      classified_materials: classifiedCount,
      supporting_materials: support.length,
      nuance_materials: nuance.length,
      contradiction_materials: contradiction.length
    },
    evidence: {
      support,
      nuance,
      contradiction,
      context
    },
    documentary_state: {
      insufficient,
      explicit_contradiction_found: contradiction.length > 0,
      contradiction_note: contradiction.length
        ? "Le corpus contient au moins un matériau explicitement structuré comme remise en cause de l'affirmation ou d'un de ses éléments."
        : "Aucune contradiction explicite n'a été repérée parmi les matériaux retenus. Cette absence ne prouve pas qu'il n'existe pas de contradiction.",
      conclusion: "MIR01 expose les matériaux disponibles et leurs tensions documentaires ; il ne rend pas de verdict sur l'affirmation."
    },
    guardrails: {
      corpus_only: true,
      rewrites_assertion: false,
      decides_truth_or_falsity: false,
      generates_problem_statement: false,
      generates_recommendation: false,
      infers_causality_from_association: false,
      invents_counterargument: false,
      classification_is_documentary_not_verdict: true,
      note: "MIR01 classe uniquement des matériaux retrouvés dans le corpus en appui, nuance ou contradiction explicite ; l'interprétation finale reste à l'utilisateur."
    }
  };
}

function runReflectionAssist(body = {}) {
  const actionId = cleanString(body.action_id || "DOC01").toUpperCase();
  const action = SUPPORTED_ACTIONS[actionId];
  if (!action) {
    const error = new Error(`Action non prise en charge : ${actionId || "(vide)"}.`);
    error.statusCode = 400;
    throw error;
  }

  if (actionId === "DOC01") return runDoc01(body);
  if (actionId === "DOC02") return runDoc02(body);
  if (actionId === "DOC03") return runDoc03(body);
  if (actionId === "MIR01") return runMir01(body);

  const error = new Error(`Action non implémentée : ${actionId}.`);
  error.statusCode = 400;
  throw error;
}

module.exports = {
  runReflectionAssist,
  SUPPORTED_ACTIONS
};
