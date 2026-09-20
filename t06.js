// =====================================================
// QUIRITES VEILLE LAB — T06 SCÉNARIO DE VEILLE
// V0.1 : cadrage sémantique du besoin, notions strictement ancrées dans le corpus.
// =====================================================

const { searchCorpus } = require('./globalSearch');

const MODEL_T06 = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const T06_MAX_CANDIDATES = 36;
const T06_MAX_NOTIONS = 5;
const T06_ANTHROPIC_MAX_ATTEMPTS = 4;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value, max = 620) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

async function appelerClaudeAvecOutil({ apiKey, system, tool, userText, maxTokens = 2600 }) {
  const payload = {
    model: MODEL_T06,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: [{ type: 'text', text: String(userText) }] }]
  };

  let lastError;
  for (let attempt = 1; attempt <= T06_ANTHROPIC_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 1200)}`);
        err.status = response.status;
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = Math.min(retryAfter * 1000, 60000);
        throw err;
      }
      const json = JSON.parse(text);
      const toolUse = (json.content || []).find(b => b && b.type === 'tool_use' && b.name === tool.name);
      if (!toolUse?.input) {
        const err = new Error("Claude n'a pas retourné l'appel structuré attendu pour T06.");
        err.status = 503;
        throw err;
      }
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = error?.name === 'AbortError' || !status || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!retryable || attempt === T06_ANTHROPIC_MAX_ATTEMPTS) throw error;
      const base = error?.retryAfterMs || Math.min(1400 * Math.pow(2, attempt - 1), 20000);
      await sleep(base + Math.floor(Math.random() * 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Échec de l'appel Anthropic T06.");
}

const NEED_ANALYSIS_TOOL = {
  name: 'analyser_besoin_t06',
  description: "Décompose le besoin sans le reformuler afin d'identifier le sujet central utilisé pour interroger le corpus et les dimensions secondaires à respecter.",
  input_schema: {
    type: 'object',
    properties: {
      sujet_central: { type: 'string' },
      requete_recherche: { type: 'string' },
      dimensions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['echelle', 'territoire', 'temporalite', 'public', 'finalite', 'angle', 'autre'] },
            valeur: { type: 'string' },
            role: { type: 'string', enum: ['secondaire', 'contrainte', 'intention'] }
          },
          required: ['type', 'valeur', 'role'],
          additionalProperties: false
        }
      }
    },
    required: ['sujet_central', 'requete_recherche', 'dimensions'],
    additionalProperties: false
  }
};

const NOTION_SELECTION_TOOL = {
  name: 'selectionner_notions_t06',
  description: "Sélectionne uniquement des notions de cadrage réellement utiles pour préciser le besoin de veille, en s'appuyant exclusivement sur les matériaux fournis.",
  input_schema: {
    type: 'object',
    properties: {
      notions: {
        type: 'array',
        maxItems: T06_MAX_NOTIONS,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            dimension_eclairee: { type: 'string' },
            pourquoi: { type: 'string' },
            limite: { type: 'string' },
            niveau: { type: 'string', enum: ['structurante', 'utile'] },
            material_ids: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } }
          },
          required: ['label', 'dimension_eclairee', 'pourquoi', 'limite', 'niveau', 'material_ids'],
          additionalProperties: false
        }
      },
      limites_couverture: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string' }
      }
    },
    required: ['notions', 'limites_couverture'],
    additionalProperties: false
  }
};

const NOTION_AUDIT_TOOL = {
  name: 'auditer_notions_t06',
  description: 'Audite la pertinence intellectuelle et la fidélité documentaire de chaque notion proposée.',
  input_schema: {
    type: 'object',
    properties: {
      notions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            dimension_eclairee: { type: 'string' },
            pourquoi: { type: 'string' },
            limite: { type: 'string' },
            niveau: { type: 'string', enum: ['structurante', 'utile'] },
            material_ids: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
            conserver: { type: 'boolean' }
          },
          required: ['label', 'dimension_eclairee', 'pourquoi', 'limite', 'niveau', 'material_ids', 'conserver'],
          additionalProperties: false
        }
      }
    },
    required: ['notions'],
    additionalProperties: false
  }
};

function materialText(result = {}) {
  if (result.kind === 'chunk') return clip(result.text, 760);
  if (result.kind === 'node') return clip(result.label, 360);
  if (result.kind === 'relation') return clip(`${result.source_label || ''} — ${result.relation_type || ''} — ${result.target_label || ''}`, 420);
  return '';
}

function materialLabel(result = {}) {
  if (result.kind === 'node') return result.label || result.node_id || result.result_id;
  if (result.kind === 'chunk') return result.section || clip(result.text, 120) || result.chunk_id || result.result_id;
  if (result.kind === 'relation') return `${result.source_label || result.source_id || ''} — ${result.relation_type || 'LIEN'} — ${result.target_label || result.target_id || ''}`;
  return result.result_id || 'Matériau';
}

function dedupeResults(results = []) {
  const out = [];
  const seen = new Set();
  for (const item of results) {
    const id = String(item?.result_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function buildCandidatePacket(results = []) {
  return results.slice(0, T06_MAX_CANDIDATES).map(result => ({
    material_id: result.result_id,
    kind: result.kind,
    label: materialLabel(result),
    texte: materialText(result),
    node_type: result.node_type || '',
    relation_type: result.relation_type || '',
    publication_id: result.publication_id || '',
    publication_title: result.publication_title || '',
    organisme_producteur: result.organisme_producteur || '',
    annee_publication: result.annee_publication || '',
    locator: result.locator || '',
    provenance_level: result.provenance_level || '',
    score: Number(result.score || 0)
  }));
}

function formatCandidatesForPrompt(candidates = []) {
  return candidates.map((m, index) => [
    `MATÉRIAU ${index + 1} — ${m.material_id}`,
    `Type: ${m.kind}${m.node_type ? ` / ${m.node_type}` : ''}${m.relation_type ? ` / ${m.relation_type}` : ''}`,
    `Publication: ${m.publication_id} — ${m.publication_title}`,
    `Organisme/année/repère: ${m.organisme_producteur || '—'} | ${m.annee_publication || '—'} | ${m.locator || '—'}`,
    `Contenu: ${m.texte || m.label}`
  ].join('\n')).join('\n\n---\n\n');
}

function sanitizeNeedAnalysis(raw = {}, need = '') {
  const sujet = String(raw.sujet_central || '').trim();
  const query = String(raw.requete_recherche || sujet || need).trim();
  const dimensions = (Array.isArray(raw.dimensions) ? raw.dimensions : [])
    .map(d => ({
      type: ['echelle', 'territoire', 'temporalite', 'public', 'finalite', 'angle', 'autre'].includes(d?.type) ? d.type : 'autre',
      valeur: String(d?.valeur || '').trim(),
      role: ['secondaire', 'contrainte', 'intention'].includes(d?.role) ? d.role : 'secondaire'
    }))
    .filter(d => d.valeur)
    .slice(0, 8);
  return { sujet_central: sujet || query, requete_recherche: query, dimensions };
}

function sanitizeSelectedNotions(rawNotions = [], allowedIds = new Set()) {
  const out = [];
  const seenLabels = new Set();
  for (const notion of Array.isArray(rawNotions) ? rawNotions : []) {
    const label = String(notion?.label || '').trim();
    const key = normalize(label);
    if (!label || !key || seenLabels.has(key)) continue;
    const ids = [...new Set((Array.isArray(notion?.material_ids) ? notion.material_ids : [])
      .map(String)
      .filter(id => allowedIds.has(id)))].slice(0, 3);
    if (!ids.length) continue;
    seenLabels.add(key);
    out.push({
      label,
      dimension_eclairee: String(notion?.dimension_eclairee || '').trim(),
      pourquoi: String(notion?.pourquoi || '').trim(),
      limite: String(notion?.limite || '').trim(),
      niveau: notion?.niveau === 'structurante' ? 'structurante' : 'utile',
      material_ids: ids
    });
    if (out.length >= T06_MAX_NOTIONS) break;
  }
  return out;
}

function enrichSource(result = {}) {
  return {
    material_id: result.result_id || '',
    kind: result.kind || '',
    publication_id: result.publication_id || '',
    titre: result.publication_title || '',
    organisme_producteur: result.organisme_producteur || '',
    annee_publication: result.annee_publication || '',
    type_document: result.type_document || '',
    repere: result.locator || '',
    provenance_level: result.provenance_level || '',
    url: result.url_contenu || result.url_source || '',
    extrait: materialText(result),
    libelle: materialLabel(result)
  };
}

async function analyserBesoin({ apiKey, besoin, callModel = appelerClaudeAvecOutil }) {
  const system = `
Tu analyses un besoin de veille uniquement pour préparer une recherche documentaire.
IMPORTANT : tu NE REFORMULES PAS le besoin utilisateur et tu ne produis aucun conseil.

Objectif :
- identifier le SUJET CENTRAL qui doit guider la recherche dans le corpus ;
- distinguer les dimensions secondaires : échelle d'observation, territoire, temporalité, public, finalité, angle ;
- produire une requête de recherche COURTE (2 à 8 mots) centrée sur le sujet, sans rendre les dimensions secondaires bloquantes.

Exemple :
« je veux suivre l'évolution de la délinquance à l'échelle communale dans les communes franciliennes »
=> sujet central : délinquance
=> requête de recherche : délinquance
=> dimensions : évolution = intention ; échelle communale = échelle ; communes franciliennes = territoire/contrainte.

Ne complète rien par connaissance extérieure. Travaille uniquement à partir du texte utilisateur.
`;
  const raw = await callModel({ apiKey, system, tool: NEED_ANALYSIS_TOOL, userText: besoin, maxTokens: 1200 });
  return sanitizeNeedAnalysis(raw, besoin);
}

async function selectionnerNotions({ apiKey, besoin, analyse, candidates, callModel = appelerClaudeAvecOutil }) {
  const allowedIds = new Set(candidates.map(c => c.material_id));
  const packet = formatCandidatesForPrompt(candidates);
  const dimensionsText = analyse.dimensions.map(d => `${d.type}: ${d.valeur} (${d.role})`).join(' ; ') || 'aucune dimension secondaire explicite';

  const system = `
Tu aides un veilleur à PRÉCISER son besoin à partir d'un corpus documentaire.
Tu ne reformules jamais le besoin à sa place.

Ta tâche est très étroite : proposer de 0 à ${T06_MAX_NOTIONS} NOTIONS DE CADRAGE utiles, uniquement à partir des matériaux fournis.

Une bonne notion :
- est suffisamment générale pour structurer ou préciser le besoin ;
- éclaire clairement une dimension du besoin (sujet, échelle, mesure, territoire, gouvernance, angle) ;
- est directement soutenue par un ou plusieurs matériaux fournis ;
- ne se contente pas d'un chevauchement lexical.

À REJETER :
- un sous-thème trop étroit que l'utilisateur n'a pas demandé (ex. mineurs, si le besoin porte sur la délinquance en général) ;
- un acteur, une recommandation ou un dispositif présenté comme une notion sans valeur de cadrage ;
- une notion seulement proche par un mot générique ;
- une notion qui élargit artificiellement le sujet.

Le champ « pourquoi » doit être explicite et concret, sur le modèle :
« Il éclaire une dimension de votre besoin liée à l'action locale contre la délinquance, en documentant les relations entre maire et parquet. »
Évite absolument les phrases vagues du type « cette notion est liée au sujet central ».

Le champ « limite » doit dire ce que les matériaux cités NE permettent PAS d'établir au regard du besoin (ex. pas d'évolution temporelle, pas de périmètre francilien, échelle différente). Si aucune limite importante n'est identifiable, indique sobrement que la notion aide au cadrage mais ne constitue pas à elle seule un objet de veille.

Tu peux synthétiser un libellé de notion si et seulement s'il est directement soutenu par les matériaux cités.
N'utilise aucune connaissance extérieure.
Ne cite que des material_ids fournis.
Ne force jamais le nombre de notions : zéro bonne notion vaut mieux qu'une proposition faible.

Les « limites_couverture » concernent uniquement les dimensions du besoin qui paraissent peu documentées DANS LES MATÉRIAUX RETROUVÉS. N'affirme pas qu'elles sont absentes de tout le corpus.
`;

  const userText = [
    `BESOIN UTILISATEUR (à respecter tel quel) : ${besoin}`,
    `SUJET CENTRAL INTERNE : ${analyse.sujet_central}`,
    `DIMENSIONS SECONDAIRES : ${dimensionsText}`,
    '',
    packet
  ].join('\n');

  const raw = await callModel({ apiKey, system, tool: NOTION_SELECTION_TOOL, userText, maxTokens: 3000 });
  return {
    notions: sanitizeSelectedNotions(raw.notions, allowedIds),
    limites_couverture: [...new Set((Array.isArray(raw.limites_couverture) ? raw.limites_couverture : []).map(v => String(v || '').trim()).filter(Boolean))].slice(0, 4)
  };
}

async function auditerNotions({ apiKey, besoin, analyse, notions, candidateMap, callModel = appelerClaudeAvecOutil }) {
  if (!notions.length) return [];

  const packet = notions.map((notion, index) => {
    const materials = notion.material_ids.map(id => candidateMap.get(id)).filter(Boolean);
    return [
      `NOTION ${index + 1}`,
      `Label: ${notion.label}`,
      `Dimension éclairée: ${notion.dimension_eclairee}`,
      `Pourquoi: ${notion.pourquoi}`,
      `Limite: ${notion.limite}`,
      `Niveau: ${notion.niveau}`,
      `Matériaux autorisés: ${notion.material_ids.join(', ')}`,
      materials.map(m => `${m.material_id}: ${m.texte || m.label} [${m.publication_title} ; repère ${m.locator || '—'}]`).join('\n')
    ].join('\n');
  }).join('\n\n---\n\n');

  const system = `
Tu audites des notions de cadrage proposées pour un besoin de veille.
Le besoin utilisateur ne doit pas être reformulé.

Conserve une notion uniquement si :
1) elle est réellement soutenue par les matériaux cités ;
2) elle aide à préciser le besoin sans l'élargir artificiellement ;
3) elle n'est pas un sous-thème trop étroit par rapport au besoin ;
4) son « pourquoi » explique précisément la contribution au besoin ;
5) sa « limite » explicite honnêtement ce que les sources ne permettent pas d'établir.

Rejette une notion fondée sur simple proximité lexicale, sur une source hors sujet, ou sur un cas particulier non demandé.
Tu peux corriger label, pourquoi et limite pour les rendre plus fidèles et plus précis, sans ajouter de connaissance extérieure.
N'utilise que les material_ids déjà associés à chaque notion.
`;

  const userText = `BESOIN : ${besoin}\nSUJET CENTRAL : ${analyse.sujet_central}\n\n${packet}`;
  const raw = await callModel({ apiKey, system, tool: NOTION_AUDIT_TOOL, userText, maxTokens: 3000 });

  const originalByLabel = new Map(notions.map(n => [normalize(n.label), n]));
  const audited = [];
  for (const item of Array.isArray(raw.notions) ? raw.notions : []) {
    if (!item?.conserver) continue;
    const original = originalByLabel.get(normalize(item.label)) || notions.find(n => n.material_ids.some(id => (item.material_ids || []).includes(id)));
    if (!original) continue;
    const allowed = new Set(original.material_ids);
    const ids = [...new Set((Array.isArray(item.material_ids) ? item.material_ids : []).map(String).filter(id => allowed.has(id) && candidateMap.has(id)))];
    if (!ids.length) continue;
    audited.push({
      label: String(item.label || original.label).trim(),
      dimension_eclairee: String(item.dimension_eclairee || original.dimension_eclairee).trim(),
      pourquoi: String(item.pourquoi || original.pourquoi).trim(),
      limite: String(item.limite || original.limite).trim(),
      niveau: item.niveau === 'structurante' ? 'structurante' : 'utile',
      material_ids: ids
    });
    if (audited.length >= T06_MAX_NOTIONS) break;
  }
  return audited;
}

async function proposerNotionsT06({ apiKey, besoin = '', searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) {
    const error = new Error('Le besoin de veille est obligatoire.');
    error.statusCode = 400;
    throw error;
  }
  if (need.length > 4000) {
    const error = new Error('Le besoin de veille est trop long (4000 caractères maximum).');
    error.statusCode = 400;
    throw error;
  }

  const analyse = await analyserBesoin({ apiKey, besoin: need, callModel });
  const query = analyse.requete_recherche || analyse.sujet_central || need;

  const [general, nodes] = [
    searchFn({ query, limit: 30, max_per_publication: 4, diversify_by_publication: true }),
    searchFn({ query, kinds: ['node'], limit: 30, max_per_publication: 5, diversify_by_publication: true })
  ];

  const rawResults = dedupeResults([...(general?.results || []), ...(nodes?.results || [])]);
  const candidates = buildCandidatePacket(rawResults);
  const candidateMap = new Map(candidates.map(c => [c.material_id, c]));
  const rawResultMap = new Map(rawResults.map(r => [r.result_id, r]));

  if (!candidates.length) {
    return {
      ok: true,
      engine: 't06-framing-v0.1-llm-grounded',
      need,
      analysis: analyse,
      retrieval: { query, candidates: 0, publications: 0 },
      notions: [],
      limites_couverture: ['Aucun matériau suffisamment pertinent n’a été retrouvé pour le sujet central dans cette recherche.']
    };
  }

  const selected = await selectionnerNotions({ apiKey, besoin: need, analyse, candidates, callModel });
  const audited = await auditerNotions({ apiKey, besoin: need, analyse, notions: selected.notions, candidateMap, callModel });

  const notions = audited.map((notion, index) => ({
    notion_id: `T06N${String(index + 1).padStart(2, '0')}`,
    label: notion.label,
    dimension_eclairee: notion.dimension_eclairee,
    pourquoi: notion.pourquoi,
    limite: notion.limite,
    niveau: notion.niveau,
    sources: notion.material_ids.map(id => rawResultMap.get(id)).filter(Boolean).map(enrichSource)
  })).filter(n => n.sources.length);

  const publicationIds = new Set(rawResults.map(r => r.publication_id).filter(Boolean));
  return {
    ok: true,
    engine: 't06-framing-v0.1-llm-grounded',
    need,
    analysis: analyse,
    retrieval: {
      query,
      candidates: candidates.length,
      publications: publicationIds.size,
      source_engine: general?.engine || 'corpus-search'
    },
    notions,
    limites_couverture: selected.limites_couverture
  };
}

module.exports = {
  MODEL_T06,
  proposerNotionsT06,
  analyserBesoin,
  selectionnerNotions,
  auditerNotions,
  buildCandidatePacket,
  sanitizeNeedAnalysis,
  sanitizeSelectedNotions,
  dedupeResults,
  enrichSource
};
