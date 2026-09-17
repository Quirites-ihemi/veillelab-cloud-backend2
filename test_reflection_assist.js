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
assert.equal(ports.engine, "reflection-assist-v0.4-doc01-doc02-doc03-mir01");
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

// DOC02 — Niveau A.
const proofA = runReflectionAssist({ action_id: "DOC02", material_id: "node:N0672" });
assert.equal(proofA.ok, true);
assert.equal(proofA.engine, "reflection-assist-v0.4-doc01-doc02-doc03-mir01");
assert.equal(proofA.publication.publication_id, "PUB025");
assert.equal(proofA.provenance.level, "A");
assert.equal(proofA.provenance.status, "fine_proof_available");
assert.equal(proofA.proofs[0].chunk_id, "C0524");
assert.equal(proofA.provenance.source_locator, "4");

// DOC02 — Niveau B.
const proofB = runReflectionAssist({ action_id: "DOC02", material_id: "node:N1003" });
assert.equal(proofB.publication.publication_id, "PUB052");
assert.equal(proofB.provenance.level, "B");
assert.equal(proofB.provenance.status, "source_level_only");
assert.equal(proofB.proofs.length, 0);

// DOC02 — Niveau C.
const proofC = runReflectionAssist({ action_id: "DOC02", material_id: "node:N1010" });
assert.equal(proofC.publication.publication_id, "PUB058");
assert.equal(proofC.provenance.level, "C");
assert.equal(proofC.provenance.status, "structured_without_fine_locator");
assert.equal(proofC.proofs.length, 0);
assert.equal(proofC.guardrails.invents_excerpt, false);
assert.equal(proofC.guardrails.invents_locator, false);

// DOC03 — un nœud sur les ports français et le trafic de cocaïne doit
// proposer un autre cas documenté, sans réutiliser la publication d'origine.
const comparablePorts = runReflectionAssist({
  action_id: "DOC03",
  material_id: "node:N0672"
});
assert.equal(comparablePorts.ok, true);
assert.equal(comparablePorts.engine, "reflection-assist-v0.4-doc01-doc02-doc03-mir01");
assert.equal(comparablePorts.action.id, "DOC03");
assert.equal(comparablePorts.origin_publication_id, "PUB025");
assert.deepEqual(comparablePorts.comparison_basis.anchors.map(a => a.id).sort(), ["narcotrafic", "port"]);
assert.equal(comparablePorts.comparison_basis.query, "narcotrafic ports");
assert(comparablePorts.cases.length >= 1);
assert.equal(comparablePorts.cases[0].publication.publication_id, "PUB024");
assert(comparablePorts.cases.every(c => c.publication.publication_id !== "PUB025"));
assert(comparablePorts.cases[0].shared_features.some(f => f.id === "narcotrafic"));
assert(comparablePorts.cases[0].shared_features.some(f => f.id === "port"));
assert.equal(comparablePorts.cases[0].comparability_verified, false);
assert.equal(comparablePorts.guardrails.infers_transferability, false);
assert.equal(comparablePorts.guardrails.forces_candidate, false);

// DOC03 — ne pas forcer un résultat quand le corpus ne fournit pas d'autre cas solide.
const noForcedCase = runReflectionAssist({
  action_id: "DOC03",
  material_id: "node:N1010"
});
assert.equal(noForcedCase.origin_publication_id, "PUB058");
assert(noForcedCase.cases.every(c => c.publication.publication_id !== "PUB058"));
assert.equal(noForcedCase.guardrails.forces_candidate, false);

// MIR01 — affirmation causale : documenter l'appui, la nuance et ne pas transformer
// une proximité documentaire en preuve causale générale.
const causalClaim = runReflectionAssist({
  action_id: "MIR01",
  assertion: "Le renforcement des contrôles portuaires déplace les flux de cocaïne vers des ports secondaires."
});
assert.equal(causalClaim.ok, true);
assert.equal(causalClaim.action.id, "MIR01");
assert.equal(causalClaim.claim_analysis.causal_language_detected, true);
assert(causalClaim.evidence.support.some(m => m.publication.publication_id === "PUB025"));
assert(causalClaim.evidence.nuance.some(m => ["PUB024", "PUB025"].includes(m.publication.publication_id)));
assert(causalClaim.evidence.support.concat(causalClaim.evidence.nuance).every(m => ["PUB024", "PUB025"].includes(m.publication.publication_id)));
assert.equal(causalClaim.guardrails.infers_causality_from_association, false);
assert.equal(causalClaim.guardrails.decides_truth_or_falsity, false);

// MIR01 — une affirmation descriptive avec nuances explicites dans le graphe.
const fsiClaim = runReflectionAssist({
  action_id: "MIR01",
  assertion: "L'image des forces de sécurité intérieure est globalement positive."
});
assert(fsiClaim.evidence.support.some(m => m.publication.publication_id === "PUB013"));
assert(fsiClaim.evidence.nuance.some(m => m.result_kind === "relation" && m.content.relation_type === "NUANCE"));

// MIR01 — contradiction explicite uniquement lorsqu'elle est structurée comme telle.
const truthClaim = runReflectionAssist({
  action_id: "MIR01",
  assertion: "La vérité-adéquation correspond à une réalité extérieure indépendante de l'individu."
});
assert(truthClaim.evidence.contradiction.some(m => m.result_kind === "relation" && m.content.relation_type === "REMET_EN_CAUSE"));
assert.equal(truthClaim.documentary_state.explicit_contradiction_found, true);

console.log("OK reflection-assist DOC01 + DOC02 (A/B/C) + DOC03 + MIR01");
