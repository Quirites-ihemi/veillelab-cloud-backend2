// Tests de non-régression — troncature des réponses du chatbot (graphChat.js)
// Usage : node test_graph_chat_troncature.js [chemin/vers/graphChat.js]
// Aucun appel réseau : on teste uniquement le post-traitement (finalizeAnswer).
const path = require("path");
const assert = require("assert");
const target = path.resolve(process.argv[2] || "./graphChat.js");
const { finalizeAnswer } = require(target);

const graph = {
  publicationTitle: "Publication de test",
  nodes: [{ node_id: "N1", type_noeud: "notion_idee", libelle: "x", page_source: "1" }],
  relations: []
};
const run = (reponse, question, insuffisant = false, meta = {}) =>
  finalizeAnswer({ reponse, noeuds_selectionnes: ["N1"], relations_selectionnees: [], insuffisant }, graph, question, meta);

const results = [];
function test(name, fn) {
  try { fn(); results.push(["OK ", name]); }
  catch (e) { results.push(["ÉCHEC", `${name} — ${e.message}`]); }
}
const endsWithPunct = s => /[.!?…»)\]]$/.test(String(s).trim());

// 1. Cas réel PUB031 (18/11/2026) : une année suivie d'un point ne doit plus couper la phrase.
test("année suivie d'un point (« depuis 2016. »)", () => {
  const r = run(
    "Le graphe de cette publication ne contient pas d'information relative à une baisse de 15 % des violences intrafamiliales non conjugales depuis 2016. Il indique au contraire une hausse de 9 % entre 2023 et 2024.",
    "Pourquoi le rapport conclut-il que les violences ont baissé de 15 % depuis 2016 ?", true);
  assert.ok(r.reponse.includes("depuis 2016."), `réponse : ${r.reponse}`);
  assert.strictEqual(r.tronque, false);
});

// 2. Cas réel PUB010 : une réponse longue sans marqueurs ne doit plus être coupée en plein mot à 1200 caractères.
test("réponse longue (> 1200 caractères) non coupée en plein mot", () => {
  const long = "Le graphe retient 7 recommandations. " + Array.from({ length: 7 }, (_, i) =>
    `Recommandation ${i + 1} : structurer et animer au profit des collectivités un réseau technique alpin sur les risques naturels, réunissant expertises publiques et privées autour d'une stratégie d'action commune et partagée à l'échelle du massif alpin.`).join(" ");
  assert.ok(long.length > 1200);
  const r = run(long, "Combien de recommandations ? Liste-les toutes.");
  const body = r.reponse.split(" Provenance —")[0];
  assert.ok(body.includes("Recommandation 7"), "la 7e recommandation a disparu");
  assert.ok(endsWithPunct(body), `fin : …${body.slice(-60)}`);
  assert.strictEqual(r.tronque, false);
});

// 3. Une vraie liste numérotée en ligne est toujours découpée en éléments.
test("liste numérotée « 1. … 2. … » toujours reconnue", () => {
  const r = run("Le graphe mentionne deux acteurs : 1. Les préfets pilotent la démarche. 2. Les collectivités y participent.", "Quels acteurs ?");
  assert.strictEqual(r.sections.length, 1, JSON.stringify(r));
  assert.strictEqual(r.sections[0].items.length, 2);
});

// 4. Une page « p. 12. » n'est pas prise pour un numéro de liste.
test("référence de page « p. 12. » non découpée", () => {
  const r = run("Le rapport le précise p. 12. Il ajoute un second point.", "Que dit le rapport ?");
  assert.strictEqual(r.sections.length, 0, JSON.stringify(r.sections));
  assert.ok(r.reponse.includes("p. 12."));
});

// 5. Réponse structurée normale : inchangée, non signalée.
test("réponse structurée INTRO/SECTION/ITEM inchangée", () => {
  const r = run("INTRO: En 2024, 90 000 victimes ont été enregistrées (p. 1).\nSECTION: Chiffres\nITEM: Hausse de 9 % entre 2023 et 2024 (p. 1).", "Combien de victimes ?");
  assert.strictEqual(r.reponse, "En 2024, 90 000 victimes ont été enregistrées (p. 1).");
  assert.deepStrictEqual(r.sections, [{ titre: "Chiffres", items: ["Hausse de 9 % entre 2023 et 2024 (p. 1)."] }]);
  assert.strictEqual(r.tronque, false);
});

// 6. Réponse correcte se terminant par un chiffre : jamais signalée à tort.
test("réponse correcte sans point final : non signalée", () => {
  const r = run("INTRO: Le nombre de victimes enregistrées en 2024 est de 90 000", "Combien de victimes ?");
  assert.strictEqual(r.tronque, false);
});

// 7. Modèle interrompu (stop_reason max_tokens) : signalé.
test("stop_reason max_tokens → tronque = true", () => {
  const r = run("INTRO: Le graphe documente plusieurs mesures", "Quelles mesures ?", false, { stopReason: "max_tokens" });
  assert.strictEqual(r.tronque, true);
});

// 8. Plus de 6 éléments dans une section : la coupe est signalée (pas de liste incomplète présentée comme entière).
test("7 éléments dans une section → tronque = true", () => {
  const items = Array.from({ length: 7 }, (_, i) => `ITEM: Mesure ${i + 1} (p. ${i + 1}).`).join("\n");
  const r = run(`INTRO: Le graphe retient sept mesures (p. 8).\nSECTION: Mesures\n${items}`, "Liste les mesures.");
  assert.strictEqual(r.sections[0].items.length, 6);
  assert.strictEqual(r.tronque, true);
});

// 9. Styles volontairement courts (« en gros ») : raccourcis mais non signalés comme tronqués.
test("réponse volontairement courte (« en gros ») non signalée", () => {
  const r = run("INTRO: Le rapport porte sur la résilience (p. 8).\nSECTION: A\nITEM: Un (p. 1).\nITEM: Deux (p. 2).\nITEM: Trois (p. 3).", "En gros, de quoi parle le rapport ?");
  assert.strictEqual(r.tronque, false);
});

// 10. Question « priorité » sans preuve : barrière existante conservée.
test("barrière « ordre de priorité » conservée", () => {
  const r = run("INTRO: Il faut commencer par la recommandation 1 (p. 8).", "Par quoi faut-il commencer en priorité ?");
  assert.strictEqual(r.insuffisant, true);
  assert.ok(r.reponse.startsWith("Le graphe de cette publication ne permet pas d'établir un ordre de priorité"));
});

console.log(`Fichier testé : ${target}`);
for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(r => r[0] !== "OK ").length;
console.log(failed ? `\n${failed} test(s) en échec.` : "\nTous les tests passent.");
process.exitCode = failed ? 1 : 0;
