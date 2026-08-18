(function (global) {
  "use strict";

  const Store = global.OAOAuditStore;
  const BUNDLE_VERSION = 4;

  function validateBundle(data) {
    if (!data || typeof data !== "object") throw new Error("备份文件无效");
    if (!data.project || !data.project.name) throw new Error("缺少 project 字段");
    const version = data.version || 3;
    if (version < 3) throw new Error(`不支持的备份版本：${version}`);
    return {
      version,
      project: data.project,
      org: data.org || null,
      clauses: Array.isArray(data.clauses) ? data.clauses : [],
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      findings: Array.isArray(data.findings) ? data.findings : [],
      remediations: Array.isArray(data.remediations) ? data.remediations : [],
      consultMessages: Array.isArray(data.consultMessages) ? data.consultMessages : [],
      requirementFiles: Array.isArray(data.requirementFiles) ? data.requirementFiles : [],
      evaluationRuns: Array.isArray(data.evaluationRuns) ? data.evaluationRuns : [],
      blobs: Array.isArray(data.blobs) ? data.blobs : [],
    };
  }

  function remapId(map, oldId, prefix) {
    if (!oldId) return oldId;
    if (!map?.size) return oldId;
    if (!map.has(oldId)) map.set(oldId, Store.newId(prefix));
    return map.get(oldId);
  }

  async function deleteProjectCascade(projectId) {
    const blobIds = new Set();
    const evidence = await Store.getEvidenceByProject(projectId);
    evidence.forEach((e) => e.blobId && blobIds.add(e.blobId));
    const clauses = await Store.getClausesByProject(projectId);
    clauses.forEach((c) => c.sourceBlobId && blobIds.add(c.sourceBlobId));
    const reqFiles = (await Store.getAll("requirementFiles")).filter((f) => f.projectId === projectId);
    reqFiles.forEach((f) => f.blobId && blobIds.add(f.blobId));

    const stores = [
      "clauses",
      "evidenceFiles",
      "findings",
      "remediations",
      "evaluationRuns",
      "kbSyncQueue",
      "kbDocMap",
      "consultSessions",
      "requirementFiles",
    ];
    for (const name of stores) {
      await Store.deleteByProject(name, projectId);
    }
    for (const blobId of blobIds) {
      try {
        await Store.delete("blobs", blobId);
      } catch (_) {}
    }
    await Store.delete("projects", projectId);
  }

  async function restoreBlobs(blobs, idMap) {
    let count = 0;
    for (const item of blobs) {
      if (!item?.id || !item.base64) continue;
      const targetId = idMap?.has(item.id) ? idMap.get(item.id) : item.id;
      try {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: item.mimeType || "application/octet-stream" });
        await Store.saveBlob(targetId, blob, { name: item.fileName || "file" });
        count += 1;
      } catch (err) {
        console.warn("[OAO Audit Import] blob restore failed:", item.id, err);
      }
    }
    return count;
  }

  function premapEntityIds(bundle, idMap) {
    bundle.clauses.forEach((c) => {
      remapId(idMap, c.id, "clause");
      if (c.sourceBlobId) remapId(idMap, c.sourceBlobId, "blob");
    });
    bundle.requirementFiles.forEach((f) => {
      remapId(idMap, f.id, "reqf");
      if (f.blobId) remapId(idMap, f.blobId, "blob");
    });
    bundle.evidence.forEach((e) => {
      remapId(idMap, e.id, "evid");
      if (e.blobId) remapId(idMap, e.blobId, "blob");
    });
    bundle.findings.forEach((f) => remapId(idMap, f.id, "find"));
    bundle.remediations.forEach((r) => remapId(idMap, r.id, "rem"));
    bundle.evaluationRuns.forEach((r) => remapId(idMap, r.id, "eval"));
    bundle.blobs.forEach((b) => {
      if (b.id) remapId(idMap, b.id, "blob");
    });
  }

  async function importBundle(raw, options = {}) {
    const bundle = validateBundle(typeof raw === "string" ? JSON.parse(raw) : raw);
    const overwrite = options.overwrite === true;
    const asNewProject = options.asNewProject === true;

    const existing = await Store.get("projects", bundle.project.id);
    if (existing && !overwrite && !asNewProject) {
      throw new Error(`项目「${bundle.project.name}」已存在。请选择覆盖或另存为新项目。`);
    }

    const idMap = new Map();
    let projectId = bundle.project.id;

    if (asNewProject) {
      projectId = Store.newId("proj");
      idMap.set(bundle.project.id, projectId);
      premapEntityIds(bundle, idMap);
    } else if (existing && overwrite) {
      await deleteProjectCascade(bundle.project.id);
    }

    if (bundle.blobs.length) {
      await restoreBlobs(bundle.blobs, idMap);
    }

    const now = Date.now();
    const project = {
      ...bundle.project,
      id: projectId,
      name: options.newProjectName?.trim() || bundle.project.name,
      importedAt: now,
      updatedAt: now,
      allmWorkspaceSlug: asNewProject ? undefined : bundle.project.allmWorkspaceSlug,
      kbLastSyncedAt: asNewProject ? 0 : bundle.project.kbLastSyncedAt || 0,
    };
    await Store.put("projects", project);

    if (bundle.org?.id) {
      const orgExisting = await Store.get("organizations", bundle.org.id);
      if (!orgExisting) await Store.put("organizations", { ...bundle.org, updatedAt: now });
    }

    for (const clause of bundle.clauses) {
      await Store.put("clauses", {
        ...clause,
        id: remapId(idMap, clause.id, "clause"),
        projectId,
        sourceBlobId: clause.sourceBlobId ? remapId(idMap, clause.sourceBlobId, "blob") : "",
      });
    }

    for (const row of bundle.requirementFiles) {
      await Store.put("requirementFiles", {
        ...row,
        id: remapId(idMap, row.id, "reqf"),
        projectId,
        blobId: row.blobId ? remapId(idMap, row.blobId, "blob") : "",
      });
    }

    for (const row of bundle.evidence) {
      await Store.put("evidenceFiles", {
        ...row,
        id: remapId(idMap, row.id, "evid"),
        projectId,
        clauseId: row.clauseId ? remapId(idMap, row.clauseId, "clause") : "",
        blobId: row.blobId ? remapId(idMap, row.blobId, "blob") : "",
      });
    }

    const findingIdMap = new Map();
    for (const row of bundle.findings) {
      const newId = remapId(idMap, row.id, "find");
      findingIdMap.set(row.id, newId);
      await Store.put("findings", {
        ...row,
        id: newId,
        projectId,
        clauseId: row.clauseId ? remapId(idMap, row.clauseId, "clause") : "",
        evidenceIds: (row.evidenceIds || []).map((eid) => remapId(idMap, eid, "evid")),
      });
    }

    for (const row of bundle.remediations) {
      await Store.put("remediations", {
        ...row,
        id: remapId(idMap, row.id, "rem"),
        projectId,
        findingId: row.findingId ? findingIdMap.get(row.findingId) || remapId(idMap, row.findingId, "find") : "",
        evidenceIds: (row.evidenceIds || []).map((eid) => remapId(idMap, eid, "evid")),
      });
    }

    for (const row of bundle.evaluationRuns) {
      await Store.put("evaluationRuns", {
        ...row,
        id: remapId(idMap, row.id, "eval"),
        projectId,
      });
    }

    if (bundle.consultMessages.length) {
      await Store.saveConsultSession({
        id: Store.newId("consult"),
        projectId,
        messages: bundle.consultMessages,
        updatedAt: now,
      });
    }

    return {
      projectId,
      projectName: project.name,
      clauseCount: bundle.clauses.length,
      evidenceCount: bundle.evidence.length,
      findingCount: bundle.findings.length,
      blobCount: bundle.blobs.length,
      hadBlobs: bundle.blobs.length > 0,
    };
  }

  global.OAOAuditImport = {
    BUNDLE_VERSION,
    validateBundle,
    importBundle,
    deleteProjectCascade,
  };
})(typeof window !== "undefined" ? window : globalThis);
