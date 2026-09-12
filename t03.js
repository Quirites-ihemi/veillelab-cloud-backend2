// =====================================================
// QUIRITES VEILLE LAB — T03 CARTE DE RÉFLEXION ASSISTÉE
// V0.2 — parcours de réflexion + RAG global + prompt intégral
// =====================================================

const MODEL_REDACTION = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MAX_PUBLICATIONS = 4;
const MAX_RAG_CANDIDATE_PUBLICATIONS = 80;
const MAX_CHUNKS_TOTAL = 48;
const MAX_CHUNKS_PAR_PUB = 16;
const MAX_GRAPH_NODES = 120;
const MAX_GRAPH_RELATIONS = 180;
const MAX_MAP_NODES = 28;

const BRANCHES = [
  { id: "question", label: "Question / problème" },
  { id: "enjeux", label: "Enjeux" },
  { id: "acteurs", label: "Acteurs" },
  { id: "faisceaux", label: "Faisceaux explicatifs" },
  { id: "leviers", label: "Leviers" },
  { id: "tensions", label: "Tensions, limites et angles morts" },
  { id: "prolongements", label: "Prolongements" }
];

const STOPWORDS = new Set([
  "dans","avec","pour","sans","sur","sous","entre","vers","chez","des","les","une","un","du","de","la","le","et","ou","que","qui","quoi","dont","est","sont","etre","être","comment","pourquoi","quel","quelle","quels","quelles","plus","moins","peut","faire","fait","cette","ces","ce","cet","leurs","leur","notre","votre","mon","ma","mes","au","aux","en","d","l"
]);

function normaliser(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(texte) {
  return normaliser(texte)
    .split(" ")
    .filter(mot => mot.length >= 3 && !STOPWORDS.has(mot));
}

function nettoyerCorpusT03(corpus) {
  const seen = new Set();
  return (Array.isArray(corpus) ? corpus : [])
    .slice(0, MAX_RAG_CANDIDATE_PUBLICATIONS)
    .map(pub => {
      const publicationId = String(pub?.publication_id || "").trim();
      if (!publicationId) return null;
      const chunks = (Array.isArray(pub.chunks) ? pub.chunks : [])
        .filter(c => c && c.chunk_id && c.texte && !seen.has(String(c.chunk_id)))
        .map((c, index) => {
          seen.add(String(c.chunk_id));
          return {
            chunk_id: String(c.chunk_id),
            publication_id: publicationId,
            ordre: String(c.ordre || index + 1),
            section: String(c.section || ""),
            page_debut: c.page_debut == null ? "" : String(c.page_debut),
            page_fin: c.page_fin == null ? "" : String(c.page_fin),
            texte: String(c.texte || "").trim()
          };
        })
        .filter(c => c.texte);

      return {
        publication_id: publicationId,
        titre: String(pub.titre || ""),
        organisme_producteur: String(pub.organisme_producteur || ""),
        annee_publication: String(pub.annee_publication || pub["année_publication"] || ""),
        type_document: String(pub.type_document || ""),
        url_contenu: String(pub.url_contenu || ""),
        url_source: String(pub.url_source || ""),
        chunks
      };
    })
    .filter(pub => pub && pub.chunks.length);
}

function scorerChunk(chunk, besoinTokens, pubTokens) {
  const texte = normaliser(`${chunk.section} ${chunk.texte}`);
  let score = 0;
  besoinTokens.forEach(t => { if (texte.includes(t)) score += 5; });
  pubTokens.forEach(t => { if (texte.includes(t)) score += 1; });
  const ordre = Number(chunk.ordre);
  if (ordre === 1) score += 2;
  return score;
}

function selectionnerPublicationsT03(corpus, besoin) {
  if (corpus.length <= MAX_PUBLICATIONS) return corpus;
  const besoinTokens = tokens(besoin);

  return corpus
    .map((pub, index) => {
      const titre = normaliser(pub.titre);
      let score = 0;
      besoinTokens.forEach(t => { if (titre.includes(t)) score += 9; });

      const chunkScores = pub.chunks
        .map(chunk => scorerChunk(chunk, besoinTokens, []))
        .sort((a, b) => b - a);
      score += (chunkScores[0] || 0) * 2;
      score += (chunkScores[1] || 0);
      score += Math.min(8, chunkScores.filter(x => x > 0).length);

      return { pub, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_PUBLICATIONS)
    .map(x => x.pub);
}

function selectionnerChunksT03(corpus, besoin) {
  const besoinTokens = tokens(besoin);
  const selection = [];

  corpus.forEach(pub => {
    const chunks = pub.chunks;
    if (chunks.length <= MAX_CHUNKS_PAR_PUB) {
      selection.push(...chunks.map(c => ({ ...c, publication_titre: pub.titre })));
      return;
    }

    const pubTokens = tokens(pub.titre).slice(0, 10);
    const scores = chunks.map((chunk, index) => ({
      chunk,
      index,
      score: scorerChunk(chunk, besoinTokens, pubTokens)
    }));

    const indexes = new Set([0, 1, chunks.length - 1]);
    scores.sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 9)
      .forEach(x => indexes.add(x.index));

    const pas = Math.max(1, Math.floor(chunks.length / 5));
    for (let i = pas; i < chunks.length && indexes.size < MAX_CHUNKS_PAR_PUB; i += pas) {
      indexes.add(Math.min(i, chunks.length - 1));
    }

    [...indexes]
      .sort((a, b) => a - b)
      .slice(0, MAX_CHUNKS_PAR_PUB)
      .forEach(i => selection.push({ ...chunks[i], publication_titre: pub.titre }));
  });

  if (selection.length <= MAX_CHUNKS_TOTAL) return selection;

  const wanted = new Set();
  corpus.forEach(pub => {
    const own = selection.filter(c => c.publication_id === pub.publication_id);
    own.slice(0, 3).forEach(c => wanted.add(c.chunk_id));
  });

  const reste = selection
    .filter(c => !wanted.has(c.chunk_id))
    .map(c => ({
      c,
      score: scorerChunk(c, besoinTokens, tokens(c.publication_titre).slice(0, 8))
    }))
    .sort((a, b) => b.score - a.score);

  const ids = [...wanted];
  reste.forEach(x => {
    if (ids.length < MAX_CHUNKS_TOTAL) ids.push(x.c.chunk_id);
  });
  const idSet = new Set(ids);
  return selection.filter(c => idSet.has(c.chunk_id)).slice(0, MAX_CHUNKS_TOTAL);
}

async function appelerClaudeT03({ apiKey, system, tool, userText, maxTokens = 4200 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL_REDACTION,
          max_tokens: maxTokens,
          system,
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
          messages: [{ role: "user", content: [{ type: "text", text: userText }] }]
        }),
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 1200)}`);
        err.status = response.status;
        throw err;
      }
      const json = JSON.parse(text);
      const toolUse = (json.content || []).find(b => b?.type === "tool_use" && b.name === tool.name);
      if (!toolUse?.input) throw new Error("Claude n'a pas retourné la carte structurée attendue.");
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = error?.name === "AbortError" || !status || status === 429 || status >= 500;
      if (!retryable || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1800 * (2 ** (attempt - 1)), 12000)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Échec de génération T03.");
}

function outilCarteT03() {
  return {
    name: "produire_carte_reflexion_t03",
    description: "Produit une carte de réflexion structurée, sourcée et explicitement distinguée entre corpus et propositions IA.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        titre: { type: "string" },
        question_centrale: { type: "string" },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              branche: { type: "string", enum: BRANCHES.map(b => b.id) },
              parent_id: { type: "string" },
              type: { type: "string", enum: ["documente", "suggestion", "question"] },
              label: { type: "string" },
              chunk_ids: { type: "array", items: { type: "string" } }
            },
            required: ["id", "branche", "parent_id", "type", "label", "chunk_ids"],
            additionalProperties: false
          }
        },
        prochaines_pistes: { type: "array", items: { type: "string" } }
      },
      required: ["titre", "question_centrale", "nodes", "prochaines_pistes"],
      additionalProperties: false
    }
  };
}

function estPodcast(pub) {
  return /podcast|audio/.test(normaliser(pub?.type_document));
}

function normaliserTimecode(valeur) {
  if (valeur == null || valeur === "") return "";
  const brut = String(valeur).trim();
  if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(brut)) return brut;
  const nombre = Number(brut.replace(",", "."));
  if (!Number.isFinite(nombre) || nombre < 0) return brut;
  const total = Math.round(nombre * 24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function provenanceChunk(chunk, pub) {
  if (estPodcast(pub)) {
    const debut = normaliserTimecode(chunk.page_debut);
    const fin = normaliserTimecode(chunk.page_fin);
    const label = debut && fin && fin !== debut ? `${debut}–${fin}` : (debut || fin || "");
    return { type: "timecode", label, timecode_debut: debut, timecode_fin: fin };
  }
  const debut = String(chunk.page_debut || "").trim();
  const fin = String(chunk.page_fin || "").trim();
  const label = debut && fin && fin !== debut ? `${debut}–${fin}` : (debut || fin || "");
  return { type: "page", label, page: debut };
}

function enrichirCarteT03(brut, corpus, chunksSelectionnes, besoin) {
  const pubs = new Map(corpus.map(p => [p.publication_id, p]));
  const chunks = new Map(chunksSelectionnes.map(c => [c.chunk_id, c]));
  const idsVus = new Set();
  const nodes = [];

  (Array.isArray(brut?.nodes) ? brut.nodes : []).slice(0, MAX_MAP_NODES).forEach((node, index) => {
    if (!node?.label || !BRANCHES.some(b => b.id === node.branche)) return;
    let id = String(node.id || `n${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!id || idsVus.has(id)) id = `n${index + 1}`;
    idsVus.add(id);

    const type = ["documente", "suggestion", "question"].includes(node.type) ? node.type : "suggestion";
    const validIds = [...new Set((node.chunk_ids || []).map(String).filter(cid => chunks.has(cid)))];
    if (type === "documente" && !validIds.length) return;

    const provenances = [];
    if (type === "documente") {
      const seen = new Set();
      validIds.forEach(cid => {
        const chunk = chunks.get(cid);
        const pub = pubs.get(chunk.publication_id);
        if (!pub) return;
        const repere = provenanceChunk(chunk, pub);
        const key = `${pub.publication_id}|${repere.type}|${repere.label}`;
        if (seen.has(key)) return;
        seen.add(key);
        provenances.push({
          publication_id: pub.publication_id,
          titre: pub.titre,
          organisme_producteur: pub.organisme_producteur,
          annee_publication: pub.annee_publication,
          url: pub.url_contenu || pub.url_source,
          chunk_id: cid,
          ...repere
        });
      });
    }

    nodes.push({
      id,
      branch_id: node.branche,
      parent_id: String(node.parent_id || ""),
      kind: type,
      label: String(node.label).trim(),
      chunk_ids: type === "documente" ? validIds : [],
      provenances
    });
  });

  const nodeIds = new Set(nodes.map(n => n.id));
  nodes.forEach(n => {
    if (n.parent_id && !nodeIds.has(n.parent_id)) n.parent_id = "";
  });

  return {
    title: String(brut?.titre || "Carte de réflexion").trim(),
    // Le besoin saisi par l’utilisateur est la source de vérité : aucune reformulation IA.
    central_question: String(besoin || "").trim(),
    branches: BRANCHES,
    nodes,
    next_steps: (Array.isArray(brut?.prochaines_pistes) ? brut.prochaines_pistes : [])
      .map(String).map(s => s.trim()).filter(Boolean).slice(0, 4)
  };
}

async function genererCarteReflexionT03({ apiKey, besoin, treatment, corpus, graphNodes = [], graphRelations = [], onProgress = async () => {} }) {
  const besoinExact = String(besoin || "").trim();
  if (!besoinExact) throw new Error("Le besoin utilisateur est vide.");

  const corpusDisponible = nettoyerCorpusT03(corpus);
  if (!corpusDisponible.length) throw new Error("Aucun contenu exploitable n’est disponible dans le RAG.");

  // Si aucune publication n’est imposée par l’interface, le client transmet le corpus RAG complet.
  // T03 en retient ici jusqu’à 4, uniquement selon la pertinence du prompt.
  const modeRecherche = corpusDisponible.length > MAX_PUBLICATIONS ? "rag_global" : "selection_manuelle";
  const corpusPropre = selectionnerPublicationsT03(corpusDisponible, besoinExact);

  await onProgress({ stage: "t03_selecting", message: modeRecherche === "rag_global" ? "Recherche des passages pertinents dans le RAG" : "Sélection des passages utiles à la réflexion" });
  const chunksSelectionnes = selectionnerChunksT03(corpusPropre, besoinExact);
  const autorises = new Set(chunksSelectionnes.map(c => c.chunk_id));

  const contexte = chunksSelectionnes.map(c => ({
    chunk_id: c.chunk_id,
    publication_id: c.publication_id,
    publication_titre: c.publication_titre,
    section: c.section,
    page_debut: c.page_debut,
    page_fin: c.page_fin,
    texte: String(c.texte || "").slice(0, 5000)
  }));

  const noeudsGraphe = (Array.isArray(graphNodes) ? graphNodes : [])
    .filter(n => corpusPropre.some(p => p.publication_id === String(n.publication_id || "")))
    .slice(0, MAX_GRAPH_NODES)
    .map(n => ({
      node_id: String(n.node_id || ""),
      publication_id: String(n.publication_id || ""),
      type_noeud: String(n.type_noeud || ""),
      libelle: String(n.libelle || ""),
      page_source: String(n.page_source || ""),
      chunk_id_source: String(n.chunk_id_source || "")
    }));

  const relationsGraphe = (Array.isArray(graphRelations) ? graphRelations : [])
    .filter(r => corpusPropre.some(p => p.publication_id === String(r.publication_id || "")))
    .slice(0, MAX_GRAPH_RELATIONS)
    .map(r => ({
      publication_id: String(r.publication_id || ""),
      source_node_id: String(r.source_node_id || r.source || ""),
      relation: String(r.relation || r.type_relation || ""),
      target_node_id: String(r.target_node_id || r.target || "")
    }));

  await onProgress({ stage: "t03_generating", message: "Construction de la carte de réflexion", chunks_selected: contexte.length });

  const system = `
Tu construis une CARTE DE RÉFLEXION ASSISTÉE pour Quiritès Veille Lab.
Ce n'est ni un résumé, ni une réponse définitive. Ta fonction est de STRUCTURER, STIMULER et PROLONGER la réflexion de l'utilisateur.

Régime : ENRICHISSEMENT CONTRÔLÉ.
Tu dois distinguer strictement trois types de nœuds :
- documente : information directement soutenue par les chunks fournis ; au moins un chunk_id valide est obligatoire ;
- suggestion : piste de réflexion proposée par l'IA ; aucun chunk_id ; formulation ouverte, jamais présentée comme un fait ;
- question : question utile pour faire avancer la réflexion ; aucun chunk_id.

Branches autorisées :
1. question = Question / problème
2. enjeux = Enjeux
3. acteurs = Acteurs
4. faisceaux = Faisceaux explicatifs
5. leviers = Leviers
6. tensions = Tensions, limites et angles morts
7. prolongements = Prolongements

Règles de qualité :
- ne remplis pas artificiellement les sept branches ; utilise seulement celles qui apportent quelque chose ;
- vise une carte initiale respirante : environ 16 à 24 nœuds au total ;
- privilégie des libellés courts, précis, intellectuellement stimulants ;
- évite les catégories vagues (« contexte », « divers », « autres ») ;
- pour les faisceaux explicatifs, n'invente aucune causalité : parle d'éléments associés, de facteurs évoqués ou d'hypothèses avancées seulement si le corpus le permet ;
- un angle mort doit être formulé comme une question ou une dimension peu documentée, jamais comme un fait inventé ;
- ne recommande pas d'expert absent du corpus ;
- les acteurs documentés doivent être présents dans les sources ou le graphe fourni ;
- n'utilise aucune connaissance extérieure comme connaissance documentée ;
- les suggestions IA doivent ouvrir une piste concrète : comparaison, indicateur, échelle, tension, hypothèse à tester, articulation entre acteurs, territoire ou temporalité ;
- n'utilise pas de jargon de consultant ; écris en français naturel ;
- la question centrale doit reprendre MOT POUR MOT et INTÉGRALEMENT le BESOIN UTILISATEUR ; ne le résume pas, ne le corrige pas et ne le reformule pas.

Parenté :
- parent_id peut rester vide ;
- tu peux rattacher un nœud à un autre nœud de la même branche lorsque cela améliore réellement la lecture ;
- ne crée pas de chaînes profondes : deux niveaux sous la branche suffisent.
`;

  const brut = await appelerClaudeT03({
    apiKey,
    system,
    tool: outilCarteT03(),
    userText:
      `BESOIN UTILISATEUR — À REPRENDRE À L’IDENTIQUE COMME QUESTION CENTRALE :\n${besoinExact}\n\n` +
      `OBJECTIF DU TRAITEMENT :\n${String(treatment?.objectif || "")}\n\n` +
      `PUBLICATIONS SÉLECTIONNÉES :\n${JSON.stringify(corpusPropre.map(p => ({ publication_id: p.publication_id, titre: p.titre, organisme_producteur: p.organisme_producteur, annee_publication: p.annee_publication })))}\n\n` +
      `PASSAGES DOCUMENTAIRES AUTORISÉS :\n${JSON.stringify(contexte)}\n\n` +
      `NŒUDS DU GRAPHE DISPONIBLES :\n${JSON.stringify(noeudsGraphe)}\n\n` +
      `RELATIONS DU GRAPHE DISPONIBLES :\n${JSON.stringify(relationsGraphe)}`
  });

  const map = enrichirCarteT03(brut, corpusPropre, chunksSelectionnes, besoinExact);
  if (!map.central_question || !map.nodes.length) throw new Error("La carte générée est insuffisamment structurée.");

  await onProgress({ stage: "t03_done", message: "Carte prête", chunks_selected: contexte.length, nodes: map.nodes.length });

  return {
    treatment_id: "T03",
    nom_traitement: String(treatment?.nom_traitement || "Carte de réflexion assistée"),
    regime_IA: "Enrichissement contrôlé",
    besoin: besoinExact,
    corpus: corpusPropre.map(p => ({
      publication_id: p.publication_id,
      titre: p.titre,
      organisme_producteur: p.organisme_producteur,
      annee_publication: p.annee_publication,
      url: p.url_contenu || p.url_source
    })),
    selection: {
      mode: modeRecherche,
      publications_disponibles: corpusDisponible.length,
      publications: corpusPropre.length,
      chunks_recus: corpusPropre.reduce((n, p) => n + p.chunks.length, 0),
      chunks_mobilises: contexte.length,
      graph_nodes_considered: noeudsGraphe.length,
      engine: "cloud-v0.2-t03-reflection-journey"
    },
    map
  };
}

module.exports = {
  genererCarteReflexionT03,
  nettoyerCorpusT03,
  selectionnerPublicationsT03,
  MODEL_REDACTION,
  BRANCHES
};
