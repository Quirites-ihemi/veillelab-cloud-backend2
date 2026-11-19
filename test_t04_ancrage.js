// Tests du correctif T04 v0.2 (ancrage par citation exacte).
// Usage : node test_t04_ancrage.js [chemin/t04.js] [dossier corpus]
const assert = require('assert');
const path = require('path');
const t04 = require(path.resolve(process.argv[2] || './t04.js'));
const corpusDir = path.resolve(process.argv[3] || './corpus');
const contents = require(path.join(corpusDir, 'contents.json'));
const pubs = require(path.join(corpusDir, 'publications.json'));
const chunk = id => contents.find(c => c.chunk_id === id);
const pubOf = id => pubs.find(p => p.publication_id === chunk(id).publication_id);
const index = new Map(['C0978','C0979','C0983','C0984','C0985','C0986','C0997','C0906','C0907'].map(id => [id, { chunk: chunk(id), pub: pubOf(id) }]));
let n = 0; const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// 1. Constats reformulés (cas réels PUB115) : écartés faute de formule de prescription dans la source.
const constats = [
  { formulation: "Mettre en place un transfert électronique automatisé", citation: "Il n’existe pas encore de transfert électronique automatisé de l’ensemble des données nationales vers les systèmes européens", chunk_ids: ['C0978'], formulateur: 'Cour des comptes européenne' },
  { formulation: "Clarifier l'utilisation des canaux", citation: "Leur utilisation n’est pas homogène et leurs bases juridiques ne sont pas toujours bien maîtrisées", chunk_ids: ['C0985'], formulateur: 'Cour des comptes européenne' },
  { formulation: "Rendre publics les accords", citation: "La Cour souligne que le manque de transparence empêche de vérifier pleinement leur conformité aux exigences de la CCLAT", chunk_ids: ['C0986'], formulateur: 'Cour des comptes européenne' },
  { formulation: "Échanger plus vite", citation: "Les quatre États audités considèrent que des échanges plus rapides, structurés et en temps réel constituent une priorité", chunk_ids: ['C0984'], formulateur: 'Cour des comptes européenne' },
];
const r1 = t04.verifierAncrage(constats, index);
ok(r1.gardes.length === 0, 'les 4 constats doivent être écartés : ' + JSON.stringify(r1.gardes.map(g => g.formulation)));

// 2. Vraies recommandations : conservées.
const vraies = [
  { formulation: "Améliorer l'information sur le marché", citation: "La Cour recommande d’améliorer l’information sur le marché, de renforcer le soutien aux États membres", chunk_ids: ['C0997'], formulateur: 'Cour des comptes européenne' },
  { formulation: "Limiter la sous-traitance à un rang", citation: "La mission recommande donc de limiter la sous-traitance à un rang pour les seules activités de surveillance humaine et de gardiennage", chunk_ids: ['C0906'], formulateur: 'Inspection générale de l’administration' },
];
const r2 = t04.verifierAncrage(vraies, index);
ok(r2.gardes.length === 2, 'les 2 vraies recommandations doivent être conservées');
ok(r2.gardes[0].formulateur === 'Cour des comptes européenne', 'formulateur Cour conservé');
ok(r2.gardes[1].formulateur === 'Inspection générale de l’administration', 'IGA conservée via « la mission recommande »');

// 3. Attribution erronée (cas réel REC004) : l'appel vient des douanes, pas de la Cour.
const appel = { formulation: "Harmoniser les infractions", citation: "Les autorités douanières belges, espagnoles et roumaines appellent à une harmonisation accrue des infractions et des sanctions", chunk_ids: ['C0983'], formulateur: 'Cour des comptes européenne' };
const r3 = t04.verifierAncrage([appel], index);
ok(r3.gardes.length === 1 && r3.gardes[0].formulateur === '', 'la Cour ne doit pas être indiquée comme formulateur');
const appelBon = { ...appel, formulateur: 'Autorités douanières belges, espagnoles et roumaines' };
ok(t04.verifierAncrage([appelBon], index).gardes[0].formulateur === appelBon.formulateur, 'formulateur douanes conservé');

// 4. Citation inventée ou paraphrasée : écartée.
const inventee = { formulation: "x", citation: "La Cour recommande de créer une agence européenne du tabac", chunk_ids: ['C0997'], formulateur: '' };
ok(t04.verifierAncrage([inventee], index).gardes.length === 0, 'citation absente de la source écartée');
ok(!t04.citationAncree('', 'texte'), 'citation vide refusée');
ok(!t04.citationAncree('recommande', 'La Cour recommande'), 'citation trop courte refusée');

// 5. Tolérances : guillemets, apostrophes, ellipse.
ok(t04.citationAncree("La Cour recommande d'améliorer l'information sur le marché … de construire une réponse stratégique coordonnée", chunk('C0997').texte), 'ellipse et apostrophes droites acceptées');

console.log(`T04 ancrage : ${n} tests OK`);
