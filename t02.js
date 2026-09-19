// =====================================================
// QUIRITES VEILLE LAB — T02 GLOSSAIRE CLOUD
// V0.1 : extraction stricte, provenance fine et audit de fidélité.
// =====================================================

const MODEL_T02 = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const T02_MAX_PUBLICATIONS = 4;
const T02_LOT_MAX_CHUNKS = 24;
const T02_LOT_MAX_CARACTERES = 52000;
const T02_MAX_TERMS_PER_LOT = 12;
const T02_MAX_FINAL_TERMS = 60;
const T02_ANTHROPIC_MAX_ATTEMPTS = 5;
const T02_AUDIT_BATCH_SIZE = 12;

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

function nettoyerCorpusT02(corpus) {
  const propres = [];
  const chunksVus = new Set();

  (Array.isArray(corpus) ? corpus : []).slice(0, T02_MAX_PUBLICATIONS).forEach(item => {
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
    if (courant.length && (courant.length >= T02_LOT_MAX_CHUNKS || taille + n > T02_LOT_MAX_CARACTERES)) {
      lots.push(courant);
      courant = [];
      taille = 0;
    }
    courant.push(chunk);
    taille += n;
  });
  if (courant.length) lots.push(courant);
  return lots;
}

async function appelerClaudeAvecOutil({ apiKey, system, tool, userText, maxTokens = 2600 }) {
  const payload = {
    model: MODEL_T02,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: "user", content: [{ type: "text", text: String(userText) }] }]
  };
  let lastError;
  for (let attempt = 1; attempt <= T02_ANTHROPIC_MAX_ATTEMPTS; attempt += 1) {
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
        const err = new Error("Claude n'a pas retourné l'appel structuré attendu pour T02.");
        err.status = 503;
        throw err;
      }
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = error?.name === "AbortError" || !status || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!retryable || attempt === T02_ANTHROPIC_MAX_ATTEMPTS) throw error;
      const base = error?.retryAfterMs || Math.min(1800 * Math.pow(2, attempt - 1), 30000);
      await sleep(base + Math.floor(Math.random() * 900));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Échec de l'appel Anthropic T02.");
}

const EXTRACTION_TOOL = {
  name: "extraire_glossaire_t02",
  description: "Retourne uniquement le vocabulaire spécialisé réellement présent dans les extraits fournis.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        maxItems: T02_MAX_TERMS_PER_LOT,
        items: {
          type: "object",
          properties: {
            terme: { type: "string" },
            explicitation: { type: "string" },
            statut: { type: "string", enum: ["definition_source", "explicitation_contextuelle", "insuffisamment_defini"] },
            chunk_ids: { type: "array", minItems: 1, items: { type: "string" } }
          },
          required: ["terme", "explicitation", "statut", "chunk_ids"],
          additionalProperties: false
        }
      }
    },
    required: ["entries"],
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
Tu construis un glossaire DOCUMENTAIRE STRICT à partir des seuls extraits fournis.

Règles impératives :
- Identifie uniquement des termes spécialisés, professionnels, techniques, juridiques, administratifs, opérationnels, scientifiques, des acronymes ou des notions métier réellement présents dans les extraits.
- Écarte les mots génériques, les thèmes trop larges, les noms de personnes et les simples noms d'organismes, sauf si un sigle ou une dénomination constitue réellement un vocabulaire métier à expliciter.
- N'utilise AUCUNE connaissance extérieure.
- Pour chaque terme, l'explicitation doit être entièrement soutenue par les chunks cités.
- Si la source donne une définition explicite, statut = definition_source.
- Si le sens peut seulement être explicité à partir du contexte fourni, statut = explicitation_contextuelle et reste prudent.
- Si le terme est clairement spécialisé mais que les extraits ne permettent pas de l'expliquer précisément, statut = insuffisamment_defini et écris exactement : "Le corpus sélectionné ne permet pas de définir précisément ce terme."
- Ne transforme jamais une association en causalité.
- Cite uniquement des chunk_ids du lot.
- Maximum ${T02_MAX_TERMS_PER_LOT} termes utiles, sans remplissage artificiel.
`;

  const userText = `Angle utilisateur (facultatif) : ${besoin || "aucun angle particulier"}\nLot ${numero}/${total}\n\n${docs}`;
  const brut = await appelerClaudeAvecOutil({ apiKey, system, tool: EXTRACTION_TOOL, userText, maxTokens: 3200 });
  const entries = Array.isArray(brut.entries) ? brut.entries : [];
  return entries.map(e => ({
    terme: String(e.terme || "").trim(),
    explicitation: String(e.explicitation || "").trim(),
    statut: ["definition_source", "explicitation_contextuelle", "insuffisamment_defini"].includes(e.statut) ? e.statut : "explicitation_contextuelle",
    chunk_ids: [...new Set((Array.isArray(e.chunk_ids) ? e.chunk_ids : []).map(String).filter(id => autorises.has(id)))]
  })).filter(e => e.terme && e.explicitation && e.chunk_ids.length);
}

function mergeEntries(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = normalize(e.terme);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { ...e, chunk_ids: [...e.chunk_ids] });
      continue;
    }
    const cur = groups.get(key);
    cur.chunk_ids = [...new Set([...cur.chunk_ids, ...e.chunk_ids])];
    const rank = { definition_source: 3, explicitation_contextuelle: 2, insuffisamment_defini: 1 };
    if ((rank[e.statut] || 0) > (rank[cur.statut] || 0) || (rank[e.statut] === rank[cur.statut] && e.explicitation.length > cur.explicitation.length)) {
      cur.terme = e.terme;
      cur.explicitation = e.explicitation;
      cur.statut = e.statut;
    }
  }
  return [...groups.values()].sort((a, b) => a.terme.localeCompare(b.terme, "fr", { sensitivity: "base" })).slice(0, T02_MAX_FINAL_TERMS);
}

const AUDIT_TOOL = {
  name: "auditer_glossaire_t02",
  description: "Vérifie que chaque entrée est soutenue uniquement par les extraits cités et la corrige ou la retire si nécessaire.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            terme: { type: "string" },
            explicitation: { type: "string" },
            statut: { type: "string", enum: ["definition_source", "explicitation_contextuelle", "insuffisamment_defini"] },
            chunk_ids: { type: "array", minItems: 1, items: { type: "string" } },
            conserver: { type: "boolean" }
          },
          required: ["terme", "explicitation", "statut", "chunk_ids", "conserver"],
          additionalProperties: false
        }
      }
    },
    required: ["entries"],
    additionalProperties: false
  }
};

async function auditerEntries({ apiKey, entries, index }) {
  const audited = [];
  for (let start = 0; start < entries.length; start += T02_AUDIT_BATCH_SIZE) {
    const batch = entries.slice(start, start + T02_AUDIT_BATCH_SIZE);
    const packet = batch.map((e, i) => {
      const sources = e.chunk_ids.map(id => {
        const item = index.get(id);
        return item ? `CHUNK ${id}: ${item.chunk.texte}` : "";
      }).filter(Boolean).join("\n");
      return `ENTRÉE ${i + 1}\nTerme: ${e.terme}\nStatut: ${e.statut}\nExplicitation: ${e.explicitation}\nChunks autorisés: ${e.chunk_ids.join(", ")}\n${sources}`;
    }).join("\n\n---\n\n");

    const system = `
Tu audites un glossaire en EXTRACTION STRICTE.
Pour chaque entrée :
- conserve-la seulement si le terme est bien un vocabulaire spécialisé utile et si son explicitation est intégralement soutenue par les extraits cités ;
- supprime toute information extérieure ou déduction non documentée ;
- si les extraits ne permettent pas une définition précise, utilise le statut insuffisamment_defini et exactement la phrase : "Le corpus sélectionné ne permet pas de définir précisément ce terme." ;
- ne cite que les chunk_ids déjà autorisés pour l'entrée ;
- n'ajoute aucun nouveau terme.
`;
    const result = await appelerClaudeAvecOutil({ apiKey, system, tool: AUDIT_TOOL, userText: packet, maxTokens: 3000 });
    const raw = Array.isArray(result.entries) ? result.entries : [];
    raw.forEach((e, idx) => {
      const original = batch[idx];
      if (!original || !e?.conserver) return;
      const allowed = new Set(original.chunk_ids);
      const ids = [...new Set((Array.isArray(e.chunk_ids) ? e.chunk_ids : []).map(String).filter(id => allowed.has(id) && index.has(id)))];
      if (!ids.length) return;
      audited.push({
        terme: String(e.terme || original.terme).trim(),
        explicitation: String(e.explicitation || "").trim(),
        statut: ["definition_source", "explicitation_contextuelle", "insuffisamment_defini"].includes(e.statut) ? e.statut : original.statut,
        chunk_ids: ids
      });
    });
  }
  return mergeEntries(audited);
}

function pageLabel(chunk) {
  const a = String(chunk.page_debut || "").trim();
  const b = String(chunk.page_fin || "").trim();
  if (!a && !b) return "";
  if (!b || a === b) return a;
  return `${a}-${b}`;
}

function enrichEntry(entry, index) {
  const sources = [];
  const seen = new Set();
  entry.chunk_ids.forEach(id => {
    const item = index.get(id);
    if (!item) return;
    const key = `${item.pub.publication_id}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      publication_id: item.pub.publication_id,
      titre: item.pub.titre,
      organisme_producteur: item.pub.organisme_producteur,
      annee_publication: item.pub.annee_publication,
      type_document: item.pub.type_document,
      chunk_id: id,
      section: item.chunk.section,
      page_debut: item.chunk.page_debut,
      page_fin: item.chunk.page_fin,
      repere: pageLabel(item.chunk),
      extrait: item.chunk.texte,
      url: item.pub.url_contenu || item.pub.url_source || ""
    });
  });
  return { ...entry, sources };
}

async function genererGlossaireT02({ apiKey, besoin = "", treatment = {}, corpus = [], onProgress = async () => {} }) {
  const corpusPropre = nettoyerCorpusT02(corpus);
  if (!corpusPropre.length) throw new Error("Aucun chunk exploitable dans le corpus sélectionné pour T02.");

  const chunks = allChunks(corpusPropre);
  const index = indexCorpus(corpusPropre);
  const lots = decouperLots(chunks);
  const brutes = [];

  for (let i = 0; i < lots.length; i += 1) {
    await onProgress({
      stage: "t02_extracting",
      message: `Extraction du vocabulaire spécialisé — lot ${i + 1}/${lots.length}`,
      chunks_total: chunks.length,
      chunks_processed: lots.slice(0, i).reduce((n, lot) => n + lot.length, 0),
      lots_total: lots.length,
      lot: i + 1
    });
    const entries = await extraireLot({ apiKey, besoin, lot: lots[i], numero: i + 1, total: lots.length });
    brutes.push(...entries);
  }

  let merged = mergeEntries(brutes);
  await onProgress({
    stage: "t02_auditing",
    message: "Vérification de la fidélité et de la provenance du glossaire",
    chunks_total: chunks.length,
    chunks_processed: chunks.length,
    lots_total: lots.length
  });
  merged = await auditerEntries({ apiKey, entries: merged, index });

  const entries = merged.map(e => enrichEntry(e, index)).filter(e => e.sources.length);

  return {
    treatment_id: "T02",
    nom_traitement: String(treatment.nom_traitement || "Glossaire"),
    regime_IA: "Extraction stricte",
    besoin: String(besoin || ""),
    engine: "t02-v0.1-strict-glossary",
    corpus: corpusPropre.map(pub => ({
      publication_id: pub.publication_id,
      titre: pub.titre,
      organisme_producteur: pub.organisme_producteur,
      annee_publication: pub.annee_publication,
      url: pub.url_contenu || pub.url_source
    })),
    selection: {
      publications: corpusPropre.length,
      chunks_recus: chunks.length,
      lots_analyses: lots.length,
      termes_extraits_avant_audit: brutes.length,
      termes_retenus: entries.length,
      audit_fidelite: true,
      connaissance_exterieure_autorisee: false,
      moteur: "t02-v0.1-strict-glossary"
    },
    output: { entries }
  };
}

module.exports = {
  genererGlossaireT02,
  nettoyerCorpusT02,
  mergeEntries,
  MODEL_T02
};
