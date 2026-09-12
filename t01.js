// =====================================================
// QUIRITES VEILLE LAB — T01 CLOUD
// V0.5 stabilisée : reprise par lot, couverture contrôlée et robustesse Anthropic.
// =====================================================

const MODEL_REDACTION = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const T01_COURT_MAX_CHUNKS = 24;
const T01_LOT_MAX_CHUNKS = 32;
const T01_LOT_MAX_CARACTERES = 65000;
const T01_MAX_RESULTATS = 7;
const T01_MAX_ENSEIGNEMENTS = 4;
const T01_MAX_NUANCES = 4;
const T01_ANTHROPIC_MAX_ATTEMPTS = 5;
const T01_EMPTY_LOT_SPLIT_MIN_CHUNKS = 7;
const T01_MIN_COVERAGE_RATIO_LONG = 0.50;

const POINT_SCHEMA = {
  type: "object",
  properties: {
    texte: { type: "string" },
    chunk_ids: { type: "array", items: { type: "string" } }
  },
  required: ["texte", "chunk_ids"],
  additionalProperties: false
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normaliserTexteSimple(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nettoyerCorpusT01(corpus) {
  const chunksVus = new Set();
  const propres = [];

  (Array.isArray(corpus) ? corpus : []).slice(0, 1).forEach(item => {
    if (!item || !item.publication_id) return;

    const chunks = (Array.isArray(item.chunks) ? item.chunks : [])
      .filter(c =>
        c &&
        c.chunk_id &&
        !chunksVus.has(String(c.chunk_id)) &&
        (!c.publication_id || String(c.publication_id) === String(item.publication_id))
      )
      .map((c, index) => {
        chunksVus.add(String(c.chunk_id));
        return {
          chunk_id: String(c.chunk_id),
          publication_id: String(item.publication_id),
          ordre: String(c.ordre || index + 1),
          section: String(c.section || ""),
          page_debut: c.page_debut === null || c.page_debut === undefined ? "" : String(c.page_debut),
          page_fin: c.page_fin === null || c.page_fin === undefined ? "" : String(c.page_fin),
          texte: String(c.texte || "").trim(),
          _index_source: index
        };
      })
      .filter(c => c.texte)
      .sort((a, b) => {
        const na = Number(a.ordre);
        const nb = Number(b.ordre);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return a._index_source - b._index_source;
      })
      .map(c => {
        delete c._index_source;
        return c;
      });

    propres.push({
      publication_id: String(item.publication_id),
      titre: String(item.titre || ""),
      organisme_producteur: String(item.organisme_producteur || ""),
      annee_publication: String(item.annee_publication || item["année_publication"] || ""),
      type_document: String(item.type_document || ""),
      url_contenu: String(item.url_contenu || ""),
      url_source: String(item.url_source || ""),
      chunks
    });
  });

  return propres.filter(p => p.chunks.length > 0);
}

function indexChunksT01(corpusPropre) {
  const map = new Map();
  corpusPropre.forEach(pub => {
    pub.chunks.forEach(c => map.set(c.chunk_id, { chunk: c, publication: pub }));
  });
  return map;
}

function contexteChunksT01(ids, corpusPropre) {
  const index = indexChunksT01(corpusPropre);
  return (ids || []).map(id => {
    const entry = index.get(id);
    if (!entry) return null;
    return {
      chunk_id: id,
      publication_id: entry.publication.publication_id,
      publication_titre: entry.publication.titre,
      ordre: entry.chunk.ordre,
      section: entry.chunk.section,
      page_debut: entry.chunk.page_debut,
      page_fin: entry.chunk.page_fin,
      texte: entry.chunk.texte
    };
  }).filter(Boolean);
}

function contexteTousChunksT01(corpusPropre) {
  const ids = [];
  corpusPropre.forEach(pub => pub.chunks.forEach(c => ids.push(c.chunk_id)));
  return contexteChunksT01(ids, corpusPropre);
}

function decouperLotsT01(chunks) {
  const lots = [];
  let courant = [];
  let caracteres = 0;

  (chunks || []).forEach(c => {
    const taille = String(c.texte || "").length;
    const depasseNombre = courant.length >= T01_LOT_MAX_CHUNKS;
    const depasseTaille = courant.length > 0 && (caracteres + taille) > T01_LOT_MAX_CARACTERES;

    if (depasseNombre || depasseTaille) {
      lots.push(courant);
      courant = [];
      caracteres = 0;
    }

    courant.push(c);
    caracteres += taille;
  });

  if (courant.length) lots.push(courant);
  return lots;
}

async function appelerClaudeAvecOutil({ apiKey, model, system, tool, userText, maxTokens }) {
  const payload = {
    model: model || MODEL_REDACTION,
    max_tokens: maxTokens || 1200,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true },
    messages: [{
      role: "user",
      content: [{ type: "text", text: String(userText) }]
    }]
  };

  let lastError = null;

  for (let attempt = 1; attempt <= T01_ANTHROPIC_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

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
        const err = new Error(`Anthropic HTTP ${response.status}: ${text.slice(0, 1200)}`);
        err.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          err.retryAfterMs = Math.min(retryAfter * 1000, 60000);
        }
        throw err;
      }

      const json = JSON.parse(text);
      const toolUse = (json.content || []).find(
        bloc => bloc && bloc.type === "tool_use" && bloc.name === tool.name
      );

      if (!toolUse || !toolUse.input) {
        const err = new Error("Claude n'a pas retourné l'appel structuré attendu.");
        err.status = 503;
        throw err;
      }

      return toolUse.input;
    } catch (error) {
      lastError = error;
      const status = Number(error && error.status);
      const retryable =
        error?.name === "AbortError" ||
        !status ||
        status === 408 ||
        status === 409 ||
        status === 429 ||
        status >= 500;

      if (!retryable || attempt === T01_ANTHROPIC_MAX_ATTEMPTS) throw error;

      const base = error?.retryAfterMs ||
        Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      const jitter = Math.floor(Math.random() * 1200);
      await sleep(base + jitter);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Échec de l'appel Anthropic.");
}

async function extraireMateriauLotT01({
  apiKey, besoin, treatment, publication, lot, numeroLot, nbLots
}) {
  const system = `
Tu effectues une EXTRACTION DOCUMENTAIRE STRICTE pour préparer le résumé analytique
D'UNE publication. Tu analyses tous les passages du lot fourni, sans connaissance extérieure.

Objectif : repérer ce qui doit pouvoir nourrir ensuite le résumé de la publication entière.
Ne rédige pas encore le résumé final.

Règles impératives :
- utilise uniquement les chunks fournis ;
- chaque élément doit être rattaché à un ou plusieurs chunk_id réellement fournis ;
- conserve les chiffres, évolutions, constats, comparaisons, dispositifs, mécanismes et conclusions utiles ;
- distingue le cadrage du document de ses éléments substantiels ;
- conserve le niveau de généralité du texte source : ne transforme pas un exemple en tendance ;
- pour toute relation statistique, formule une association et jamais une causalité non démontrée ;
- n'emploie pas « effet », « impact », « influence », « détermine », « entraîne », « cause » ou
  « explique » pour une simple association statistique ;
- n'ajoute aucune connaissance extérieure, aucun territoire parent ni précision de mémoire ;
- n'ajoute pas « principal », « majeur », « central », « stratégique », « incontournable »,
  « dominant » ou « structurant » si ces qualifications ne sont pas attestées ;
- n'utilise pas de raccord interprétatif comme « s'explique par », « révèle », « traduit »,
  « témoigne de », « signe », « incarne », « conduit à » ou « permet de » s'il n'est pas attesté ;
- parcours l'ensemble du lot, pas seulement son début ;
- vise 6 à 12 éléments réellement distincts quand le lot contient suffisamment de matière ;
- n'utilise que du français clair et grammatical ; évite les anglicismes lorsqu'un équivalent français existe ;
- évite les doublons ;
- une nuance, limite, incertitude ou réserve n'est retenue que si elle est réellement présente.

Catégories :
- cadrage ;
- substantiel ;
- nuance.
`;

  const elementSchema = {
    type: "object",
    properties: {
      categorie: { type: "string", enum: ["cadrage", "substantiel", "nuance"] },
      texte: { type: "string" },
      chunk_ids: { type: "array", items: { type: "string" } }
    },
    required: ["categorie", "texte", "chunk_ids"],
    additionalProperties: false
  };

  const tool = {
    name: "extraire_materiau_t01",
    description: "Extrait les éléments sourcés nécessaires au résumé analytique à partir d’un lot de chunks.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        elements: { type: "array", items: elementSchema }
      },
      required: ["elements"],
      additionalProperties: false
    }
  };

  const contexteLot = lot.map(c => ({
    chunk_id: c.chunk_id,
    ordre: c.ordre,
    section: c.section,
    page_debut: c.page_debut,
    page_fin: c.page_fin,
    texte: c.texte
  }));

  const brut = await appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system,
    tool,
    userText:
      `PUBLICATION : ${publication.titre}\n` +
      `LOT : ${numeroLot}/${nbLots}\n` +
      `BESOIN UTILISATEUR :\n${besoin}\n\n` +
      `OBJECTIF DU TRAITEMENT :\n${String(treatment.objectif || "")}\n\n` +
      `PASSAGES DU LOT :\n${JSON.stringify(contexteLot)}`,
    maxTokens: 2000
  });

  const autorises = new Set(lot.map(c => c.chunk_id));

  let elements = (brut.elements || []).map(el => {
    if (!el) return null;
    const ids = (el.chunk_ids || []).filter(id => autorises.has(id));
    if (!el.texte || !ids.length) return null;
    return {
      categorie: String(el.categorie || "substantiel"),
      texte: String(el.texte).trim(),
      chunk_ids: [...new Set(ids)],
      lot: numeroLot
    };
  }).filter(Boolean);

  if (elements.length) return elements;

  // Reprise factuelle unique si l'extraction du lot est vide.
  const secoursTool = {
    ...tool,
    name: "extraire_materiau_t01_secours",
    description: "Reprend une extraction documentaire vide avec des règles factuelles simplifiées."
  };

  const secours = await appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system: `
Extraction factuelle stricte. Utilise uniquement les chunks fournis.
Retourne les constats, données, évolutions, mesures, mécanismes, cadrages et nuances utiles.
Chaque élément doit citer au moins un chunk_id fourni. N'invente rien et ne crée aucune causalité.
`,
    tool: secoursTool,
    userText:
      `PUBLICATION : ${publication.titre}\nLOT : ${numeroLot}/${nbLots}\n` +
      `BESOIN : ${besoin}\nPASSAGES :\n${JSON.stringify(contexteLot)}`,
    maxTokens: 1800
  });

  return (secours.elements || []).map(el => {
    if (!el) return null;
    const ids = (el.chunk_ids || []).filter(id => autorises.has(id));
    if (!el.texte || !ids.length) return null;
    return {
      categorie: String(el.categorie || "substantiel"),
      texte: String(el.texte).trim(),
      chunk_ids: [...new Set(ids)],
      lot: numeroLot
    };
  }).filter(Boolean);
}

async function extraireMateriauLotRobusteT01({
  apiKey, besoin, treatment, publication, lot, numeroLot, nbLots
}) {
  let elements = await extraireMateriauLotT01({
    apiKey, besoin, treatment, publication, lot, numeroLot, nbLots
  });

  if (elements.length) return elements;

  if (lot.length >= T01_EMPTY_LOT_SPLIT_MIN_CHUNKS) {
    const milieu = Math.ceil(lot.length / 2);
    const sousLots = [lot.slice(0, milieu), lot.slice(milieu)].filter(x => x.length);
    const recuperes = [];

    for (let i = 0; i < sousLots.length; i += 1) {
      const extraits = await extraireMateriauLotT01({
        apiKey,
        besoin,
        treatment,
        publication,
        lot: sousLots[i],
        numeroLot,
        nbLots
      });
      recuperes.push(...extraits);
    }

    if (recuperes.length) return recuperes;
  }

  return [];
}

function construireCarteCouvertureT01(lots, elements) {
  return lots.map((lot, i) => {
    const numero = i + 1;
    const els = elements.filter(el => el.lot === numero);
    const pages = [];
    const sections = [];

    lot.forEach(c => {
      if (c.page_debut) pages.push(String(c.page_debut));
      if (c.page_fin) pages.push(String(c.page_fin));
      if (c.section) sections.push(String(c.section));
    });

    return {
      lot: numero,
      chunks: lot.length,
      pages: [...new Set(pages)].slice(0, 20),
      sections: [...new Set(sections)].slice(0, 12),
      cadrage: els.filter(el => el.categorie === "cadrage").length,
      substantiel: els.filter(el => el.categorie === "substantiel").length,
      nuances: els.filter(el => el.categorie === "nuance").length,
      apercu: els.slice(0, 6).map(el => el.texte)
    };
  });
}

function lotsSubstantielsCarteT01(carte) {
  return (carte || [])
    .filter(x => Number(x.substantiel || 0) > 0)
    .map(x => Number(x.lot))
    .filter(Number.isFinite);
}

function tauxCouvertureLotsT01(brut, index, carte) {
  const substantiels = lotsSubstantielsCarteT01(carte);
  if (!substantiels.length) return 1;
  const cites = new Set(lotsCitesSortie(brut, index));
  const couverts = substantiels.filter(lot => cites.has(lot)).length;
  return couverts / substantiels.length;
}

function resumeTool(description) {
  return {
    name: "produire_resume_analytique_t01",
    description,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        sujet: POINT_SCHEMA,
        problematique: POINT_SCHEMA,
        resultats: { type: "array", items: POINT_SCHEMA },
        enseignements: { type: "array", items: POINT_SCHEMA },
        nuances: { type: "array", items: POINT_SCHEMA }
      },
      required: ["sujet", "problematique", "resultats", "enseignements", "nuances"],
      additionalProperties: false
    }
  };
}

const SYSTEM_RESUME_STRICT = `
Tu produis un résumé analytique en régime de SYNTHÈSE STRICTE.
Tu travailles exclusivement à partir des éléments fournis.

Priorités :
1. fidélité au document ;
2. couverture des dimensions importantes ;
3. hiérarchisation et compression ;
4. lisibilité.

Règles absolues :
- aucune connaissance extérieure ; aucun fait inventé ;
- chaque point doit être rattaché à un ou plusieurs chunk_id fournis ;
- conserve le niveau de généralité de la source ;
- ne transforme pas une recommandation en constat ;
- ne transforme pas un exemple isolé en tendance ;
- pour toute relation statistique, formule une ASSOCIATION et non un effet causal, sauf démonstration
  causale explicitement décrite dans les passages ;
- n'emploie donc pas « exerce un effet », « impacte », « influence », « détermine », « entraîne »,
  « cause » ou « explique » à partir d'une simple association statistique ;
- n'ajoute pas de territoire, fonction, qualité, date, unité, acronyme ou précision de mémoire ;
- n'ajoute pas « principal », « majeur », « central », « stratégique », « incontournable »,
  « dominant » ou « structurant » sauf si cette qualification est explicitement attestée ;
- évite « s'explique par », « révèle », « traduit », « témoigne de », « signe », « incarne »,
  « conduit à », « permet de » et les raccords interprétatifs équivalents, sauf attestation explicite ;
- le sujet décrit sobrement ce dont traite la publication ;
- la problématique reformule le problème, la question ou la tension réellement traitée ;
- les résultats décrivent ce que la publication établit, observe, mesure, compare ou documente ;
- les enseignements sont des synthèses descriptives prudentes directement soutenues par le document ;
- un enseignement ne doit jamais répéter le sujet, la problématique ou un résultat ;
- n'emploie pas de jugement tel que « pertinent », « robuste », « efficace », « important » ou « nécessaire »
  sauf si cette appréciation est explicitement portée par la source ;
- les nuances recensent uniquement des limites, précautions méthodologiques, incertitudes ou réserves attestées ;
- une stratégie, un choix institutionnel ou un résultat descriptif n'est pas une nuance ;
- rédige en français naturel et grammatical, sans anglicisme évitable ;
- évite les répétitions.

Hiérarchisation :
- vise 4 à 7 résultats au maximum ;
- fusionne les résultats proches ;
- vise 0 à 4 enseignements et 0 à 4 nuances ;
- retourne un tableau vide lorsqu'un enseignement ou une nuance ne peut pas être formulé sans extrapolation.
`;

async function produireStructureDirecteT01({ apiKey, besoin, treatment, contexte }) {
  return appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system: SYSTEM_RESUME_STRICT,
    tool: resumeTool("Produit un résumé analytique strict, hiérarchisé et rattaché aux chunks sources."),
    userText:
      `BESOIN UTILISATEUR :\n${besoin}\n\n` +
      `PROMPT DU TRAITEMENT :\n${String(treatment.prompt_systeme || "")}\n\n` +
      `PASSAGES AUTORISÉS :\n${JSON.stringify(contexte)}`,
    maxTokens: 2400
  });
}

async function produireStructureDepuisMateriauT01({
  apiKey, besoin, treatment, publication, materiau, nbLots
}) {
  const entree = materiau.map((el, i) => ({
    element_id: `E${i + 1}`,
    categorie: el.categorie,
    texte: el.texte,
    chunk_ids: el.chunk_ids,
    lot: el.lot
  }));

  const repartition = {};
  materiau.forEach(el => {
    repartition[el.lot] = (repartition[el.lot] || 0) + 1;
  });

  const system = `${SYSTEM_RESUME_STRICT}

Le matériau provient d'une première passe qui a couvert TOUS les chunks successivement.
Pour un document en plusieurs lots :
- examine les éléments de chaque lot avant de rédiger ;
- ne concentre pas automatiquement la synthèse sur le dernier lot ;
- si des résultats substantiels distincts existent dans des lots différents, veille à les représenter ;
- ne force cependant pas artificiellement la présence d'un lot qui ne contient aucun résultat distinct.
`;

  return appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system,
    tool: resumeTool("Synthétise le matériau sourcé issu de la couverture intégrale en résumé analytique final."),
    userText:
      `PUBLICATION : ${publication.titre}\n` +
      `NOMBRE DE LOTS COUVERTS : ${nbLots}\n` +
      `RÉPARTITION DES ÉLÉMENTS PAR LOT : ${JSON.stringify(repartition)}\n` +
      `BESOIN UTILISATEUR :\n${besoin}\n\n` +
      `PROMPT DU TRAITEMENT :\n${String(treatment.prompt_systeme || "")}\n\n` +
      `ÉLÉMENTS DOCUMENTAIRES :\n${JSON.stringify(entree)}`,
    maxTokens: 2600
  });
}

function structureManqueResultatsT01(brut) {
  return !brut || !Array.isArray(brut.resultats) || brut.resultats.length === 0;
}

async function relancerResultatsT01({
  apiKey, besoin, treatment, publication, materiau, brutInitial
}) {
  const substantiels = (materiau || []).filter(el => el && el.categorie === "substantiel");

  if (!substantiels.length || !structureManqueResultatsT01(brutInitial)) {
    return brutInitial;
  }

  const tool = {
    name: "corriger_resume_t01",
    description: "Réexamine les éléments substantiels pour éviter l’omission injustifiée des résultats.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        sujet: POINT_SCHEMA,
        problematique: POINT_SCHEMA,
        resultats: { type: "array", items: POINT_SCHEMA },
        enseignements: { type: "array", items: POINT_SCHEMA },
        nuances: { type: "array", items: POINT_SCHEMA }
      },
      required: ["sujet", "problematique", "resultats", "enseignements", "nuances"],
      additionalProperties: false
    }
  };

  return appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system: `
Tu contrôles un résumé analytique qui ne contient aucun résultat alors que des éléments
substantiels sourcés ont été extraits de la publication.

Ta tâche est de produire à nouveau la structure complète, sans inventer.
- Examine les éléments substantiels fournis sur l'ensemble du document.
- Transforme en résultats uniquement les constats, données, évolutions, mécanismes,
  mesures ou conclusions qui sont réellement soutenus.
- Regroupe les éléments proches et vise au maximum 7 résultats hiérarchisés.
- N'ajoute aucune causalité, qualification ou interprétation absente des éléments.
- Une association statistique, y compris ajustée, reste une ASSOCIATION tant qu'une méthode
  causale n'est pas explicitement démontrée : n'écris pas « effet », « impact », « influence »,
  « détermine », « entraîne », « cause » ou « explique » dans ce cas.
- N'ajoute aucune précision géographique, institutionnelle, biographique ou numérique
  à un nom propre si elle n'est pas explicitement présente dans les éléments sourcés.
- N'emploie pas « principal », « majeur », « central », « stratégique », « incontournable »
  ou des raccords comme « révèle », « traduit », « signe », « incarne », « s'explique par »
  sauf s'ils sont explicitement attestés.
- Si malgré cet examen aucun résultat ne peut être formulé de façon fiable, le tableau
  resultats peut rester vide.
- Sujet, problématique, enseignements et nuances obéissent aux mêmes règles de synthèse stricte.
- Chaque point doit être rattaché à des chunk_id fournis.
`,
    tool,
    userText:
      `PUBLICATION : ${publication.titre}\n` +
      `BESOIN UTILISATEUR :\n${besoin}\n\n` +
      `PROMPT DU TRAITEMENT :\n${String(treatment.prompt_systeme || "")}\n\n` +
      `ÉLÉMENTS EXTRAITS :\n${JSON.stringify(materiau)}\n\n` +
      `PREMIÈRE STRUCTURE :\n${JSON.stringify(brutInitial)}`,
    maxTokens: 2600
  });
}

async function auditerCouvertureT01({
  apiKey, besoin, treatment, publication, materiau, carteCouverture, brut, index
}) {
  const lotsSubstantiels = lotsSubstantielsCarteT01(carteCouverture);
  if (lotsSubstantiels.length <= 1) return brut;

  const tauxAvant = tauxCouvertureLotsT01(brut, index, carteCouverture);
  const lotsCitesAvant = lotsCitesSortie(brut, index);

  const dernierLotSeulement =
    lotsCitesAvant.length === 1 &&
    lotsCitesAvant[0] === Math.max(...lotsSubstantiels) &&
    lotsSubstantiels.length > 1;

  if (!dernierLotSeulement && tauxAvant >= T01_MIN_COVERAGE_RATIO_LONG) {
    return brut;
  }

  const tool = resumeTool(
    "Corrige un résumé qui sous-représente des dimensions documentaires substantielles."
  );

  return appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system: `${SYSTEM_RESUME_STRICT}

Tu effectues maintenant un AUDIT DE COUVERTURE DOCUMENTAIRE.
Le brouillon peut être fidèle aux passages qu'il cite tout en omettant des dimensions importantes.

Règles supplémentaires :
- examine la carte de couverture lot par lot et le matériau extrait de TOUS les lots ;
- repère les dimensions substantielles omises dans le brouillon ;
- corrige la problématique si elle réduit abusivement le champ du document ;
- remplace, fusionne ou rééquilibre les résultats pour représenter les principaux axes réellement documentés ;
- ne cherche pas à citer chaque lot artificiellement : un lot sans apport distinct peut rester absent ;
- en revanche, ne produis pas une synthèse centrée uniquement sur la fin du document lorsque des résultats
  substantiels distincts existent plus tôt ;
- conserve 4 à 7 résultats maximum ;
- n'invente rien et n'ajoute aucune causalité ;
- les enseignements ne doivent pas dupliquer le sujet ou les résultats ;
- les nuances doivent être de vraies précautions, limites ou incertitudes attestées.
`,
    tool,
    userText:
      `PUBLICATION : ${publication.titre}\n` +
      `BESOIN : ${besoin}\n\n` +
      `CARTE DE COUVERTURE :\n${JSON.stringify(carteCouverture)}\n\n` +
      `MATÉRIAU DE TOUS LES LOTS :\n${JSON.stringify(materiau)}\n\n` +
      `BROUILLON À RÉÉQUILIBRER :\n${JSON.stringify(brut)}`,
    maxTokens: 2800
  });
}

function similariteTexteT01(a, b) {
  const ta = new Set(normaliserTexteSimple(a).split(" ").filter(x => x.length > 3));
  const tb = new Set(normaliserTexteSimple(b).split(" ").filter(x => x.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach(x => { if (tb.has(x)) inter += 1; });
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

function dedoublonnerSectionsT01(brut) {
  if (!brut) return brut;

  const bases = [brut.sujet?.texte, brut.problematique?.texte].filter(Boolean);
  const resultats = [];
  (brut.resultats || []).forEach(point => {
    if (!point?.texte) return;
    if (bases.some(x => similariteTexteT01(point.texte, x) >= 0.82)) return;
    if (resultats.some(x => similariteTexteT01(point.texte, x.texte) >= 0.82)) return;
    resultats.push(point);
  });

  const enseignements = [];
  (brut.enseignements || []).forEach(point => {
    if (!point?.texte) return;
    const comparables = [
      ...bases,
      ...resultats.map(x => x.texte),
      ...enseignements.map(x => x.texte)
    ];
    if (comparables.some(x => similariteTexteT01(point.texte, x) >= 0.78)) return;
    enseignements.push(point);
  });

  const nuances = [];
  (brut.nuances || []).forEach(point => {
    if (!point?.texte) return;
    const comparables = [
      ...bases,
      ...resultats.map(x => x.texte),
      ...enseignements.map(x => x.texte),
      ...nuances.map(x => x.texte)
    ];
    if (comparables.some(x => similariteTexteT01(point.texte, x) >= 0.84)) return;
    nuances.push(point);
  });

  return { ...brut, resultats, enseignements, nuances };
}

function compterIdsSortieT01(brut) {
  const ids = new Set();
  if (!brut) return ids;
  const ajouter = point => (point?.chunk_ids || []).forEach(id => ids.add(id));
  ajouter(brut.sujet);
  ajouter(brut.problematique);
  (brut.resultats || []).forEach(ajouter);
  (brut.enseignements || []).forEach(ajouter);
  (brut.nuances || []).forEach(ajouter);
  return ids;
}

function lotsCitesSortie(brut, index) {
  const lots = new Set();
  const ids = compterIdsSortieT01(brut);
  ids.forEach(id => {
    const entry = index.get(id);
    if (entry?.chunk?._lot) lots.add(entry.chunk._lot);
  });
  return [...lots].sort((a, b) => a - b);
}

function contexteAuditT01(brut, index) {
  const ids = compterIdsSortieT01(brut);
  return [...ids].map(id => {
    const entry = index.get(id);
    if (!entry) return null;
    return {
      chunk_id: id,
      publication_id: entry.publication.publication_id,
      page_debut: entry.chunk.page_debut,
      page_fin: entry.chunk.page_fin,
      section: entry.chunk.section,
      texte: entry.chunk.texte
    };
  }).filter(Boolean);
}

function nettoyerAuditT01(audit, brouillon) {
  if (!audit) return brouillon;
  const idsBrouillon = compterIdsSortieT01(brouillon);

  function nettoyerPoint(point, fallback) {
    if (!point || !point.texte) return fallback || null;
    const ids = (point.chunk_ids || []).filter(id => idsBrouillon.has(id));
    if (!ids.length) return fallback || null;
    return { texte: String(point.texte).trim(), chunk_ids: [...new Set(ids)] };
  }

  return {
    sujet: nettoyerPoint(audit.sujet, brouillon.sujet),
    problematique: nettoyerPoint(audit.problematique, brouillon.problematique),
    resultats: (audit.resultats || []).map(p => nettoyerPoint(p, null)).filter(Boolean),
    enseignements: (audit.enseignements || []).map(p => nettoyerPoint(p, null)).filter(Boolean),
    nuances: (audit.nuances || []).map(p => nettoyerPoint(p, null)).filter(Boolean)
  };
}

async function auditerFideliteT01({ apiKey, besoin, publication, brut, index }) {
  const passages = contexteAuditT01(brut, index);
  if (!passages.length) return brut;

  const tool = {
    name: "auditer_resume_analytique_t01",
    description: "Contrôle la fidélité du résumé aux seuls passages cités, sans enrichissement.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        sujet: POINT_SCHEMA,
        problematique: POINT_SCHEMA,
        resultats: { type: "array", items: POINT_SCHEMA },
        enseignements: { type: "array", items: POINT_SCHEMA },
        nuances: { type: "array", items: POINT_SCHEMA }
      },
      required: ["sujet", "problematique", "resultats", "enseignements", "nuances"],
      additionalProperties: false
    }
  };

  const audit = await appelerClaudeAvecOutil({
    apiKey,
    model: MODEL_REDACTION,
    system: `
Tu es le contrôleur de fidélité d'un résumé analytique.
Tu ne dois PAS enrichir le résumé : seulement conserver, supprimer ou reformuler
les formulations déjà présentes pour qu'elles soient strictement soutenues par les passages cités.

Règles :
- aucune connaissance extérieure ;
- n'ajoute aucun fait, exemple ou chunk_id ;
- vérifie chaque qualification, comparaison, causalité et interprétation ;
- une association statistique ne devient jamais une causalité ;
- retire les adjectifs ou raccords non attestés ;
- vérifie particulièrement les noms propres, lieux, fonctions, dates, nombres, unités et acronymes ;
- les enseignements doivent rester descriptifs et directement soutenus ;
- si une nuance n'est pas attestée, supprime-la ;
- ne remplace jamais une erreur par une information de mémoire.
`,
    tool,
    userText:
      `PUBLICATION : ${publication.titre}\n` +
      `BESOIN : ${besoin}\n\n` +
      `BROUILLON À CONTRÔLER :\n${JSON.stringify(brut)}\n\n` +
      `PASSAGES CITÉS :\n${JSON.stringify(passages)}`,
    maxTokens: 2500
  });

  return nettoyerAuditT01(audit, brut);
}

function limiterStructureT01(brut) {
  if (!brut) return brut;
  return {
    ...brut,
    resultats: (Array.isArray(brut.resultats) ? brut.resultats : []).slice(0, T01_MAX_RESULTATS),
    enseignements: (Array.isArray(brut.enseignements) ? brut.enseignements : []).slice(0, T01_MAX_ENSEIGNEMENTS),
    nuances: (Array.isArray(brut.nuances) ? brut.nuances : []).slice(0, T01_MAX_NUANCES)
  };
}

function estPodcastT01(publication) {
  return /podcast|audio/.test(normaliserTexteSimple(publication?.type_document || ""));
}

function normaliserTimecodeT01(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return "";
  const brut = String(valeur).trim();

  if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(brut)) {
    const morceaux = brut.split(":");
    if (morceaux.length === 2) {
      return String(Number(morceaux[0])).padStart(2, "0") + ":" + morceaux[1].padStart(2, "0");
    }
    return brut;
  }

  const nombre = Number(brut.replace(",", "."));
  if (!Number.isFinite(nombre) || nombre < 0) return brut;

  const minutesExcel = Math.round(nombre * 24 * 60);
  const minutesTimecode = Math.floor(minutesExcel / 60);
  const secondesTimecode = minutesExcel % 60;
  return String(minutesTimecode).padStart(2, "0") + ":" +
    String(secondesTimecode).padStart(2, "0");
}

function reperesChunkT01(chunk, publication) {
  if (estPodcastT01(publication)) {
    const debut = normaliserTimecodeT01(chunk.page_debut);
    const fin = normaliserTimecodeT01(chunk.page_fin);
    if (!debut && !fin) return [];
    const label = debut && fin && fin !== debut ? `${debut}–${fin}` : (debut || fin);
    return [{
      type: "timecode",
      label,
      timecode_debut: debut,
      timecode_fin: fin
    }];
  }

  const pages = [];
  if (chunk.page_debut) pages.push(String(chunk.page_debut));
  if (chunk.page_fin && String(chunk.page_fin) !== String(chunk.page_debut)) {
    pages.push(String(chunk.page_fin));
  }

  return [...new Set(pages)].map(page => ({ type: "page", label: page, page }));
}

function enrichirPointT01(point, index, idsAutorises) {
  if (!point || !point.texte) return null;

  const ids = (point.chunk_ids || []).filter(id =>
    index.has(id) && (!idsAutorises || idsAutorises.has(id))
  );
  if (!ids.length) return null;

  const provenances = [];
  const vus = new Set();

  ids.forEach(id => {
    const entry = index.get(id);
    reperesChunkT01(entry.chunk, entry.publication).forEach(repere => {
      const key = `${entry.publication.publication_id}|${repere.type}|${repere.label}`;
      if (vus.has(key)) return;
      vus.add(key);
      provenances.push({
        publication_id: entry.publication.publication_id,
        titre: entry.publication.titre,
        type: repere.type,
        label: repere.label,
        page: repere.page || "",
        timecode_debut: repere.timecode_debut || "",
        timecode_fin: repere.timecode_fin || "",
        chunk_id: id
      });
    });
  });

  return {
    texte: String(point.texte).trim(),
    chunk_ids: [...new Set(ids)],
    provenances
  };
}

function enrichirListeT01(items, index, idsAutorises) {
  return (items || []).map(item => enrichirPointT01(item, index, idsAutorises)).filter(Boolean);
}

async function genererResumeAnalytiqueT01({
  apiKey, besoin, treatment, corpus,
  onProgress = async () => {},
  resumeLots = {},
  onLotExtracted = async () => {}
}) {
  const corpusPropre = nettoyerCorpusT01(corpus);
  if (!corpusPropre.length) {
    throw new Error("Aucun chunk exploitable dans le corpus sélectionné.");
  }

  const publication = corpusPropre[0];
  const totalChunks = publication.chunks.length;
  let index = indexChunksT01(corpusPropre);
  let brut;
  let mode;
  let lotsAnalyses = 1;
  let idsAutorises = null;
  let nbLots = 1;
  let carteCouverture = [];

  await onProgress({
    stage: "t01_preparing",
    message: "Préparation du corpus",
    chunks_total: totalChunks
  });

  if (totalChunks <= T01_COURT_MAX_CHUNKS) {
    const contexte = contexteTousChunksT01(corpusPropre);

    await onProgress({
      stage: "t01_synthesizing",
      message: "Synthèse directe de la publication complète",
      chunks_total: totalChunks,
      chunks_processed: totalChunks
    });

    brut = await produireStructureDirecteT01({
      apiKey, besoin, treatment, contexte
    });

    mode = "couverture_integrale_directe";
    idsAutorises = new Set(publication.chunks.map(c => c.chunk_id));
  } else {
    const lots = decouperLotsT01(publication.chunks);
    nbLots = lots.length;
    lotsAnalyses = lots.length;
    const elements = [];

    // On marque le numéro de lot dans une copie interne pour le diagnostic de couverture.
    lots.forEach((lot, i) => {
      lot.forEach(c => { c._lot = i + 1; });
    });
    index = indexChunksT01(corpusPropre);

    for (let i = 0; i < lots.length; i += 1) {
      await onProgress({
        stage: "t01_extracting",
        message: `Analyse documentaire — lot ${i + 1}/${lots.length}`,
        lot_current: i + 1,
        lots_total: lots.length,
        chunks_total: totalChunks,
        chunks_processed: lots.slice(0, i).reduce((n, lot) => n + lot.length, 0)
      });

      const numeroLot = i + 1;
      const checkpoint = resumeLots && resumeLots[numeroLot];
      let extraits = [];

      if (checkpoint && Array.isArray(checkpoint.elements) && checkpoint.elements.length) {
        extraits = checkpoint.elements
          .filter(el => el && el.texte && Array.isArray(el.chunk_ids) && el.chunk_ids.length)
          .map(el => ({
            categorie: String(el.categorie || "substantiel"),
            texte: String(el.texte).trim(),
            chunk_ids: [...new Set(el.chunk_ids.map(String))],
            lot: numeroLot
          }));
      } else {
        extraits = await extraireMateriauLotRobusteT01({
          apiKey,
          besoin,
          treatment,
          publication,
          lot: lots[i],
          numeroLot,
          nbLots: lots.length
        });

        if (extraits.length) {
          await onLotExtracted({
            lot: numeroLot,
            chunks: lots[i].length,
            elements: extraits
          });
        }
      }

      elements.push(...extraits);

      await onProgress({
        stage: "t01_extracting",
        message: `Lot ${i + 1}/${lots.length} analysé`,
        lot_current: i + 1,
        lots_total: lots.length,
        chunks_total: totalChunks,
        chunks_processed: lots.slice(0, i + 1).reduce((n, lot) => n + lot.length, 0),
        extracted_elements: elements.length
      });
    }

    if (!elements.length) {
      throw new Error(
        "La couverture documentaire n’a produit aucun élément exploitable après reprise et découpage des lots."
      );
    }

    carteCouverture = construireCarteCouvertureT01(lots, elements);

    idsAutorises = new Set();
    elements.forEach(el => (el.chunk_ids || []).forEach(id => idsAutorises.add(id)));

    await onProgress({
      stage: "t01_synthesizing",
      message: "Synthèse des éléments issus de toute la publication",
      lots_total: lots.length,
      chunks_total: totalChunks,
      chunks_processed: totalChunks,
      extracted_elements: elements.length
    });

    brut = await produireStructureDepuisMateriauT01({
      apiKey,
      besoin,
      treatment,
      publication,
      materiau: elements,
      nbLots: lots.length
    });

    // Même garde-fou que la V4.4.1 Apps Script : si des éléments substantiels
    // existent mais que la synthèse revient sans résultat, une seule reprise ciblée.
    brut = await relancerResultatsT01({
      apiKey,
      besoin,
      treatment,
      publication,
      materiau: elements,
      brutInitial: brut
    });

    await onProgress({
      stage: "t01_coverage_audit",
      message: "Contrôle de l’équilibre documentaire entre les lots",
      lots_total: lots.length,
      chunks_total: totalChunks,
      chunks_processed: totalChunks
    });

    brut = await auditerCouvertureT01({
      apiKey,
      besoin,
      treatment,
      publication,
      materiau: elements,
      carteCouverture,
      brut,
      index
    });

    mode = "couverture_integrale_par_lots";
  }

  await onProgress({
    stage: "t01_auditing",
    message: "Contrôle final de fidélité et de provenance",
    chunks_total: totalChunks,
    chunks_processed: totalChunks,
    lots_total: nbLots
  });

  brut = await auditerFideliteT01({
    apiKey, besoin, publication, brut, index
  });
  brut = dedoublonnerSectionsT01(brut);
  brut = limiterStructureT01(brut);

  const sujet = enrichirPointT01(brut.sujet, index, idsAutorises);
  const problematique = enrichirPointT01(brut.problematique, index, idsAutorises);

  if (!sujet || !problematique) {
    throw new Error("Le résumé généré ne possède pas une provenance suffisante.");
  }

  const idsSortie = compterIdsSortieT01(brut);
  const nbChunksCites = [...idsSortie].filter(id =>
    index.has(id) && (!idsAutorises || idsAutorises.has(id))
  ).length;

  const lotsCites = lotsCitesSortie(brut, index);

  return {
    treatment_id: "T01",
    nom_traitement: String(treatment.nom_traitement || "Résumé analytique"),
    regime_IA: "Synthèse stricte",
    besoin,
    corpus: corpusPropre.map(pub => ({
      publication_id: pub.publication_id,
      titre: pub.titre,
      organisme_producteur: pub.organisme_producteur,
      annee_publication: pub.annee_publication,
      url: pub.url_contenu || pub.url_source
    })),
    selection: {
      mode,
      chunks_recus: totalChunks,
      chunks_retenus: totalChunks,
      chunks_cites_sortie: nbChunksCites,
      lots_analyses: lotsAnalyses,
      lots_cites_sortie: lotsCites,
      audit_fidelite: true,
      verrou_anti_causalite_statistique: true,
      controle_coherence_factuelle: true,
      controle_raccords_interpretatifs: true,
      max_resultats: T01_MAX_RESULTATS,
      reprise_anthropic: T01_ANTHROPIC_MAX_ATTEMPTS,
      checkpoint_par_lot: totalChunks > T01_COURT_MAX_CHUNKS,
      carte_couverture: totalChunks > T01_COURT_MAX_CHUNKS,
      audit_couverture: totalChunks > T01_COURT_MAX_CHUNKS,
      moteur: "cloud-v0.5.1-t01-schema-fix"
    },
    output: {
      sujet,
      problematique,
      resultats: enrichirListeT01(brut.resultats, index, idsAutorises),
      enseignements: enrichirListeT01(brut.enseignements, index, idsAutorises),
      nuances: enrichirListeT01(brut.nuances, index, idsAutorises)
    }
  };
}

module.exports = {
  genererResumeAnalytiqueT01,
  nettoyerCorpusT01,
  MODEL_REDACTION
};
