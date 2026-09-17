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
assert.equal(ports.engine, "reflection-assist-v0.4.1-doc01-doc02-doc03-mir01");
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
assert.equal(proofA.engine, "reflection-assist-v0.4.1-doc01-doc02-doc03-mir01");
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
assert.equal(comparablePorts.engine, "reflection-assist-v0.4.1-doc01-doc02-doc03-mir01");
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

// MIR01 v0.4.1 — REMET_EN_CAUSE est une tension/nuance par défaut,
// pas une contradiction automatique de la proposition testée.
const truthClaim = runReflectionAssist({
  action_id: "MIR01",
  assertion: "La vérité-adéquation correspond à une réalité extérieure indépendante de l'individu."
});
assert(truthClaim.evidence.support.some(m => m.material_id === "chunk:C0803"));
assert(truthClaim.evidence.nuance.some(m => m.result_kind === "relation" && m.content.relation_type === "REMET_EN_CAUSE"));
assert.equal(truthClaim.evidence.contradiction.length, 0);
assert.equal(truthClaim.documentary_state.explicit_contradiction_found, false);



// MIR04 — deux matériaux explicitement reliés par NUANCE doivent être présentés
// comme tension documentaire, jamais comme contradiction automatique.
const mir04Nuance = runReflectionAssist({
  action_id: "MIR04",
  material_ids: ["node:N0366", "node:N0370"]
});
assert.equal(mir04Nuance.ok, true);
assert.equal(mir04Nuance.engine, "reflection-assist-v0.5-mir04");
assert.equal(mir04Nuance.input_mode, "selected_materials");
assert.equal(mir04Nuance.findings.explicit_contradictions.length, 0);
assert(mir04Nuance.findings.documented_tensions.some(f => f.finding_id === "relation:R013_11" && f.relation_type === "NUANCE"));
assert.equal(mir04Nuance.documentary_state.explicit_contradiction_found, false);
assert.equal(mir04Nuance.documentary_state.documented_tension_found, true);
assert.equal(mir04Nuance.guardrails.treats_nuance_as_contradiction, false);

// MIR04 — REMET_EN_CAUSE reste une tension documentaire, conformément au correctif MIR01 v0.4.1.
const mir04Challenge = runReflectionAssist({
  action_id: "MIR04",
  material_ids: ["node:N1040", "node:N1044"]
});
assert.equal(mir04Challenge.findings.explicit_contradictions.length, 0);
assert(mir04Challenge.findings.documented_tensions.some(f => f.finding_id === "relation:R062_05" && f.relation_type === "REMET_EN_CAUSE"));
assert.equal(mir04Challenge.guardrails.treats_remet_en_cause_as_contradiction, false);

// MIR04 — ne pas inventer une contradiction entre deux matériaux sans relation explicite.
const mir04NoForcedOpposition = runReflectionAssist({
  action_id: "MIR04",
  material_ids: ["node:N0672", "node:N1010"]
});
assert.equal(mir04NoForcedOpposition.findings.explicit_contradictions.length, 0);
assert.equal(mir04NoForcedOpposition.findings.documented_tensions.length, 0);
assert.equal(mir04NoForcedOpposition.documentary_state.insufficient, true);
assert.equal(mir04NoForcedOpposition.guardrails.infers_contradiction_from_difference, false);

console.log("OK reflection-assist DOC01 + DOC02 (A/B/C) + DOC03 + MIR01 + MIR04");


// MIR08 — un énoncé chiffré et précisément documenté doit être reconnu comme ancré empiriquement.
const mir08Anchored = runReflectionAssist({
  action_id: "MIR08",
  text: "En 2024, 78 % du volume de cocaïne saisi en France l'a été par voie maritime."
});
assert.equal(mir08Anchored.ok, true);
assert.equal(mir08Anchored.engine, "reflection-assist-v0.6.1-mir08");
assert.equal(mir08Anchored.checks.length, 1);
assert.equal(mir08Anchored.checks[0].status, "empirical_anchor_found");
assert.equal(mir08Anchored.checks[0].weak_empirical_anchor, false);
assert.equal(mir08Anchored.checks[0].empirical_anchor_count, mir08Anchored.checks[0].materials.filter(m => m.empirical_check && m.empirical_check.counts_as_empirical_anchor).length);
assert(mir08Anchored.checks[0].materials.some(m => m.material_id === "chunk:C0523" && m.empirical_check.counts_as_empirical_anchor === true));
assert.equal(mir08Anchored.guardrails.treats_illustrative_material_as_proof, false);
assert.equal(mir08Anchored.guardrails.evaluates_truth_or_falsity, false);

// MIR08 — un matériau empirique proche avec une autre quantification ne doit pas être traité comme preuve.
const mir08WrongNumber = runReflectionAssist({
  action_id: "MIR08",
  text: "En 2024, 90 % du volume de cocaïne saisi en France l'a été par voie maritime."
});
assert.equal(mir08WrongNumber.ok, true);
assert.equal(mir08WrongNumber.checks.length, 1);
assert.equal(mir08WrongNumber.checks[0].weak_empirical_anchor, true);
assert.notEqual(mir08WrongNumber.checks[0].status, "empirical_anchor_found");
assert(mir08WrongNumber.checks[0].materials.some(m => m.empirical_check.role === "related_empirical_material_with_mismatched_quantification"));
assert.equal(mir08WrongNumber.guardrails.treats_related_quantification_as_matching_proof, false);

// MIR08 — une proposition évaluative/conceptuelle n'est pas automatiquement qualifiée de faiblement étayée.
const mir08Conceptual = runReflectionAssist({
  action_id: "MIR08",
  text: "La vérité-adéquation est supérieure à toute autre conception de la vérité."
});
assert.equal(mir08Conceptual.ok, true);
assert.equal(mir08Conceptual.checks[0].status, "outside_empirical_check_scope");
assert.equal(mir08Conceptual.checks[0].weak_empirical_anchor, null);

console.log("OK MIR08 ancrage empirique");

// MET01 — deux matériaux issus de la même enquête peuvent partager population,
// périmètre et source tout en mesurant des objets différents. MET01 doit le signaler
// sans conclure à l'incomparabilité ni à l'équivalence.
const met01SameSurveyDifferentIndicator = runReflectionAssist({
  action_id: "MET01",
  material_ids: ["node:N0366", "node:N0367"]
});
assert.equal(met01SameSurveyDifferentIndicator.ok, true);
assert.equal(met01SameSurveyDifferentIndicator.engine, "reflection-assist-v0.7-met01");
assert.equal(met01SameSurveyDifferentIndicator.input_mode, "two_selected_materials");
assert.equal(met01SameSurveyDifferentIndicator.materials.length, 2);
assert.equal(met01SameSurveyDifferentIndicator.criteria.length, 5);
assert.equal(met01SameSurveyDifferentIndicator.criteria.find(c => c.id === "population").status, "documented_alignment");
assert.equal(met01SameSurveyDifferentIndicator.criteria.find(c => c.id === "geography").status, "documented_overlap");
assert.equal(met01SameSurveyDifferentIndicator.criteria.find(c => c.id === "indicator").status, "different_indicator_definitions_to_review");
assert.equal(met01SameSurveyDifferentIndicator.criteria.find(c => c.id === "source_method").status, "same_publication_context");
assert.equal(met01SameSurveyDifferentIndicator.summary.comparability_decision, "analyst_required");
assert.equal(met01SameSurveyDifferentIndicator.guardrails.declares_equivalence, false);
assert.equal(met01SameSurveyDifferentIndicator.guardrails.declares_incomparability_automatically, false);
assert(met01SameSurveyDifferentIndicator.materials[0].evidence_refs.some(ref => ref.proof_id === "chunk:C0351" && ref.locator === "14"));

// MET01 — deux matériaux sur le narcotrafic/les ports mais portant sur des espaces
// et mesures distincts doivent déclencher une prudence méthodologique, sans verdict.
const met01DifferentScopes = runReflectionAssist({
  action_id: "MET01",
  material_ids: ["node:N0672", "chunk:C0460"]
});
assert.equal(met01DifferentScopes.criteria.find(c => c.id === "geography").status, "different_geographic_scopes_to_review");
assert.equal(met01DifferentScopes.criteria.find(c => c.id === "indicator").status, "different_indicator_definitions_to_review");
assert.equal(met01DifferentScopes.summary.verification_state, "comparability_requires_caution");
assert.equal(met01DifferentScopes.guardrails.performs_substantive_comparison_for_user, false);
assert.equal(met01DifferentScopes.guardrails.uses_publication_year_as_observation_period, false);

console.log("OK MET01 comparabilité");


// MET02 — une relation statistique encodée ASSOCIATION doit rester une association.
// Le sens source -> cible du graphe ne doit jamais devenir une direction causale.
const met02Association = runReflectionAssist({
  action_id: "MET02",
  material_id: "relation:R018_07"
});
assert.equal(met02Association.ok, true);
assert.equal(met02Association.engine, "reflection-assist-v0.8-met02");
assert.equal(met02Association.input_mode, "selected_relation");
assert.equal(met02Association.relation.relation_type, "ASSOCIATION");
assert.equal(met02Association.assessment.relation_family, "statistical_association");
assert.equal(met02Association.assessment.statistical_association, true);
assert.equal(met02Association.assessment.graph_direction_is_causal_direction, false);
assert.equal(met02Association.assessment.causal_interpretation.status, "association_does_not_establish_causality");
assert.equal(met02Association.assessment.causal_interpretation.causal_inference_allowed, false);
assert.equal(met02Association.provenance.level, "A");
assert(met02Association.provenance.proof_ids.includes("chunk:C0418"));
assert.equal(met02Association.guardrails.converts_association_to_causality, false);

// MET02 — un libellé contributif peut porter un langage causal ou explicatif,
// mais ne devient pas pour autant une causalité méthodologiquement démontrée.
const met02Contributive = runReflectionAssist({
  action_id: "MET02",
  relation_id: "R014_13"
});
assert.equal(met02Contributive.relation.relation_type, "PEUT_CONTRIBUER_A");
assert.equal(met02Contributive.assessment.relation_family, "causal_or_contributive_wording");
assert.equal(met02Contributive.assessment.source_signals.causal_wording_detected, true);
assert.equal(met02Contributive.assessment.source_signals.uncertainty_language_detected, true);
assert.equal(met02Contributive.assessment.causal_interpretation.causal_inference_allowed, false);
assert.equal(met02Contributive.guardrails.declares_causality_from_relation_label_alone, false);

// MET02 — un lien illustratif reste descriptif, sans causalité déduite du sens du graphe.
const met02Illustrative = runReflectionAssist({
  action_id: "MET02",
  material_id: "relation:R025_05"
});
assert.equal(met02Illustrative.relation.relation_type, "ILLUSTRE");
assert.equal(met02Illustrative.assessment.relation_family, "descriptive_or_evidentiary");
assert.equal(met02Illustrative.assessment.graph_direction_is_causal_direction, false);
assert.equal(met02Illustrative.guardrails.treats_graph_direction_as_causal_direction, false);

console.log("OK MET02 nature du lien");

// MET04 — une recommandation doit être éprouvée à partir des liens explicitement
// documentés dans le graphe, sans verdict automatique de faisabilité ou d'efficacité.
const met04Recommendation = runReflectionAssist({
  action_id: "MET04",
  material_id: "node:N1207"
});
assert.equal(met04Recommendation.ok, true);
assert.equal(met04Recommendation.engine, "reflection-assist-v0.9-met04");
assert.equal(met04Recommendation.input_mode, "selected_recommendation_node");
assert.equal(met04Recommendation.recommendation.node_id, "N1207");
assert.equal(met04Recommendation.recommendation.node_type, "recommandation");
assert.equal(met04Recommendation.recommendation.provenance.level, "A");
assert(met04Recommendation.recommendation.provenance.proof_ids.includes("chunk:C0900"));

const met04Problem = met04Recommendation.criteria.find(c => c.id === "problem_or_need");
const met04Actor = met04Recommendation.criteria.find(c => c.id === "implementation_actor");
const met04Effect = met04Recommendation.criteria.find(c => c.id === "expected_effect_or_mechanism");
const met04Conditions = met04Recommendation.criteria.find(c => c.id === "conditions_or_dependencies");
const met04Limits = met04Recommendation.criteria.find(c => c.id === "limits_or_tensions");
assert.equal(met04Problem.status, "documented_in_graph");
assert(met04Problem.materials.some(m => m.relation_id === "R101_17" && m.relation_type === "REPOND_A"));
assert.equal(met04Actor.status, "documented_in_graph");
assert(met04Actor.materials.some(m => m.relation_id === "R101_18" && m.relation_type === "MOBILISE"));
assert.equal(met04Effect.status, "not_documented_in_graph");
assert.equal(met04Conditions.status, "not_documented_in_graph");
assert.equal(met04Limits.status, "not_documented_in_graph");
assert.equal(met04Recommendation.summary.feasibility_decision, "analyst_required");
assert.equal(met04Recommendation.summary.effectiveness_decision, "analyst_required");
assert.equal(met04Recommendation.guardrails.treats_absence_of_limit_as_absence_of_risk, false);
assert.equal(met04Recommendation.guardrails.converts_documented_effect_into_proven_causality, false);

// MET04 — une autre recommandation peut documenter un effet attendu et un appui,
// sans que le moteur en déduise qu'elle est efficace ou faisable.
const met04Mechanism = runReflectionAssist({
  action_id: "MET04",
  recommendation_id: "N1173"
});
assert.equal(met04Mechanism.criteria.find(c => c.id === "expected_effect_or_mechanism").status, "documented_in_graph");
assert(met04Mechanism.criteria.find(c => c.id === "expected_effect_or_mechanism").materials.some(m => m.relation_id === "R090_22"));
assert.equal(met04Mechanism.criteria.find(c => c.id === "conditions_or_dependencies").status, "documented_in_graph");
assert(met04Mechanism.criteria.find(c => c.id === "conditions_or_dependencies").materials.some(m => m.relation_id === "R090_23"));
assert.equal(met04Mechanism.summary.feasibility_decision, "analyst_required");

// MET04 refuse un nœud qui n'est pas typé recommandation.
assert.throws(() => runReflectionAssist({
  action_id: "MET04",
  material_id: "node:N0672"
}), /n'est pas typé recommandation/);

console.log("OK MET04 éprouver une recommandation");
