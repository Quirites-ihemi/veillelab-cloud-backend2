const { searchCorpus } = require("./globalSearch");
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
    engine: "reflection-assist-v0.2-doc01-doc02",
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
    engine: "reflection-assist-v0.2-doc01-doc02",
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

  const error = new Error(`Action non implémentée : ${actionId}.`);
  error.statusCode = 400;
  throw error;
}

module.exports = {
  runReflectionAssist,
  SUPPORTED_ACTIONS
};
