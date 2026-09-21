// =====================================================
// T06 — SONDE DE DIAGNOSTIC (à lancer dans le dossier du backend, en local)
//
//   node t06_probe.js            → tests de recherche seuls (aucun appel API)
//   ANTHROPIC_API_KEY=… node t06_probe.js --llm
//                                → rejoue aussi /scenario-dynamics V1 sur un axe
//                                  et compare les IDs renvoyés par Claude aux IDs autorisés
//
// Ne modifie rien. Écrit un rapport dans t06_probe_report.json.
// =====================================================
'use strict';
const fs = require('fs');
const { searchCorpus } = require('./globalSearch');

const OFFTOPIC = /alpes|climat|resilience|montagne|glacier/i;
const report = {};

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function probe(label, body) {
  let res;
  try { res = searchCorpus(body); } catch (e) { res = { error: String(e.message || e), results: [] }; }
  const results = Array.isArray(res?.results) ? res.results : [];
  const rows = results.map((r, i) => ({
    rang: i + 1,
    result_id: r.result_id,
    kind: r.kind,
    publication_id: r.publication_id,
    titre: String(r.publication_title || '').slice(0, 90),
    locator: r.locator || '',
    score: r.score ?? r._score ?? r.similarity ?? null,
    contient_pedo: /pedocrim|pedophil|mineur|enfant/.test(norm(`${r.text || ''} ${r.label || ''} ${r.publication_title || ''}`)),
    hors_sujet_suspect: OFFTOPIC.test(norm(r.publication_title))
  }));
  const kinds = rows.reduce((m, r) => { m[r.kind || '?'] = (m[r.kind || '?'] || 0) + 1; return m; }, {});
  report[label] = { body, engine: res?.engine, nb: rows.length, kinds, cles_premier_resultat: results[0] ? Object.keys(results[0]) : [], rows };
  const off = rows.filter(r => r.hors_sujet_suspect).map(r => `#${r.rang}`).join(',') || '—';
  const on = rows.filter(r => r.contient_pedo).length;
  console.log(`\n=== ${label}\n  requête : « ${body.query} » | ${rows.length} résultats | types ${JSON.stringify(kinds)}`);
  console.log(`  mention explicite du sujet : ${on}/${rows.length} | titres suspects (Alpes/climat) aux rangs : ${off}`);
  rows.slice(0, 8).forEach(r => console.log(`   ${String(r.rang).padStart(2)}. [${r.kind}] ${r.result_id} | ${r.publication_id} | ${r.titre}${r.score !== null ? ` | score ${r.score}` : ''}`));
}

const base = { limit: 18, max_per_publication: 4 };

// H1 — sensibilité aux accents (le front V0.4 envoie « pedocriminalite »)
probe('H1a sujet accentué', { ...base, query: 'pédocriminalité', diversify_by_publication: true });
probe('H1b sujet sans accents (V0.4)', { ...base, query: 'pedocriminalite', diversify_by_publication: true });

// H2 — dilution du sujet dans la requête d'axe (reconstitution de buildDynamicPackets V1)
probe('H2a requête axe V1 (fallback A3)', { ...base, diversify_by_publication: true,
  query: 'pedocriminalite pedocriminalite territoire commune Repérer les écarts et recompositions entre territoires.' });
probe('H2b requête axe V2 (sujet + termes)', { ...base, diversify_by_publication: false,
  query: 'pédocriminalité pedocriminalite territoire' });

// H3 — effet de la diversification forcée par publication
probe('H3a diversification ON', { ...base, query: 'pédocriminalité', diversify_by_publication: true });
probe('H3b diversification OFF', { ...base, query: 'pédocriminalité', diversify_by_publication: false });

async function replayV1() {
  const { construireGrilleGuetT06 } = require('./t06');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('\n(--llm ignoré : ANTHROPIC_API_KEY absente)'); return; }
  const captured = [];
  const callModel = async ({ system, tool, userText, maxTokens }) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system,
        tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: userText }] })
    });
    const j = await r.json();
    const tu = (j.content || []).find(b => b.type === 'tool_use');
    captured.push({ stop_reason: j.stop_reason, usage: j.usage, input: tu?.input, prompt_head: userText.slice(0, 1500) });
    return tu?.input;
  };
  const axis = { axis_id: 'A3', titre: 'Différenciations territoriales', objectif_surveillance: 'Repérer les écarts et recompositions entre territoires.',
    questions: ['Quels écarts territoriaux méritent une surveillance régulière ?'], requete_rag: 'pedocriminalite territoire commune' };
  const out = await construireGrilleGuetT06({ apiKey, besoin: 'Je veux faire une veille sur les évolutions de la pédocriminalité',
    cadrage: { sujet_central: 'pedocriminalite' }, axes: [axis], callModel });

  const raw = captured[0]?.input || {};
  const returnedAxis = (raw.axes || [])[0] || {};
  const ids = [];
  for (const k of ['tendances', 'signes_a_guetter', 'sources_a_surveiller']) for (const o of (returnedAxis[k] || [])) ids.push(...(o.material_ids || []));
  const allowed = [...(captured[0]?.prompt_head || '').matchAll(/^\d+\. ([^|]+) \|/gm)].map(m => m[1].trim());
  console.log('\n=== H4 — rejeu /scenario-dynamics V1');
  console.log(`  stop_reason : ${captured[0]?.stop_reason} | axis_id renvoyé : ${returnedAxis.axis_id}`);
  console.log(`  objets bruts : T=${(returnedAxis.tendances || []).length} S=${(returnedAxis.signes_a_guetter || []).length} Src=${(returnedAxis.sources_a_surveiller || []).length}`);
  console.log(`  objets après cleanIds : T=${out.axes[0].tendances.length} S=${out.axes[0].signes_a_guetter.length} Src=${out.axes[0].sources_a_surveiller.length} | statut ${out.axes[0].object_generation_status}`);
  console.log(`  IDs renvoyés : ${JSON.stringify([...new Set(ids)])}`);
  console.log(`  IDs attendus (extrait du prompt) : ${JSON.stringify(allowed.slice(0, 6))}…`);
  report.H4 = { captured, normalized: out.axes[0] };
}

(async () => {
  if (process.argv.includes('--llm')) await replayV1();
  fs.writeFileSync('t06_probe_report.json', JSON.stringify(report, null, 2));
  console.log('\nRapport complet : t06_probe_report.json');
})();
