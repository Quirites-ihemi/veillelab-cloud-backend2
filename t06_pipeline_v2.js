// =====================================================
// QUIRITÈS VEILLE LAB — T06 SCÉNARIO DE VEILLE — PIPELINE V2 (LOCAL)
//
// Principe : FIABILITÉ > EXHAUSTIVITÉ.
//
//   besoin
//     → requête sujet (déterministe, courte, accents conservés)
//     → recherche corpus (sans diversification forcée)
//     → FILTRE DE PERTINENCE SUJET (LLM + extrait verbatim vérifié)
//     → axes émergeant des seuls matériaux validés (≥ 2 matériaux cités)
//   puis, par axe retenu :
//     → recherche corpus « sujet + termes discriminants de l'axe »
//     → FILTRE DE PERTINENCE SUJET + AXE
//     → objets de veille générés à partir des seuls matériaux validés
//     → validation déterministe (IDs, 2 publications, extraits, récurrence)
//
// Aucun repli qui fabrique du contenu : un objet non validé est supprimé,
// une case vide est une réponse légitime.
//
// Ce module ne modifie pas t06.js (V1). Il réutilise seulement
// enrichSource() et searchCorpus().
// =====================================================

'use strict';

const { searchCorpus } = require('./globalSearch');
const { enrichSource } = require('./t06');

const MODEL_T06_V2 = process.env.ANTHROPIC_MODEL_T06 || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const CFG = {
  SUBJECT_SEARCH_LIMIT: 30,
  AXIS_SEARCH_LIMIT: 20,
  MAX_CANDIDATES_TO_FILTER: 24,
  MAX_VALIDATED_SUBJECT: 10,
  MAX_VALIDATED_AXIS: 8,
  MAX_AXES: 4,
  MIN_ANCHORS_PER_AXIS: 2,
  MIN_QUOTE_CHARS: 20,
  MAX_PER_PUBLICATION: 3,
  // Types de résultats admis comme preuve (doivent porter un repère précis).
  EVIDENCE_KINDS: (process.env.T06_EVIDENCE_KINDS || 'chunk').split(',').map(s => s.trim()).filter(Boolean),
  ACCENT_VARIANTS: process.env.T06_ACCENT_VARIANTS !== 'off'
};

// ---------------------------------------------------------------------
// Outils texte
// ---------------------------------------------------------------------

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value, max = 650) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Texte intégral d'un matériau (sert à la vérification des extraits).
function fullText(r = {}) {
  if (r.kind === 'relation') return `${r.source_label || ''} ${r.relation_type || ''} ${r.target_label || ''}`;
  return String(r.text || r.label || '');
}

function metadataText(r = {}) {
  return `${r.publication_title || ''} ${r.organisme_producteur || ''}`;
}

// Un extrait est accepté s'il figure (après normalisation) dans l'un des textes.
// Les ellipses sont tolérées : chaque segment doit alors être retrouvé.
function quoteFound(quote, texts = []) {
  const segments = String(quote || '').split(/\.{3}|…|\[\.\.\.\]/).map(normalize).filter(Boolean);
  if (!segments.length) return false;
  if (!segments.some(s => s.length >= CFG.MIN_QUOTE_CHARS)) return false;
  const haystacks = texts.map(normalize);
  return segments.every(seg => seg.length < 8 || haystacks.some(h => h.includes(seg)));
}

const STOP = new Set([
  'je', 'j', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'on', 'le', 'la', 'les', 'l', 'un', 'une', 'des',
  'du', 'de', 'd', 'en', 'au', 'aux', 'a', 'et', 'ou', 'pour', 'sur', 'dans', 'avec', 'par', 'ce', 'cette', 'ces',
  'son', 'sa', 'ses', 'leur', 'leurs', 'qui', 'que', 'quoi', 'dont', 'mon', 'ma', 'mes', 'notre', 'nos',
  'veux', 'voudrais', 'souhaite', 'souhaiterais', 'aimerais', 'cherche', 'faire', 'mettre', 'place', 'veille',
  'veiller', 'suivre', 'surveiller', 'observer', 'analyser', 'etudier', 'evolution', 'evolutions', 'tendance',
  'tendances', 'sujet', 'question', 'questions', 'concernant', 'autour', 'niveau', 'echelle', 'theme', 'thematique',
  'phenomene', 'phenomenes', 'dynamique', 'dynamiques', 'enjeu', 'enjeux', 'plus', 'entre', 'tout', 'tous',
  'notamment', 'mieux', 'comprendre', 'transformations', 'transformation', 'actuelles', 'actuels', 'recentes', 'recents'
]);

// Requête sujet déterministe : mots porteurs du besoin, accents conservés.
function subjectQueryFromNeed(need = '') {
  const tokens = String(need).replace(/[’']/g, ' ').split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const kept = [];
  const seen = new Set();
  for (const t of tokens) {
    const n = normalize(t);
    if (n.length < 3 || STOP.has(n) || seen.has(n)) continue;
    seen.add(n);
    kept.push(t.toLowerCase());
  }
  return kept.slice(0, 6).join(' ');
}

function deaccent(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Ajoute la variante sans accents si elle diffère (utile si l'index est sensible aux accents).
function withAccentVariant(query) {
  const q = String(query || '').trim();
  if (!CFG.ACCENT_VARIANTS) return q;
  const d = deaccent(q);
  return d !== q.toLowerCase() ? `${q} ${d}` : q;
}

// ---------------------------------------------------------------------
// Recherche corpus
// ---------------------------------------------------------------------

function isEvidence(r = {}) {
  if (!r.result_id || !r.publication_id) return false;
  if (!CFG.EVIDENCE_KINDS.includes(r.kind || 'chunk')) return false;
  return fullText(r).trim().length >= 60;
}

function runSearch(searchFn, query, limit) {
  let response;
  try {
    response = searchFn({
      query,
      limit,
      max_per_publication: CFG.MAX_PER_PUBLICATION,
      diversify_by_publication: false
    });
  } catch (error) {
    const e = new Error(`Recherche corpus en échec : ${error?.message || error}`);
    e.code = 'T06_SEARCH_FAILED';
    throw e;
  }
  const raw = Array.isArray(response?.results) ? response.results : [];
  const seen = new Set();
  const results = [];
  let nonEvidence = 0;
  for (const r of raw) {
    const id = String(r?.result_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!isEvidence(r)) { nonEvidence += 1; continue; }
    results.push(r);
  }
  return { results, raw_count: raw.length, non_evidence_count: nonEvidence, engine: response?.engine || '' };
}

// ---------------------------------------------------------------------
// Identifiants courts M1…Mn (le modèle ne manipule jamais les result_id)
// ---------------------------------------------------------------------

function aliasList(results) {
  return results.map((r, i) => ({ alias: `M${i + 1}`, r }));
}

function aliasMap(list) {
  const m = new Map();
  for (const x of list) {
    m.set(x.alias.toLowerCase(), x.r);
    m.set(String(x.r.result_id).toLowerCase(), x.r);
  }
  return m;
}

function resolveIds(ids, map, rejects, context) {
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const key = String(id || '').trim().replace(/^\[|\]$/g, '').replace(/^mat[ée]riau\s*/i, 'm').toLowerCase();
    const r = map.get(key);
    if (!r) { rejects.push({ objet: context, motif: 'identifiant_inconnu', valeur: String(id) }); continue; }
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

function formatMaterials(list, max = 650) {
  return list.map(({ alias, r }) => [
    `[${alias}] Publication ${r.publication_id} — « ${r.publication_title || 'titre inconnu'} »`,
    `Organisme : ${r.organisme_producteur || 'non précisé'} | Année : ${r.annee_publication || 'non précisée'} | Repère : ${r.locator || 'aucun'}`,
    `Texte : ${clip(fullText(r), max)}`
  ].join('\n')).join('\n\n');
}

function publicationCount(results) {
  return new Set(results.map(r => r.publication_id).filter(Boolean)).size;
}

function excludedView(r, motif, raison = '') {
  return {
    material_id: r.result_id,
    publication_id: r.publication_id || '',
    titre: r.publication_title || '',
    repere: r.locator || '',
    motif,
    raison: String(raison || '').trim()
  };
}

// ---------------------------------------------------------------------
// Appel Claude (outil forcé, température 0, troncature détectée)
// ---------------------------------------------------------------------

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function callTool({ apiKey, system, tool, userText, maxTokens = 3000 }) {
  const payload = {
    model: MODEL_T06_V2,
    max_tokens: maxTokens,
    temperature: 0,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: [{ type: 'text', text: String(userText) }] }]
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 600)}`);
        err.status = response.status;
        throw err;
      }
      const json = JSON.parse(text);
      if (json.stop_reason === 'max_tokens') {
        const err = new Error(`Réponse tronquée (max_tokens=${maxTokens}) pour ${tool.name}.`);
        err.status = 400; // non rejouable à l'identique
        err.code = 'T06_TRUNCATED';
        throw err;
      }
      const toolUse = (json.content || []).find(b => b?.type === 'tool_use' && b.name === tool.name);
      if (!toolUse?.input) {
        const err = new Error(`Pas d'appel structuré ${tool.name}.`);
        err.status = 503;
        throw err;
      }
      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status);
      const retryable = error?.name === 'AbortError' || !status || status === 429 || status === 529 || status >= 500;
      if (!retryable || attempt === 3) throw error;
      await sleep(1500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------
// Étape de filtrage de pertinence (sujet, ou sujet + axe)
// ---------------------------------------------------------------------

function relevanceTool(withAxis) {
  const props = {
    id: { type: 'string', description: 'Identifiant court du matériau, par exemple M3.' },
    pertinent_sujet: { type: 'boolean' },
    extrait_appui: { type: 'string', description: 'Si pertinent : passage copié MOT POUR MOT dans le texte du matériau (20 à 200 caractères, continu, sans ellipse). Sinon chaîne vide.' },
    raison: { type: 'string', description: 'Une phrase courte.' }
  };
  const required = ['id', 'pertinent_sujet', 'extrait_appui', 'raison'];
  if (withAxis) {
    props.pertinent_axe = { type: 'boolean' };
    required.splice(2, 0, 'pertinent_axe');
  }
  return {
    name: withAxis ? 'filtrer_pertinence_axe_t06' : 'filtrer_pertinence_sujet_t06',
    description: 'Évalue chaque matériau au regard du critère fourni, uniquement d\'après son texte.',
    input_schema: {
      type: 'object',
      properties: {
        evaluations: {
          type: 'array',
          items: { type: 'object', properties: props, required, additionalProperties: false }
        }
      },
      required: ['evaluations'],
      additionalProperties: false
    }
  };
}

function relevanceSystem(withAxis) {
  return `
Tu es un FILTRE DOCUMENTAIRE STRICT. Tu ne rédiges rien d'autre que des évaluations.
Tu reçois un SUJET DE VEILLE${withAxis ? ', un AXE DE VEILLE' : ''} et des matériaux extraits d'un corpus.
Pour CHAQUE matériau, décide :
- pertinent_sujet : le texte traite-t-il DIRECTEMENT du sujet ?${withAxis ? '\n- pertinent_axe : le texte traite-t-il DIRECTEMENT de l\'axe, appliqué à ce sujet ?' : ''}

Règles :
- Juge uniquement d'après le texte fourni. N'utilise aucune connaissance extérieure.
- Une proximité de vocabulaire ne suffit pas (territoire, données, prévention, politique publique, résilience, acteurs…). Le matériau doit porter sur le sujet lui-même.
- Un matériau qui traite d'un autre phénomène est NON pertinent, même s'il partage des mots avec l'axe ou la requête.
- En cas de doute : false.
- Si tu réponds true, copie dans extrait_appui un passage MOT POUR MOT du texte qui établit le lien. Si tu ne trouves pas un tel passage, réponds false.
- Évalue tous les matériaux, une évaluation par identifiant.`;
}

async function filterRelevance({ apiKey, callModel, need, subjectQuery, axis = null, candidates }) {
  const list = aliasList(candidates);
  const map = aliasMap(list);
  const withAxis = Boolean(axis);
  const userText = [
    `BESOIN DU VEILLEUR : ${need}`,
    `SUJET DE VEILLE : ${subjectQuery}`,
    withAxis ? `AXE DE VEILLE : ${axis.titre}\nObjectif : ${axis.objectif_surveillance || ''}` : '',
    'MATÉRIAUX :',
    formatMaterials(list)
  ].filter(Boolean).join('\n\n');

  const raw = await callModel({
    apiKey,
    system: relevanceSystem(withAxis),
    tool: relevanceTool(withAxis),
    userText,
    maxTokens: 4000
  });

  const evaluations = new Map();
  for (const ev of (Array.isArray(raw?.evaluations) ? raw.evaluations : [])) {
    const key = String(ev?.id || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
    const r = map.get(key);
    if (r && !evaluations.has(r.result_id)) evaluations.set(r.result_id, ev);
  }

  const kept = [];
  const excluded = [];
  for (const { r } of list) {
    const ev = evaluations.get(r.result_id);
    if (!ev) { excluded.push(excludedView(r, 'non_evalue')); continue; }
    const ok = ev.pertinent_sujet === true && (!withAxis || ev.pertinent_axe === true);
    if (!ok) {
      const motif = ev.pertinent_sujet !== true ? 'hors_sujet' : 'hors_axe';
      excluded.push(excludedView(r, motif, ev.raison));
      continue;
    }
    if (!quoteFound(ev.extrait_appui, [fullText(r)])) {
      excluded.push(excludedView(r, 'extrait_introuvable', ev.raison));
      continue;
    }
    kept.push({ r, raison: String(ev.raison || '').trim(), extrait: String(ev.extrait_appui || '').trim() });
  }
  return { kept, excluded };
}

// ---------------------------------------------------------------------
// ÉTAPES 1-4 : besoin → matériaux pertinents → axes issus du corpus
// ---------------------------------------------------------------------

const AXES_TOOL = {
  name: 'proposer_axes_depuis_corpus_t06',
  description: 'Propose des axes de veille qui émergent des matériaux validés.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array',
        maxItems: CFG.MAX_AXES,
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            objectif_surveillance: { type: 'string' },
            question_veille: { type: 'string' },
            termes_discriminants: { type: 'array', maxItems: 4, items: { type: 'string' } },
            material_ids: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } },
            justification: { type: 'string' }
          },
          required: ['titre', 'objectif_surveillance', 'question_veille', 'termes_discriminants', 'material_ids', 'justification'],
          additionalProperties: false
        }
      }
    },
    required: ['axes'],
    additionalProperties: false
  }
};

const AXES_SYSTEM = `
Tu proposes des AXES DE VEILLE qui ÉMERGENT des matériaux fournis. Tous ces matériaux ont déjà été validés comme pertinents pour le sujet.
Un axe est une dimension du sujet que l'on peut surveiller dans la durée ET que plusieurs matériaux traitent effectivement.

Règles :
- Chaque axe cite au moins 2 matériaux (identifiants M…) qui le traitent explicitement.
- N'introduis aucune dimension absente des matériaux, même si elle paraît logique pour le sujet.
- Pas d'axe générique (territoires, données, acteurs, réponses publiques…) si les matériaux cités ne le traitent pas explicitement POUR CE SUJET.
- termes_discriminants : 1 à 4 mots ou expressions courtes, présents dans les matériaux cités, spécifiques à l'axe, sans répéter le sujet.
- Aucun chiffre, date, nom propre ou lien de causalité absent des matériaux.
- Mieux vaut 1 ou 2 axes solides que 4 axes fragiles. Si les matériaux ne permettent aucun axe, renvoie une liste vide.`;

async function proposerAxesV2({ apiKey, besoin = '', sujet_requete = '', searchFn = searchCorpus, callModel = callTool }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }

  const subjectQuery = String(sujet_requete || '').trim() || subjectQueryFromNeed(need);
  if (!subjectQuery) { const e = new Error('Impossible de dériver une requête sujet du besoin.'); e.statusCode = 400; throw e; }

  const searchQuery = withAccentVariant(subjectQuery);
  const search = runSearch(searchFn, searchQuery, CFG.SUBJECT_SEARCH_LIMIT);
  const candidates = search.results.slice(0, CFG.MAX_CANDIDATES_TO_FILTER);

  const base = {
    ok: true,
    engine: 't06-v2-corpus-first-filtered',
    model: MODEL_T06_V2,
    need,
    subject_query: subjectQuery,
    diagnostic: {
      requete_envoyee: searchQuery,
      resultats_bruts: search.raw_count,
      resultats_non_probants_ecartes: search.non_evidence_count,
      candidats_evalues: candidates.length
    }
  };

  if (!candidates.length) {
    return { ...base, statut: 'corpus_muet', materiaux_valides: [], materiaux_ecartes: [], axes: [], rejets: [],
      message: 'La recherche corpus ne renvoie aucun matériau exploitable pour ce sujet.' };
  }

  const { kept, excluded } = await filterRelevance({ apiKey, callModel, need, subjectQuery, candidates });
  const validated = kept.slice(0, CFG.MAX_VALIDATED_SUBJECT);
  const validatedView = validated.map(k => ({ ...enrichSource(k.r, candidates), raison_pertinence: k.raison, extrait_appui: k.extrait }));
  base.diagnostic.materiaux_valides = validated.length;
  base.diagnostic.publications_validees = publicationCount(validated.map(k => k.r));

  if (validated.length < CFG.MIN_ANCHORS_PER_AXIS) {
    return { ...base, statut: 'corpus_insuffisant', materiaux_valides: validatedView, materiaux_ecartes: excluded, axes: [], rejets: [],
      message: `Moins de ${CFG.MIN_ANCHORS_PER_AXIS} matériaux pertinents : aucun axe ne peut être fondé sur le corpus.` };
  }

  const list = aliasList(validated.map(k => k.r));
  const map = aliasMap(list);
  const raw = await callModel({
    apiKey,
    system: AXES_SYSTEM,
    tool: AXES_TOOL,
    userText: `BESOIN : ${need}\n\nSUJET : ${subjectQuery}\n\nMATÉRIAUX VALIDÉS :\n\n${formatMaterials(list)}`,
    maxTokens: 2500
  });

  const rejets = [];
  const axes = [];
  (Array.isArray(raw?.axes) ? raw.axes : []).slice(0, CFG.MAX_AXES).forEach((a, i) => {
    const titre = String(a?.titre || '').trim();
    if (!titre) return;
    const ctx = `axe « ${titre} »`;
    const anchors = resolveIds(a?.material_ids, map, rejets, ctx);
    if (anchors.length < CFG.MIN_ANCHORS_PER_AXIS) {
      rejets.push({ objet: ctx, motif: 'moins_de_2_materiaux_valides' });
      return;
    }
    const anchorText = anchors.map(r => `${fullText(r)} ${metadataText(r)}`).join(' ');
    const nAnchor = normalize(anchorText);
    const terms = [];
    for (const t of (Array.isArray(a?.termes_discriminants) ? a.termes_discriminants : [])) {
      const nt = normalize(t);
      if (!nt) continue;
      if (nAnchor.includes(nt)) terms.push(String(t).trim());
      else rejets.push({ objet: ctx, motif: 'terme_absent_des_materiaux', valeur: String(t) });
    }
    const pubs = publicationCount(anchors);
    axes.push({
      axis_id: `AX${i + 1}`,
      titre,
      objectif_surveillance: String(a?.objectif_surveillance || '').trim(),
      question_veille: String(a?.question_veille || '').trim(),
      justification: String(a?.justification || '').trim(),
      termes_discriminants: terms.slice(0, 4),
      anchor_material_ids: anchors.map(r => r.result_id),
      publication_count: pubs,
      statut_documentaire: pubs >= 2 ? 'documente' : 'appui_publication_unique',
      sources: anchors.map(r => enrichSource(r, candidates))
    });
  });

  return {
    ...base,
    statut: axes.length ? 'ok' : 'aucun_axe_fonde',
    materiaux_valides: validatedView,
    materiaux_ecartes: excluded,
    axes,
    rejets,
    message: axes.length ? '' : 'Les matériaux validés ne permettent de fonder aucun axe avec au moins deux appuis.'
  };
}

// ---------------------------------------------------------------------
// ÉTAPES 6-10 : par axe → matériaux pertinents sujet + axe → objets
// ---------------------------------------------------------------------

const SOURCE_TYPES = ['organisme_producteur_recurrent', 'serie_statistique', 'observatoire', 'bulletin_ou_rapport_periodique', 'base_de_donnees', 'dispositif_de_publication_recurrent'];

const OBJECTS_TOOL = {
  name: 'construire_objets_veille_axe_t06',
  description: 'Construit les objets de veille d\'un axe à partir des seuls matériaux validés.',
  input_schema: {
    type: 'object',
    properties: {
      tendances: {
        type: 'array', maxItems: 2,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            synthese: { type: 'string' },
            limite: { type: 'string' },
            material_ids: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } }
          },
          required: ['label', 'synthese', 'limite', 'material_ids'], additionalProperties: false
        }
      },
      signes_a_guetter: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            pourquoi_guetter: { type: 'string' },
            ce_qui_confirmerait: { type: 'string' },
            ce_qui_affaiblirait: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
            extrait_appui: { type: 'string' }
          },
          required: ['label', 'pourquoi_guetter', 'ce_qui_confirmerait', 'ce_qui_affaiblirait', 'material_ids', 'extrait_appui'],
          additionalProperties: false
        }
      },
      sources_a_surveiller: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Nom de l\'organisme, de la série, de l\'observatoire, du bulletin ou de la base, tel qu\'il apparaît dans le matériau.' },
            type_source: { type: 'string', enum: SOURCE_TYPES },
            indice_recurrence: { type: 'string', description: 'Passage copié MOT POUR MOT qui établit le caractère récurrent ou suivable.' },
            raison: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } }
          },
          required: ['label', 'type_source', 'indice_recurrence', 'raison', 'material_ids'], additionalProperties: false
        }
      },
      angles_morts: { type: 'array', maxItems: 3, items: { type: 'string' } }
    },
    required: ['tendances', 'signes_a_guetter', 'sources_a_surveiller', 'angles_morts'],
    additionalProperties: false
  }
};

const OBJECTS_SYSTEM = `
Tu construis les OBJETS DE VEILLE d'UN axe, à partir des SEULS matériaux fournis (tous validés comme pertinents pour le sujet et l'axe).
Une case vide est une réponse correcte. Ne remplis jamais une case pour la remplir.

1) TENDANCE DOCUMENTÉE : une évolution dans le temps EXPLICITEMENT décrite par au moins deux matériaux issus de publications DIFFÉRENTES.
   Pas de tendance à partir d'une seule publication. Pas de tendance à partir de constats ponctuels sans dimension d'évolution.
   Pas de causalité si les matériaux ne l'énoncent pas ; une association n'est pas une cause.
   Indique dans « limite » ce que les matériaux ne permettent pas d'affirmer.
2) SIGNE DE CHANGEMENT À GUETTER : un élément observable, mentionné dans un matériau, dont une évolution future serait informative.
   Il n'est jamais présenté comme déjà observé. extrait_appui = passage copié MOT POUR MOT d'un matériau cité.
3) SOURCE À SURVEILLER : un organisme producteur récurrent, une série statistique, un observatoire, un bulletin ou rapport périodique,
   une base de données ou un dispositif de publication récurrent, NOMMÉ dans un matériau, dont le caractère récurrent est ÉTABLI par le texte.
   Une publication ponctuelle N'EST PAS une source à surveiller. Le simple fait qu'un document figure dans le corpus n'en fait pas une source à surveiller.
   indice_recurrence = passage copié MOT POUR MOT qui prouve la récurrence. Si aucun matériau ne l'établit : liste vide.
4) ANGLES MORTS : ce que l'axe demanderait et que les matériaux ne couvrent pas (formulé comme point à instruire).

Règles impératives :
- Cite les matériaux uniquement par leurs identifiants courts (M1, M2…).
- Aucun chiffre, date, nom propre ou organisme absent des matériaux.
- N'utilise aucune connaissance extérieure. En cas d'incertitude, abstiens-toi.`;

const RECURRENCE_MARKERS = /\b(annuel\w*|mensuel\w*|trimestriel\w*|semestriel\w*|hebdomadaire\w*|periodique\w*|chaque (annee|mois|trimestre|semaine)|tous les (ans|mois)|serie\w*|edition\w*|observatoire\w*|barometre\w*|bases? de donnees|tableaux? de bord|enquetes? de victimation|bulletin\w*|panel\w*|vague\w*|recensement\w*|releve\w*|rapport annuel|depuis \d{4}|mis\w* a jour|suivi regulier|statistiques (annuelles|mensuelles|officielles))\b/;

function significantWords(s) {
  return normalize(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
}

function validateObjects(raw, list, map, rejets) {
  const tendances = [];
  (Array.isArray(raw?.tendances) ? raw.tendances : []).forEach(t => {
    const label = String(t?.label || '').trim();
    if (!label) return;
    const ctx = `tendance « ${label} »`;
    const rs = resolveIds(t?.material_ids, map, rejets, ctx);
    if (rs.length < 2) { rejets.push({ objet: ctx, motif: 'moins_de_2_materiaux_valides' }); return; }
    if (publicationCount(rs) < 2) { rejets.push({ objet: ctx, motif: 'une_seule_publication' }); return; }
    tendances.push({ label, synthese: String(t.synthese || '').trim(), limite: String(t.limite || '').trim(), origin: 'corpus', material_ids: rs.map(r => r.result_id), rs });
  });

  const signes = [];
  (Array.isArray(raw?.signes_a_guetter) ? raw.signes_a_guetter : []).forEach(s => {
    const label = String(s?.label || '').trim();
    if (!label) return;
    const ctx = `signe « ${label} »`;
    const rs = resolveIds(s?.material_ids, map, rejets, ctx);
    if (!rs.length) { rejets.push({ objet: ctx, motif: 'aucun_materiau_valide' }); return; }
    if (!quoteFound(s?.extrait_appui, rs.map(fullText))) { rejets.push({ objet: ctx, motif: 'extrait_introuvable_dans_materiaux_cites' }); return; }
    signes.push({
      label,
      pourquoi_guetter: String(s.pourquoi_guetter || '').trim(),
      ce_qui_confirmerait: String(s.ce_qui_confirmerait || '').trim(),
      ce_qui_affaiblirait: String(s.ce_qui_affaiblirait || '').trim(),
      extrait_appui: String(s.extrait_appui || '').trim(),
      origin: 'proposition_ia_ancree',
      material_ids: rs.map(r => r.result_id),
      rs
    });
  });

  const sources = [];
  (Array.isArray(raw?.sources_a_surveiller) ? raw.sources_a_surveiller : []).forEach(s => {
    const label = String(s?.label || '').trim();
    if (!label) return;
    const ctx = `source « ${label} »`;
    const rs = resolveIds(s?.material_ids, map, rejets, ctx);
    if (!rs.length) { rejets.push({ objet: ctx, motif: 'aucun_materiau_valide' }); return; }
    if (!SOURCE_TYPES.includes(s?.type_source)) { rejets.push({ objet: ctx, motif: 'type_source_invalide' }); return; }
    const texts = rs.map(r => `${fullText(r)} ${metadataText(r)}`);
    if (!quoteFound(s?.indice_recurrence, texts)) { rejets.push({ objet: ctx, motif: 'indice_recurrence_introuvable' }); return; }
    if (!RECURRENCE_MARKERS.test(normalize(s.indice_recurrence))) { rejets.push({ objet: ctx, motif: 'recurrence_non_etablie' }); return; }
    const hay = normalize(texts.join(' '));
    const words = significantWords(label);
    if (!words.length || !words.every(w => hay.includes(w))) { rejets.push({ objet: ctx, motif: 'libelle_absent_des_materiaux' }); return; }
    const isPubTitle = rs.some(r => normalize(r.publication_title) === normalize(label));
    if (isPubTitle && !['bulletin_ou_rapport_periodique', 'serie_statistique'].includes(s.type_source)) {
      rejets.push({ objet: ctx, motif: 'publication_ponctuelle' }); return;
    }
    sources.push({
      label,
      type_source: s.type_source,
      indice_recurrence: String(s.indice_recurrence || '').trim(),
      raison: String(s.raison || '').trim(),
      origin: 'corpus',
      material_ids: rs.map(r => r.result_id),
      rs
    });
  });

  const angles = [...new Set((Array.isArray(raw?.angles_morts) ? raw.angles_morts : []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 3);
  return { tendances, signes, sources, angles };
}

async function construireObjetsAxeV2({ apiKey, besoin = '', subject_query = '', axis = {}, searchFn = searchCorpus, callModel = callTool }) {
  const need = String(besoin || '').trim();
  const subjectQuery = String(subject_query || '').trim() || subjectQueryFromNeed(need);
  const titre = String(axis?.titre || '').trim();
  if (!need || !subjectQuery || !titre) { const e = new Error('besoin, subject_query et axis.titre sont obligatoires.'); e.statusCode = 400; throw e; }

  const ax = {
    axis_id: String(axis.axis_id || 'AX').trim(),
    titre,
    objectif_surveillance: String(axis.objectif_surveillance || '').trim(),
    question_veille: String(axis.question_veille || '').trim(),
    termes_discriminants: (Array.isArray(axis.termes_discriminants) ? axis.termes_discriminants : []).map(String).filter(Boolean).slice(0, 4),
    anchor_material_ids: (Array.isArray(axis.anchor_material_ids) ? axis.anchor_material_ids : []).map(String)
  };

  const empty = { tendances: [], signes_a_guetter: [], sources_a_surveiller: [], angles_morts: [] };
  const out = { ok: true, engine: 't06-v2-axis-objects', model: MODEL_T06_V2, axis_id: ax.axis_id, titre: ax.titre, objectif_surveillance: ax.objectif_surveillance };

  try {
    // 1. Ancres : on rejoue la recherche sujet (déterministe) pour retrouver les matériaux fondateurs.
    const subjectSearch = runSearch(searchFn, withAccentVariant(subjectQuery), CFG.SUBJECT_SEARCH_LIMIT);
    const anchorSet = new Set(ax.anchor_material_ids);
    const anchors = subjectSearch.results.filter(r => anchorSet.has(String(r.result_id)));

    // 2. Recherche axe : le sujet reste la partie dominante de la requête.
    const axisQuery = withAccentVariant([subjectQuery, ...ax.termes_discriminants].join(' '));
    const axisSearch = runSearch(searchFn, axisQuery, CFG.AXIS_SEARCH_LIMIT);

    const seen = new Set();
    const candidates = [];
    for (const r of [...anchors, ...axisSearch.results]) {
      if (seen.has(r.result_id)) continue;
      seen.add(r.result_id);
      candidates.push(r);
      if (candidates.length >= CFG.MAX_CANDIDATES_TO_FILTER) break;
    }

    out.diagnostic = {
      requete_axe: axisQuery,
      ancres_attendues: ax.anchor_material_ids.length,
      ancres_retrouvees: anchors.length,
      candidats_evalues: candidates.length
    };

    if (!candidates.length) {
      return { ...out, ...empty, statut: 'aucun_materiau_valide', materiaux_valides: [], materiaux_ecartes: [], rejets: [],
        message: 'Aucun matériau du corpus n\'a été retrouvé pour cet axe.' };
    }

    // 3. Filtre de pertinence sujet + axe.
    const { kept, excluded } = await filterRelevance({ apiKey, callModel, need, subjectQuery, axis: ax, candidates });
    const validated = kept.slice(0, CFG.MAX_VALIDATED_AXIS);
    const validatedResults = validated.map(k => k.r);
    out.diagnostic.materiaux_valides = validated.length;
    out.diagnostic.publications_validees = publicationCount(validatedResults);

    const validatedView = validated.map(k => ({ ...enrichSource(k.r, candidates), raison_pertinence: k.raison, extrait_appui: k.extrait }));

    if (!validated.length) {
      return { ...out, ...empty, statut: 'aucun_materiau_valide', materiaux_valides: [], materiaux_ecartes: excluded, rejets: [],
        message: 'Aucun matériau n\'est pertinent à la fois pour le sujet et pour cet axe : aucun objet n\'est produit.' };
    }

    // 4. Génération des objets à partir des seuls matériaux validés.
    const list = aliasList(validatedResults);
    const map = aliasMap(list);
    const raw = await callModel({
      apiKey,
      system: OBJECTS_SYSTEM,
      tool: OBJECTS_TOOL,
      userText: [
        `BESOIN : ${need}`,
        `SUJET : ${subjectQuery}`,
        `AXE : ${ax.titre}`,
        ax.objectif_surveillance ? `Objectif : ${ax.objectif_surveillance}` : '',
        ax.question_veille ? `Question de veille : ${ax.question_veille}` : '',
        `MATÉRIAUX VALIDÉS (${validated.length}, ${out.diagnostic.publications_validees} publication(s)) :`,
        formatMaterials(list, 800)
      ].filter(Boolean).join('\n\n'),
      maxTokens: 4000
    });

    // 5. Validation déterministe.
    const rejets = [];
    const v = validateObjects(raw, list, map, rejets);
    const withSources = objs => objs.map(({ rs, ...o }) => ({ ...o, sources: rs.map(r => enrichSource(r, candidates)) }));

    return {
      ...out,
      statut: 'ok',
      tendances: withSources(v.tendances),
      signes_a_guetter: withSources(v.signes),
      sources_a_surveiller: withSources(v.sources),
      angles_morts: v.angles,
      materiaux_valides: validatedView,
      materiaux_ecartes: excluded,
      rejets
    };
  } catch (error) {
    console.error(`[T06-v2] axe ${ax.axis_id} :`, error?.message || error);
    return { ...out, ...empty, statut: 'erreur_technique', erreur: String(error?.message || error),
      materiaux_valides: [], materiaux_ecartes: [], rejets: [],
      message: 'Erreur technique : ce statut ne dit rien du contenu du corpus.' };
  }
}

module.exports = {
  MODEL_T06_V2,
  CFG,
  proposerAxesV2,
  construireObjetsAxeV2,
  // exportés pour les tests
  subjectQueryFromNeed,
  withAccentVariant,
  quoteFound,
  validateObjects,
  aliasList,
  aliasMap,
  normalize
};
