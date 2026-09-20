// =====================================================
// QUIRITES VEILLE LAB — T06 SCÉNARIO DE VEILLE
// V1.0 : besoin d'abord, corpus ensuite.
// - Étape 1 : cadrer le besoin par maïeutique + aperçu brut de couverture corpus.
// - Étape 2 : proposer deux structurations rivales d'axes, puis documenter chaque axe par RAG.
// - Étape 3 : construire une grille de guet axe par axe.
// - Étape 4 : assemblage déterministe côté front, sans nouvelle génération.
// =====================================================

const { searchCorpus } = require('./globalSearch');

const MODEL_T06 = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const T06_ANTHROPIC_MAX_ATTEMPTS = 4;
const MAX_CLARIFYING_QUESTIONS = 5;
const MAX_AXES_PER_STRUCTURE = 5;
const MAX_AXIS_CANDIDATES = 14;
const MAX_TRENDS_PER_AXIS = 2;
const MAX_WATCH_SIGNS_PER_AXIS = 4;
const MAX_CLUSTER_HYPOTHESES_PER_AXIS = 2;

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

function clip(value, max = 760) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

async function appelerClaudeAvecOutil({ apiKey, system, tool, userText, maxTokens = 3600 }) {
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
        const err = new Error(`Claude n'a pas retourné l'appel structuré attendu pour ${tool.name}.`);
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
  throw lastError || new Error('Échec de l’appel Anthropic T06.');
}

// ---------- Schémas Claude ----------

const FRAMING_TOOL = {
  name: 'cadrer_besoin_t06',
  description: 'Analyse le besoin sans le reformuler et propose quelques questions utiles de clarification.',
  input_schema: {
    type: 'object',
    properties: {
      sujet_central: { type: 'string' },
      requete_corpus: { type: 'string' },
      dimensions_deja_precisees: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['territoire', 'echelle', 'horizon', 'destinataire', 'finalite', 'phenomene', 'mesure', 'autre'] },
            valeur: { type: 'string' }
          },
          required: ['type', 'valeur'], additionalProperties: false
        }
      },
      questions: {
        type: 'array', minItems: 3, maxItems: MAX_CLARIFYING_QUESTIONS,
        items: {
          type: 'object',
          properties: {
            question_id: { type: 'string' },
            question: { type: 'string' },
            pourquoi: { type: 'string' },
            dimension: { type: 'string', enum: ['territoire', 'echelle', 'horizon', 'destinataire', 'finalite', 'phenomene', 'mesure', 'autre'] }
          },
          required: ['question_id', 'question', 'pourquoi', 'dimension'], additionalProperties: false
        }
      }
    },
    required: ['sujet_central', 'requete_corpus', 'dimensions_deja_precisees', 'questions'],
    additionalProperties: false
  }
};

const STRUCTURES_TOOL = {
  name: 'proposer_structurations_t06',
  description: 'Propose deux structurations rivales d’un scénario de veille à partir du besoin, sans prétendre décrire le monde.',
  input_schema: {
    type: 'object',
    properties: {
      structurations: {
        type: 'array', minItems: 2, maxItems: 2,
        items: {
          type: 'object',
          properties: {
            structure_id: { type: 'string' },
            titre: { type: 'string' },
            logique: { type: 'string' },
            axes: {
              type: 'array', minItems: 3, maxItems: MAX_AXES_PER_STRUCTURE,
              items: {
                type: 'object',
                properties: {
                  axis_id: { type: 'string' },
                  titre: { type: 'string' },
                  objectif_surveillance: { type: 'string' },
                  pourquoi: { type: 'string' },
                  questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
                  requete_rag: { type: 'string' }
                },
                required: ['axis_id', 'titre', 'objectif_surveillance', 'pourquoi', 'questions', 'requete_rag'],
                additionalProperties: false
              }
            }
          },
          required: ['structure_id', 'titre', 'logique', 'axes'], additionalProperties: false
        }
      }
    },
    required: ['structurations'], additionalProperties: false
  }
};

const AXIS_SUPPORT_TOOL = {
  name: 'documenter_axes_t06',
  description: 'Sélectionne, pour chaque axe, les matériaux du corpus réellement utiles et résume ce qu’ils apportent.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array', minItems: 1, maxItems: 1,
        items: {
          type: 'object',
          properties: {
            axis_id: { type: 'string' },
            material_ids: { type: 'array', maxItems: 5, items: { type: 'string' } },
            apport_corpus: { type: 'string' },
            limite_corpus: { type: 'string' }
          },
          required: ['axis_id', 'material_ids', 'apport_corpus', 'limite_corpus'],
          additionalProperties: false
        }
      }
    },
    required: ['axes'], additionalProperties: false
  }
};

const WATCH_TOOL = {
  name: 'construire_grille_guet_t06',
  description: 'Construit par axe une grille de guet : tendances documentées, signes de changement à guetter et hypothèses de regroupement.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            axis_id: { type: 'string' },
            tendances: {
              type: 'array', maxItems: MAX_TRENDS_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  trend_id: { type: 'string' },
                  label: { type: 'string' },
                  synthese: { type: 'string' },
                  limite: { type: 'string' },
                  material_ids: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } }
                },
                required: ['trend_id', 'label', 'synthese', 'limite', 'material_ids'], additionalProperties: false
              }
            },
            signes_a_guetter: {
              type: 'array', maxItems: MAX_WATCH_SIGNS_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  sign_id: { type: 'string' },
                  label: { type: 'string' },
                  pourquoi_guetter: { type: 'string' },
                  ce_qui_confirmerait: { type: 'string' },
                  ce_qui_affaiblirait: { type: 'string' },
                  material_ids: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }
                },
                required: ['sign_id', 'label', 'pourquoi_guetter', 'ce_qui_confirmerait', 'ce_qui_affaiblirait', 'material_ids'],
                additionalProperties: false
              }
            },
            hypotheses_regroupement: {
              type: 'array', maxItems: MAX_CLUSTER_HYPOTHESES_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  hypothesis_id: { type: 'string' },
                  label: { type: 'string' },
                  interpretation: { type: 'string' },
                  sign_ids: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
                  ce_qui_invaliderait: { type: 'string' }
                },
                required: ['hypothesis_id', 'label', 'interpretation', 'sign_ids', 'ce_qui_invaliderait'],
                additionalProperties: false
              }
            },
            sources_a_surveiller: {
              type: 'array', maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  raison: { type: 'string' },
                  material_ids: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }
                },
                required: ['label', 'raison', 'material_ids'], additionalProperties: false
              }
            },
            angles_morts: { type: 'array', maxItems: 4, items: { type: 'string' } }
          },
          required: ['axis_id', 'tendances', 'signes_a_guetter', 'hypotheses_regroupement', 'sources_a_surveiller', 'angles_morts'],
          additionalProperties: false
        }
      }
    },
    required: ['axes'], additionalProperties: false
  }
};

// ---------- Helpers corpus ----------

function materialText(result = {}) {
  if (result.kind === 'chunk') return clip(result.text, 900);
  if (result.kind === 'node') return clip(result.label, 460);
  if (result.kind === 'relation') return clip(`${result.source_label || ''} — ${result.relation_type || ''} — ${result.target_label || ''}`, 560);
  return '';
}

function materialLabel(result = {}) {
  if (result.kind === 'node') return result.label || result.node_id || result.result_id;
  if (result.kind === 'chunk') return result.section || clip(result.text, 140) || result.chunk_id || result.result_id;
  if (result.kind === 'relation') return `${result.source_label || result.source_id || ''} — ${result.relation_type || 'LIEN'} — ${result.target_label || result.target_id || ''}`;
  return result.result_id || 'Matériau';
}

function sourceAccessUrl(result = {}, allResults = []) {
  const direct = String(result.url_contenu || result.url_source || '').trim();
  if (direct) return direct;
  const publicationId = String(result.publication_id || '').trim();
  if (!publicationId) return '';
  const samePublication = (Array.isArray(allResults) ? allResults : []).find(item =>
    String(item?.publication_id || '').trim() === publicationId &&
    String(item?.url_contenu || item?.url_source || '').trim()
  );
  return samePublication ? String(samePublication.url_contenu || samePublication.url_source || '').trim() : '';
}

function enrichSource(result = {}, allResults = []) {
  const url = sourceAccessUrl(result, allResults);
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
    url,
    access_available: Boolean(url),
    extrait: materialText(result),
    libelle: materialLabel(result),
    origin: 'corpus'
  };
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

function formatCandidatesForPrompt(candidates = []) {
  return candidates.map((r, i) => [
    `MATÉRIAU ${i + 1} — ${r.result_id}`,
    `Type: ${r.kind}${r.node_type ? ` / ${r.node_type}` : ''}${r.relation_type ? ` / ${r.relation_type}` : ''}`,
    `Publication: ${r.publication_id || '—'} — ${r.publication_title || '—'}`,
    `Organisme / année / repère: ${r.organisme_producteur || '—'} | ${r.annee_publication || '—'} | ${r.locator || '—'}`,
    `Contenu: ${materialText(r) || materialLabel(r)}`
  ].join('\n')).join('\n\n---\n\n');
}

function sanitizeAnswers(answers = []) {
  return (Array.isArray(answers) ? answers : [])
    .map(a => ({
      question_id: String(a?.question_id || '').trim(),
      question: String(a?.question || '').trim(),
      answer: String(a?.answer || '').trim()
    }))
    .filter(a => a.answer)
    .slice(0, MAX_CLARIFYING_QUESTIONS);
}

function answersText(answers = []) {
  const safe = sanitizeAnswers(answers);
  if (!safe.length) return 'Aucune précision supplémentaire fournie.';
  return safe.map(a => `- ${a.question || a.question_id}: ${a.answer}`).join('\n');
}

function searchSafe(searchFn, body) {
  try {
    const response = searchFn(body);
    return response && typeof response === 'object' ? response : { results: [] };
  } catch {
    return { results: [] };
  }
}

function getRepresentativeCoverage(searchFn, query) {
  if (!query) return { publication_count: 0, material_count: 0, source_engine: '', sources: [], years: [] };
  const response = searchSafe(searchFn, {
    query,
    limit: 18,
    max_per_publication: 3,
    diversify_by_publication: true
  });
  const results = dedupeResults(Array.isArray(response.results) ? response.results : []);
  const pubs = new Set(results.map(r => r.publication_id).filter(Boolean));
  const years = [...new Set(results.map(r => String(r.annee_publication || '').trim()).filter(Boolean))].sort();
  const seenPub = new Set();
  const sources = [];
  for (const r of results) {
    const key = r.publication_id || r.result_id;
    if (!key || seenPub.has(key)) continue;
    seenPub.add(key);
    sources.push(enrichSource(r, results));
    if (sources.length >= 5) break;
  }
  return {
    publication_count: pubs.size,
    material_count: results.length,
    source_engine: response.engine || '',
    years,
    sources
  };
}


function fallbackSubjectFromNeed(need = '') {
  let text = String(need || '').replace(/\s+/g, ' ').trim();
  text = text
    .replace(/^[\s"'«»]*(je\s+(souhaite|veux|voudrais|cherche\s+à|cherche\s+a)\s+)/i, '')
    .replace(/^(faire|mettre\s+en\s+place)\s+(une\s+)?veille\s+(sur|concernant|autour\s+de)\s+/i, '')
    .replace(/^(suivre|surveiller|observer|analyser)\s+/i, '')
    .replace(/^(une\s+)?veille\s+(sur|concernant|autour\s+de)\s+/i, '')
    .replace(/^(?:l[’']\s*)?(?:évolution|evolution|suivi|observation)\s+(?:de\s+|du\s+|des\s+|d[’']\s*)/i, '')
    .replace(/^(?:le|la|les|un|une)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!text) return 'sujet de veille';
  const words = text.split(' ').filter(Boolean);
  return words.slice(0, 12).join(' ');
}

function fallbackCorpusQuery(subject = '') {
  const stop = new Set([
    'je','souhaite','veux','voudrais','faire','une','veille','sur','suivre','surveiller',
    'observer','analyser','le','la','les','un','une','des','de','du','d','a','à','au','aux',
    'en','dans','pour','et','ou','l','echelle','échelle'
  ]);
  const words = String(subject || '')
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => !stop.has(x.toLowerCase()));
  const picked = words.slice(0, 8);
  if (picked.length >= 2) return picked.join(' ');
  return String(subject || 'sujet veille').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
}

function fallbackQuestions() {
  return [
    { question_id: 'Q1', question: 'À qui ce scénario de veille doit-il être utile ?', pourquoi: 'Le destinataire change les priorités de surveillance et le niveau de détail attendu.', dimension: 'destinataire' },
    { question_id: 'Q2', question: 'Sur quel horizon souhaitez-vous observer les évolutions ?', pourquoi: 'Un horizon court et un horizon pluriannuel ne conduisent pas aux mêmes signes à guetter.', dimension: 'horizon' },
    { question_id: 'Q3', question: 'Quel périmètre géographique ou organisationnel faut-il privilégier ?', pourquoi: 'Le périmètre détermine ce qui doit être comparé et les sources pertinentes.', dimension: 'territoire' }
  ];
}

function safeQuestionList(raw = []) {
  const out = (Array.isArray(raw) ? raw : []).map((q, i) => ({
    question_id: String(q?.question_id || `Q${i + 1}`).trim(),
    question: String(q?.question || '').trim(),
    pourquoi: String(q?.pourquoi || '').trim(),
    dimension: String(q?.dimension || 'autre').trim()
  })).filter(q => q.question).slice(0, MAX_CLARIFYING_QUESTIONS);
  return out.length >= 3 ? out : fallbackQuestions();
}

function fallbackStructurations(subject = 'le sujet') {
  return [
    {
      structure_id: 'A',
      titre: 'Lire les transformations du phénomène',
      logique: 'Suivre ce qui change dans le phénomène, sa mesure et sa territorialisation.',
      axes: [
        { axis_id: 'A1', titre: `Évolution des formes de ${subject}`, objectif_surveillance: `Repérer comment les formes prises par ${subject} évoluent dans le temps.`, pourquoi: 'Cet axe permet de distinguer une évolution du phénomène d’un simple changement de visibilité.', questions: [`Quelles formes de ${subject} progressent, reculent ou se recomposent ?`], requete_rag: `${subject} évolution formes` },
        { axis_id: 'A2', titre: 'Mesure et qualité des données', objectif_surveillance: 'Suivre la manière dont le phénomène est mesuré et rendu visible.', pourquoi: 'Les changements d’indicateurs ou de couverture peuvent modifier la lecture du phénomène.', questions: ['Les données disponibles deviennent-elles plus fines, plus complètes ou au contraire plus fragmentées ?'], requete_rag: `${subject} données mesure statistique` },
        { axis_id: 'A3', titre: 'Différenciations territoriales', objectif_surveillance: 'Repérer les écarts et recompositions entre territoires.', pourquoi: 'La géographie du phénomène peut évoluer indépendamment de son niveau global.', questions: ['Quels écarts territoriaux méritent une surveillance régulière ?'], requete_rag: `${subject} territoire commune` }
      ]
    },
    {
      structure_id: 'B',
      titre: 'Lire la chaîne de connaissance et d’action publique',
      logique: 'Organiser la veille autour de ce qui est observé, interprété puis pris en charge.',
      axes: [
        { axis_id: 'B1', titre: 'Production de la connaissance', objectif_surveillance: 'Suivre les évolutions des données, méthodes et catégories de mesure.', pourquoi: 'Une évolution de l’appareil de connaissance peut changer ce que les décideurs voient du sujet.', questions: ['Quels changements de méthode ou de données modifient la compréhension du sujet ?'], requete_rag: `${subject} méthodes données` },
        { axis_id: 'B2', titre: 'Perceptions et interprétations', objectif_surveillance: 'Suivre les écarts entre phénomène mesuré, perception et problématisation publique.', pourquoi: 'Ces écarts peuvent influencer la mise à l’agenda et les priorités.', questions: ['Quels décalages apparaissent entre données disponibles et perception du phénomène ?'], requete_rag: `${subject} perception opinion` },
        { axis_id: 'B3', titre: 'Réponses locales et institutionnelles', objectif_surveillance: 'Suivre les dispositifs, coordinations et adaptations de l’action publique.', pourquoi: 'Les réponses apportées constituent elles-mêmes un indicateur de transformation du problème public.', questions: ['Quels dispositifs ou modes de coordination évoluent en réponse au sujet ?'], requete_rag: `${subject} dispositifs action publique` }
      ]
    }
  ];
}

function sanitizeStructurations(raw = {}, subject = '') {
  const fallback = fallbackStructurations(subject || 'le sujet');
  const incoming = Array.isArray(raw?.structurations) ? raw.structurations.slice(0, 2) : [];
  const out = [];

  for (let si = 0; si < 2; si += 1) {
    const source = incoming[si] || {};
    const fb = fallback[si];
    const rawAxes = Array.isArray(source?.axes) ? source.axes.slice(0, MAX_AXES_PER_STRUCTURE) : [];
    const axes = [];

    rawAxes.forEach((a, ai) => {
      const fbAxis = fb.axes[Math.min(ai, fb.axes.length - 1)] || fb.axes[0];
      const titre = String(a?.titre || '').trim();
      if (!titre) return;
      const questions = [...new Set((Array.isArray(a?.questions) ? a.questions : [])
        .map(x => String(x || '').trim()).filter(Boolean))].slice(0, 3);
      axes.push({
        axis_id: String(a?.axis_id || `${si === 0 ? 'A' : 'B'}${ai + 1}`).trim(),
        titre,
        objectif_surveillance: String(a?.objectif_surveillance || `Suivre les évolutions relatives à ${titre.toLowerCase()}.`).trim(),
        pourquoi: String(a?.pourquoi || 'Axe proposé pour structurer durablement la surveillance du besoin exprimé.').trim(),
        questions: questions.length ? questions : [`Quelles évolutions relatives à ${titre.toLowerCase()} méritent une surveillance régulière ?`],
        requete_rag: String(a?.requete_rag || `${subject} ${titre}`).trim(),
        origin: 'proposition_ia',
        corpus_status: 'non_evalue',
        apport_corpus: '',
        limite_corpus: '',
        sources: []
      });
    });

    // Dégradation par axe : on conserve les axes valides et on complète seulement ce qui manque.
    const usedTitles = new Set(axes.map(a => normalize(a.titre)));
    for (const fbAxis of fb.axes) {
      if (axes.length >= 3) break;
      if (usedTitles.has(normalize(fbAxis.titre))) continue;
      axes.push({
        ...fbAxis,
        origin: 'proposition_ia',
        corpus_status: 'non_evalue',
        apport_corpus: '',
        limite_corpus: '',
        sources: []
      });
      usedTitles.add(normalize(fbAxis.titre));
    }

    out.push({
      structure_id: String(source?.structure_id || fb.structure_id || (si === 0 ? 'A' : 'B')).trim(),
      titre: String(source?.titre || fb.titre || `Structuration ${si + 1}`).trim(),
      logique: String(source?.logique || fb.logique || '').trim(),
      axes: axes.slice(0, MAX_AXES_PER_STRUCTURE)
    });
  }
  return out;
}

function axisCoverageStatus(sources = []) {
  const pubs = new Set(sources.map(s => s.publication_id).filter(Boolean));
  if (pubs.size >= 2) return 'documente';
  if (pubs.size === 1 || sources.length) return 'partiellement_documente';
  return 'a_instruire';
}

function allowedMaterialIds(results = []) {
  return new Set(results.map(r => String(r.result_id || '')).filter(Boolean));
}

function cleanIds(ids, allowed, max = 6) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(id => allowed.has(id)))].slice(0, max);
}

function buildAxisCorpusPackets(searchFn, structures, subject, answers) {
  const packets = [];
  const rawByAxis = new Map();
  for (const structure of structures) {
    for (const axis of structure.axes) {
      const query = [subject, axis.requete_rag, answers.map(a => a.answer).join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const response = searchSafe(searchFn, {
        query,
        limit: MAX_AXIS_CANDIDATES,
        max_per_publication: 3,
        diversify_by_publication: true
      });
      const results = dedupeResults(Array.isArray(response.results) ? response.results : []).slice(0, MAX_AXIS_CANDIDATES);
      rawByAxis.set(axis.axis_id, results);
      packets.push({
        axis_id: axis.axis_id,
        titre: axis.titre,
        objectif_surveillance: axis.objectif_surveillance,
        questions: axis.questions,
        materials: results.map(r => ({
          material_id: r.result_id,
          publication_id: r.publication_id || '',
          publication_title: r.publication_title || '',
          organisme_producteur: r.organisme_producteur || '',
          annee_publication: r.annee_publication || '',
          locator: r.locator || '',
          kind: r.kind || '',
          text: materialText(r)
        }))
      });
    }
  }
  return { packets, rawByAxis };
}

function supportPrompt(packets = []) {
  return packets.map(p => [
    `AXE ${p.axis_id} — ${p.titre}`,
    `Objectif: ${p.objectif_surveillance}`,
    `Questions: ${(p.questions || []).join(' | ')}`,
    'Matériaux candidats:',
    p.materials.length ? p.materials.map((m, i) => `${i + 1}. ${m.material_id} | ${m.publication_id} | ${m.publication_title} | ${m.locator || 'sans repère'} | ${clip(m.text, 520)}`).join('\n') : '(aucun)'
  ].join('\n')).join('\n\n=====\n\n');
}

function normalizeAxisSupport(raw = {}, structures = [], rawByAxis = new Map()) {
  const supportById = new Map((Array.isArray(raw.axes) ? raw.axes : []).map(a => [String(a?.axis_id || ''), a]));
  return structures.map(structure => ({
    ...structure,
    axes: structure.axes.map(axis => {
      const results = rawByAxis.get(axis.axis_id) || [];
      const allowed = allowedMaterialIds(results);
      const support = supportById.get(axis.axis_id) || {};
      const ids = cleanIds(support.material_ids, allowed, 5);
      const sources = ids.map(id => results.find(r => r.result_id === id)).filter(Boolean).map(result => enrichSource(result, results));
      return {
        ...axis,
        corpus_status: axisCoverageStatus(sources),
        apport_corpus: String(support.apport_corpus || '').trim(),
        limite_corpus: String(support.limite_corpus || '').trim(),
        sources
      };
    })
  }));
}

function buildDynamicPackets(searchFn, axes = [], subject = '', answers = []) {
  const packets = [];
  const rawByAxis = new Map();
  for (const axis of axes) {
    const query = [subject, axis.requete_rag || axis.titre, axis.objectif_surveillance, answers.map(a => a.answer).join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const response = searchSafe(searchFn, {
      query,
      limit: 18,
      max_per_publication: 4,
      diversify_by_publication: true
    });
    const results = dedupeResults(Array.isArray(response.results) ? response.results : []).slice(0, 18);
    rawByAxis.set(axis.axis_id, results);
    packets.push({
      axis_id: axis.axis_id,
      titre: axis.titre,
      objectif_surveillance: axis.objectif_surveillance,
      corpus_status: axis.corpus_status || 'a_instruire',
      materials: results.map(r => ({
        material_id: r.result_id,
        publication_id: r.publication_id || '',
        publication_title: r.publication_title || '',
        organisme_producteur: r.organisme_producteur || '',
        annee_publication: r.annee_publication || '',
        locator: r.locator || '',
        kind: r.kind || '',
        text: materialText(r)
      }))
    });
  }
  return { packets, rawByAxis };
}

function uniquePublicationCount(ids, results) {
  const pubs = new Set();
  for (const id of ids) {
    const r = results.find(x => x.result_id === id);
    if (r?.publication_id) pubs.add(r.publication_id);
  }
  return pubs.size;
}

// ---------- Étape 1 ----------

async function cadrerBesoinT06({ apiKey, besoin = '', searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }

  const system = `
Tu aides un veilleur à CLARIFIER son besoin, sans le reformuler et sans conclure à sa place.
Produis 3 à 5 questions courtes qui l'obligent à préciser ce qui compte réellement : destinataire, finalité décisionnelle, horizon, périmètre, phénomène ou mesure.
N'invente aucune information sur le monde. N'utilise aucune connaissance extérieure.
Le besoin utilisateur reste intact. Une question peut rester sans réponse.
La requête corpus doit être courte (2 à 8 mots), centrée sur le sujet central et dépourvue de formulations comme « je souhaite ».
N'ajoute aucun nom propre, chiffre ou date absent du besoin.`;

  let raw;
  try {
    raw = await callModel({ apiKey, system, tool: FRAMING_TOOL, userText: need, maxTokens: 1800 });
  } catch (error) {
    const fallbackSubject = fallbackSubjectFromNeed(need);
    raw = {
      sujet_central: fallbackSubject,
      requete_corpus: fallbackCorpusQuery(fallbackSubject),
      dimensions_deja_precisees: [],
      questions: fallbackQuestions(),
      fallback_used: true
    };
  }

  const subject = String(raw?.sujet_central || fallbackSubjectFromNeed(need)).trim();
  const query = String(raw?.requete_corpus || fallbackCorpusQuery(subject)).trim();
  const questions = safeQuestionList(raw?.questions);
  const dimensions = (Array.isArray(raw?.dimensions_deja_precisees) ? raw.dimensions_deja_precisees : [])
    .map(d => ({ type: String(d?.type || 'autre'), valeur: String(d?.valeur || '').trim() }))
    .filter(d => d.valeur)
    .slice(0, 8);
  const coverage = getRepresentativeCoverage(searchFn, query);

  return {
    ok: true,
    engine: 't06-framing-v1.0-maieutique',
    need,
    sujet_central: subject,
    requete_corpus: query,
    dimensions_deja_precisees: dimensions,
    questions,
    couverture_corpus: coverage,
    guardrails: {
      need_reformulated: false,
      corpus_decides_axes: false,
      user_can_skip_questions: true,
      note: 'Le cadrage aide à préciser le besoin ; il ne décide pas encore des axes de veille.'
    }
  };
}

// ---------- Étape 2 ----------

async function proposerStructurationsT06({ apiKey, besoin = '', cadrage = {}, reponses = [], searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }
  const answers = sanitizeAnswers(reponses);
  const subject = String(cadrage?.sujet_central || fallbackSubjectFromNeed(need)).trim();

  const system = `
Tu proposes DEUX structurations rivales d'un scénario de veille.
Tu travailles d'abord à partir du besoin utilisateur et des précisions qu'il a données. Le corpus n'est PAS utilisé pour autoriser ou interdire les axes à ce stade.
Chaque structuration comprend 3 à 5 axes. Un axe est une QUESTION DURABLE SUR CE QU'IL FAUT SURVEILLER, pas un constat sur le monde, ni un acteur, ni un dispositif ponctuel.
Utilise une grille de veille quand elle aide : formes du phénomène, production et mesure de la donnée, acteurs et réponses, cadre normatif, territoires, perceptions, ruptures technologiques, comparaisons.
Les deux structurations doivent être réellement différentes et aider le veilleur à choisir un angle de lecture.
Chaque axe contient 1 à 3 questions de veille et une requête RAG courte.
Aucun chiffre, date ou nom propre ne doit être ajouté s'il n'est pas déjà dans le besoin ou les réponses de l'utilisateur.
Les axes sont des PROPOSITIONS IA À VALIDER, jamais des faits établis.`;

  let raw;
  try {
    raw = await callModel({
      apiKey,
      system,
      tool: STRUCTURES_TOOL,
      userText: `BESOIN INITIAL : ${need}\nSUJET CENTRAL : ${subject}\nPRÉCISIONS DE L'UTILISATEUR :\n${answersText(answers)}`,
      maxTokens: 3800
    });
  } catch {
    raw = { structurations: fallbackStructurations(subject) };
  }

  const structures = sanitizeStructurations(raw, subject);

  return {
    ok: true,
    engine: 't06-axes-v1.0-hypotheses-first',
    need,
    sujet_central: subject,
    reponses: answers,
    structurations: structures,
    status_legend: {
      non_evalue: 'La couverture documentaire sera établie après le choix de la structuration.',
      documente: 'Le corpus apporte plusieurs sources à cet axe.',
      partiellement_documente: 'Le corpus apporte un appui limité ou concentré sur une seule publication.',
      a_instruire: 'Aucun matériau suffisamment pertinent n’a été retenu pour cet axe ; l’axe reste une hypothèse de veille à instruire.',
      indisponible: 'La documentation du corpus n’a pas pu être établie pour des raisons techniques ; ce statut ne décrit pas une lacune documentaire.'
    },
    guardrails: {
      axes_are_hypotheses: true,
      corpus_can_block_axis: false,
      user_must_choose: true,
      corpus_documentation_after_choice: true,
      note: 'Les axes viennent du besoin et d’une grille de veille. Le corpus n’est interrogé pour documenter les axes qu’après le choix du veilleur.'
    }
  };
}

async function documenterAxesT06({ apiKey, besoin = '', cadrage = {}, reponses = [], axes = [], searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }

  const selectedAxes = (Array.isArray(axes) ? axes : [])
    .map((a, i) => ({
      ...a,
      axis_id: String(a?.axis_id || `AX${i + 1}`).trim(),
      titre: String(a?.titre || '').trim(),
      objectif_surveillance: String(a?.objectif_surveillance || '').trim(),
      pourquoi: String(a?.pourquoi || '').trim(),
      questions: Array.isArray(a?.questions) ? a.questions.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [],
      requete_rag: String(a?.requete_rag || a?.titre || '').trim(),
      origin: String(a?.origin || 'proposition_ia')
    }))
    .filter(a => a.titre)
    .slice(0, MAX_AXES_PER_STRUCTURE + 2);

  if (!selectedAxes.length) { const e = new Error('Au moins un axe de veille doit être retenu.'); e.statusCode = 400; throw e; }

  const answers = sanitizeAnswers(reponses);
  const subject = String(cadrage?.sujet_central || fallbackSubjectFromNeed(need)).trim();
  const fakeStructure = [{ structure_id: 'SELECTED', titre: 'Axes retenus', logique: '', axes: selectedAxes }];
  const { packets, rawByAxis } = buildAxisCorpusPackets(searchFn, fakeStructure, subject, answers);

  const supportSystem = `
Tu documentes UN axe de veille déjà proposé. Tu ne dois PAS le réécrire ni le supprimer.
Sélectionne uniquement les matériaux réellement utiles parmi ceux fournis.
Résume en une ou deux phrases ce que le corpus apporte à l'axe, sans généraliser au-delà des matériaux.
Si aucun matériau n'est réellement pertinent, retourne material_ids vide et explique simplement la limite du corpus.
Un axe peut rester « à instruire » : ce n'est pas un échec.
N'utilise aucune connaissance extérieure. Les noms propres, chiffres et dates dans « apport_corpus » doivent venir des matériaux sélectionnés.`;

  const documentedAxes = [];
  let technicalFailure = false;

  for (const packet of packets) {
    let supportRaw;
    try {
      supportRaw = await callModel({
        apiKey,
        system: supportSystem,
        tool: AXIS_SUPPORT_TOOL,
        userText: `BESOIN : ${need}\n\n${supportPrompt([packet])}`,
        maxTokens: 1400
      });
      const structure = normalizeAxisSupport(supportRaw, [{ structure_id: 'SELECTED', titre: '', logique: '', axes: selectedAxes.filter(a => a.axis_id === packet.axis_id) }], rawByAxis)[0];
      const axis = structure?.axes?.[0];
      documentedAxes.push(axis || selectedAxes.find(a => a.axis_id === packet.axis_id));
    } catch (error) {
      technicalFailure = true;
      const axis = selectedAxes.find(a => a.axis_id === packet.axis_id);
      documentedAxes.push({
        ...axis,
        corpus_status: 'indisponible',
        apport_corpus: '',
        limite_corpus: 'La documentation du corpus n’a pas pu être établie pour cet axe en raison d’une indisponibilité technique. Ce statut ne signifie pas que le corpus est lacunaire.',
        sources: [],
        documentation_error: true
      });
    }
  }

  return {
    ok: true,
    engine: 't06-axis-support-v1.0-selected-only',
    need,
    axes: documentedAxes,
    documentation_available: !technicalFailure,
    guardrails: {
      only_selected_axes_documented: true,
      technical_failure_is_not_documentary_gap: true
    }
  };
}

// ---------- Étape 3 ----------

async function construireGrilleGuetT06({ apiKey, besoin = '', cadrage = {}, reponses = [], axes = [], searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }

  const selectedAxes = (Array.isArray(axes) ? axes : [])
    .map((a, i) => ({
      ...a,
      axis_id: String(a?.axis_id || `AX${i + 1}`).trim(),
      titre: String(a?.titre || '').trim(),
      objectif_surveillance: String(a?.objectif_surveillance || '').trim(),
      questions: Array.isArray(a?.questions) ? a.questions.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [],
      requete_rag: String(a?.requete_rag || a?.titre || '').trim(),
      corpus_status: String(a?.corpus_status || 'non_evalue').trim()
    }))
    .filter(a => a.titre)
    .slice(0, MAX_AXES_PER_STRUCTURE + 2);

  if (!selectedAxes.length) { const e = new Error('Au moins un axe de veille doit être retenu.'); e.statusCode = 400; throw e; }

  const answers = sanitizeAnswers(reponses);
  const subject = String(cadrage?.sujet_central || fallbackSubjectFromNeed(need)).trim();
  const { packets, rawByAxis } = buildDynamicPackets(searchFn, selectedAxes, subject, answers);
  const packetByAxis = new Map(packets.map(packet => [String(packet.axis_id || ''), packet]));

  const system = `
Tu construis les OBJETS DE VEILLE pour UN SEUL AXE à la fois.
Tu produis une grille de guet, pas une analyse prédictive.

Pour l'axe fourni :
1) TENDANCES DOCUMENTÉES : constats déclaratifs synthétiques. Chaque tendance doit être soutenue par au moins deux matériaux provenant de publications différentes. Si ce n'est pas possible, retourne zéro tendance.
2) SIGNES DE CHANGEMENT À GUETTER : propositions observables sur ce qu'il serait utile de surveiller. Ils ne sont PAS présentés comme déjà observés. CHAQUE signe doit obligatoirement être relié à au moins un material_id réellement fourni. Si aucun matériau ne permet de justifier un signe, ne le propose pas.
3) HYPOTHÈSES DE REGROUPEMENT : seulement si au moins deux signes sourcés peuvent converger. Formule explicitement l'incertitude et ce qui invaliderait l'hypothèse. Ne présente jamais cela comme un signal faible établi.
4) SOURCES À SURVEILLER : ne propose ici que des publications réellement représentées parmi les matériaux fournis. Le label doit correspondre à la publication (ou à son organisme producteur lorsqu'il est explicitement fourni dans les métadonnées), et CHAQUE source à surveiller doit obligatoirement être reliée à au moins un material_id de cette publication. Ne recommande pas une source seulement mentionnée dans le texte d'un document si elle n'est pas elle-même représentée dans les matériaux. N'invente ni organisme, ni publication, ni URL.
5) ANGLES MORTS : transforme les lacunes documentaires en points à instruire, sans bloquer l'axe.

Règles impératives :
- Tu réponds uniquement pour l'axis_id fourni.
- Aucun objet affichable (tendance, signe, source à surveiller) ne doit exister sans material_id valide.
- Aucun chiffre, date, nom propre ou causalité dans une proposition s'ils ne figurent pas dans le besoin ou les matériaux fournis.
- Les tendances sont des synthèses sourcées ; les signes à guetter et hypothèses sont des propositions IA à valider, mais restent ancrés dans au moins un matériau du corpus.
- N'utilise aucune connaissance extérieure.
- Si le corpus ne permet pas de sourcer un signe ou une source à surveiller, retourne simplement moins d'objets.`;

  function buildAxisPrompt(axis, packet) {
    return [
      `BESOIN : ${need}`,
      answers.length ? `PRÉCISIONS UTILISATEUR :\n${answersText(answers)}` : '',
      `AXE ${axis.axis_id} — ${axis.titre}`,
      `Objectif : ${axis.objectif_surveillance}`,
      `Statut de couverture : ${axis.corpus_status}`,
      axis.questions.length ? `Questions de veille :\n- ${axis.questions.join('\n- ')}` : '',
      'MATÉRIAUX :',
      packet?.materials?.length
        ? packet.materials.map((m, i) => `${i + 1}. ${m.material_id} | ${m.publication_id} | ${m.publication_title} | ${m.locator || 'sans repère'} | ${clip(m.text, 620)}`).join('\n')
        : '(aucun matériau pertinent)'
    ].filter(Boolean).join('\n\n');
  }

  function normalizeGeneratedAxis(axis, sourceAxis, results) {
    const allowed = allowedMaterialIds(results);

    const trends = (Array.isArray(sourceAxis.tendances) ? sourceAxis.tendances : []).map((t, i) => {
      const ids = cleanIds(t?.material_ids, allowed, 6);
      if (ids.length < 2 || uniquePublicationCount(ids, results) < 2) return null;
      return {
        trend_id: String(t?.trend_id || `${axis.axis_id}-T${i + 1}`).trim(),
        label: String(t?.label || '').trim(),
        synthese: String(t?.synthese || '').trim(),
        limite: String(t?.limite || '').trim(),
        origin: 'corpus',
        material_ids: ids,
        sources: ids.map(id => results.find(r => r.result_id === id)).filter(Boolean).map(result => enrichSource(result, results))
      };
    }).filter(t => t?.label).slice(0, MAX_TRENDS_PER_AXIS);

    const signs = (Array.isArray(sourceAxis.signes_a_guetter) ? sourceAxis.signes_a_guetter : []).map((s, i) => {
      const ids = cleanIds(s?.material_ids, allowed, 4);
      if (!ids.length) return null;
      const sources = ids.map(id => results.find(r => r.result_id === id)).filter(Boolean).map(result => enrichSource(result, results));
      if (!sources.length) return null;
      return {
        sign_id: String(s?.sign_id || `${axis.axis_id}-S${i + 1}`).trim(),
        label: String(s?.label || '').trim(),
        pourquoi_guetter: String(s?.pourquoi_guetter || '').trim(),
        ce_qui_confirmerait: String(s?.ce_qui_confirmerait || '').trim(),
        ce_qui_affaiblirait: String(s?.ce_qui_affaiblirait || '').trim(),
        origin: 'proposition_ia',
        material_ids: ids,
        sources
      };
    }).filter(s => s?.label).slice(0, MAX_WATCH_SIGNS_PER_AXIS);

    const signIds = new Set(signs.map(s => s.sign_id));
    const hypotheses = (Array.isArray(sourceAxis.hypotheses_regroupement) ? sourceAxis.hypotheses_regroupement : []).map((h, i) => {
      const ids = [...new Set((Array.isArray(h?.sign_ids) ? h.sign_ids : []).map(String).filter(id => signIds.has(id)))];
      if (ids.length < 2) return null;
      return {
        hypothesis_id: String(h?.hypothesis_id || `${axis.axis_id}-H${i + 1}`).trim(),
        label: String(h?.label || '').trim(),
        interpretation: String(h?.interpretation || '').trim(),
        sign_ids: ids,
        ce_qui_invaliderait: String(h?.ce_qui_invaliderait || '').trim(),
        origin: 'proposition_ia'
      };
    }).filter(h => h?.label).slice(0, MAX_CLUSTER_HYPOTHESES_PER_AXIS);

    const sourcesToWatch = (Array.isArray(sourceAxis.sources_a_surveiller) ? sourceAxis.sources_a_surveiller : []).map((s, i) => {
      const ids = cleanIds(s?.material_ids, allowed, 4);
      if (!ids.length) return null;
      const sources = ids.map(id => results.find(r => r.result_id === id)).filter(Boolean).map(result => enrichSource(result, results));
      if (!sources.length) return null;
      return {
        source_watch_id: `${axis.axis_id}-SRC${i + 1}`,
        label: String(s?.label || '').trim(),
        raison: String(s?.raison || '').trim(),
        origin: 'corpus',
        material_ids: ids,
        sources
      };
    }).filter(s => s?.label).slice(0, 6);

    return {
      ...axis,
      object_generation_status: 'disponible',
      object_generation_error: false,
      tendances: trends,
      signes_a_guetter: signs,
      hypotheses_regroupement: hypotheses,
      sources_a_surveiller: sourcesToWatch,
      angles_morts: [...new Set((Array.isArray(sourceAxis.angles_morts) ? sourceAxis.angles_morts : []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 4)
    };
  }

  const resultAxes = [];
  const failedAxisIds = [];

  // Important : un appel LLM indépendant par axe.
  // Une panne sur un axe ne vide plus silencieusement tous les autres axes.
  for (const axis of selectedAxes) {
    const packet = packetByAxis.get(axis.axis_id) || { axis_id: axis.axis_id, materials: [] };
    const results = rawByAxis.get(axis.axis_id) || [];

    try {
      const raw = await callModel({
        apiKey,
        system,
        tool: WATCH_TOOL,
        userText: buildAxisPrompt(axis, packet),
        maxTokens: 2600
      });

      const returnedAxes = Array.isArray(raw?.axes) ? raw.axes : [];
      const sourceAxis = returnedAxes.find(item => String(item?.axis_id || '') === axis.axis_id);
      if (!sourceAxis) {
        const error = new Error(`Réponse structurée sans l'axe attendu ${axis.axis_id}.`);
        error.code = 'T06_MISSING_AXIS_RESULT';
        throw error;
      }

      resultAxes.push(normalizeGeneratedAxis(axis, sourceAxis, results));
    } catch (error) {
      failedAxisIds.push(axis.axis_id);
      console.error(`[T06] Échec génération objets axe ${axis.axis_id}:`, error?.message || error);
      resultAxes.push({
        ...axis,
        object_generation_status: 'indisponible',
        object_generation_error: true,
        object_generation_message: 'Les objets de veille n’ont pas pu être générés pour cet axe en raison d’une indisponibilité technique. Ce statut ne signifie pas que le corpus ne contient aucun élément pertinent.',
        tendances: [],
        signes_a_guetter: [],
        hypotheses_regroupement: [],
        sources_a_surveiller: [],
        angles_morts: []
      });
    }
  }

  return {
    ok: true,
    engine: 't06-watch-v1.0.3-source-traceability',
    need,
    axes: resultAxes,
    generation_available: failedAxisIds.length === 0,
    failed_axis_ids: failedAxisIds,
    methodological_reference: {
      label: 'ESPAS Horizon Scanning — communauté des veilleurs de l’Union européenne',
      url: 'https://espas.eu/horizon.html',
      origin: 'enrichissement_controle',
      usage: 'Repère méthodologique pour structurer l’observation continue des changements. Cette ressource n’est pas une preuve documentaire du scénario.'
    },
    guardrails: {
      weak_signal_claims_generated: false,
      trends_require_two_publications: true,
      watch_signs_are_hypotheses: true,
      final_step_should_be_deterministic: true,
      generation_isolated_per_axis: true,
      technical_failure_is_not_empty_corpus: true
    }
  };
}

module.exports = {
  MODEL_T06,
  cadrerBesoinT06,
  proposerStructurationsT06,
  documenterAxesT06,
  construireGrilleGuetT06,
  enrichSource,
  materialText,
  materialLabel,
  fallbackQuestions,
  fallbackStructurations,
  sanitizeStructurations,
  axisCoverageStatus,
  fallbackSubjectFromNeed,
  fallbackCorpusQuery
};
