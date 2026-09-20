// =====================================================
// QUIRITES VEILLE LAB — T06 SCÉNARIO DE VEILLE
// V0.3 : synthèse documentaire multi-niveaux.
// Le corpus fournit les preuves ; l'IA monte en généralité sans sortir des sources.
// =====================================================

const { searchCorpus } = require('./globalSearch');

const MODEL_T06 = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const T06_MAX_CANDIDATES = 56;
const T06_MAX_NOTIONS = 4;
const T06_MAX_AXES = 5;
const T06_MAX_TRENDS_PER_AXIS = 3;
const T06_MAX_SIGNS_PER_AXIS = 4;
const T06_MAX_WEAK_PER_AXIS = 2;
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

function clip(value, max = 680) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

async function appelerClaudeAvecOutil({ apiKey, system, tool, userText, maxTokens = 3200 }) {
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

const NEED_ANALYSIS_TOOL = {
  name: 'analyser_besoin_t06',
  description: "Décompose le besoin sans le reformuler pour identifier le sujet central et les dimensions secondaires.",
  input_schema: {
    type: 'object',
    properties: {
      sujet_central: { type: 'string' },
      requete_recherche: { type: 'string' },
      dimensions: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['echelle', 'territoire', 'temporalite', 'public', 'finalite', 'angle', 'autre'] },
            valeur: { type: 'string' },
            role: { type: 'string', enum: ['secondaire', 'contrainte', 'intention'] }
          },
          required: ['type', 'valeur', 'role'], additionalProperties: false
        }
      }
    },
    required: ['sujet_central', 'requete_recherche', 'dimensions'], additionalProperties: false
  }
};

const FRAME_SYNTHESIS_TOOL = {
  name: 'synthetiser_cadrage_t06',
  description: 'Fait émerger 0 à 4 notions de cadrage à partir de plusieurs matériaux du corpus.',
  input_schema: {
    type: 'object',
    properties: {
      notions: {
        type: 'array', maxItems: T06_MAX_NOTIONS,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            dimension_eclairee: { type: 'string' },
            pourquoi: { type: 'string' },
            limite: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } }
          },
          required: ['label', 'dimension_eclairee', 'pourquoi', 'limite', 'material_ids'], additionalProperties: false
        }
      },
      limites_couverture: { type: 'array', maxItems: 4, items: { type: 'string' } }
    },
    required: ['notions', 'limites_couverture'], additionalProperties: false
  }
};

const FRAME_AUDIT_TOOL = {
  name: 'auditer_cadrage_t06',
  description: 'Vérifie le soutien documentaire des notions sans imposer un rejet excessif.',
  input_schema: {
    type: 'object',
    properties: {
      notions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            pourquoi: { type: 'string' },
            limite: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
            statut: { type: 'string', enum: ['solide', 'partiel', 'rejeter'] }
          },
          required: ['label', 'pourquoi', 'limite', 'material_ids', 'statut'], additionalProperties: false
        }
      }
    },
    required: ['notions'], additionalProperties: false
  }
};

const AXES_SYNTHESIS_TOOL = {
  name: 'synthetiser_axes_t06',
  description: 'Propose 2 à 5 axes de veille à un niveau de généralité supérieur aux sources.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array', maxItems: T06_MAX_AXES,
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            objectif_surveillance: { type: 'string' },
            pourquoi: { type: 'string' },
            questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
            limite: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } }
          },
          required: ['titre', 'objectif_surveillance', 'pourquoi', 'questions', 'limite', 'material_ids'], additionalProperties: false
        }
      },
      limites_couverture: { type: 'array', maxItems: 4, items: { type: 'string' } }
    },
    required: ['axes', 'limites_couverture'], additionalProperties: false
  }
};

const AXES_AUDIT_TOOL = {
  name: 'auditer_axes_t06',
  description: 'Vérifie qu’un axe est bien un axe de veille et non un simple libellé de source.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            objectif_surveillance: { type: 'string' },
            pourquoi: { type: 'string' },
            questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
            limite: { type: 'string' },
            material_ids: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
            statut: { type: 'string', enum: ['solide', 'partiel', 'rejeter'] }
          },
          required: ['titre', 'objectif_surveillance', 'pourquoi', 'questions', 'limite', 'material_ids', 'statut'], additionalProperties: false
        }
      }
    },
    required: ['axes'], additionalProperties: false
  }
};

const DYNAMICS_SYNTHESIS_TOOL = {
  name: 'synthetiser_dynamiques_t06',
  description: 'Synthétise tendances et signes de changement pour chaque axe à partir des seuls matériaux fournis.',
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
              type: 'array', maxItems: T06_MAX_TRENDS_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  interpretation: { type: 'string' },
                  pourquoi: { type: 'string' },
                  limite: { type: 'string' },
                  material_ids: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } }
                },
                required: ['label', 'interpretation', 'pourquoi', 'limite', 'material_ids'], additionalProperties: false
              }
            },
            signes_changement: {
              type: 'array', maxItems: T06_MAX_SIGNS_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  interpretation: { type: 'string' },
                  pourquoi: { type: 'string' },
                  limite: { type: 'string' },
                  material_ids: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } }
                },
                required: ['label', 'interpretation', 'pourquoi', 'limite', 'material_ids'], additionalProperties: false
              }
            },
            limites_couverture: { type: 'array', maxItems: 3, items: { type: 'string' } }
          },
          required: ['axis_id', 'tendances', 'signes_changement', 'limites_couverture'], additionalProperties: false
        }
      }
    },
    required: ['axes'], additionalProperties: false
  }
};

const WEAK_CLUSTER_TOOL = {
  name: 'clusteriser_signaux_faibles_t06',
  description: 'Regroupe au moins deux signes de changement convergents en un signal faible, sans inventer de contenu.',
  input_schema: {
    type: 'object',
    properties: {
      axes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            axis_id: { type: 'string' },
            signaux_faibles: {
              type: 'array', maxItems: T06_MAX_WEAK_PER_AXIS,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  interpretation: { type: 'string' },
                  pourquoi: { type: 'string' },
                  limite: { type: 'string' },
                  sign_ids: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } }
                },
                required: ['label', 'interpretation', 'pourquoi', 'limite', 'sign_ids'], additionalProperties: false
              }
            }
          },
          required: ['axis_id', 'signaux_faibles'], additionalProperties: false
        }
      }
    },
    required: ['axes'], additionalProperties: false
  }
};

function materialText(result = {}) {
  if (result.kind === 'chunk') return clip(result.text, 860);
  if (result.kind === 'node') return clip(result.label, 420);
  if (result.kind === 'relation') return clip(`${result.source_label || ''} — ${result.relation_type || ''} — ${result.target_label || ''}`, 520);
  return '';
}

function materialLabel(result = {}) {
  if (result.kind === 'node') return result.label || result.node_id || result.result_id;
  if (result.kind === 'chunk') return result.section || clip(result.text, 140) || result.chunk_id || result.result_id;
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

function mergeSearchResults(searches = []) {
  const byId = new Map();
  for (const search of searches) {
    const query = String(search?.query || '').trim();
    const results = Array.isArray(search?.response?.results) ? search.response.results : [];
    for (const result of results) {
      const id = String(result?.result_id || '').trim();
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, { ...result, _t06_queries: [] });
      const current = byId.get(id);
      if (query && !current._t06_queries.includes(query)) current._t06_queries.push(query);
      if (Number(result.score || 0) > Number(current.score || 0)) current.score = result.score;
    }
  }
  return [...byId.values()];
}

function buildCandidatePacket(results = [], max = T06_MAX_CANDIDATES) {
  return results.slice(0, max).map(result => ({
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
    score: Number(result.score || 0),
    retrieved_by: Array.isArray(result._t06_queries) ? result._t06_queries.slice(0, 5) : []
  }));
}

function formatCandidatesForPrompt(candidates = []) {
  return candidates.map((m, index) => [
    `MATÉRIAU ${index + 1} — ${m.material_id}`,
    `Type: ${m.kind}${m.node_type ? ` / ${m.node_type}` : ''}${m.relation_type ? ` / ${m.relation_type}` : ''}`,
    `Publication: ${m.publication_id} — ${m.publication_title}`,
    `Organisme/année/repère: ${m.organisme_producteur || '—'} | ${m.annee_publication || '—'} | ${m.locator || '—'}`,
    m.retrieved_by?.length ? `Repéré via: ${m.retrieved_by.join(' | ')}` : '',
    `Contenu: ${m.texte || m.label}`
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');
}

function enrichSource(result = {}) {
  return {
    material_id: result.result_id || '', kind: result.kind || '',
    publication_id: result.publication_id || '', titre: result.publication_title || '',
    organisme_producteur: result.organisme_producteur || '', annee_publication: result.annee_publication || '',
    type_document: result.type_document || '', repere: result.locator || '',
    provenance_level: result.provenance_level || '', url: result.url_contenu || result.url_source || '',
    extrait: materialText(result), libelle: materialLabel(result)
  };
}

function sanitizeNeedAnalysis(raw = {}, need = '') {
  const sujet = String(raw.sujet_central || '').trim();
  const query = String(raw.requete_recherche || sujet || need).trim();
  const dimensions = (Array.isArray(raw.dimensions) ? raw.dimensions : []).map(d => ({
    type: ['echelle','territoire','temporalite','public','finalite','angle','autre'].includes(d?.type) ? d.type : 'autre',
    valeur: String(d?.valeur || '').trim(),
    role: ['secondaire','contrainte','intention'].includes(d?.role) ? d.role : 'secondaire'
  })).filter(d => d.valeur).slice(0, 8);
  return { sujet_central: sujet || query, requete_recherche: query, dimensions };
}

function compactDimensionValue(dimension = {}) {
  const raw = String(dimension?.valeur || '').trim();
  if (!raw) return '';
  const n = normalize(raw);
  if (dimension.type === 'echelle') {
    if (/commun|municip/.test(n)) return 'commune';
    if (/departement/.test(n)) return 'département';
    if (/region/.test(n)) return 'région';
  }
  if (dimension.type === 'territoire' && /francilien|ile de france/.test(n)) return 'Île-de-France';
  if (dimension.type === 'temporalite' && /evolu|tendance|avenir|prospect/.test(n)) return 'évolution';
  return clip(raw, 72);
}

function buildRetrievalQueries(analyse = {}, extras = []) {
  const base = String(analyse.requete_recherche || analyse.sujet_central || '').trim();
  if (!base) return [];
  const queries = [base];
  const priority = ['echelle','territoire','temporalite','angle','public'];
  for (const type of priority) {
    const d = (analyse.dimensions || []).find(x => x.type === type && String(x.valeur || '').trim());
    if (!d) continue;
    const v = compactDimensionValue(d);
    const q = `${base} ${v}`.replace(/\s+/g, ' ').trim();
    if (q && !queries.some(x => normalize(x) === normalize(q))) queries.push(q);
    if (queries.length >= 4) break;
  }
  for (const extra of extras) {
    const v = String(extra || '').trim();
    if (!v) continue;
    const q = `${base} ${v}`.replace(/\s+/g, ' ').trim();
    if (!queries.some(x => normalize(x) === normalize(q))) queries.push(q);
    if (queries.length >= 6) break;
  }
  return queries.slice(0, 6);
}

function collectCandidates(searchFn, queries, { maxPerQuery = 24, kinds = null, max = T06_MAX_CANDIDATES } = {}) {
  const searches = [];
  for (const query of queries) {
    const body = { query, limit: maxPerQuery, max_per_publication: 4, diversify_by_publication: true };
    if (Array.isArray(kinds) && kinds.length) body.kinds = kinds;
    searches.push({ query, response: searchFn(body) });
  }
  const rawResults = dedupeResults(mergeSearchResults(searches));
  rawResults.sort((a, b) => {
    const q = (b._t06_queries?.length || 0) - (a._t06_queries?.length || 0);
    if (q) return q;
    return Number(b.score || 0) - Number(a.score || 0);
  });
  return { searches, rawResults, candidates: buildCandidatePacket(rawResults, max) };
}

function cleanIds(ids, allowed, max = 6) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(id => allowed.has(id)))].slice(0, max);
}

async function analyserBesoin({ apiKey, besoin, callModel = appelerClaudeAvecOutil }) {
  const system = `
Tu analyses un besoin de veille uniquement pour préparer une recherche documentaire.
Tu NE REFORMULES PAS le besoin et tu ne produis aucun conseil.
Identifie le sujet central et distingue les dimensions secondaires (échelle, territoire, temporalité, public, finalité, angle).
La requête de recherche doit être courte (2 à 8 mots) et centrée sur le sujet ; les dimensions secondaires ne doivent jamais devenir bloquantes.
Ne complète rien par connaissance extérieure.`;
  const raw = await callModel({ apiKey, system, tool: NEED_ANALYSIS_TOOL, userText: besoin, maxTokens: 1200 });
  return sanitizeNeedAnalysis(raw, besoin);
}

async function proposerNotionsT06({ apiKey, besoin = '', searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e = new Error('Le besoin de veille est obligatoire.'); e.statusCode = 400; throw e; }
  const analyse = await analyserBesoin({ apiKey, besoin: need, callModel });
  const queries = buildRetrievalQueries(analyse);
  const { searches, rawResults, candidates } = collectCandidates(searchFn, queries, { max: 52 });
  const candidateMap = new Map(candidates.map(c => [c.material_id, c]));
  const rawMap = new Map(rawResults.map(r => [r.result_id, r]));
  if (!candidates.length) return { ok:true, engine:'t06-framing-v0.3-grounded-synthesis', need, analysis:analyse, retrieval:{queries,candidates:0,publications:0}, notions:[], limites_couverture:['Aucun matériau suffisamment pertinent n’a été retrouvé pour ce sujet dans cette recherche.'] };

  const system = `
Tu aides un veilleur à préciser son besoin en montant UN NIVEAU au-dessus des sources, sans jamais sortir du corpus.
À partir des matériaux fournis, fais émerger 2 à 4 notions de cadrage si elles sont soutenues. Une notion peut synthétiser plusieurs matériaux et son libellé n'a pas besoin d'exister mot pour mot.

Une bonne notion :
- structure le besoin (mesure du phénomène, échelle d'observation, disparités territoriales, temporalité, gouvernance) ;
- est plus générale qu'un extrait ou qu'un dispositif ponctuel ;
- reste fidèle aux matériaux cités ;
- explique précisément POURQUOI elle aide le besoin ;
- indique une LIMITE concrète.

Rejette : sous-thèmes étroits non demandés, simple proximité lexicale, acteur ou dispositif ponctuel déguisé en notion, contenu hors sujet.
Ne t'abstiens pas seulement parce que les sources sont imparfaites : une notion partiellement couverte peut être proposée si la limite est clairement dite.
Les dimensions secondaires du besoin (territoire, échelle, temporalité) servent à qualifier les limites et priorités, pas à bloquer la synthèse.
N'utilise aucune connaissance extérieure et seulement les material_ids fournis.`;

  const dimensions = (analyse.dimensions || []).map(d => `${d.type}: ${d.valeur}`).join(' ; ') || 'aucune';
  const raw = await callModel({ apiKey, system, tool: FRAME_SYNTHESIS_TOOL, userText:`BESOIN : ${need}\nSUJET CENTRAL : ${analyse.sujet_central}\nDIMENSIONS : ${dimensions}\n\n${formatCandidatesForPrompt(candidates)}`, maxTokens:3400 });
  const allowed = new Set(candidates.map(c => c.material_id));
  const proposed = (Array.isArray(raw.notions) ? raw.notions : []).map(n => ({
    label:String(n?.label||'').trim(), dimension_eclairee:String(n?.dimension_eclairee||'').trim(),
    pourquoi:String(n?.pourquoi||'').trim(), limite:String(n?.limite||'').trim(), material_ids:cleanIds(n?.material_ids, allowed, 5)
  })).filter(n => n.label && n.material_ids.length).slice(0,T06_MAX_NOTIONS);

  let audited = proposed;
  if (proposed.length) {
    const auditPacket = proposed.map((n,i)=>[`NOTION ${i+1}: ${n.label}`,`Pourquoi: ${n.pourquoi}`,`Limite: ${n.limite}`,`Matériaux: ${n.material_ids.join(', ')}`,n.material_ids.map(id=>{const m=candidateMap.get(id);return `${id}: ${m?.texte||m?.label||''}`}).join('\n')].join('\n')).join('\n\n---\n\n');
    const auditSystem = `
Tu contrôles une synthèse documentaire. Le but n'est PAS de tout rejeter : distingue solide, partiel et rejet.
- solide : notion clairement soutenue et utile au cadrage ;
- partiel : utile et soutenue, mais couverture incomplète ; elle DOIT être conservée avec une limite explicite ;
- rejeter : hors sujet, simple rapprochement lexical, sous-thème trop étroit ou généralisation non soutenue.
Tu peux améliorer pourquoi/limite, sans ajouter de connaissance extérieure. Ne change pas les material_ids.`;
    const auditRaw = await callModel({ apiKey, system:auditSystem, tool:FRAME_AUDIT_TOOL, userText:`BESOIN : ${need}\n\n${auditPacket}`, maxTokens:2600 });
    const byLabel = new Map(proposed.map(n=>[normalize(n.label),n]));
    audited = (Array.isArray(auditRaw.notions)?auditRaw.notions:[]).filter(n=>n?.statut!=='rejeter').map(n=>{
      const original = byLabel.get(normalize(n.label)) || proposed.find(p=>p.material_ids.some(id=>(n.material_ids||[]).includes(id)));
      if(!original) return null;
      return {...original, label:String(n.label||original.label).trim(), pourquoi:String(n.pourquoi||original.pourquoi).trim(), limite:String(n.limite||original.limite).trim(), statut:n.statut||'partiel'};
    }).filter(Boolean).slice(0,T06_MAX_NOTIONS);
  }

  const notions = audited.map((n,i)=>({
    notion_id:`T06N${String(i+1).padStart(2,'0')}`, label:n.label, dimension_eclairee:n.dimension_eclairee,
    pourquoi:n.pourquoi, limite:n.limite, statut:n.statut||'solide',
    sources:n.material_ids.map(id=>rawMap.get(id)).filter(Boolean).map(enrichSource)
  })).filter(n=>n.sources.length);
  const pubs = new Set(rawResults.map(r=>r.publication_id).filter(Boolean));
  return { ok:true, engine:'t06-framing-v0.3-grounded-synthesis', need, analysis:analyse, retrieval:{queries,candidates:candidates.length,publications:pubs.size,source_engine:searches.find(s=>s.response?.engine)?.response?.engine||'corpus-search'}, notions, limites_couverture:[...new Set((raw.limites_couverture||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,4) };
}

async function proposerAxesT06({ apiKey, besoin = '', notions = [], searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need = String(besoin || '').trim();
  if (!need) { const e=new Error('Le besoin de veille est obligatoire.'); e.statusCode=400; throw e; }
  const analyse = await analyserBesoin({ apiKey, besoin:need, callModel });
  const notionLabels = (Array.isArray(notions)?notions:[]).map(n=>String(n?.label||n||'').trim()).filter(Boolean).slice(0,4);
  const queries = buildRetrievalQueries(analyse, notionLabels);
  const { rawResults, candidates } = collectCandidates(searchFn, queries, { max:54 });
  const rawMap = new Map(rawResults.map(r=>[r.result_id,r]));
  const allowed = new Set(candidates.map(c=>c.material_id));
  if(!candidates.length) return {ok:true,engine:'t06-axes-v0.1-synthesized',need,axes:[],limites_couverture:['Le corpus ne fournit pas assez de matériaux pour proposer des axes de veille robustes.']};

  const system = `
Tu construis des AXES DE VEILLE à partir d'un besoin et de matériaux documentaires.
Tu dois monter en généralité par rapport aux sources : un axe est une direction de surveillance dans le temps, pas un titre de publication, un acteur isolé, un dispositif ponctuel ni un extrait.
Propose 2 à 5 axes maximum. Chaque axe doit :
- être directement relié au besoin ;
- regrouper plusieurs matériaux lorsque possible ;
- dire ce qu'il faut SURVEILLER ;
- proposer 1 à 3 questions de veille concrètes ;
- expliciter pourquoi cet axe est utile et sa limite ;
- citer uniquement les material_ids fournis.
Exemples de forme attendue (uniquement si les sources les soutiennent) : « Différenciation territoriale de la délinquance enregistrée », « Évolution des réponses locales de prévention ».
Évite les axes vagues (« acteurs », « dispositifs ») ou trop proches d'un seul libellé source. Aucune connaissance extérieure.`;
  const raw = await callModel({apiKey,system,tool:AXES_SYNTHESIS_TOOL,userText:`BESOIN : ${need}\nNOTIONS RETENUES : ${notionLabels.join(' ; ')||'aucune'}\n\n${formatCandidatesForPrompt(candidates)}`,maxTokens:4200});
  const proposed = (Array.isArray(raw.axes)?raw.axes:[]).map(a=>({
    titre:String(a?.titre||'').trim(), objectif_surveillance:String(a?.objectif_surveillance||'').trim(), pourquoi:String(a?.pourquoi||'').trim(),
    questions:[...new Set((a?.questions||[]).map(q=>String(q||'').trim()).filter(Boolean))].slice(0,3), limite:String(a?.limite||'').trim(), material_ids:cleanIds(a?.material_ids,allowed,6)
  })).filter(a=>a.titre&&a.questions.length&&a.material_ids.length).slice(0,T06_MAX_AXES);

  let audited=proposed;
  if(proposed.length){
    const packet=proposed.map((a,i)=>[`AXE ${i+1}: ${a.titre}`,`Objectif: ${a.objectif_surveillance}`,`Pourquoi: ${a.pourquoi}`,`Questions: ${a.questions.join(' | ')}`,`Limite: ${a.limite}`,`Matériaux: ${a.material_ids.join(', ')}`].join('\n')).join('\n\n---\n\n');
    const auditSystem=`
Audite des axes de veille. Ne cherche pas la perfection : conserve comme « partiel » un axe utile mais incomplètement couvert, à condition que sa limite soit explicite.
Rejette seulement s'il s'agit d'un simple extrait/libellé de source, d'un élément hors sujet, d'un sous-thème trop étroit ou d'une généralisation non soutenue.
Un bon axe doit être formulé à un niveau supérieur aux sources et être surveillable dans le temps. N'ajoute aucune connaissance extérieure.`;
    const ar=await callModel({apiKey,system:auditSystem,tool:AXES_AUDIT_TOOL,userText:`BESOIN : ${need}\n\n${packet}`,maxTokens:3000});
    const byTitle=new Map(proposed.map(a=>[normalize(a.titre),a]));
    audited=(Array.isArray(ar.axes)?ar.axes:[]).filter(a=>a?.statut!=='rejeter').map(a=>{
      const original=byTitle.get(normalize(a.titre))||proposed.find(p=>p.material_ids.some(id=>(a.material_ids||[]).includes(id)));
      if(!original)return null;
      return {...original,titre:String(a.titre||original.titre).trim(),objectif_surveillance:String(a.objectif_surveillance||original.objectif_surveillance).trim(),pourquoi:String(a.pourquoi||original.pourquoi).trim(),questions:(a.questions||original.questions).map(String).filter(Boolean).slice(0,3),limite:String(a.limite||original.limite).trim(),statut:a.statut||'partiel'};
    }).filter(Boolean).slice(0,T06_MAX_AXES);
  }
  const axes=audited.map((a,i)=>({axis_id:`T06A${String(i+1).padStart(2,'0')}`,titre:a.titre,objectif_surveillance:a.objectif_surveillance,pourquoi:a.pourquoi,questions:a.questions,limite:a.limite,statut:a.statut||'solide',sources:a.material_ids.map(id=>rawMap.get(id)).filter(Boolean).map(enrichSource)})).filter(a=>a.sources.length);
  return {ok:true,engine:'t06-axes-v0.1-synthesized',need,axes,limites_couverture:[...new Set((raw.limites_couverture||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,4)};
}

async function proposerDynamiquesT06({ apiKey, besoin = '', axes = [], searchFn = searchCorpus, callModel = appelerClaudeAvecOutil }) {
  const need=String(besoin||'').trim();
  const selectedAxes=(Array.isArray(axes)?axes:[]).map((a,i)=>({axis_id:String(a?.axis_id||`T06A${String(i+1).padStart(2,'0')}`),titre:String(a?.titre||a?.title||'').trim(),objectif_surveillance:String(a?.objectif_surveillance||'').trim()})).filter(a=>a.titre).slice(0,T06_MAX_AXES);
  if(!need||!selectedAxes.length){const e=new Error('Le besoin et au moins un axe de veille sont obligatoires.');e.statusCode=400;throw e;}
  const analyse=await analyserBesoin({apiKey,besoin:need,callModel});

  const rawMaps=new Map();
  const candidatesByAxis=new Map();
  for(const axis of selectedAxes){
    const queries=[`${analyse.sujet_central} ${axis.titre}`.trim(),axis.titre].filter(Boolean);
    const {rawResults,candidates}=collectCandidates(searchFn,queries,{maxPerQuery:24,max:32});
    rawMaps.set(axis.axis_id,new Map(rawResults.map(r=>[r.result_id,r])));
    candidatesByAxis.set(axis.axis_id,candidates);
  }
  const promptSections=selectedAxes.map(axis=>{
    const c=candidatesByAxis.get(axis.axis_id)||[];
    return `### AXE ${axis.axis_id} — ${axis.titre}\nObjectif : ${axis.objectif_surveillance||'—'}\n\n${formatCandidatesForPrompt(c)}`;
  }).join('\n\n====================\n\n');

  const system=`
Tu analyses les dynamiques d'un sujet de veille à partir d'un corpus, en montant en généralité sans perdre l'ancrage documentaire.
Pour chaque axe fourni, distingue :
1) TENDANCE : évolution structurante ou durable. Elle doit être soutenue par plusieurs matériaux convergents ; privilégie plusieurs publications. Si le corpus ne suffit pas, n'en propose pas.
2) SIGNE DE CHANGEMENT : indice récent ou évolution notable pouvant annoncer une inflexion. Il peut être plus ponctuel qu'une tendance, mais doit être explicitement observable dans les matériaux.

Ne transforme jamais : un titre de section, une méthode, un simple acteur, une table ronde, une recommandation ou une donnée isolée sans dynamique en tendance/signe.
Chaque proposition doit être une SYNTHÈSE à un niveau supérieur aux sources, avec une interprétation concise, un « pourquoi » et une limite.
Le besoin et les axes sont les filtres de pertinence. N'utilise aucune connaissance extérieure. Ne cite que les material_ids fournis pour l'axe concerné.
Si une catégorie n'est pas suffisamment étayée, retourne un tableau vide.`;
  const raw=await callModel({apiKey,system,tool:DYNAMICS_SYNTHESIS_TOOL,userText:`BESOIN : ${need}\n\n${promptSections}`,maxTokens:5200});

  const axisResults=[];
  for(const axis of selectedAxes){
    const sourceAxis=(Array.isArray(raw.axes)?raw.axes:[]).find(a=>String(a?.axis_id)===axis.axis_id)||{};
    const candidates=candidatesByAxis.get(axis.axis_id)||[];
    const allowed=new Set(candidates.map(c=>c.material_id));
    const rawMap=rawMaps.get(axis.axis_id)||new Map();
    const trends=(Array.isArray(sourceAxis.tendances)?sourceAxis.tendances:[]).map((t,i)=>({
      trend_id:`${axis.axis_id}-T${i+1}`,label:String(t?.label||'').trim(),interpretation:String(t?.interpretation||'').trim(),pourquoi:String(t?.pourquoi||'').trim(),limite:String(t?.limite||'').trim(),material_ids:cleanIds(t?.material_ids,allowed,6)
    })).filter(t=>t.label&&t.material_ids.length>=2).slice(0,T06_MAX_TRENDS_PER_AXIS);
    const signs=(Array.isArray(sourceAxis.signes_changement)?sourceAxis.signes_changement:[]).map((s,i)=>({
      sign_id:`${axis.axis_id}-S${i+1}`,label:String(s?.label||'').trim(),interpretation:String(s?.interpretation||'').trim(),pourquoi:String(s?.pourquoi||'').trim(),limite:String(s?.limite||'').trim(),material_ids:cleanIds(s?.material_ids,allowed,5)
    })).filter(s=>s.label&&s.material_ids.length).slice(0,T06_MAX_SIGNS_PER_AXIS);
    axisResults.push({axis_id:axis.axis_id,titre:axis.titre,tendances:trends.map(t=>({...t,sources:t.material_ids.map(id=>rawMap.get(id)).filter(Boolean).map(enrichSource)})),signes_changement:signs.map(s=>({...s,sources:s.material_ids.map(id=>rawMap.get(id)).filter(Boolean).map(enrichSource)})),limites_couverture:[...new Set((sourceAxis.limites_couverture||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,3)});
  }

  // Les signaux faibles sont explicitement des clusters de >=2 signes de changement.
  const clusterInput=axisResults.map(a=>({axis_id:a.axis_id,titre:a.titre,signes:a.signes_changement.map(s=>({sign_id:s.sign_id,label:s.label,interpretation:s.interpretation,pourquoi:s.pourquoi,limite:s.limite,source_count:s.sources.length}))})).filter(a=>a.signes.length>=2);
  let clusters={axes:[]};
  if(clusterInput.length){
    const clusterSystem=`
Tu appliques une définition stricte : un SIGNAL FAIBLE est ici un regroupement (cluster) d'au moins deux signes de changement convergents.
Tu ne crées aucun signal faible à partir d'un seul signe. Tu n'ajoutes aucune information extérieure.
Le signal faible doit exprimer la dynamique commune qui devient visible lorsqu'on rapproche les signes, sans prétendre qu'elle est certaine.
Le champ limite doit rappeler l'incertitude et ce qui manque pour confirmer la dynamique. Si aucun cluster cohérent n'existe, retourne zéro signal faible.`;
    clusters=await callModel({apiKey,system:clusterSystem,tool:WEAK_CLUSTER_TOOL,userText:`BESOIN : ${need}\n\n${JSON.stringify(clusterInput,null,2)}`,maxTokens:2800});
  }
  for(const axisResult of axisResults){
    const signsById=new Map(axisResult.signes_changement.map(s=>[s.sign_id,s]));
    const rawClusters=(Array.isArray(clusters.axes)?clusters.axes:[]).find(a=>String(a?.axis_id)===axisResult.axis_id)?.signaux_faibles||[];
    axisResult.signaux_faibles=rawClusters.map((w,i)=>{
      const signIds=[...new Set((w?.sign_ids||[]).map(String).filter(id=>signsById.has(id)))];
      if(signIds.length<2)return null;
      const sources=[];const seen=new Set();
      for(const sid of signIds){for(const src of signsById.get(sid)?.sources||[]){const key=`${src.material_id}|${src.publication_id}`;if(!seen.has(key)){seen.add(key);sources.push(src)}}}
      return {weak_id:`${axisResult.axis_id}-W${i+1}`,label:String(w?.label||'').trim(),interpretation:String(w?.interpretation||'').trim(),pourquoi:String(w?.pourquoi||'').trim(),limite:String(w?.limite||'').trim(),based_on_sign_ids:signIds,sources};
    }).filter(w=>w?.label).slice(0,T06_MAX_WEAK_PER_AXIS);
  }

  return {ok:true,engine:'t06-dynamics-v0.1-synthesized',need,axes:axisResults,methodological_reference:{label:'ESPAS Horizon Scanning — communauté des veilleurs de l’Union européenne',url:'https://espas.eu/horizon.html',origin:'enrichissement_controle',usage:'Repère méthodologique pour questionner tendances, signes de changement et signaux faibles ; il ne constitue pas une preuve documentaire du scénario.'}};
}

module.exports={
  MODEL_T06,
  proposerNotionsT06,
  proposerAxesT06,
  proposerDynamiquesT06,
  analyserBesoin,
  sanitizeNeedAnalysis,
  buildRetrievalQueries,
  mergeSearchResults,
  dedupeResults,
  buildCandidatePacket,
  enrichSource
};
