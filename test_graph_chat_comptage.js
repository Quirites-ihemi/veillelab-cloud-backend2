// Tests du correctif de comptage (inventaire déterministe) — graphChat.js
// Usage : node test_graph_chat_comptage.js [chemin/vers/graphChat.js] [dossier contenant nodes.json et publications.json]
// Aucun appel au modèle : le test échoue si le modèle est appelé pour une question d'inventaire.
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const target = path.resolve(process.argv[2] || "./graphChat.js");
const dataDir = path.resolve(process.argv[3] || "./corpus");
const { detectInventoryRequest, buildInventoryAnswer, createGraphChatHandler } = require(target);

const nodesAll = JSON.parse(fs.readFileSync(path.join(dataDir, "nodes.json"), "utf8"));
const graphOf = pid => ({
  publicationId: pid,
  publicationTitle: pid,
  nodes: nodesAll.filter(n => n.publication_id === pid).map(n => ({
    node_id: n.node_id, type_noeud: n.type_noeud, libelle: n.libelle, page_source: n.page_source
  })),
  relations: []
});

const results = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => results.push(["OK ", name]))
    .catch(e => results.push(["ÉCHEC", `${name} — ${e.message}`]));
}
const key = q => detectInventoryRequest(q)?.key || null;

(async () => {
  // 1. Détection : questions d'inventaire reconnues
  await test("détection : questions de comptage / liste complète", () => {
    const cases = {
      "Combien de recommandations formule ce rapport ? Liste-les toutes avec leur numéro.": "recommandation",
      "Combien de recommandations ?": "recommandation",
      "Liste toutes les recommandations": "recommandation",
      "Quelles recommandations sont formulées ?": "recommandation",
      "Quels acteurs sont mentionnés ?": "acteur",
      "Quels sont les acteurs ?": "acteur",
      "Combien d'acteurs sont cités ?": "acteur",
      "Combien de problèmes sont identifiés ?": "probleme",
      "Liste tous les lieux": "localisation"
    };
    for (const [q, expected] of Object.entries(cases)) assert.strictEqual(key(q), expected, q);
  });

  // 2. Détection : questions qui restent traitées par le modèle
  await test("détection : questions qui filtrent ou qualifient → modèle", () => {
    const cases = [
      "Combien de victimes en 2024 ?",
      "Quels sont les principaux problèmes identifiés ?",
      "Quelles recommandations répondent au problème du risque torrentiel ?",
      "Quelles recommandations concernent les préfets ?",
      "Qui doit mettre en œuvre les recommandations ?",
      "Par quoi faut-il commencer en priorité parmi les recommandations ?",
      "Pourquoi le rapport formule-t-il ces recommandations ?",
      "Quels liens relient les éléments importants ?",
      "Que dit le rapport sur la résilience ?"
    ];
    for (const q of cases) assert.strictEqual(key(q), null, q);
  });

  // 3. PUB010 : 7 recommandations dans le graphe → annonce 7, restitue les 7
  await test("PUB010 : annonce 7 et restitue les 7 recommandations du graphe", () => {
    const g = graphOf("PUB010");
    const expected = g.nodes.filter(n => n.type_noeud === "recommandation");
    assert.strictEqual(expected.length, 7, "le graphe de test devrait contenir 7 recommandations");
    const d = buildInventoryAnswer(g, detectInventoryRequest("Combien de recommandations formule ce rapport ? Liste-les toutes."));
    assert.ok(d.reponse.startsWith("Le graphe de cette publication contient 7 recommandations."), d.reponse);
    assert.ok(/sélection de la publication/.test(d.reponse), "la limite de périmètre doit être rappelée");
    assert.strictEqual(d.sections.length, 1);
    assert.strictEqual(d.sections[0].items.length, 7);
    assert.ok(d.sections[0].items.some(i => /Restauration des terrains en montagne/.test(i)), "la recommandation 8 (ONF-RTM) doit figurer");
    assert.deepStrictEqual(d.noeuds_selectionnes, expected.map(n => n.node_id));
    assert.strictEqual(d.tronque, false);
    assert.ok(d.sections[0].items.every(i => /\(p\. [0-9, ]+\)\.$/.test(i)), "chaque élément doit porter ses pages");
  });

  // 3 bis. Aucun libellé coupé (les deux plus longs du corpus font 424 et 457 caractères)
  await test("libellés longs transmis en entier (route /graph-chat)", () => {
    const { sanitizeGraph } = require(target);
    const nodes = nodesAll.filter(n => n.publication_id === "PUB010");
    const g = sanitizeGraph({ question: "x", publication_id: "PUB010", graph: { nodes, relations: [] } });
    for (const n of nodes) {
      const kept = g.nodes.find(k => k.node_id === n.node_id);
      assert.strictEqual(kept.libelle, n.libelle.replace(/\s+/g, " ").trim(), `libellé coupé : ${n.node_id}`);
    }
  });

  // 4. Aucun élément du type : réponse honnête, insuffisant = true
  await test("PUB031 : aucune recommandation → réponse explicite, insuffisant", () => {
    const d = buildInventoryAnswer(graphOf("PUB031"), detectInventoryRequest("Combien de recommandations ?"));
    assert.strictEqual(d.insuffisant, true);
    assert.strictEqual(d.sections.length, 0);
    assert.ok(/ne contient aucun élément de type « recommandation »/.test(d.reponse), d.reponse);
  });

  // 5. Accord singulier
  await test("accord au singulier quand il y a un seul élément", () => {
    const g = { nodes: [{ node_id: "N1", type_noeud: "acteur", libelle: "Préfets", page_source: "3" }], relations: [] };
    const d = buildInventoryAnswer(g, detectInventoryRequest("Quels acteurs sont mentionnés ?"));
    assert.ok(d.reponse.startsWith("Le graphe de cette publication contient 1 acteur."), d.reponse);
    assert.strictEqual(d.sections[0].titre, "Acteur retenu dans le graphe");
  });

  // 6. Timecodes (podcasts) correctement libellés
  await test("timecodes des podcasts conservés", () => {
    const g = { nodes: [{ node_id: "N1", type_noeud: "acteur", libelle: "OFB", page_source: "07:42" }], relations: [] };
    const d = buildInventoryAnswer(g, detectInventoryRequest("Quels acteurs sont mentionnés ?"));
    assert.strictEqual(d.sections[0].items[0], "OFB (timecode 07:42).");
  });

  // 7. Bout en bout : la route /graph-chat répond sans appeler le modèle
  await test("route /graph-chat : inventaire servi sans appel au modèle", async () => {
    const firestore = { collection: () => ({ doc: () => ({}) }), runTransaction: async fn => fn({ get: async () => ({ exists: false }), set() {} }) };
    let modelCalled = false;
    const handler = createGraphChatHandler({ firestore, model: "test", getAnthropicApiKey: async () => { modelCalled = true; throw new Error("modèle appelé"); } });
    const nodes = nodesAll.filter(n => n.publication_id === "PUB010");
    const body = { question: "Combien de recommandations ? Liste-les toutes.", publication_id: "PUB010", publication_titre: "PUB010", graph: { nodes, relations: [] } };
    let status = 0, payload = null;
    await handler({ headers: { origin: "https://quirites-ihemi.github.io" }, socket: {} }, {}, body, (_res, s, p) => { status = s; payload = p; });
    assert.strictEqual(modelCalled, false, "le modèle ne doit pas être appelé");
    assert.strictEqual(status, 200, JSON.stringify(payload));
    assert.strictEqual(payload.data.sections[0].items.length, 7);
    assert.strictEqual(payload.data.mode, "inventaire");
  });

  console.log(`Fichier testé : ${target}`);
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  const failed = results.filter(r => r[0] !== "OK ").length;
  console.log(failed ? `\n${failed} test(s) en échec.` : "\nTous les tests passent.");
  process.exitCode = failed ? 1 : 0;
})();
