"use strict";

const path = require("path");
const { getCorpusStore } = require("./corpusStore");
const expertiseNodes = require(path.join(__dirname, "corpus", "expertise_nodes.json"));

const MODEL_EXPERTS = process.env.MODEL_EXPERTS || "claude-haiku-4-5-20251001";
const MAX_SELECTED_EXPERTISES = 16;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function norm(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAuthors(value) {
  return clean(value)
    .split(/[;,]/)
    .map(clean)
    .filter(name => name && !/^PUB\d+\.png$/i.test(name));
}

function buildExpertiseCatalog() {
  return (expertiseNodes || []).map(x => ({
    id: clean(x.id),
    label: clean(x.label),
    family: clean(x.family),
    definition: clean(x.definition),
    publication_ids: (x.publications || []).map(p => clean(p.publication_id)).filter(Boolean)
  })).filter(x => x.id && x.label);
}

const EXPERTISE_CATALOG = buildExpertiseCatalog();
const EXPERTISE_BY_ID = new Map(EXPERTISE_CATALOG.map(x => [x.id, x]));

function publicationUrl(pub) {
  return clean(pub?.url_contenu) || clean(pub?.url_source);
}

function buildCandidates(selectedIds) {
  const store = getCorpusStore();
  const selected = selectedIds.map(id => EXPERTISE_BY_ID.get(id)).filter(Boolean);
  const byExpert = new Map();

  for (const expertise of selected) {
    for (const publicationId of expertise.publication_ids) {
      const pub = store.publicationById.get(publicationId);
      if (!pub) continue;
      const authors = splitAuthors(pub.auteurs_MI);
      if (!authors.length) continue;

      for (const name of authors) {
        const key = norm(name);
        if (!byExpert.has(key)) {
          byExpert.set(key, {
            name,
            organisations: new Set(),
            domains: new Set(),
            publications: new Map(),
            matches: [],
            expertise_ids: new Set()
          });
        }
        const e = byExpert.get(key);
        if (clean(pub.organisme_producteur)) e.organisations.add(clean(pub.organisme_producteur));
        if (clean(pub.domaine)) e.domains.add(clean(pub.domaine));
        e.expertise_ids.add(expertise.id);
        e.publications.set(publicationId, {
          publication_id: publicationId,
          titre: clean(pub.titre),
          année_publication: clean(pub["année_publication"] || pub.annee_publication),
          organisme_producteur: clean(pub.organisme_producteur),
          domaine: clean(pub.domaine),
          url_source: clean(pub.url_source),
          url_contenu: clean(pub.url_contenu)
        });
        e.matches.push({
          result_id: `expertise:${expertise.id}:${publicationId}`,
          kind: "expertise",
          score: 100,
          publication_id: publicationId,
          publication_title: clean(pub.titre),
          organisme_producteur: clean(pub.organisme_producteur),
          locator: "",
          label: expertise.label,
          definition: expertise.definition,
          expertise_id: expertise.id,
          family: expertise.family,
          source_url: publicationUrl(pub)
        });
      }
    }
  }

  return [...byExpert.values()].map(e => ({
    name: e.name,
    organisations: [...e.organisations].sort((a, b) => a.localeCompare(b, "fr")),
    domains: [...e.domains].sort((a, b) => a.localeCompare(b, "fr")),
    publications: [...e.publications.values()],
    matches: e.matches,
    expertise_ids: [...e.expertise_ids]
  }));
}

async function callSelector({ apiKey, query }) {
  const tool = {
    name: "selectionner_micro_expertises",
    description: "Sélectionne uniquement les micro-expertises du référentiel qui correspondent réellement à l'expertise demandée.",
    input_schema: {
      type: "object",
      properties: {
        selected: {
          type: "array",
          maxItems: MAX_SELECTED_EXPERTISES,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              reason: { type: "string" }
            },
            required: ["id", "reason"],
            additionalProperties: false
          }
        }
      },
      required: ["selected"],
      additionalProperties: false
    }
  };

  const system = `
Tu es un filtre documentaire STRICT chargé d'identifier des EXPERTISES MINISTÉRIELLES.
Tu reçois une demande utilisateur et un référentiel fermé de micro-expertises déjà validées.

Ta seule tâche est de sélectionner les micro-expertises qui correspondent réellement à la compétence demandée.

RÈGLES IMPÉRATIVES :
- Utilise exclusivement le référentiel fourni. N'invente aucun identifiant ni aucune expertise.
- Distingue le SUJET étudié de la NATURE DE L'EXPERTISE demandée.
- Une publication qui mesure ou décrit un phénomène ne prouve pas une expertise en politique publique de lutte contre ce phénomène.
- Une expertise statistique, descriptive, méthodologique ou de traitement des données ne doit pas être transformée en expertise de conception, pilotage ou mise en œuvre d'une politique publique.
- Une proximité lexicale ne suffit jamais. Exemple : « intégration de la recherche criminologique » n'a aucun lien avec l'intégration des immigrés.
- Respecte les qualificatifs de la demande : politique publique, prévention, évaluation, gestion administrative, recherche, statistique, etc.
- Si le référentiel ne contient pas d'expertise suffisamment correspondante, retourne selected: [].
- En cas de doute, ne sélectionne pas.
- Ne sélectionne pas une micro-expertise seulement parce que son domaine général est voisin du sujet.
`;

  const userText = `DEMANDE :\n${query}\n\nRÉFÉRENTIEL FERMÉ :\n${JSON.stringify(EXPERTISE_CATALOG.map(x => ({ id: x.id, label: x.label, family: x.family, definition: x.definition })))}`;

  const payload = {
    model: MODEL_EXPERTS,
    max_tokens: 1800,
    temperature: 0,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 800)}`);
      err.statusCode = response.status;
      throw err;
    }
    const json = JSON.parse(text);
    const toolUse = (json.content || []).find(b => b?.type === "tool_use" && b.name === tool.name);
    if (!toolUse?.input) {
      const err = new Error("Le moteur d'experts n'a pas retourné la sélection structurée attendue.");
      err.statusCode = 503;
      throw err;
    }
    return toolUse.input;
  } finally {
    clearTimeout(timeout);
  }
}

function applyOptionalFilters(experts, body) {
  const org = norm(body.organisme);
  const domain = norm(body.domaine);
  return experts.filter(e => {
    if (org && !e.organisations.some(x => norm(x) === org)) return false;
    if (domain && !e.domains.some(x => norm(x) === domain)) return false;
    return true;
  });
}

async function searchExperts({ apiKey, body = {} }) {
  const query = clean(body.query);
  if (!query) {
    const err = new Error("Le champ query est obligatoire.");
    err.statusCode = 400;
    throw err;
  }

  const selection = await callSelector({ apiKey, query });
  const seen = new Set();
  const selected = [];
  for (const item of selection.selected || []) {
    const id = clean(item?.id);
    if (!EXPERTISE_BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    selected.push({ id, reason: clean(item.reason) });
  }

  const experts = applyOptionalFilters(buildCandidates(selected.map(x => x.id)), body)
    .sort((a, b) => b.matches.length - a.matches.length || a.name.localeCompare(b.name, "fr"));

  return {
    ok: true,
    engine: "expert-search-v1.0-strict-microexpertise",
    query,
    selected_expertises: selected.map(item => ({
      ...item,
      label: EXPERTISE_BY_ID.get(item.id)?.label || "",
      family: EXPERTISE_BY_ID.get(item.id)?.family || ""
    })),
    experts,
    guardrails: {
      corpus_only: true,
      closed_expertise_catalog: true,
      authorship_alone_is_not_expertise: true,
      lexical_match_alone_is_not_enough: true
    }
  };
}

module.exports = { searchExperts, buildCandidates, EXPERTISE_CATALOG };
