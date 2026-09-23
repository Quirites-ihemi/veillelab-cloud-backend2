const http = require("http");
const crypto = require("crypto");
const { randomUUID, randomBytes } = require("crypto");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { CloudTasksClient } = require("@google-cloud/tasks");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { genererResumeAnalytiqueT01, nettoyerCorpusT01, MODEL_REDACTION } = require("./t01");
const { genererCarteReflexionT03, nettoyerCorpusT03 } = require("./t03");
const { genererGlossaireT02, nettoyerCorpusT02 } = require("./t02");
const { genererRecommandationsT04, nettoyerCorpusT04 } = require("./t04");
const { cadrerBesoinT06, proposerStructurationsT06, documenterAxesT06, construireGrilleGuetT06 } = require("./t06");
const { proposerAxesV2, construireObjetsAxeV2 } = require("./t06_pipeline_v2");
const { createGraphChatHandler } = require("./graphChat");
const { getCorpusStatus } = require("./corpusStore");
const { searchCorpus } = require("./globalSearch");
const { runReflectionAssist } = require("./reflectionAssist");
const { searchExperts } = require("./expertSearch");

const PORT = process.env.PORT || 8080;

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "quirites-veille-lab-cloud";
const TASK_LOCATION = process.env.TASK_LOCATION || "europe-west1";
const TASK_QUEUE = process.env.TASK_QUEUE || "quirites-t01";
const SERVICE_URL =
  process.env.SERVICE_URL ||
  "https://veillelab-cloud-backend2-633342872265.europe-west9.run.app";
const ANTHROPIC_SECRET =
  process.env.ANTHROPIC_SECRET || "anthropic-api-key";

const firestore = new Firestore({ projectId: PROJECT_ID });
const tasksClient = new CloudTasksClient();
const secretClient = new SecretManagerServiceClient();

let apiKeyCache = null;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > maxBytes) {
        const error = new Error(`Corps de requête trop volumineux (maximum ${Math.ceil(maxBytes / 1024 / 1024)} Mo).`);
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON invalide."));
      }
    });

    req.on("error", reject);
  });
}

function timestampToIso(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value || null;
}

function serializeJob(data) {
  const copy = { ...data };
  delete copy.task_token_hash;
  return {
    ...copy,
    created_at: timestampToIso(copy.created_at),
    updated_at: timestampToIso(copy.updated_at),
    started_at: timestampToIso(copy.started_at),
    completed_at: timestampToIso(copy.completed_at)
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

async function getAnthropicApiKey() {
  if (apiKeyCache) return apiKeyCache;

  // Local : clé fournie par variable d'environnement (évite Secret Manager).
  if (process.env.ANTHROPIC_API_KEY) {
    apiKeyCache = process.env.ANTHROPIC_API_KEY.trim();
    return apiKeyCache;
  }

  const name =
    `projects/${PROJECT_ID}/secrets/${ANTHROPIC_SECRET}/versions/latest`;

  const [version] = await secretClient.accessSecretVersion({ name });
  const value = version?.payload?.data
    ? Buffer.from(version.payload.data).toString("utf8").trim()
    : "";

  if (!value) {
    throw new Error(`Le secret ${ANTHROPIC_SECRET} est vide ou inaccessible.`);
  }

  apiKeyCache = value;
  return value;
}

const handleGraphChat = createGraphChatHandler({
  firestore,
  getAnthropicApiKey,
  model: MODEL_REDACTION
});

async function writeInputT01(jobId, body) {
  const corpusPropre = nettoyerCorpusT01(body.corpus);

  if (!corpusPropre.length) {
    throw new Error("Aucun chunk exploitable dans le corpus sélectionné.");
  }

  if (corpusPropre.length !== 1) {
    throw new Error("T01 accepte une seule publication.");
  }

  const pub = corpusPropre[0];

  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const chunksRef = inputRef.collection("chunks");

  const meta = {
    job_id: jobId,
    treatment_id: "T01",
    need: String(body.need || "").trim(),
    treatment: {
      traitement_id: String(body.treatment?.traitement_id || "T01"),
      nom_traitement: String(body.treatment?.nom_traitement || "Résumé analytique"),
      objectif: String(body.treatment?.objectif || ""),
      regime_IA: String(body.treatment?.regime_IA || "Synthèse stricte"),
      format_sortie: String(body.treatment?.format_sortie || ""),
      provenance_exigee: String(body.treatment?.provenance_exigee || ""),
      prompt_systeme: String(body.treatment?.prompt_systeme || "")
    },
    publication: {
      publication_id: pub.publication_id,
      titre: pub.titre,
      organisme_producteur: pub.organisme_producteur,
      annee_publication: pub.annee_publication,
      type_document: pub.type_document,
      url_contenu: pub.url_contenu,
      url_source: pub.url_source
    },
    total_chunks: pub.chunks.length,
    created_at: FieldValue.serverTimestamp()
  };

  await inputRef.set(meta);

  // Écriture par lots Firestore : supporte aussi les publications longues.
  const chunks = pub.chunks;
  for (let start = 0; start < chunks.length; start += 400) {
    const batch = firestore.batch();
    chunks.slice(start, start + 400).forEach((c, localIndex) => {
      const orderIndex = start + localIndex;
      const docId =
        String(orderIndex + 1).padStart(5, "0") + "_" +
        String(c.chunk_id).replace(/[^a-zA-Z0-9_-]/g, "_");

      batch.set(chunksRef.doc(docId), {
        chunk_id: c.chunk_id,
        publication_id: pub.publication_id,
        ordre: c.ordre,
        section: c.section,
        page_debut: c.page_debut,
        page_fin: c.page_fin,
        texte: c.texte,
        order_index: orderIndex
      });
    });
    await batch.commit();
  }

  return { publication: pub, totalChunks: chunks.length };
}

async function loadInputT01(jobId) {
  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const inputSnap = await inputRef.get();

  if (!inputSnap.exists) {
    throw new Error(`Entrée du job introuvable : ${jobId}`);
  }

  const meta = inputSnap.data();

  const chunksSnap = await inputRef
    .collection("chunks")
    .orderBy("order_index", "asc")
    .get();

  const chunks = chunksSnap.docs.map(doc => {
    const c = doc.data();
    return {
      chunk_id: String(c.chunk_id || ""),
      publication_id: String(c.publication_id || meta.publication.publication_id),
      ordre: String(c.ordre || ""),
      section: String(c.section || ""),
      page_debut: c.page_debut === null || c.page_debut === undefined ? "" : String(c.page_debut),
      page_fin: c.page_fin === null || c.page_fin === undefined ? "" : String(c.page_fin),
      texte: String(c.texte || "")
    };
  });

  return {
    need: String(meta.need || ""),
    treatment: meta.treatment || {},
    corpus: [{
      ...meta.publication,
      chunks
    }]
  };
}



async function writeInputT02(jobId, body) {
  const corpusPropre = nettoyerCorpusT02(body.corpus);
  if (!corpusPropre.length) throw new Error("Aucun chunk exploitable dans le corpus sélectionné pour T02.");

  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const chunksRef = inputRef.collection("chunks");
  const publications = corpusPropre.map(pub => ({
    publication_id: pub.publication_id,
    titre: pub.titre,
    organisme_producteur: pub.organisme_producteur,
    annee_publication: pub.annee_publication,
    type_document: pub.type_document,
    url_contenu: pub.url_contenu,
    url_source: pub.url_source
  }));
  const totalChunks = corpusPropre.reduce((n, pub) => n + pub.chunks.length, 0);

  await inputRef.set({
    job_id: jobId,
    treatment_id: "T02",
    need: String(body.need || "").trim(),
    treatment: {
      traitement_id: "T02",
      nom_traitement: String(body.treatment?.nom_traitement || "Glossaire"),
      objectif: String(body.treatment?.objectif || ""),
      regime_IA: String(body.treatment?.regime_IA || "Extraction stricte"),
      format_sortie: String(body.treatment?.format_sortie || ""),
      provenance_exigee: String(body.treatment?.provenance_exigee || ""),
      prompt_systeme: String(body.treatment?.prompt_systeme || "")
    },
    publications,
    total_chunks: totalChunks,
    created_at: FieldValue.serverTimestamp()
  });

  let globalIndex = 0;
  const chunks = [];
  corpusPropre.forEach(pub => pub.chunks.forEach(c => chunks.push({ ...c, _pub: pub.publication_id })));
  for (let start = 0; start < chunks.length; start += 350) {
    const batch = firestore.batch();
    chunks.slice(start, start + 350).forEach(c => {
      const orderIndex = globalIndex++;
      const docId = String(orderIndex + 1).padStart(5, "0") + "_" + String(c.chunk_id).replace(/[^a-zA-Z0-9_-]/g, "_");
      batch.set(chunksRef.doc(docId), {
        chunk_id: c.chunk_id,
        publication_id: c.publication_id || c._pub,
        ordre: c.ordre,
        section: c.section,
        page_debut: c.page_debut,
        page_fin: c.page_fin,
        texte: c.texte,
        order_index: orderIndex
      });
    });
    await batch.commit();
  }
  return { publications, totalChunks };
}

async function loadInputT02(jobId) {
  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const inputSnap = await inputRef.get();
  if (!inputSnap.exists) throw new Error(`Entrée du job introuvable : ${jobId}`);
  const meta = inputSnap.data();
  const chunksSnap = await inputRef.collection("chunks").orderBy("order_index", "asc").get();
  const byPub = new Map((meta.publications || []).map(pub => [String(pub.publication_id), { ...pub, chunks: [] }]));
  chunksSnap.docs.forEach(doc => {
    const c = doc.data();
    const pubId = String(c.publication_id || "");
    if (!byPub.has(pubId)) return;
    byPub.get(pubId).chunks.push({
      chunk_id: String(c.chunk_id || ""),
      publication_id: pubId,
      ordre: String(c.ordre || ""),
      section: String(c.section || ""),
      page_debut: c.page_debut == null ? "" : String(c.page_debut),
      page_fin: c.page_fin == null ? "" : String(c.page_fin),
      texte: String(c.texte || "")
    });
  });
  return {
    need: String(meta.need || ""),
    treatment: meta.treatment || {},
    corpus: [...byPub.values()]
  };
}

async function writeInputT04(jobId, body) {
  const corpusPropre = nettoyerCorpusT04(body.corpus);
  if (!corpusPropre.length) throw new Error("Aucun chunk exploitable dans le corpus sélectionné pour T04.");

  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const chunksRef = inputRef.collection("chunks");
  const publications = corpusPropre.map(pub => ({
    publication_id: pub.publication_id,
    titre: pub.titre,
    organisme_producteur: pub.organisme_producteur,
    annee_publication: pub.annee_publication,
    type_document: pub.type_document,
    url_contenu: pub.url_contenu,
    url_source: pub.url_source
  }));
  const totalChunks = corpusPropre.reduce((n, pub) => n + pub.chunks.length, 0);

  await inputRef.set({
    job_id: jobId,
    treatment_id: "T04",
    need: String(body.need || "").trim(),
    treatment: {
      traitement_id: "T04",
      nom_traitement: String(body.treatment?.nom_traitement || "Extraction de recommandations"),
      objectif: String(body.treatment?.objectif || ""),
      regime_IA: String(body.treatment?.regime_IA || "Extraction stricte"),
      format_sortie: String(body.treatment?.format_sortie || ""),
      provenance_exigee: String(body.treatment?.provenance_exigee || ""),
      prompt_systeme: String(body.treatment?.prompt_systeme || "")
    },
    publications,
    total_chunks: totalChunks,
    created_at: FieldValue.serverTimestamp()
  });

  let globalIndex = 0;
  const chunks = [];
  corpusPropre.forEach(pub => pub.chunks.forEach(c => chunks.push({ ...c, _pub: pub.publication_id })));
  for (let start = 0; start < chunks.length; start += 350) {
    const batch = firestore.batch();
    chunks.slice(start, start + 350).forEach(c => {
      const orderIndex = globalIndex++;
      const docId = String(orderIndex + 1).padStart(5, "0") + "_" + String(c.chunk_id).replace(/[^a-zA-Z0-9_-]/g, "_");
      batch.set(chunksRef.doc(docId), {
        chunk_id: c.chunk_id,
        publication_id: c.publication_id || c._pub,
        ordre: c.ordre,
        section: c.section,
        page_debut: c.page_debut,
        page_fin: c.page_fin,
        texte: c.texte,
        order_index: orderIndex
      });
    });
    await batch.commit();
  }
  return { publications, totalChunks };
}

async function loadInputT04(jobId) {
  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const inputSnap = await inputRef.get();
  if (!inputSnap.exists) throw new Error(`Entrée du job introuvable : ${jobId}`);
  const meta = inputSnap.data();
  const chunksSnap = await inputRef.collection("chunks").orderBy("order_index", "asc").get();
  const byPub = new Map((meta.publications || []).map(pub => [String(pub.publication_id), { ...pub, chunks: [] }]));
  chunksSnap.docs.forEach(doc => {
    const c = doc.data();
    const pubId = String(c.publication_id || "");
    if (!byPub.has(pubId)) return;
    byPub.get(pubId).chunks.push({
      chunk_id: String(c.chunk_id || ""),
      publication_id: pubId,
      ordre: String(c.ordre || ""),
      section: String(c.section || ""),
      page_debut: c.page_debut == null ? "" : String(c.page_debut),
      page_fin: c.page_fin == null ? "" : String(c.page_fin),
      texte: String(c.texte || "")
    });
  });
  return {
    need: String(meta.need || ""),
    treatment: meta.treatment || {},
    corpus: [...byPub.values()]
  };
}

async function writeInputT03(jobId, body) {
  const corpusPropre = nettoyerCorpusT03(body.corpus);
  if (!corpusPropre.length) throw new Error("Aucun chunk exploitable dans le corpus sélectionné.");

  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const chunksRef = inputRef.collection("chunks");
  const publications = corpusPropre.map(pub => ({
    publication_id: pub.publication_id,
    titre: pub.titre,
    organisme_producteur: pub.organisme_producteur,
    annee_publication: pub.annee_publication,
    type_document: pub.type_document,
    url_contenu: pub.url_contenu,
    url_source: pub.url_source
  }));
  const totalChunks = corpusPropre.reduce((n, pub) => n + pub.chunks.length, 0);

  await inputRef.set({
    job_id: jobId,
    treatment_id: "T03",
    need: String(body.need || "").trim(),
    treatment: {
      traitement_id: "T03",
      nom_traitement: String(body.treatment?.nom_traitement || "Carte de réflexion assistée"),
      objectif: String(body.treatment?.objectif || ""),
      regime_IA: String(body.treatment?.regime_IA || "Enrichissement contrôlé"),
      format_sortie: String(body.treatment?.format_sortie || ""),
      provenance_exigee: String(body.treatment?.provenance_exigee || ""),
      prompt_systeme: String(body.treatment?.prompt_systeme || "")
    },
    publications,
    graph_nodes: (Array.isArray(body.graph_nodes) ? body.graph_nodes : []).slice(0, 120),
    graph_relations: (Array.isArray(body.graph_relations) ? body.graph_relations : []).slice(0, 180),
    total_chunks: totalChunks,
    created_at: FieldValue.serverTimestamp()
  });

  let globalIndex = 0;
  const allChunks = [];
  corpusPropre.forEach(pub => pub.chunks.forEach(c => allChunks.push({ ...c, _pub: pub.publication_id })));
  for (let start = 0; start < allChunks.length; start += 350) {
    const batch = firestore.batch();
    allChunks.slice(start, start + 350).forEach(c => {
      const orderIndex = globalIndex++;
      const docId = String(orderIndex + 1).padStart(5, "0") + "_" + String(c.chunk_id).replace(/[^a-zA-Z0-9_-]/g, "_");
      batch.set(chunksRef.doc(docId), {
        chunk_id: c.chunk_id,
        publication_id: c.publication_id || c._pub,
        ordre: c.ordre,
        section: c.section,
        page_debut: c.page_debut,
        page_fin: c.page_fin,
        texte: c.texte,
        order_index: orderIndex
      });
    });
    await batch.commit();
  }
  return { publications, totalChunks };
}

async function loadInputT03(jobId) {
  const inputRef = firestore.collection("job_inputs").doc(jobId);
  const inputSnap = await inputRef.get();
  if (!inputSnap.exists) throw new Error(`Entrée du job introuvable : ${jobId}`);
  const meta = inputSnap.data();
  const chunksSnap = await inputRef.collection("chunks").orderBy("order_index", "asc").get();
  const byPub = new Map((meta.publications || []).map(pub => [String(pub.publication_id), { ...pub, chunks: [] }]));
  chunksSnap.docs.forEach(doc => {
    const c = doc.data();
    const pubId = String(c.publication_id || "");
    if (!byPub.has(pubId)) return;
    byPub.get(pubId).chunks.push({
      chunk_id: String(c.chunk_id || ""),
      publication_id: pubId,
      ordre: String(c.ordre || ""),
      section: String(c.section || ""),
      page_debut: c.page_debut == null ? "" : String(c.page_debut),
      page_fin: c.page_fin == null ? "" : String(c.page_fin),
      texte: String(c.texte || "")
    });
  });
  return {
    need: String(meta.need || ""),
    treatment: meta.treatment || {},
    corpus: [...byPub.values()],
    graphNodes: Array.isArray(meta.graph_nodes) ? meta.graph_nodes : [],
    graphRelations: Array.isArray(meta.graph_relations) ? meta.graph_relations : []
  };
}

async function enqueueJob(jobId, taskToken) {
  const parent = tasksClient.queuePath(PROJECT_ID, TASK_LOCATION, TASK_QUEUE);
  const taskName = tasksClient.taskPath(
    PROJECT_ID,
    TASK_LOCATION,
    TASK_QUEUE,
    `job-${jobId}`
  );

  const payload = JSON.stringify({
    job_id: jobId,
    task_token: taskToken
  });

  const task = {
    name: taskName,
    // 20 minutes : supérieur au timeout Cloud Run par défaut et assez large pour
    // un T01 multi-lots. Le service Cloud Run devra être réglé au même niveau.
    dispatchDeadline: { seconds: 1200 },
    httpRequest: {
      httpMethod: "POST",
      url: `${SERVICE_URL}/tasks/process`,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(payload).toString("base64")
    }
  };

  const [createdTask] = await tasksClient.createTask({ parent, task });
  return createdTask.name;
}

async function createJob(body) {
  const traitementId = String(body.treatment_id || body.treatment?.traitement_id || "").trim();
  const besoin = String(body.need || "").trim();
  const corpus = Array.isArray(body.corpus) ? body.corpus : [];

  if (!["T01", "T02", "T03", "T04"].includes(traitementId)) {
    throw new Error("Cette version Cloud traite T01, T02, T03 et T04.");
  }
  const besoinEffectif = besoin || (traitementId === "T02" ? "Identifier et expliciter le vocabulaire spécialisé présent dans les publications sélectionnées." : traitementId === "T04" ? "Extraire les recommandations, préconisations, propositions et orientations explicitement formulées dans les publications sélectionnées." : "");
  if (!besoinEffectif) throw new Error("Le besoin utilisateur est vide.");
  if (!corpus.length) throw new Error("Le corpus sélectionné est vide.");

  const jobId = randomUUID();
  const taskToken = randomBytes(32).toString("hex");
  const ref = firestore.collection("jobs").doc(jobId);

  await ref.set({
    job_id: jobId,
    treatment_id: traitementId,
    publication_id: String(corpus[0]?.publication_id || ""),
    publication_title: String(corpus[0]?.titre || ""),
    publication_count: corpus.length,
    status: "queued",
    stage: "storing_input",
    attempt_count: 0,
    task_token_hash: sha256(taskToken),
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp()
  });

  try {
    const bodyEffectif = { ...body, need: besoinEffectif };
    const inputInfo = traitementId === "T01"
      ? await writeInputT01(jobId, bodyEffectif)
      : traitementId === "T02"
        ? await writeInputT02(jobId, bodyEffectif)
        : traitementId === "T04"
          ? await writeInputT04(jobId, bodyEffectif)
          : await writeInputT03(jobId, bodyEffectif);

    await ref.update({
      publication_id: traitementId === "T01" ? inputInfo.publication.publication_id : String(inputInfo.publications[0]?.publication_id || ""),
      publication_title: traitementId === "T01" ? inputInfo.publication.titre : String(inputInfo.publications[0]?.titre || ""),
      publication_count: traitementId === "T01" ? 1 : inputInfo.publications.length,
      chunks_total: inputInfo.totalChunks,
      stage: "waiting_for_task",
      updated_at: FieldValue.serverTimestamp()
    });

    const taskName = await enqueueJob(jobId, taskToken);
    await ref.update({ task_name: taskName, stage: "task_enqueued", updated_at: FieldValue.serverTimestamp() });
    return { jobId, taskName, treatmentId: traitementId };
  } catch (error) {
    await ref.update({
      status: "error",
      stage: "enqueue_or_input_error",
      error_message: error?.message || String(error),
      updated_at: FieldValue.serverTimestamp()
    });
    throw error;
  }
}

async function verifyTask(jobId, taskToken) {
  const ref = firestore.collection("jobs").doc(jobId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(`Job introuvable : ${jobId}`);
  }

  const data = snap.data();
  const supplied = sha256(taskToken || "");

  if (!data.task_token_hash || !safeEqualHex(data.task_token_hash, supplied)) {
    const err = new Error("Jeton de tâche invalide.");
    err.statusCode = 403;
    throw err;
  }

  return { ref, data };
}

async function loadT01LotCheckpoints(jobId) {
  const snap = await firestore
    .collection("jobs")
    .doc(jobId)
    .collection("t01_lots")
    .get();

  const lots = {};
  snap.docs.forEach(doc => {
    const data = doc.data();
    const numero = Number(data.lot);
    if (!Number.isFinite(numero)) return;
    lots[numero] = {
      lot: numero,
      chunks: Number(data.chunks || 0),
      elements: Array.isArray(data.elements) ? data.elements : []
    };
  });
  return lots;
}

async function saveT01LotCheckpoint(jobId, checkpoint) {
  const numero = Number(checkpoint?.lot);
  if (!Number.isFinite(numero)) return;

  await firestore
    .collection("jobs")
    .doc(jobId)
    .collection("t01_lots")
    .doc(String(numero).padStart(3, "0"))
    .set({
      lot: numero,
      chunks: Number(checkpoint?.chunks || 0),
      elements: Array.isArray(checkpoint?.elements) ? checkpoint.elements : [],
      saved_at: FieldValue.serverTimestamp()
    }, { merge: true });
}

async function processJob(jobId, taskToken) {
  const { ref, data } = await verifyTask(jobId, taskToken);
  if (data.status === "completed") return { alreadyCompleted: true };

  await ref.update({
    status: "running",
    stage: "loading_input",
    attempt_count: FieldValue.increment(1),
    started_at: data.started_at || FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    error_message: FieldValue.delete()
  });

  try {
    const apiKey = await getAnthropicApiKey();
    let result;

    if (data.treatment_id === "T01") {
      const input = await loadInputT01(jobId);
      const resumeLots = await loadT01LotCheckpoints(jobId);
      result = await genererResumeAnalytiqueT01({
        apiKey,
        besoin: input.need,
        treatment: input.treatment,
        corpus: input.corpus,
        resumeLots,
        onLotExtracted: async checkpoint => saveT01LotCheckpoint(jobId, checkpoint),
        onProgress: async progress => {
          await ref.update({ status: "running", stage: progress.stage || "running", progress, updated_at: FieldValue.serverTimestamp() });
        }
      });
    } else if (data.treatment_id === "T02") {
      const input = await loadInputT02(jobId);
      result = await genererGlossaireT02({
        apiKey,
        besoin: input.need,
        treatment: input.treatment,
        corpus: input.corpus,
        onProgress: async progress => {
          await ref.update({ status: "running", stage: progress.stage || "running", progress, updated_at: FieldValue.serverTimestamp() });
        }
      });
    } else if (data.treatment_id === "T03") {
      const input = await loadInputT03(jobId);
      result = await genererCarteReflexionT03({
        apiKey,
        besoin: input.need,
        treatment: input.treatment,
        corpus: input.corpus,
        graphNodes: input.graphNodes,
        graphRelations: input.graphRelations,
        onProgress: async progress => {
          await ref.update({ status: "running", stage: progress.stage || "running", progress, updated_at: FieldValue.serverTimestamp() });
        }
      });
    } else if (data.treatment_id === "T04") {
      const input = await loadInputT04(jobId);
      result = await genererRecommandationsT04({
        apiKey,
        besoin: input.need,
        treatment: input.treatment,
        corpus: input.corpus,
        onProgress: async progress => {
          await ref.update({ status: "running", stage: progress.stage || "running", progress, updated_at: FieldValue.serverTimestamp() });
        }
      });
    } else {
      throw new Error(`Traitement non pris en charge : ${data.treatment_id}`);
    }

    await ref.update({
      status: "completed",
      stage: "done",
      result,
      progress: {
        stage: "done",
        message: data.treatment_id === "T03" ? "Carte de réflexion prête" : data.treatment_id === "T02" ? "Glossaire terminé" : data.treatment_id === "T04" ? "Extraction de recommandations terminée" : "Résumé analytique terminé",
        chunks_total: result?.selection?.chunks_recus || data.chunks_total || 0,
        chunks_processed: result?.selection?.chunks_mobilises || result?.selection?.chunks_recus || data.chunks_total || 0
      },
      completed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      task_token_hash: FieldValue.delete(),
      error_message: FieldValue.delete()
    });

    return { alreadyCompleted: false };
  } catch (error) {
    await ref.update({
      status: "error",
      stage: `${String(data.treatment_id || "treatment").toLowerCase()}_error`,
      error_message: error?.message || String(error),
      updated_at: FieldValue.serverTimestamp()
    });
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "3600"
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      return sendJson(res, 200, {
        ok: true,
        service: "quirites-veille-lab-cloud",
        version: "cloud-v0.13.1-t06-v2-test",
        message: "Backend Cloud Run disponible — T01 + T02 + T03 + T04 + T06 scénario synthétisé + recherche corpus + chatbot public structuré",
        queue: `${TASK_LOCATION}/${TASK_QUEUE}`,
        model: MODEL_REDACTION,
        input_storage: "firestore-subcollection"
      });
    }

    if (req.method === "GET" && req.url === "/corpus-status") {
      return sendJson(res, 200, getCorpusStatus());
    }

    if (req.method === "POST" && req.url === "/corpus-search") {
      const body = await readJsonBody(req, 512 * 1024);
      const result = searchCorpus(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/expert-search") {
      const body = await readJsonBody(req, 512 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await searchExperts({ apiKey, body });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/reflection-assist") {
      const body = await readJsonBody(req, 512 * 1024);
      const result = runReflectionAssist(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/scenario-framing") {
      const body = await readJsonBody(req, 512 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await cadrerBesoinT06({
        apiKey,
        besoin: String(body.need || body.besoin || "")
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/scenario-axes") {
      const body = await readJsonBody(req, 512 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await proposerStructurationsT06({
        apiKey,
        besoin: String(body.need || body.besoin || ""),
        cadrage: body.cadrage && typeof body.cadrage === "object" ? body.cadrage : {},
        reponses: Array.isArray(body.reponses) ? body.reponses : []
      });
      return sendJson(res, 200, result);
    }


    if (req.method === "POST" && req.url === "/scenario-axis-support") {
      const body = await readJsonBody(req, 1024 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await documenterAxesT06({
        apiKey,
        besoin: String(body.need || body.besoin || ""),
        cadrage: body.cadrage && typeof body.cadrage === "object" ? body.cadrage : {},
        reponses: Array.isArray(body.reponses) ? body.reponses : [],
        axes: Array.isArray(body.axes) ? body.axes : []
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/scenario-dynamics") {
      const body = await readJsonBody(req, 1024 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await construireGrilleGuetT06({
        apiKey,
        besoin: String(body.need || body.besoin || ""),
        cadrage: body.cadrage && typeof body.cadrage === "object" ? body.cadrage : {},
        reponses: Array.isArray(body.reponses) ? body.reponses : [],
        axes: Array.isArray(body.axes) ? body.axes : []
      });
      return sendJson(res, 200, result);
    }

    // ---------- T06 V2 (local, en validation) ----------
    if (req.method === "POST" && req.url === "/scenario-v2/axes") {
      const body = await readJsonBody(req, 512 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await proposerAxesV2({
        apiKey,
        besoin: String(body.need || body.besoin || ""),
        sujet_requete: String(body.sujet_requete || "")
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/scenario-v2/axis-objects") {
      const body = await readJsonBody(req, 512 * 1024);
      const apiKey = await getAnthropicApiKey();
      const result = await construireObjetsAxeV2({
        apiKey,
        besoin: String(body.need || body.besoin || ""),
        subject_query: String(body.subject_query || ""),
        axis: body.axis && typeof body.axis === "object" ? body.axis : {}
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/graph-chat") {
      const body = await readJsonBody(req, 1024 * 1024);
      return handleGraphChat(req, res, body, sendJson);
    }

    if (req.method === "POST" && req.url === "/jobs") {
      const body = await readJsonBody(req);
      const { jobId, taskName, treatmentId } = await createJob(body);

      return sendJson(res, 202, {
        ok: true,
        job_id: jobId,
        status: "queued",
        task_name: taskName,
        poll_url: `${SERVICE_URL}/jobs/${jobId}`,
        message: `${treatmentId} créé et confié à Cloud Tasks`
      });
    }

    if (req.method === "POST" && req.url === "/tasks/process") {
      const cloudTaskName = req.headers["x-cloudtasks-taskname"];
      if (!cloudTaskName) {
        return sendJson(res, 403, {
          ok: false,
          error: "Appel réservé à Cloud Tasks"
        });
      }

      const body = await readJsonBody(req);
      const jobId = String(body.job_id || "");
      const taskToken = String(body.task_token || "");

      if (!jobId || !taskToken) {
        return sendJson(res, 400, {
          ok: false,
          error: "job_id ou task_token manquant"
        });
      }

      const result = await processJob(jobId, taskToken);

      return sendJson(res, 200, {
        ok: true,
        job_id: jobId,
        status: result.alreadyCompleted ? "already_completed" : "completed"
      });
    }

    const match = req.url && req.url.match(/^\/jobs\/([0-9a-fA-F-]{36})$/);
    if (req.method === "GET" && match) {
      const jobId = match[1];
      const snap = await firestore.collection("jobs").doc(jobId).get();

      if (!snap.exists) {
        return sendJson(res, 404, {
          ok: false,
          error: "Job introuvable"
        });
      }

      return sendJson(res, 200, {
        ok: true,
        job: serializeJob(snap.data())
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: "Route inconnue"
    });
  } catch (error) {
    console.error("Erreur backend :", error);
    return sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || String(error)
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Quiritès Cloud backend T01/T02/T03/T04/T06/graph-chat listening on port ${PORT}`);
});
