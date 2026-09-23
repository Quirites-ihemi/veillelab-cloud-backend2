"use strict";

const path = require("path");
const publications = require(path.join(__dirname, "corpus", "publications.json"));
const expertiseNodes = require(path.join(__dirname, "corpus", "expertise_nodes.json"));

const MODEL_EXPERTS = process.env.MODEL_EXPERTS || "claude-haiku-4-5-20251001";
const MAX_RETRIEVED_UNITS = 36;
const MAX_FINAL_EXPERTS = 27;

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
        byName.set(key, { name, publications: [] });
      }

      byName.get(key).publications.push({
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

function buildEvidenceUnits() {
  const units = new Map();

  for (const profile of EXPERT_PROFILES) {
    for (const pub of profile.publications) {
      for (const expertise of pub.expertises) {
        const unitId = `${pub.publication_id}::${expertise.id}`;
        if (!units.has(unitId)) {
          units.set(unitId, {
            unit_id: unitId,
            publication_id: pub.publication_id,
            publication_title: pub.titre,
            organisation: pub.organisme_producteur,
            domain: pub.domaine,
            expertise_id: expertise.id,
            expertise_label: expertise.label,
            expertise_family: expertise.family,
            expertise_definition: expertise.definition,
            profile_ids: []
          });
        }
        const unit = units.get(unitId);
        if (!unit.profile_ids.includes(profile.profile_id)) unit.profile_ids.push(profile.profile_id);
      }
    }
  }

  return [...units.values()].sort((a, b) =>
    a.publication_id.localeCompare(b.publication_id) ||
    a.expertise_id.localeCompare(b.expertise_id)
  );
}

const EVIDENCE_UNITS = buildEvidenceUnits();
const EVIDENCE_UNIT_BY_ID = new Map(EVIDENCE_UNITS.map(x => [x.unit_id, x]));

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
  return contentTokens(query).length === 0;
}

async function callAnthropicTool({ apiKey, tool, system, userText, maxTokens = 2200 }) {
  const payload = {
    model: MODEL_EXPERTS,
    max_tokens: maxTokens,
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

function compactEvidenceUnit(unit) {
  return {
    unit_id: unit.unit_id,
    publication_id: unit.publication_id,
    publication_title: unit.publication_title,
    organisation: unit.organisation,
    domain: unit.domain,
    expertise_id: unit.expertise_id,
    expertise_label: unit.expertise_label,
    expertise_family: unit.expertise_family,
    expertise_definition: unit.expertise_definition
  };
}

async function retrieveRelevantEvidence({ apiKey, query }) {
  const tool = {
    name: "selectionner_preuves_expertise",
    description: "Repère les unités documentaires qui peuvent réellement documenter l'expertise demandée, sans encore décider quels auteurs sont experts.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        selected_units: {
          type: "array",
          items: {
            type: "object",
            properties: {
              unit_id: { type: "string" },
              reason: { type: "string" }
            },
            required: ["unit_id", "reason"],
            additionalProperties: false
          }
        }
      },
      required: ["selected_units"],
      additionalProperties: false
    }
  };

  const system = `
Tu réalises l'ÉTAPE 1 d'un moteur documentaire d'identification d'experts ministériels.

Tu ne sélectionnes PAS des personnes. Tu sélectionnes des UNITÉS DE PREUVE rattachées à une publication précise.
Chaque unité associe : une micro-expertise validée + le titre, le domaine et l'organisme de la publication qui la documente.

OBJECTIF :
Retrouver avec un BON RAPPEL les unités réellement pertinentes pour la demande, afin qu'une seconde étape plus stricte valide ensuite les experts.

RÈGLES :
- Utilise exclusivement les unités fournies. Aucune connaissance extérieure.
- Raisonne sur le sens, les reformulations et les équivalences sémantiques normales : par exemple « effets » peut correspondre à « impacts » si le reste du contexte est cohérent.
- Une demande large portant sur un THÈME (ex. « sécurité routière », « changement climatique sur les territoires », « immigration ») peut être documentée par des micro-expertises de problème public, d'instrument ou de méthode clairement ancrées dans ce thème.
- Une demande portant sur une PRATIQUE ou une NATURE D'EXPERTISE précise (ex. « analyse criminelle », « politique publique de lutte contre la délinquance », « pilotage ») exige des unités dont la micro-expertise ET/OU le contexte explicite de la publication soutiennent cette nature précise.
- Le TITRE de publication est une composante de preuve importante : il peut préciser le thème ou la nature de l'expertise quand le libellé de micro-expertise est plus générique.
- Ne sélectionne pas une méthode générique (« analyse géospatiale », « traitement des données », etc.) uniquement parce qu'un mot de la demande apparaît : le contexte de la publication doit aussi être pertinent.
- Ne confonds pas des champs voisins : criminologie, analyse criminelle, criminalistique, statistiques de délinquance, politique publique de sécurité, prévention, etc.
- N'exige pas à cette étape une certitude absolue sur la PERSONNE : si une unité est substantiellement pertinente, inclus-la. La seconde étape éliminera les faux positifs.
- Si aucune unité n'est réellement pertinente, retourne selected_units: [].
`;

  const userText = `DEMANDE :\n${query}\n\nUNITÉS DOCUMENTAIRES FERMÉES :\n${JSON.stringify(EVIDENCE_UNITS.map(compactEvidenceUnit))}`;
  const raw = await callAnthropicTool({ apiKey, tool, system, userText, maxTokens: 2200 });

  const selected = [];
  const seen = new Set();
  for (const item of raw?.selected_units || []) {
    const unitId = clean(item?.unit_id);
    if (!EVIDENCE_UNIT_BY_ID.has(unitId) || seen.has(unitId)) continue;
    seen.add(unitId);
    selected.push({ unit_id: unitId, reason: clean(item?.reason) });
    if (selected.length >= MAX_RETRIEVED_UNITS) break;
  }
  return selected;
}

function buildCandidateProfiles(retrievedUnits) {
  const byProfile = new Map();

  for (const retrieved of retrievedUnits) {
    const unit = EVIDENCE_UNIT_BY_ID.get(retrieved.unit_id);
    if (!unit) continue;

    for (const profileId of unit.profile_ids) {
      const profile = PROFILE_BY_ID.get(profileId);
      if (!profile) continue;
      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, {
          profile_id: profileId,
          name: profile.name,
          publication_contexts: []
        });
      }

      const candidate = byProfile.get(profileId);
      let context = candidate.publication_contexts.find(x => x.publication_id === unit.publication_id);
      if (!context) {
        context = {
          publication_id: unit.publication_id,
          title: unit.publication_title,
          organisation: unit.organisation,
          domain: unit.domain,
          selected_evidence: []
        };
        candidate.publication_contexts.push(context);
      }

      if (!context.selected_evidence.some(x => x.unit_id === unit.unit_id)) {
        context.selected_evidence.push({
          unit_id: unit.unit_id,
          expertise_id: unit.expertise_id,
          expertise_label: unit.expertise_label,
          expertise_family: unit.expertise_family,
          expertise_definition: unit.expertise_definition,
          retrieval_reason: retrieved.reason
        });
      }
    }
  }

  return [...byProfile.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function validateCandidateExperts({ apiKey, query, candidates }) {
  const tool = {
    name: "valider_experts",
    description: "Valide uniquement les experts dont le contexte documentaire propre établit suffisamment l'expertise demandée.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        selected: {
          type: "array",
          items: {
            type: "object",
            properties: {
              profile_id: { type: "string" },
              reason: { type: "string" },
              evidence_unit_ids: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["profile_id", "reason", "evidence_unit_ids"],
            additionalProperties: false
          }
        }
      },
      required: ["selected"],
      additionalProperties: false
    }
  };

  const system = `
Tu réalises l'ÉTAPE 2, stricte, d'un moteur documentaire d'identification d'experts ministériels.

L'étape 1 a présélectionné des unités de preuve potentiellement pertinentes. Tu dois maintenant décider si le PROFIL DOCUMENTAIRE PROPRE de chaque personne établit réellement l'expertise demandée.

RÈGLES IMPÉRATIVES :
- Utilise exclusivement les candidats et unités fournis. Aucune connaissance extérieure.
- Une signature seule n'est jamais une preuve suffisante.
- Chaque unité est strictement rattachée à SA publication : ne transfère jamais une micro-expertise vers une autre publication ou un autre contexte.
- Pour une demande LARGE DE THÈME (ex. « sécurité routière », « effets du changement climatique sur les territoires », « immigration »), accepte un profil quand sa propre publication et ses unités sélectionnées portent explicitement et substantiellement sur ce thème. N'exige pas que le libellé contienne mot pour mot la demande.
- Pour une demande de PRATIQUE, MÉTHODE ou RÔLE précis (ex. « analyse criminelle », « pilotage d'une politique publique »), exige une preuve de cette nature précise ; un domaine voisin ne suffit pas.
- Pour une demande de POLITIQUE PUBLIQUE, une publication explicitement consacrée aux politiques publiques correspondantes peut constituer un contexte probant, même si la micro-expertise associée est formulée comme méthode ou mise en perspective. En revanche, une simple publication statistique sur le phénomène ne suffit pas.
- Une méthode générique (« analyse géospatiale », « traitement et analyse des données », etc.) ne suffit jamais seule à prouver une expertise thématique : le titre et le sujet de la publication doivent confirmer la pertinence.
- Distingue les champs voisins : criminologie / analyse criminelle / criminalistique ; statistiques de délinquance / politique publique de lutte contre la délinquance ; étude d'un risque / pilotage d'une politique de prévention.
- Si plusieurs personnes sont coauteurs de la même publication et qu'aucune donnée du corpus ne permet de distinguer leurs contributions, traite-les de la même façon : ne crée pas artificiellement une différence.
- En cas de doute substantiel, ne retiens pas la personne.
- Pour chaque personne retenue, cite uniquement des evidence_unit_ids présents dans son profil candidat.
- Si aucune personne n'est suffisamment étayée, retourne selected: [].
`;

  const userText = `DEMANDE :\n${query}\n\nCANDIDATS ET PREUVES PRÉSÉLECTIONNÉES :\n${JSON.stringify(candidates)}`;
  return callAnthropicTool({ apiKey, tool, system, userText, maxTokens: 2200 });
}

function validateFinalSelection(rawSelection, candidates) {
  const candidateById = new Map(candidates.map(x => [x.profile_id, x]));
  const out = [];
  const seenProfiles = new Set();

  for (const item of rawSelection?.selected || []) {
    const profileId = clean(item?.profile_id);
    const candidate = candidateById.get(profileId);
    if (!candidate || seenProfiles.has(profileId)) continue;

    const allowedUnits = new Set(
      candidate.publication_contexts.flatMap(ctx => ctx.selected_evidence.map(e => e.unit_id))
    );
    const unitIds = [...new Set((item?.evidence_unit_ids || []).map(clean).filter(id => allowedUnits.has(id)))];
    if (!unitIds.length) continue;

    const evidenceByPublication = new Map();
    for (const unitId of unitIds) {
      const unit = EVIDENCE_UNIT_BY_ID.get(unitId);
      if (!unit || !unit.profile_ids.includes(profileId)) continue;
      if (!evidenceByPublication.has(unit.publication_id)) evidenceByPublication.set(unit.publication_id, new Set());
      evidenceByPublication.get(unit.publication_id).add(unit.expertise_id);
    }

    const evidence = [...evidenceByPublication.entries()].map(([publication_id, ids]) => ({
      publication_id,
      expertise_ids: [...ids]
    }));
    if (!evidence.length) continue;

    seenProfiles.add(profileId);
    out.push({
      profile_id: profileId,
      reason: clean(item?.reason),
      evidence
    });
    if (out.length >= MAX_FINAL_EXPERTS) break;
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

function stats(extra = {}) {
  const uniqueExpertiseIds = new Set(EVIDENCE_UNITS.map(x => x.expertise_id));
  return {
    directory_experts: DIRECTORY_EXPERTS,
    searchable_expertises: uniqueExpertiseIds.size,
    evidence_units: EVIDENCE_UNITS.length,
    total_expertises: Array.isArray(expertiseNodes) ? expertiseNodes.length : 0,
    publications_available: Array.isArray(publications) ? publications.length : 0,
    ...extra
  };
}

function buildSelectedExpertises(selected) {
  const selectedExpertises = [];
  const seen = new Set();

  for (const item of selected) {
    const profile = PROFILE_BY_ID.get(item.profile_id);
    if (!profile) continue;
    for (const evidence of item.evidence) {
      const pub = profile.publications.find(p => p.publication_id === evidence.publication_id);
      if (!pub) continue;
      const expertiseById = new Map(pub.expertises.map(x => [x.id, x]));
      for (const id of evidence.expertise_ids) {
        const expertise = expertiseById.get(id);
        if (!expertise) continue;
        const key = `${item.profile_id}:${evidence.publication_id}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
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

  return selectedExpertises;
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
      engine: "expert-search-v1.3-two-stage",
      query,
      status: "insufficient_query",
      message: "Précisez le sujet ou la compétence recherchée avant de lancer la recherche.",
      selected_expertises: [],
      experts: [],
      stats: stats({ retrieved_units: 0, candidate_experts: 0 })
    };
  }

  const retrievedUnits = await retrieveRelevantEvidence({ apiKey, query });
  if (!retrievedUnits.length) {
    return {
      ok: true,
      engine: "expert-search-v1.3-two-stage",
      query,
      status: "no_relevant_evidence",
      message: "Le référentiel ne contient pas de micro-expertise rattachée à une publication ministérielle suffisamment pertinente pour cette demande.",
      selected_expertises: [],
      experts: [],
      stats: stats({ retrieved_units: 0, candidate_experts: 0 })
    };
  }

  const candidates = buildCandidateProfiles(retrievedUnits);
  const rawFinal = await validateCandidateExperts({ apiKey, query, candidates });
  const selected = validateFinalSelection(rawFinal, candidates);

  if (!selected.length) {
    return {
      ok: true,
      engine: "expert-search-v1.3-two-stage",
      query,
      status: "no_matching_expert",
      message: "Des éléments du référentiel sont liés au sujet, mais aucun des profils ministériels associés ne fournit une preuve suffisamment précise de l'expertise demandée.",
      selected_expertises: [],
      experts: [],
      stats: stats({ retrieved_units: retrievedUnits.length, candidate_experts: candidates.length })
    };
  }

  const unfilteredExperts = selected.map(buildExpertResult);
  const experts = applyOptionalFilters(unfilteredExperts, body)
    .sort((a, b) => b.matches.length - a.matches.length || a.name.localeCompare(b.name, "fr"));

  const status = experts.length ? "ok" : "no_expert_after_filters";
  const message = status === "ok"
    ? `${experts.length} expert${experts.length > 1 ? "s" : ""} documenté${experts.length > 1 ? "s" : ""} par des preuves rattachées à leurs propres publications.`
    : "Des experts correspondent à la demande, mais aucun ne répond aux filtres Organisme/Domaine sélectionnés.";

  return {
    ok: true,
    engine: "expert-search-v1.3-two-stage",
    query,
    status,
    message,
    selected_expertises: buildSelectedExpertises(selected),
    experts,
    stats: stats({ retrieved_units: retrievedUnits.length, candidate_experts: candidates.length }),
    guardrails: {
      corpus_only: true,
      two_stage_retrieval_and_validation: true,
      publication_scoped_expertise: true,
      no_cross_publication_expertise_transfer: true,
      authorship_alone_is_not_expertise: true,
      generic_method_alone_is_not_thematic_expertise: true,
      lexical_match_alone_is_not_enough: true,
      broad_topic_recall_preserved: true,
      strict_final_validation: true,
      underspecified_query_guard: true
    }
  };
}

module.exports = {
  searchExperts,
  EXPERT_PROFILES,
  EVIDENCE_UNITS,
  queryIsUnderspecified,
  DIRECTORY_EXPERTS
};
