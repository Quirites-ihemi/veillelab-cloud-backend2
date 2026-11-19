// Tests de la consolidation du 19/11/2026 — graphChat.js
// Usage : node test_graph_chat_consolidation.js [chemin/vers/graphChat.js] [dossier contenant nodes.json et relations.json]
// Aucun appel au modèle. Les cas reprennent les réponses réellement observées lors des tests du 19/11/2026.
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const target = path.resolve(process.argv[2] || "./graphChat.js");
const dataDir = path.resolve(process.argv[3] || "./corpus");
const G = require(target);

const nodesAll = JSON.parse(fs.readFileSync(path.join(dataDir, "nodes.json"), "utf8"));
const relsAll = JSON.parse(fs.readFileSync(path.join(dataDir, "relations.json"), "utf8"));
const graphOf = pid => ({
  publicationId: pid, publicationTitle: pid,
  nodes: nodesAll.filter(n => n.publication_id === pid),
  relations: relsAll.filter(r => r.publication_id === pid)
});

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["OK ", name]); }
  catch (e) { results.push(["ÉCHEC", `${name} — ${e.message}`]); }
}

(async () => {
  // --- 1. Balisage interne (Q18, PUB116) ---
  await test("balisage interne retiré (Q18)", () => {
    const raw = "…aucun ne porte spécifiquement sur des enjeux raciaux.</reponse> <parameter name=\"noeuds_selectionnes\">[\"\", \"\", \"\", \"\"]";
    const out = G.stripModelArtifacts(raw);
    assert.strictEqual(out, "…aucun ne porte spécifiquement sur des enjeux raciaux.");
  });
  await test("balisage interne : réponse finale propre et non signalée tronquée", () => {
    const g = { publicationTitle: "T", nodes: [{ node_id: "N1", type_noeud: "probleme", libelle: "x", page_source: "1" }], relations: [] };
    const d = G.finalizeAnswer({ reponse: "INTRO: Le graphe ne contient pas cet élément.</reponse> <parameter name=\"noeuds_selectionnes\">[\"\"]", noeuds_selectionnes: [], relations_selectionnees: [], insuffisant: true }, g, "Question ?");
    assert.ok(!/<|parameter|reponse>/.test(d.reponse), d.reponse);
    assert.strictEqual(d.tronque, false);
  });

  // --- 2. Jargon (Q4c, Q4d, Q8, Q22) ---
  await test("jargon : nœuds, relations et codes remplacés", () => {
    const cases = [
      ["Les nœuds et relations fournis traitent exclusivement des problèmes.", /^Les éléments du graphe traitent/],
      ["Bien que le nœud « Risques » soit présent, aucune relation n'indique le moment.", /l'élément « Risques ».*aucun lien n'indique/],
      ["La relation documentée est de type ASSOCIE_A (est associé à), ce qui signifie…", /^Le lien documenté est « associé à », ce qui signifie…$/],
      ["Aucune relation de type REPOND_A, PERMET_DE ou MOBILISE ne relie une recommandation.", /^Aucun lien « répond à », « permet de » ou « mobilise » ne relie une recommandation\.$/]
    ];
    for (const [input, expected] of cases) {
      const out = G.dejargon(input);
      assert.ok(expected.test(out), `« ${input} » → « ${out} »`);
      assert.ok(!/nœud|[A-Z]{3,}_[A-Z]/.test(out), `jargon restant : ${out}`);
    }
  });
  await test("jargon : les libellés et sigles légitimes sont conservés", () => {
    const input = "Les relations entre police et population, selon le SSMSI et l'OFAC (COMCYBER-MI).";
    assert.strictEqual(G.dejargon(input), input);
  });

  await test("jargon : élision correcte (« d'élément », relevé le 19/11 sur test4)", () => {
    const out = G.dejargon("Le graphe ne contient pas de nœud ou de relation traitant du racisme.");
    assert.ok(out.includes("pas d'élément ou de relation"), out);
  });
  await test("« Le documentaire n'aborde pas » → « Le graphe de cette publication n'aborde pas »", () => {
    assert.strictEqual(G.dejargon("Le documentaire n'aborde pas directement la question."), "Le graphe de cette publication n'aborde pas directement la question.");
    assert.strictEqual(G.dejargon("En revanche, le rapport ne mentionne pas de date."), "En revanche, le graphe de cette publication ne mentionne pas de date.");
    // Cas relevé sur la v2 le 19/11/2026 : ne jamais doubler « le graphe de ».
    const deja = "Le graphe de cette publication ne contient pas d'élément sur ce sujet.";
    assert.strictEqual(G.dejargon(deja), deja);
    const deja2 = "Le graphe de cette publication n'aborde pas directement la question.";
    assert.strictEqual(G.dejargon(deja2), deja2);
    const keep = "Le rapport concerne six départements.";
    assert.strictEqual(G.dejargon(keep), keep);
  });

  await test("réponse réelle Q18 (v2) : aucun « graphe de le graphe »", () => {
    const real = "Le documentaire n'aborde pas directement la question du racisme institutionnel ou systémique de la police. Le graphe de cette publication ne contient pas de nœud ou de relation traitant explicitement du racisme. En revanche, le documentaire documente plusieurs phénomènes.";
    const out = G.dejargon(real);
    assert.ok(!/graphe de (?:le|la) graphe/i.test(out), out);
    assert.ok(out.startsWith("Le graphe de cette publication n'aborde pas directement"), out);
    assert.ok(out.includes("Le graphe de cette publication ne contient pas d'élément ou de relation"), out);
  });

  // --- 3. Nombre annoncé (Q7, Q16) ---
  await test("nombre annoncé faux remplacé par « plusieurs » (Q16 : deux axes, trois sections)", () => {
    const out = G.fixAnnouncedCount("L'IA joue un rôle selon deux axes principaux.", [{ titre: "A", items: ["1"] }, { titre: "B", items: ["2"] }, { titre: "C", items: ["3"] }]);
    assert.strictEqual(out, "L'IA joue un rôle selon plusieurs axes principaux.");
  });
  await test("nombre annoncé faux sans sections (Q7 : trois éléments, quatre cités en ligne)", () => {
    const out = G.fixAnnouncedCount("Trois éléments sont explicitement associés à cette hausse : a ; b ; c ; d.", []);
    assert.ok(out.startsWith("Plusieurs éléments sont explicitement associés"), out);
  });
  await test("nombre exact conservé (deux recommandations, deux sections)", () => {
    const intro = "Deux recommandations concernent directement les préfets.";
    assert.strictEqual(G.fixAnnouncedCount(intro, [{ titre: "A", items: ["1", "2"] }, { titre: "B", items: ["3", "4"] }]), intro);
  });
  await test("nombre hors liste conservé (six départements)", () => {
    const intro = "Le rapport concerne six départements de l'arc alpin.";
    assert.strictEqual(G.fixAnnouncedCount(intro, []), intro);
  });

  // --- 4. Ligne de source ---
  await test("source lisible : pages uniques et triées", () => {
    assert.strictEqual(G.summarizeSourceRefs(["8;26", "8;34", "8;38;39;40"]), "p. 8, 26, 34, 38, 39, 40");
  });
  await test("source lisible : timecodes et plages", () => {
    assert.strictEqual(G.summarizeSourceRefs(["00:31;00:58", "02:18;02:48", "00:31"]), "timecodes 00:31, 00:58, 02:18, 02:48");
    assert.strictEqual(G.summarizeSourceRefs(["12:40-13:19"]), "timecode 12:40–13:19");
  });
  await test("source lisible : repères non numériques et plafond", () => {
    assert.strictEqual(G.summarizeSourceRefs(["article web"]), "article web");
    const many = Array.from({ length: 15 }, (_, i) => String(i + 1)).join(";");
    assert.strictEqual(G.summarizeSourceRefs([many]), "p. 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …");
  });

  // --- 5. Réponses à un problème ---
  await test("détection des questions « que propose / quelles réponses »", () => {
    const yes = [
      "Quelles réponses le rapport apporte-t-il à la faiblesse de l'ingénierie technique territoriale ?",
      "Que propose le documentaire pour lutter contre le mal-être des policiers ?",
      "Que fait l'Office français de la biodiversité face aux atteintes aux milieux aquatiques ?",
      "Quelles solutions sont proposées pour réduire cette vulnérabilité ?",
      "Comment lutter contre la culture du risque insuffisante ?"
    ];
    const no = [
      "Combien de victimes en 2024 ?", "Quels acteurs sont mentionnés ?",
      "Pourquoi l'État est-il vulnérable face aux cyberattaques ?",
      "Quelles recommandations concernent les préfets ?", "Qui sont les intervenants ?",
      "La police est-elle raciste selon ce documentaire ?"
    ];
    for (const q of yes) assert.ok(G.detectResponseRequest(q), `non détectée : ${q}`);
    for (const q of no) assert.ok(!G.detectResponseRequest(q), `détectée à tort : ${q}`);
  });
  await test("Q13 (PUB010) : exactement les recommandations 8 et 9, pas la 10", () => {
    const g = graphOf("PUB010");
    const q = "Quelles réponses le rapport apporte-t-il à la faiblesse de l'ingénierie technique territoriale ?";
    const t = G.findResponseTarget(q, g);
    assert.ok(t && /Faiblesse de l.ingénierie technique territoriale/.test(t.libelle), `cible : ${t && t.libelle}`);
    const d = G.buildResponseAnswer(g, t);
    const items = d.sections[0].items.join(" ");
    assert.strictEqual(d.sections[0].items.length, 2);
    assert.ok(/recommandation 8/.test(items) && /recommandation 9/.test(items), items);
    assert.ok(!/recommandation 10/.test(items), "la recommandation 10 ne doit pas figurer");
    assert.ok(d.reponse.includes("2 éléments sont reliés explicitement"), d.reponse);
  });
  await test("Q19 (PUB116) : aucune solution reliée au mal-être → réponse honnête", () => {
    const g = graphOf("PUB116");
    const t = G.findResponseTarget("Que propose le documentaire pour lutter contre le mal-être des policiers ?", g);
    assert.ok(t && /Mal-être professionnel/.test(t.libelle), `cible : ${t && t.libelle}`);
    const d = G.buildResponseAnswer(g, t);
    assert.strictEqual(d.insuffisant, true);
    assert.ok(/ne relie explicitement aucune réponse/.test(d.reponse), d.reponse);
  });
  await test("Q2 (PUB021) : aucune réponse reliée aux atteintes aquatiques → réponse honnête", () => {
    const g = graphOf("PUB021");
    const t = G.findResponseTarget("Que fait l'Office français de la biodiversité face aux atteintes aux milieux aquatiques ?", g);
    assert.ok(t && /atteintes aux milieux aquatiques/.test(t.libelle), `cible : ${t && t.libelle}`);
    assert.strictEqual(G.buildResponseAnswer(g, t).insuffisant, true);
  });
  await test("Q4b (PUB133) : cible non identifiable → passage par le modèle", () => {
    assert.strictEqual(G.findResponseTarget("Quelles solutions sont proposées pour réduire cette vulnérabilité ?", graphOf("PUB133")), null);
  });
  await test("PUB010 : culture du risque → réponse documentée unique", () => {
    const g = graphOf("PUB010");
    const t = G.findResponseTarget("Comment lutter contre la culture du risque insuffisante ?", g);
    const d = G.buildResponseAnswer(g, t);
    assert.strictEqual(d.sections[0].items.length, 1, JSON.stringify(d.sections));
    assert.ok(/1 élément est relié/.test(d.reponse));
  });
  await test("route /graph-chat : réponses servies sans appel au modèle", async () => {
    const firestore = { collection: () => ({ doc: () => ({}) }), runTransaction: async fn => fn({ get: async () => ({ exists: false }), set() {} }) };
    let modelCalled = false;
    const handler = G.createGraphChatHandler({ firestore, model: "test", getAnthropicApiKey: async () => { modelCalled = true; throw new Error("modèle appelé"); } });
    const g = graphOf("PUB010");
    const body = { question: "Quelles réponses le rapport apporte-t-il à la faiblesse de l'ingénierie technique territoriale ?", publication_id: "PUB010", publication_titre: "PUB010", graph: { nodes: g.nodes, relations: g.relations } };
    let status = 0, payload = null;
    await handler({ headers: {}, socket: {} }, {}, body, (_res, s, p) => { status = s; payload = p; });
    assert.strictEqual(modelCalled, false);
    assert.strictEqual(status, 200, JSON.stringify(payload));
    assert.strictEqual(payload.data.mode, "reponses");
    assert.strictEqual(payload.data.sections[0].items.length, 2);
  });

  console.log(`Fichier testé : ${target}`);
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  const failed = results.filter(r => r[0] !== "OK ").length;
  console.log(failed ? `\n${failed} test(s) en échec.` : "\nTous les tests passent.");
  process.exitCode = failed ? 1 : 0;
})();
