const assert = require("assert");
const { runReflectionAssist } = require("./reflectionAssist");

function ids(response) {
  return [...new Set(response.materials.map(m => m.publication.publication_id))];
}

// DOC01 reste inchangé fonctionnellement.
const ports = runReflectionAssist({
  action_id: "DOC01",
  element: "trafic de cocaïne infrastructures portuaires"
});
assert.equal(ports.ok, true);
assert.equal(ports.engine, "reflection-assist-v0.2-doc01-doc02");
assert.deepEqual(ids(ports).sort(), ["PUB024", "PUB025"]);
assert.equal(ports.guardrails.generates_analysis, false);
assert(ports.materials.some(m => m.provenance.fine_proof_available === true));

const masculinismeDoc01 = runReflectionAssist({
  action_id: "DOC01",
  element: "terrorisme masculiniste"
});
assert.deepEqual(ids(masculinismeDoc01), ["PUB058"]);
assert(masculinismeDoc01.materials.every(m => m.provenance.level === "C"));
assert(masculinismeDoc01.materials.every(m => m.provenance.fine_proof_available === false));
assert(masculinismeDoc01.materials.every(m => m.provenance.proof_mode === "graph_only"));

// DOC02 — Niveau A : un nœud doit remonter vers son chunk exact et sa page.
const proofA = runReflectionAssist({
  action_id: "DOC02",
  material_id: "node:N0672"
});
assert.equal(proofA.ok, true);
assert.equal(proofA.action.id, "DOC02");
assert.equal(proofA.publication.publication_id, "PUB025");
assert.equal(proofA.provenance.level, "A");
assert.equal(proofA.provenance.status, "fine_proof_available");
assert.equal(proofA.provenance.exact_excerpt_available, true);
assert.equal(proofA.provenance.locator_available, true);
assert.equal(proofA.provenance.source_locator, "4");
assert.equal(proofA.proofs.length, 1);
assert.equal(proofA.proofs[0].chunk_id, "C0524");
assert.equal(proofA.proofs[0].locator, "4");
assert(proofA.proofs[0].text.includes("port du Havre"));

// DOC02 — Niveau A : une relation garde elle aussi son ancrage exact.
const proofRelationA = runReflectionAssist({
  action_id: "DOC02",
  material_id: "relation:R025_05"
});
assert.equal(proofRelationA.publication.publication_id, "PUB025");
assert.equal(proofRelationA.provenance.level, "A");
assert.equal(proofRelationA.proofs[0].chunk_id, "C0524");
assert.equal(proofRelationA.provenance.source_locator, "4");

// DOC02 — Niveau B : publication/source + repère « article web », mais aucun faux extrait.
const proofB = runReflectionAssist({
  action_id: "DOC02",
  material_id: "node:N1003"
});
assert.equal(proofB.publication.publication_id, "PUB052");
assert.equal(proofB.provenance.level, "B");
assert.equal(proofB.provenance.status, "source_level_only");
assert.equal(proofB.provenance.source_locator, "article web");
assert.equal(proofB.provenance.exact_excerpt_available, false);
assert.equal(proofB.proofs.length, 0);

// DOC02 — Niveau C : source identifiable, aucun repérage fin ni extrait inventé.
const proofC = runReflectionAssist({
  action_id: "DOC02",
  material_id: "node:N1010"
});
assert.equal(proofC.publication.publication_id, "PUB058");
assert.equal(proofC.provenance.level, "C");
assert.equal(proofC.provenance.status, "structured_without_fine_locator");
assert.equal(proofC.provenance.source_locator, null);
assert.equal(proofC.provenance.exact_excerpt_available, false);
assert.equal(proofC.provenance.locator_available, false);
assert.equal(proofC.proofs.length, 0);
assert.equal(proofC.guardrails.invents_excerpt, false);
assert.equal(proofC.guardrails.invents_locator, false);

console.log("OK reflection-assist DOC01 + DOC02 (A/B/C)");
