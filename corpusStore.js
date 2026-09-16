const fs = require("fs");
const path = require("path");

const CORPUS_DIR = path.join(__dirname, "corpus");

function readJson(filename) {
  const filepath = path.join(CORPUS_DIR, filename);
  const raw = fs.readFileSync(filepath, "utf8");
  return JSON.parse(raw);
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`Corpus Quiritès invalide : ${message}`);
  }
}

function countDistinctPublicationIds(items) {
  return new Set(
    items
      .map(item => String(item?.publication_id || "").trim())
      .filter(Boolean)
  ).size;
}

function buildCorpusStore() {
  const manifest = readJson("corpus_manifest.json");
  const publicationsAll = readJson("publications.json");
  const contentsAll = readJson("contents.json");
  const nodesAll = readJson("nodes.json");
  const relationsAll = readJson("relations.json");

  invariant(Array.isArray(manifest.publications), "manifest.publications doit être un tableau");
  invariant(Array.isArray(publicationsAll), "publications.json doit être un tableau");
  invariant(Array.isArray(contentsAll), "contents.json doit être un tableau");
  invariant(Array.isArray(nodesAll), "nodes.json doit être un tableau");
  invariant(Array.isArray(relationsAll), "relations.json doit être un tableau");

  const activeManifestPublications = manifest.publications.filter(pub => pub?.active_in_corpus !== false);
  const activeIds = new Set(
    activeManifestPublications
      .map(pub => String(pub?.publication_id || "").trim())
      .filter(Boolean)
  );

  invariant(activeIds.size > 0, "aucune publication active dans le manifeste");

  const publications = publicationsAll.filter(pub => activeIds.has(String(pub?.publication_id || "").trim()));
  const contents = contentsAll.filter(item => activeIds.has(String(item?.publication_id || "").trim()));
  const nodes = nodesAll.filter(item => activeIds.has(String(item?.publication_id || "").trim()));
  const relations = relationsAll.filter(item => activeIds.has(String(item?.publication_id || "").trim()));

  const publicationById = new Map(publications.map(pub => [String(pub.publication_id), pub]));
  const manifestByPublicationId = new Map(
    activeManifestPublications.map(pub => [String(pub.publication_id), pub])
  );

  for (const publicationId of activeIds) {
    invariant(publicationById.has(publicationId), `publication active absente de publications.json : ${publicationId}`);
  }

  const nodeIds = new Set();
  for (const node of nodes) {
    const nodeId = String(node?.node_id || "").trim();
    invariant(nodeId, "node_id vide");
    invariant(!nodeIds.has(nodeId), `node_id dupliqué : ${nodeId}`);
    nodeIds.add(nodeId);
  }

  const chunkIds = new Set();
  for (const chunk of contents) {
    const chunkId = String(chunk?.chunk_id || "").trim();
    invariant(chunkId, "chunk_id vide");
    invariant(!chunkIds.has(chunkId), `chunk_id dupliqué : ${chunkId}`);
    chunkIds.add(chunkId);
  }

  const relationIds = new Set();
  for (const relation of relations) {
    const relationId = String(relation?.relation_id || "").trim();
    invariant(relationId, "relation_id vide");
    invariant(!relationIds.has(relationId), `relation_id dupliqué : ${relationId}`);
    relationIds.add(relationId);

    const sourceId = String(relation?.source_id || "").trim();
    const targetId = String(relation?.cible_id || "").trim();
    invariant(nodeIds.has(sourceId), `${relationId} pointe vers un source_id absent : ${sourceId}`);
    invariant(nodeIds.has(targetId), `${relationId} pointe vers un cible_id absent : ${targetId}`);
  }

  const expected = manifest.counts || {};
  invariant(publications.length === Number(expected.active_publications),
    `publications actives : ${publications.length}, attendu ${expected.active_publications}`);
  invariant(contents.length === Number(expected.chunks),
    `chunks actifs : ${contents.length}, attendu ${expected.chunks}`);
  invariant(nodes.length === Number(expected.nodes),
    `nœuds actifs : ${nodes.length}, attendu ${expected.nodes}`);
  invariant(relations.length === Number(expected.relations),
    `relations actives : ${relations.length}, attendu ${expected.relations}`);

  const publicationsWithChunks = countDistinctPublicationIds(contents);
  const graphOnlyPublications = activeManifestPublications.filter(pub => pub?.graph_searchable && !pub?.text_searchable).length;

  invariant(publicationsWithChunks === Number(expected.publications_with_chunks),
    `publications avec chunks : ${publicationsWithChunks}, attendu ${expected.publications_with_chunks}`);
  invariant(graphOnlyPublications === Number(expected.graph_only_publications),
    `publications graphe seulement : ${graphOnlyPublications}, attendu ${expected.graph_only_publications}`);

  const chunksByPublication = new Map();
  for (const chunk of contents) {
    const publicationId = String(chunk.publication_id);
    if (!chunksByPublication.has(publicationId)) chunksByPublication.set(publicationId, []);
    chunksByPublication.get(publicationId).push(chunk);
  }

  const nodesByPublication = new Map();
  for (const node of nodes) {
    const publicationId = String(node.publication_id);
    if (!nodesByPublication.has(publicationId)) nodesByPublication.set(publicationId, []);
    nodesByPublication.get(publicationId).push(node);
  }

  const relationsByPublication = new Map();
  for (const relation of relations) {
    const publicationId = String(relation.publication_id);
    if (!relationsByPublication.has(publicationId)) relationsByPublication.set(publicationId, []);
    relationsByPublication.get(publicationId).push(relation);
  }

  const corpus = publications.map(publication => {
    const publicationId = String(publication.publication_id);
    return {
      publication,
      manifest: manifestByPublicationId.get(publicationId) || null,
      chunks: chunksByPublication.get(publicationId) || [],
      nodes: nodesByPublication.get(publicationId) || [],
      relations: relationsByPublication.get(publicationId) || []
    };
  });

  const status = Object.freeze({
    ok: true,
    source_workbook: String(manifest.source_workbook || ""),
    active_publications: publications.length,
    publications_with_chunks: publicationsWithChunks,
    graph_only_publications: graphOnlyPublications,
    chunks: contents.length,
    nodes: nodes.length,
    relations: relations.length,
    provenance_levels: manifest.provenance_levels || {},
    active_publication_limit: Number(manifest.active_publication_limit || publications.length)
  });

  return Object.freeze({
    manifest,
    status,
    corpus,
    publications,
    contents,
    nodes,
    relations,
    activeIds,
    publicationById,
    manifestByPublicationId,
    chunksByPublication,
    nodesByPublication,
    relationsByPublication
  });
}

const STORE = buildCorpusStore();

function getCorpusStatus() {
  return { ...STORE.status };
}

function getCorpusStore() {
  return STORE;
}

function getPublicationCorpus(publicationId) {
  const id = String(publicationId || "").trim();
  if (!id || !STORE.activeIds.has(id)) return null;

  return {
    publication: STORE.publicationById.get(id) || null,
    manifest: STORE.manifestByPublicationId.get(id) || null,
    chunks: STORE.chunksByPublication.get(id) || [],
    nodes: STORE.nodesByPublication.get(id) || [],
    relations: STORE.relationsByPublication.get(id) || []
  };
}

module.exports = {
  getCorpusStatus,
  getCorpusStore,
  getPublicationCorpus
};
