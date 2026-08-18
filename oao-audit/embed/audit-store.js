(function (global) {
  "use strict";

  const DB_NAME = "oao_audit_v1";
  const DB_VERSION = 4;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("clauses")) {
          const s = db.createObjectStore("clauses", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("requirementFiles")) {
          const s = db.createObjectStore("requirementFiles", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("evidenceFiles")) {
          const s = db.createObjectStore("evidenceFiles", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
          s.createIndex("clauseId", "clauseId", { unique: false });
        }
        if (!db.objectStoreNames.contains("findings")) {
          const s = db.createObjectStore("findings", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("consultSessions")) {
          const s = db.createObjectStore("consultSessions", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("remediations")) {
          const s = db.createObjectStore("remediations", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
          s.createIndex("findingId", "findingId", { unique: false });
        }
        if (!db.objectStoreNames.contains("evaluationRuns")) {
          const s = db.createObjectStore("evaluationRuns", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("organizations")) {
          db.createObjectStore("organizations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("kbSyncQueue")) {
          const s = db.createObjectStore("kbSyncQueue", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("kbDocMap")) {
          const s = db.createObjectStore("kbDocMap", { keyPath: "id" });
          s.createIndex("projectId", "projectId", { unique: false });
        }
      };
    });
  }

  function tx(store, mode, db) {
    return db.transaction(store, mode).objectStore(store);
  }

  async function put(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(storeName, "readwrite", db).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(storeName, "readonly", db).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(storeName, "readonly", db).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getByProjectIndex(storeName, projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const idx = tx(storeName, "readonly", db).index("projectId");
      const req = idx.getAll(projectId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getEvidenceByProject(projectId) {
    return getByProjectIndex("evidenceFiles", projectId);
  }

  async function getFindingsByProject(projectId) {
    return getByProjectIndex("findings", projectId);
  }

  async function getRemediationsByProject(projectId) {
    return getByProjectIndex("remediations", projectId);
  }

  async function getEvaluationRunsByProject(projectId) {
    return getByProjectIndex("evaluationRuns", projectId);
  }

  async function deleteByProject(storeName, projectId) {
    const existing = await getByProjectIndex(storeName, projectId);
    const db = await openDb();
    const store = tx(storeName, "readwrite", db);
    await Promise.all(
      existing.map(
        (row) =>
          new Promise((resolve, reject) => {
            const req = store.delete(row.id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          })
      )
    );
  }

  async function del(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(storeName, "readwrite", db).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFindingsByProject(projectId) {
    return deleteByProject("findings", projectId);
  }

  async function deleteClausesByProject(projectId) {
    return deleteByProject("clauses", projectId);
  }

  async function getConsultSession(projectId) {
    const rows = await getByProjectIndex("consultSessions", projectId);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }

  async function saveConsultSession(session) {
    return put("consultSessions", session);
  }

  async function getKbSyncQueueByProject(projectId) {
    return getByProjectIndex("kbSyncQueue", projectId);
  }

  async function getKbDocMapsByProject(projectId) {
    return getByProjectIndex("kbDocMap", projectId);
  }

  async function getClausesByProject(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const idx = tx("clauses", "readonly", db).index("projectId");
      const req = idx.getAll(projectId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBlob(id, blob, meta) {
    await put("blobs", { id, blob, meta: meta || {}, updatedAt: Date.now() });
    return id;
  }

  async function loadBlob(id) {
    const row = await get("blobs", id);
    return row || null;
  }

  function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  global.OAOAuditStore = {
    openDb,
    put,
    get,
    getAll,
    delete: del,
    deleteByProject,
    getClausesByProject,
    deleteClausesByProject,
    getEvidenceByProject,
    getFindingsByProject,
    deleteFindingsByProject,
    getRemediationsByProject,
    getEvaluationRunsByProject,
    getKbSyncQueueByProject,
    getKbDocMapsByProject,
    getConsultSession,
    saveConsultSession,
    saveBlob,
    loadBlob,
    newId,
  };
})(typeof window !== "undefined" ? window : globalThis);
