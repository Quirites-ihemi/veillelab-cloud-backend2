const { searchCorpus } = require("./globalSearch");

const SUPPORTED_ACTIONS = Object.freeze({
  DOC01: Object.freeze({
    id: "DOC01",
    label: "Documenter cet élément",
    role: "documentaliste_augmentee",
    mode: "retrieval_only"
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

function runReflectionAssist(body = {}) {
  const actionId = cleanString(body.action_id || "DOC01").toUpperCase();
  const action = SUPPORTED_ACTIONS[actionId];
  if (!action) {
    const error = new Error(`Action non prise en charge : ${actionId || "(vide)"}.`);
    error.statusCode = 400;
    throw error;
  }

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
    engine: "reflection-assist-v0.1-doc01",
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

module.exports = {
  runReflectionAssist,
  SUPPORTED_ACTIONS
};
