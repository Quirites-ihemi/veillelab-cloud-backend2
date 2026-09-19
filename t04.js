// =====================================================
// QUIRITES VEILLE LAB — T04 EXTRACTION DE RECOMMANDATIONS
// V0.1 : extraction stricte, provenance fine, audit de fidélité.
// =====================================================

const MODEL_T04 = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const T04_MAX_PUBLICATIONS = 4;
const T04_LOT_MAX_CHUNKS = 22;
const T04_LOT_MAX_CARACTERES = 52000;
const T04_MAX_RECOMMENDATIONS_PER_LOT = 14;
const T04_MAX_FINAL_RECOMMENDATIONS = 60;
const T04_ANTHROPIC_MAX_ATTEMPTS = 5;
const T04_AUDIT_BATCH_SIZE = 10;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nettoyerCorpusT04(corpus) {
  const propres = [];
  const chunksVus = new Set();

  (Array.isArray(corpus) ? corpus : []).slice(0, T04_MAX_PUBLICATIONS).forEach(item => {
    if (!item || !item.publication_id) return;
    const publicationId = String(item.publication_id);
    const chunks = (Array.isArray(item.chunks) ? item.chunks : [])
      .map((c, index) => {
        if (!c || !c.chunk_id) return null;
        const chunkId = String(c.chunk_id);
        if (chunksVus.has(chunkId)) return null;
        chunksVus.add(chunkId);
        return {
          chunk_id: chunkId,
          publication_id: publicationId,
          ordre: String(c.ordre || index + 1),
          section: String(c.section || ""),
          page_debut: c.page_debut === null || c.page_debut === undefined ? "" : String(c.page_debut),
          page_fin: c.page_fin === null || c.page_fin === undefined ? "" : String(c.page_fin),
          texte: String(c.texte || "").trim(),
          _index: index
        };
      })
      .filter(c => c && c.texte)
      .sort((a, b) => {
        const na = Number(a.ordre), nb = Number(b.ordre);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return a._index - b._index;
      })
      .map(c => { delete c._index; return c; });

    if (!chunks.length) return;
    propres.push({
      publication_id: publicationId,
      titre: String(item.titre || ""),
      organisme_producteur: String(item.organisme_producteur || ""),
      annee_publication: String(item.annee_publication || item["année_publication"] || ""),
      type_document: String(item.type_document || ""),
      url_contenu: String(item.url_contenu || ""),
      url_source: String(item.url_source || ""),
      chunks
    });
  });

  return propres;
}

function indexCorpus(corpus) {
  const map = new Map();
  corpus.forEach(pub => pub.chunks.forEach(chunk => map.set(chunk.chunk_id, { pub, chunk })));
  return map;
}

function allChunks(corpus) {
  const out = [];
  corpus.forEach(pub => pub.chunks.forEach(chunk => out.push({ ...chunk, _pub: pub })));
  return out;
}

function decouperLots(chunks) {
  const lots = [];
  let courant = [];
  let taille = 0;
  (chunks || []).forEach(chunk => {
    const n = String(chunk.texte || "").length;
    if (courant.length && (courant.length >= T04_LOT_MAX_CHUNKS || taille + n > T04_LOT_MAX_CARACTERES)) {
      lots.push(courant);
      // Un chunk de recouvrement pour ne pas perdre une recommandation située à cheval sur deux lots.
      const dernier = courant[courant.length - 1];
      courant = dernier ? [dernier] : [];
      taille = dernier ? String(dernier.texte || "").length : 0;
    }
    courant.push(chunk);
    taille += n;
  });
  if (courant.length) lots.push(courant);
  return lots;
}

async function appelerClaudeAvecOutil({ apiKey, system, tool, userText, maxTokens = 3200 }) {
  const payload = {
    model: MODEL_T04,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: "user", content: [{ type: "text", text: String(userText) }] }]
  };
  let lastError;
  for (let attempt = 1; attempt <= T04_ANTHROPIC_MAX_ATTEMPTS; attempt += 1) {
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
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 1200)}`);
        err.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = Math.min(retryAfter * 1000, 60000);
        throw err;
      }
      const json = JSON.parse(text);
      const toolUse = (json.content || []).find(b => b && b.type === "tool_use" && b.name === tool.name);
      if (!toolUse?.input) {
        const err = new Error("Claude n'a pas retourné l'appel structuré attendu pour T04.");
        err.status = 503;
        throw err;
      }
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = error?.name === "AbortError" || !status || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!retryable || attempt === T04_ANTHROPIC_MAX_ATTEMPTS) throw error;
      const base = error?.retryAfterMs || Math.min(1800 * Math.pow(2, attempt - 1), 30000);
      await sleep(base + Math.floor(Math.random() * 900));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Échec de l'appel Anthropic T04.");
}

const EXTRACTION_TOOL = {
  name: "extraire_recommandations_t04",
  description: "Retourne uniquement les recommandations, préconisations, propositions ou orientations explicitement formulées dans les extraits fournis.",
  input_schema: {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        maxItems: T04_MAX_RECOMMENDATIONS_PER_LOT,
        items: {
          type: "object",
          properties: {
            formulation: { type: "string" },
            type_prescription: { type: "string", enum: ["recommandation", "preconisation", "proposition", "orientation"] },
            objet: { type: "string" },
            formulateur: { type: "string" },
            destinataire: { type: "string" },
            conditions_modalites: { type: "string" },
            chunk_ids: { type: "array", minItems: 1, items: { type: "string" } }
          },
          required: ["formulation", "type_prescription", "objet", "formulateur", "destinataire", "conditions_modalites", "chunk_ids"],
          additionalProperties: false
        }
      }
    },
    required: ["recommendations"],
    additionalProperties: false
  }
};

async function extraireLot({ apiKey, besoin, lot, numero, total }) {
  const autorises = new Set(lot.map(c => c.chunk_id));
  const docs = lot.map(c => {
    const pub = c._pub || {};
    return [
      `CHUNK ${c.chunk_id}`,
      `Publication: ${pub.publication_id || c.publication_id} — ${pub.titre || ""}`,
      `Section: ${c.section || ""}`,
      `Pages/timecode: ${c.page_debut || ""}${c.page_fin && c.page_fin !== c.page_debut ? `-${c.page_fin}` : ""}`,
      c.texte
    ].join("\n");
  }).join("\n\n---\n\n");

  const system = `
Tu réalises une EXTRACTION DOCUMENTAIRE STRICTE de recommandations à partir des seuls extraits fournis.

Règles impératives :
- Extrais uniquement ce qui est EXPLICITEMENT formulé comme recommandation, préconisation, proposition ou orientation dans la source.
- Ne transforme jamais un constat, un résultat, une corrélation, une hypothèse, une difficulté, un besoin observé ou une analyse en recommandation.
- La formulation doit rester fidèle au degré de prescription de la source. N'écris pas « il faut » si la source dit seulement « pourrait », « devrait être envisagé » ou formule une orientation.
- type_prescription = recommandation, preconisation, proposition ou orientation selon la formulation réellement documentée.
- formulation = reformulation courte et fidèle de la recommandation. Ne complète pas avec des informations extérieures.
- objet = ce sur quoi porte la recommandation, uniquement si cela est explicitement identifiable ; sinon chaîne vide.
- formulateur = acteur qui formule la recommandation uniquement s'il est explicitement identifiable ; sinon chaîne vide.
- destinataire = acteur/public auquel elle s'adresse uniquement s'il est explicitement identifiable ; sinon chaîne vide.
- conditions_modalites = conditions ou modalités de mise en œuvre explicitement mentionnées ; sinon chaîne vide.
- N'utilise AUCUNE connaissance extérieure.
- Cite uniquement des chunk_ids du lot.
- Une recommandation peut mobiliser plusieurs chunks uniquement lorsque cela est nécessaire pour soutenir sa formulation ou ses modalités.
- Respecte l'angle utilisateur lorsqu'il est renseigné, sans inventer de recommandation pour le satisfaire.
- Maximum ${T04_MAX_RECOMMENDATIONS_PER_LOT} recommandations utiles, sans remplissage artificiel.
`;

  const userText = `Angle utilisateur (facultatif) : ${besoin || "aucun angle particulier"}\nLot ${numero}/${total}\n\n${docs}`;
  const brut = await appelerClaudeAvecOutil({ apiKey, system, tool: EXTRACTION_TOOL, userText, maxTokens: 3600 });
  const recommendations = Array.isArray(brut.recommendations) ? brut.recommendations : [];
  return recommendations.map(r => ({
    formulation: String(r.formulation || "").trim(),
    type_prescription: ["recommandation", "preconisation", "proposition", "orientation"].includes(r.type_prescription) ? r.type_prescription : "recommandation",
    objet: String(r.objet || "").trim(),
    formulateur: String(r.formulateur || "").trim(),
    destinataire: String(r.destinataire || "").trim(),
    conditions_modalites: String(r.conditions_modalites || "").trim(),
    chunk_ids: [...new Set((Array.isArray(r.chunk_ids) ? r.chunk_ids : []).map(String).filter(id => autorises.has(id)))]
  })).filter(r => r.formulation && r.chunk_ids.length);
}

function mergeRecommendations(items) {
  const groups = new Map();
  for (const item of items) {
    const key = normalize(item.formulation);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { ...item, chunk_ids: [...item.chunk_ids] });
      continue;
    }
    const cur = groups.get(key);
    cur.chunk_ids = [...new Set([...cur.chunk_ids, ...item.chunk_ids])];
    if (!cur.objet && item.objet) cur.objet = item.objet;
    if (!cur.formulateur && item.formulateur) cur.formulateur = item.formulateur;
    if (!cur.destinataire && item.destinataire) cur.destinataire = item.destinataire;
    if (!cur.conditions_modalites && item.conditions_modalites) cur.conditions_modalites = item.conditions_modalites;
  }
  return [...groups.values()].slice(0, T04_MAX_FINAL_RECOMMENDATIONS);
}

const AUDIT_TOOL = {
  name: "auditer_recommandations_t04",
  description: "Vérifie que chaque élément est bien une prescription explicite et qu'il est entièrement soutenu par les extraits cités.",
  input_schema: {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            formulation: { type: "string" },
            type_prescription: { type: "string", enum: ["recommandation", "preconisation", "proposition", "orientation"] },
            objet: { type: "string" },
            formulateur: { type: "string" },
            destinataire: { type: "string" },
            conditions_modalites: { type: "string" },
            chunk_ids: { type: "array", minItems: 1, items: { type: "string" } },
            conserver: { type: "boolean" }
          },
          required: ["formulation", "type_prescription", "objet", "formulateur", "destinataire", "conditions_modalites", "chunk_ids", "conserver"],
          additionalProperties: false
        }
      }
    },
    required: ["recommendations"],
    additionalProperties: false
  }
};

async function auditerRecommendations({ apiKey, recommendations, index }) {
  const audited = [];
  for (let start = 0; start < recommendations.length; start += T04_AUDIT_BATCH_SIZE) {
    const batch = recommendations.slice(start, start + T04_AUDIT_BATCH_SIZE);
    const packet = batch.map((r, i) => {
      const sources = r.chunk_ids.map(id => {
        const item = index.get(id);
        return item ? `CHUNK ${id}: ${item.chunk.texte}` : "";
      }).filter(Boolean).join("\n");
      return `ÉLÉMENT ${i + 1}\nFormulation: ${r.formulation}\nType: ${r.type_prescription}\nObjet: ${r.objet}\nFormulateur: ${r.formulateur}\nDestinataire: ${r.destinataire}\nConditions/modalités: ${r.conditions_modalites}\nChunks autorisés: ${r.chunk_ids.join(", ")}\n${sources}`;
    }).join("\n\n---\n\n");

    const system = `
Tu audites une extraction STRICTE de recommandations.
Pour chaque élément :
- conserve-le uniquement si les extraits cités formulent explicitement une recommandation, préconisation, proposition ou orientation ;
- retire tout constat, résultat, diagnostic, souhait implicite, hypothèse ou besoin que l'extraction aurait transformé en prescription ;
- vérifie que la formulation respecte le degré de prescription de la source ;
- corrige le type de prescription si nécessaire ;
- n'invente jamais formulateur, destinataire, objet, condition ou modalité : laisse une chaîne vide si ce n'est pas explicite ;
- ne cite que les chunk_ids déjà autorisés ;
- n'ajoute aucune nouvelle recommandation.
`;
    const result = await appelerClaudeAvecOutil({ apiKey, system, tool: AUDIT_TOOL, userText: packet, maxTokens: 3600 });
    const raw = Array.isArray(result.recommendations) ? result.recommendations : [];
    raw.forEach((r, idx) => {
      const original = batch[idx];
      if (!original || !r?.conserver) return;
      const allowed = new Set(original.chunk_ids);
      const ids = [...new Set((Array.isArray(r.chunk_ids) ? r.chunk_ids : []).map(String).filter(id => allowed.has(id) && index.has(id)))];
      if (!ids.length) return;
      audited.push({
        formulation: String(r.formulation || original.formulation).trim(),
        type_prescription: ["recommandation", "preconisation", "proposition", "orientation"].includes(r.type_prescription) ? r.type_prescription : original.type_prescription,
        objet: String(r.objet || "").trim(),
        formulateur: String(r.formulateur || "").trim(),
        destinataire: String(r.destinataire || "").trim(),
        conditions_modalites: String(r.conditions_modalites || "").trim(),
        chunk_ids: ids
      });
    });
  }
  return mergeRecommendations(audited);
}

function pageLabel(chunk) {
  const a = String(chunk.page_debut || "").trim();
  const b = String(chunk.page_fin || "").trim();
  if (!a && !b) return "";
  if (!b || a === b) return a;
  return `${a}-${b}`;
}

function enrichRecommendation(item, index, n) {
  const sources = [];
  const seen = new Set();
  item.chunk_ids.forEach(id => {
    const indexed = index.get(id);
    if (!indexed) return;
    const key = `${indexed.pub.publication_id}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      publication_id: indexed.pub.publication_id,
      titre: indexed.pub.titre,
      organisme_producteur: indexed.pub.organisme_producteur,
      annee_publication: indexed.pub.annee_publication,
      type_document: indexed.pub.type_document,
      chunk_id: id,
      section: indexed.chunk.section,
      page_debut: indexed.chunk.page_debut,
      page_fin: indexed.chunk.page_fin,
      repere: pageLabel(indexed.chunk),
      extrait: indexed.chunk.texte,
      url: indexed.pub.url_contenu || indexed.pub.url_source || ""
    });
  });
  return { recommendation_id: `REC${String(n).padStart(3, "0")}`, ...item, sources };
}

async function genererRecommandationsT04({ apiKey, besoin = "", treatment = {}, corpus = [], onProgress = async () => {} }) {
  const corpusPropre = nettoyerCorpusT04(corpus);
  if (!corpusPropre.length) throw new Error("Aucun chunk exploitable dans le corpus sélectionné pour T04.");

  const chunks = allChunks(corpusPropre);
  const index = indexCorpus(corpusPropre);
  const lots = decouperLots(chunks);
  const brutes = [];

  for (let i = 0; i < lots.length; i += 1) {
    await onProgress({
      stage: "t04_extracting",
      message: `Extraction des recommandations — lot ${i + 1}/${lots.length}`,
      chunks_total: chunks.length,
      chunks_processed: lots.slice(0, i).reduce((n, lot) => n + lot.length, 0),
      lots_total: lots.length,
      lot: i + 1
    });
    const items = await extraireLot({ apiKey, besoin, lot: lots[i], numero: i + 1, total: lots.length });
    brutes.push(...items);
  }

  let merged = mergeRecommendations(brutes);
  await onProgress({
    stage: "t04_auditing",
    message: "Vérification du caractère explicite et de la provenance des recommandations",
    chunks_total: chunks.length,
    chunks_processed: chunks.length,
    lots_total: lots.length
  });
  merged = await auditerRecommendations({ apiKey, recommendations: merged, index });

  const recommendations = merged.map((r, i) => enrichRecommendation(r, index, i + 1)).filter(r => r.sources.length);

  return {
    treatment_id: "T04",
    nom_traitement: String(treatment.nom_traitement || "Extraction de recommandations"),
    regime_IA: "Extraction stricte",
    besoin: String(besoin || ""),
    engine: "t04-v0.1-strict-recommendations",
    corpus: corpusPropre.map(pub => ({
      publication_id: pub.publication_id,
      titre: pub.titre,
      organisme_producteur: pub.organisme_producteur,
      annee_publication: pub.annee_publication,
      type_document: pub.type_document,
      url: pub.url_contenu || pub.url_source
    })),
    selection: {
      publications: corpusPropre.length,
      chunks_recus: chunks.length,
      lots_analyses: lots.length,
      recommandations_extraites_avant_audit: brutes.length,
      recommandations_retenues: recommendations.length,
      audit_fidelite: true,
      connaissance_exterieure_autorisee: false,
      moteur: "t04-v0.1-strict-recommendations"
    },
    output: {
      recommendations,
      aucune_recommandation_explicite: recommendations.length === 0
    }
  };
}

module.exports = {
  MODEL_T04,
  nettoyerCorpusT04,
  genererRecommandationsT04,
  mergeRecommendations,
  pageLabel
};
