"use strict";

const path = require("path");
const publications = require(path.join(__dirname, "corpus", "publications.json"));
const expertiseNodes = require(path.join(__dirname, "corpus", "expertise_nodes.json"));

const MODEL_EXPERTS = process.env.MODEL_EXPERTS || "claude-haiku-4-5-20251001";
const MAX_SELECTED_EXPERTS = 27;

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

function splitDomains(value) {
  return clean(value).split(/[;|,]/).map(clean).filter(Boolean);
}

function publicationUrl(pub) {
  return clean(pub?.url_contenu) || clean(pub?.url_source);
}

const PUBLICATION_BY_ID = new Map(
  (publications || [])
    .map(pub => [clean(pub?.publication_id), pub])
    .filter(([id]) => id)
);

const EXPERTISE_BY_PUBLICATION = new Map();
for (const expertise of expertiseNodes || []) {
  const compact = {
    id: clean(expertise?.id),
    label: clean(expertise?.label),
    family: clean(expertise?.family),
    definition: clean(expertise?.definition)
  };
  if (!compact.id || !compact.label) continue;
  for (const publication of expertise?.publications || []) {
    const publicationId = clean(publication?.publication_id);
    if (!publicationId || !PUBLICATION_BY_ID.has(publicationId)) continue;
    if (!EXPERTISE_BY_PUBLICATION.has(publicationId)) {
      EXPERTISE_BY_PUBLICATION.set(publicationId, []);
    }
    EXPERTISE_BY_PUBLICATION.get(publicationId).push(compact);
  }
}

function buildExpertProfiles() {
  const byName = new Map();

  for (const pub of publications || []) {
    const publicationId = clean(pub?.publication_id);
    const authors = splitAuthors(pub?.auteurs_MI);
    if (!publicationId || !authors.length) continue;

    const publicationExpertises = (EXPERTISE_BY_PUBLICATION.get(publicationId) || [])
      .map(x => ({ ...x }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));

    for (const name of authors) {
      const key = norm(name);
      if (!byName.has(key)) {
        byName.set(key, {
          name,
          publications: []
        });
      }

      const profile = byName.get(key);
      profile.publications.push({
        publication_id: publicationId,
        titre: clean(pub?.titre),
        année_publication: clean(pub?.["année_publication"] || pub?.annee_publication),
        organisme_producteur: clean(pub?.organisme_producteur),
        domaine: clean(pub?.domaine),
        url_source: clean(pub?.url_source),
        url_contenu: clean(pub?.url_contenu),
        expertises: publicationExpertises
      });
    }
  }

  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((profile, index) => ({
      profile_id: `EXP${String(index + 1).padStart(3, "0")}`,
      ...profile,
      publications: profile.publications.sort((a, b) =>
        String(b.année_publication || "").localeCompare(String(a.année_publication || "")) ||
        a.publication_id.localeCompare(b.publication_id)
      )
    }));
}

const EXPERT_PROFILES = buildExpertProfiles();
const PROFILE_BY_ID = new Map(EXPERT_PROFILES.map(x => [x.profile_id, x]));
const DIRECTORY_EXPERTS = EXPERT_PROFILES.length;

const QUERY_NOISE = new Set([
  "je","j","veux","voudrais","souhaite","souhaiterais","cherche","recherche","rechercher","besoin","avoir","trouver","identifier","repérer","reperer",
  "un","une","des","de","du","d","en","dans","sur","pour","au","aux","le","la","les","l","qui","que","quoi","est","suis","soit",
  "expert","experte","experts","expertes","specialiste","specialistes","spécialiste","spécialistes","matiere","matière","domaine","sujet","theme","thème"
].map(norm));

function contentTokens(query) {
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !QUERY_NOISE.has(token));
}

function queryIsUnderspecified(query) {
  const tokens = contentTokens(query);
  return tokens.length === 0;
}

function compactProfileForModel(profile) {
  return {
    profile_id: profile.profile_id,
    name: profile.name,
    publication_contexts: profile.publications.map(pub => ({
      publication_id: pub.publication_id,
      title: pub.titre,
      organisation: pub.organisme_producteur,
      domain: pub.domaine,
      micro_expertises: pub.expertises.map(x => ({
        id: x.id,
        label: x.label,
        family: x.family,
        definition: x.definition
      }))
    }))
  };
}

async function callSelector({ apiKey, query }) {
  const tool = {
    name: "selectionner_experts",
    description: "Sélectionne uniquement les experts dont le profil documentaire apporte une preuve directe et suffisamment précise de l'expertise demandée.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        selected: {
          type: "array",
          maxItems: MAX_SELECTED_EXPERTS,
          items: {
            type: "object",
            properties: {
              profile_id: { type: "string" },
              reason: { type: "string" },
              evidence: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    publication_id: { type: "string" },
                    expertise_ids: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string" }
                    }
                  },
                  required: ["publication_id", "expertise_ids"],
                  additionalProperties: false
                }
              }
            },
            required: ["profile_id", "reason", "evidence"],
            additionalProperties: false
          }
        }
      },
      required: ["selected"],
      additionalProperties: false
    }
  };

  const system = `
Tu es un filtre documentaire STRICT chargé d'identifier des EXPERTS MINISTÉRIELS à partir d'un corpus fermé.

Tu ne sélectionnes PAS d'abord des micro-expertises globales. Tu évalues CHAQUE PERSONNE à partir de son propre profil documentaire.

Chaque profil contient :
- les publications effectivement associées à cette personne dans le corpus ;
- pour chaque publication, uniquement les micro-expertises rattachées à CETTE publication.

OBJECTIF :
Retenir une personne uniquement si son propre profil fournit une preuve directe, précise et cohérente de l'expertise demandée.

RÈGLES IMPÉRATIVES :
- Utilise exclusivement les profils fournis. Aucune connaissance extérieure.
- La présence d'un nom comme auteur permet seulement d'entrer dans le répertoire ; elle ne suffit JAMAIS à prouver l'expertise demandée.
- Un domaine général de publication ne suffit jamais à qualifier une expertise.
- Une simple proximité lexicale ne suffit jamais.
- Ne transfère JAMAIS une micro-expertise d'une publication à une autre publication qui porte le même identifiant de micro-expertise.
- Une micro-expertise générique comme « analyse géospatiale », « traitement et analyse des données » ou « analyse comparative » ne prouve pas, à elle seule, une expertise thématique. Le CONTEXTE DE LA PUBLICATION doit aussi correspondre au sujet demandé.
- Toute dimension essentielle de la demande doit être soutenue par la MÊME preuve documentaire : sujet + nature de l'expertise + qualificatifs utiles.
- Ne combine pas artificiellement un mot provenant d'une micro-expertise avec un autre mot provenant d'une publication sans rapport pour fabriquer une expertise.
- Distingue strictement les champs voisins : criminologie, analyse criminelle, criminalistique, statistiques de délinquance, politique publique de sécurité, prévention, etc. Ils ne sont pas interchangeables.
- Distingue strictement le SUJET étudié de la NATURE DE L'EXPERTISE demandée.
- Une expertise statistique ou descriptive sur un phénomène ne devient pas une expertise de conception, de pilotage ou de mise en œuvre d'une politique publique.
- Pour une demande large portant seulement sur un sujet (ex. immigration), une publication et des micro-expertises explicitement consacrées à ce sujet ou à ses dimensions administratives peuvent constituer une preuve suffisante.
- Pour une demande technique ou professionnelle précise (ex. analyse criminelle), n'accepte pas des compétences seulement voisines ou génériques : la pratique demandée doit être explicitement documentée par le profil.
- Si aucune personne ne satisfait ces critères, retourne selected: [].
- En cas de doute, ne sélectionne pas.

PREUVE OBLIGATOIRE :
Pour chaque personne retenue, fournis au moins un bloc evidence contenant :
- un publication_id appartenant réellement à son profil ;
- un ou plusieurs expertise_ids appartenant réellement à cette même publication ;
- un reason bref expliquant pourquoi CET ensemble précis répond à la demande.
`;

  const catalogForModel = EXPERT_PROFILES.map(compactProfileForModel);
  const userText = `DEMANDE :\n${query}\n\nPROFILS DOCUMENTAIRES FERMÉS :\n${JSON.stringify(catalogForModel)}`;

  const payload = {
    model: MODEL_EXPERTS,
    max_tokens: 2600,
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

function validateSelection(selection) {
  const out = [];
  const seen = new Set();

  for (const item of selection?.selected || []) {
    const profileId = clean(item?.profile_id);
    const profile = PROFILE_BY_ID.get(profileId);
    if (!profile || seen.has(profileId)) continue;

    const validEvidence = [];
    for (const evidence of item?.evidence || []) {
      const publicationId = clean(evidence?.publication_id);
      const pub = profile.publications.find(p => p.publication_id === publicationId);
      if (!pub) continue;

      const allowedIds = new Set(pub.expertises.map(x => x.id));
      const expertiseIds = [...new Set((evidence?.expertise_ids || []).map(clean).filter(id => allowedIds.has(id)))];
      if (!expertiseIds.length) continue;

      validEvidence.push({ publication_id: publicationId, expertise_ids: expertiseIds });
    }

    if (!validEvidence.length) continue;
    seen.add(profileId);
    out.push({
      profile_id: profileId,
      reason: clean(item?.reason),
      evidence: validEvidence
    });
  }

  return out;
}

function buildExpertResult(item) {
  const profile = PROFILE_BY_ID.get(item.profile_id);
  const evidencePublicationIds = new Set(item.evidence.map(x => x.publication_id));
  const evidencePublications = profile.publications.filter(p => evidencePublicationIds.has(p.publication_id));

  const matches = [];
  const selectedExpertiseIds = new Set();

  for (const evidence of item.evidence) {
    const pub = profile.publications.find(p => p.publication_id === evidence.publication_id);
    if (!pub) continue;
    const expertiseById = new Map(pub.expertises.map(x => [x.id, x]));

    for (const expertiseId of evidence.expertise_ids) {
      const expertise = expertiseById.get(expertiseId);
      if (!expertise) continue;
      selectedExpertiseIds.add(expertiseId);
      matches.push({
        result_id: `expert-profile:${profile.profile_id}:${pub.publication_id}:${expertiseId}`,
        kind: "expertise",
        score: 100,
        publication_id: pub.publication_id,
        publication_title: pub.titre,
        organisme_producteur: pub.organisme_producteur,
        locator: "",
        label: expertise.label,
        definition: expertise.definition,
        expertise_id: expertise.id,
        family: expertise.family,
        selection_reason: item.reason,
        source_url: publicationUrl(pub)
      });
    }
  }

  const organisations = [...new Set(evidencePublications.map(p => p.organisme_producteur).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));
  const domains = [...new Set(evidencePublications.flatMap(p => splitDomains(p.domaine)))]
    .sort((a, b) => a.localeCompare(b, "fr"));

  return {
    name: profile.name,
    organisations,
    domains,
    publications: evidencePublications.map(pub => ({
      publication_id: pub.publication_id,
      titre: pub.titre,
      année_publication: pub.année_publication,
      organisme_producteur: pub.organisme_producteur,
      domaine: pub.domaine,
      url_source: pub.url_source,
      url_contenu: pub.url_contenu
    })),
    matches,
    expertise_ids: [...selectedExpertiseIds],
    selection_reason: item.reason
  };
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

function stats() {
  const uniqueExpertiseIds = new Set();
  let publicationContexts = 0;
  for (const profile of EXPERT_PROFILES) {
    publicationContexts += profile.publications.length;
    for (const pub of profile.publications) {
      for (const expertise of pub.expertises) uniqueExpertiseIds.add(expertise.id);
    }
  }
  return {
    directory_experts: DIRECTORY_EXPERTS,
    searchable_expertises: uniqueExpertiseIds.size,
    expert_publication_contexts: publicationContexts,
    total_expertises: Array.isArray(expertiseNodes) ? expertiseNodes.length : 0,
    publications_available: Array.isArray(publications) ? publications.length : 0
  };
}

async function searchExperts({ apiKey, body = {} }) {
  const query = clean(body.query);
  if (!query) {
    const err = new Error("Le champ query est obligatoire.");
    err.statusCode = 400;
    throw err;
  }

  if (queryIsUnderspecified(query)) {
    return {
      ok: true,
      engine: "expert-search-v1.2-expert-profile",
      query,
      status: "insufficient_query",
      message: "Précisez le sujet ou la compétence recherchée avant de lancer la recherche.",
      selected_expertises: [],
      experts: [],
      stats: stats()
    };
  }

  const rawSelection = await callSelector({ apiKey, query });
  const selected = validateSelection(rawSelection);

  if (!selected.length) {
    return {
      ok: true,
      engine: "expert-search-v1.2-expert-profile",
      query,
      status: "no_matching_expert",
      message: "Aucun des 27 profils documentaires ne fournit une preuve suffisamment précise de l'expertise demandée.",
      selected_expertises: [],
      experts: [],
      stats: stats()
    };
  }

  const unfilteredExperts = selected.map(buildExpertResult);
  const experts = applyOptionalFilters(unfilteredExperts, body)
    .sort((a, b) => b.matches.length - a.matches.length || a.name.localeCompare(b.name, "fr"));

  const status = experts.length ? "ok" : "no_expert_after_filters";
  const message = status === "ok"
    ? `${experts.length} expert${experts.length > 1 ? "s" : ""} documenté${experts.length > 1 ? "s" : ""} par une preuve directement rattachée à leur propre profil.`
    : "Des experts correspondent à la demande, mais aucun ne répond aux filtres Organisme/Domaine sélectionnés.";

  const selectedExpertises = [];
  const seenExpertiseKey = new Set();
  for (const item of selected) {
    const profile = PROFILE_BY_ID.get(item.profile_id);
    for (const evidence of item.evidence) {
      const pub = profile.publications.find(p => p.publication_id === evidence.publication_id);
      if (!pub) continue;
      const expertiseById = new Map(pub.expertises.map(x => [x.id, x]));
      for (const id of evidence.expertise_ids) {
        const expertise = expertiseById.get(id);
        if (!expertise) continue;
        const key = `${item.profile_id}:${evidence.publication_id}:${id}`;
        if (seenExpertiseKey.has(key)) continue;
        seenExpertiseKey.add(key);
        selectedExpertises.push({
          id,
          label: expertise.label,
          family: expertise.family,
          publication_id: evidence.publication_id,
          expert: profile.name,
          reason: item.reason
        });
      }
    }
  }

  return {
    ok: true,
    engine: "expert-search-v1.2-expert-profile",
    query,
    status,
    message,
    selected_expertises: selectedExpertises,
    experts,
    stats: stats(),
    guardrails: {
      corpus_only: true,
      expert_profile_first: true,
      publication_scoped_expertise: true,
      no_cross_publication_expertise_transfer: true,
      authorship_alone_is_not_expertise: true,
      generic_method_alone_is_not_thematic_expertise: true,
      lexical_match_alone_is_not_enough: true,
      underspecified_query_guard: true
    }
  };
}

module.exports = {
  searchExperts,
  EXPERT_PROFILES,
  queryIsUnderspecified,
  DIRECTORY_EXPERTS
};
