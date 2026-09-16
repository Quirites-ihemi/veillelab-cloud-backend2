const assert = require("assert");
const { runReflectionAssist } = require("./reflectionAssist");

function ids(response) {
  return [...new Set(response.materials.map(m => m.publication.publication_id))];
}

const ports = runReflectionAssist({
  action_id: "DOC01",
  element: "trafic de cocaïne infrastructures portuaires"
});
assert.equal(ports.ok, true);
assert.equal(ports.engine, "reflection-assist-v0.1-doc01");
assert.deepEqual(ids(ports).sort(), ["PUB024", "PUB025"]);
assert.equal(ports.guardrails.generates_analysis, false);
assert(ports.materials.some(m => m.provenance.fine_proof_available === true));

const masculinisme = runReflectionAssist({
  action_id: "DOC01",
  element: "terrorisme masculiniste"
});
assert.deepEqual(ids(masculinisme), ["PUB058"]);
assert(masculinisme.materials.every(m => m.provenance.level === "C"));
assert(masculinisme.materials.every(m => m.provenance.fine_proof_available === false));
assert(masculinisme.materials.every(m => m.provenance.proof_mode === "graph_only"));

console.log("OK reflection-assist DOC01");
