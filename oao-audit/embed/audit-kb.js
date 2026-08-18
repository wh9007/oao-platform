(function (global) {
  "use strict";

  const Store = global.OAOAuditStore;

  function resolveBaseUrl() {
    if (global.OAO_AI_BASE_URL) return String(global.OAO_AI_BASE_URL).replace(/\/$/, "");
    return "http://127.0.0.1:3001";
  }

  function resolveApiKey() {
    return global.OAO_ANYTHINGLLM_API_KEY || "";
  }

  function headers(json) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    const key = resolveApiKey();
    if (key) h.Authorization = `Bearer ${key}`;
    return h;
  }

  function slugify(text) {
    return String(text || "project")
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .toLowerCase() || "project";
  }

  function projectWorkspaceSlug(project) {
    if (project.allmWorkspaceSlug) return project.allmWorkspaceSlug;
    const short = String(project.id || "").replace(/[^a-z0-9]/gi, "").slice(-10);
    return `audit-${short}-${slugify(project.name)}`.slice(0, 60);
  }

  function projectSessionId(projectId) {
    return `oao_audit_${String(projectId || "guest")}`;
  }

  function extractAnswer(data) {
    if (!data) return "";
    if (typeof data.textResponse === "string") return data.textResponse.trim();
    if (typeof data.response === "string") return data.response.trim();
    if (data.message) return String(data.message).trim();
    return "";
  }

  async function checkHealth() {
    const base = resolveBaseUrl();
    try {
      const res = await fetch(`${base}/api/ping`, { cache: "no-store" });
      if (res.ok) {
        const online = (await res.json().catch(() => ({}))).online !== false;
        return { ok: online, base, hasApiKey: !!resolveApiKey() };
      }
    } catch (_) {}
    try {
      const res = await fetch(`${base}/api/v1/system`, { headers: headers(false), cache: "no-store" });
      return { ok: res.ok, base, hasApiKey: !!resolveApiKey() };
    } catch (err) {
      return { ok: false, base, hasApiKey: !!resolveApiKey(), error: err.message };
    }
  }

  async function apiJson(method, path, body) {
    const base = resolveBaseUrl();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(!!body),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || text.slice(0, 200) || res.statusText;
      throw new Error(`AnythingLLM ${res.status}: ${msg}`);
    }
    return data;
  }

  async function getWorkspace(slug) {
    try {
      return await apiJson("GET", `/api/v1/workspace/${encodeURIComponent(slug)}`);
    } catch (err) {
      if (String(err.message).includes("404")) return null;
      throw err;
    }
  }

  async function ensureProjectWorkspace(project) {
    const slug = projectWorkspaceSlug(project);
    const existing = await getWorkspace(slug);
    if (existing) {
      return { slug, created: false, name: existing?.workspace?.name || project.name };
    }
    const data = await apiJson("POST", "/api/v1/workspace/new", {
      name: `审计·${project.name}`,
      slug,
      chatMode: "query",
      openAiHistory: 30,
    });
    const ws = data?.workspace || data;
    return { slug: ws?.slug || slug, created: true, name: ws?.name || project.name };
  }

  function buildDocumentMarkdown(meta, body) {
    const esc = (v) => String(v ?? "").replace(/"/g, '\\"');
    return `---
docType: oao-audit
projectId: "${esc(meta.projectId)}"
projectName: "${esc(meta.projectName)}"
docRole: ${esc(meta.docRole)}
refId: "${esc(meta.refId)}"
version: ${meta.version || 1}
fileName: "${esc(meta.fileName || "")}"
clauseNo: "${esc(meta.clauseNo || "")}"
updatedAt: "${new Date(meta.updatedAt || Date.now()).toISOString()}"
---

# ${meta.title || meta.fileName || "审计文档"}

${body}
`;
  }

  async function uploadRawDocument(title, markdown, meta) {
    const data = await apiJson("POST", "/api/v1/document/raw-text", {
      textContent: markdown,
      metadata: {
        title: title,
        docSource: "oao-audit",
        ...meta,
      },
    });
    const doc = data?.document || data?.documents?.[0] || data;
    const location =
      doc?.location ||
      doc?.url ||
      doc?.name ||
      doc?.filename ||
      data?.location ||
      data?.url;
    if (!location) throw new Error("文档上传未返回 location");
    return { location, title, response: data };
  }

  async function updateWorkspaceEmbeddings(slug, adds) {
    const payload = {};
    if (adds?.length) payload.adds = adds;
    try {
      await apiJson("POST", `/api/v1/workspace/${encodeURIComponent(slug)}/update-embeddings`, payload);
    } catch (err) {
      await apiJson("POST", `/api/v1/workspace/${encodeURIComponent(slug)}/update-embeddings`, {});
    }
  }

  async function queryProject(project, message, options = {}) {
    const slug = project.allmWorkspaceSlug || projectWorkspaceSlug(project);
    const mode = options.mode || "query";
    const sessionId = project.allmSessionId || projectSessionId(project.id);
    const data = await apiJson("POST", `/api/v1/workspace/${encodeURIComponent(slug)}/chat`, {
      message,
      mode,
      sessionId,
      stream: false,
    });
    return {
      answer: extractAnswer(data),
      sources: data?.sources || [],
      sessionId,
      raw: data,
    };
  }

  async function saveDocMap(entry) {
    await Store.put("kbDocMap", entry);
  }

  async function getDocMap(refId) {
    return Store.get("kbDocMap", refId);
  }

  async function enqueueSync(item) {
    const pending = await Store.getKbSyncQueueByProject(item.projectId);
    for (const row of pending) {
      if (row.refId === item.refId && row.status === "pending") {
        await Store.put("kbSyncQueue", { ...row, status: "superseded", updatedAt: Date.now() });
      }
    }
    const row = {
      id: item.id || Store.newId("kbq"),
      projectId: item.projectId,
      refId: item.refId,
      docRole: item.docRole,
      title: item.title,
      markdown: item.markdown,
      version: item.version || 1,
      contentHash: item.contentHash || "",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await Store.put("kbSyncQueue", row);
    return row;
  }

  async function getPendingSync(projectId) {
    const rows = await Store.getKbSyncQueueByProject(projectId);
    return rows.filter((r) => r.status === "pending" || r.status === "processing");
  }

  let syncTimer = null;
  const syncLocks = {};

  async function processSyncQueue(project) {
    if (!project?.id) return { synced: 0, failed: 0 };
    if (syncLocks[project.id]) return syncLocks[project.id];
    syncLocks[project.id] = (async () => {
      const health = await checkHealth();
      if (!health.ok) throw new Error("AnythingLLM 未就绪，请启动 :3001 并配置 API Key");

      const ws = await ensureProjectWorkspace(project);
      project.allmWorkspaceSlug = ws.slug;
      project.allmSessionId = projectSessionId(project.id);
      project.kbLastSyncedAt = project.kbLastSyncedAt || 0;
      await Store.put("projects", project);

      const queue = (await Store.getKbSyncQueueByProject(project.id))
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.createdAt - b.createdAt);

      let synced = 0;
      let failed = 0;
      const adds = [];

      for (const job of queue) {
        job.status = "processing";
        job.updatedAt = Date.now();
        await Store.put("kbSyncQueue", job);
        try {
          const upload = await uploadRawDocument(job.title, job.markdown, {
            projectId: project.id,
            docRole: job.docRole,
            refId: job.refId,
            version: job.version,
          });
          adds.push(upload.location);
          await saveDocMap({
            id: job.refId,
            projectId: project.id,
            allmLocation: upload.location,
            title: job.title,
            version: job.version,
            syncedAt: Date.now(),
          });
          job.status = "done";
          synced += 1;
        } catch (err) {
          job.status = "failed";
          job.error = err.message;
          failed += 1;
        }
        job.updatedAt = Date.now();
        await Store.put("kbSyncQueue", job);
      }

      if (adds.length) {
        await updateWorkspaceEmbeddings(ws.slug, adds);
      }

      project.kbLastSyncedAt = Date.now();
      project.kbDocCount = (await Store.getKbDocMapsByProject(project.id)).length;
      await Store.put("projects", project);
      return { synced, failed, slug: ws.slug };
    })();
    try {
      return await syncLocks[project.id];
    } finally {
      delete syncLocks[project.id];
    }
  }

  function scheduleSync(project, delayMs) {
    if (!project?.id) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      processSyncQueue(project).catch((err) => console.warn("[OAO Audit KB]", err));
    }, delayMs || 2500);
  }

  async function queueDocument(project, payload) {
    const markdown =
      payload.markdown ||
      buildDocumentMarkdown(
        {
          projectId: project.id,
          projectName: project.name,
          docRole: payload.docRole,
          refId: payload.refId,
          version: payload.version,
          fileName: payload.fileName,
          clauseNo: payload.clauseNo,
          title: payload.title,
          updatedAt: Date.now(),
        },
        payload.body || ""
      );
    await enqueueSync({
      projectId: project.id,
      refId: payload.refId,
      docRole: payload.docRole,
      title: payload.title || payload.fileName || payload.refId,
      markdown,
      version: payload.version || 1,
    });
    scheduleSync(project, 2500);
  }

  async function syncClauses(project, clauses) {
    if (!clauses?.length) return;
    const body = clauses
      .map(
        (c) =>
          `- **${c.clauseNo}** ${c.mandatory ? "〔强制〕" : ""} [${c.subjectL1}/${c.subjectL2}] ${c.text}\n  来源: ${c.sourceFile || "-"}`
      )
      .join("\n");
    await queueDocument(project, {
      refId: `clauses_${project.id}`,
      docRole: "clauses",
      title: `${project.name}_条款清单.md`,
      version: clauses.length,
      body: `共 ${clauses.length} 条条款\n\n${body}`,
    });
  }

  async function syncFindingSnapshot(project, findings) {
    if (!findings?.length) return;
    const body = findings
      .map((f) => `- [${f.severityLabel}] ${f.title}\n  条款: ${f.clauseNo}\n  ${f.description}`)
      .join("\n\n");
    await queueDocument(project, {
      refId: `findings_${project.id}_${Date.now()}`,
      docRole: "findings",
      title: `${project.name}_评估发现_${new Date().toISOString().slice(0, 10)}.md`,
      version: findings.length,
      body,
    });
  }

  async function syncRemediation(project, record, finding) {
    await queueDocument(project, {
      refId: record.id,
      docRole: "remediation",
      title: `${project.name}_整改_${finding?.clauseNo || record.id}.md`,
      version: 1,
      clauseNo: finding?.clauseNo,
      body: `整改说明：\n${record.note}\n\n关联发现：${finding?.title || "-"}`,
    });
  }

  async function analyzeProject(project, prompt) {
    const q =
      prompt ||
      `请基于本项目全部已入库文档，给出审计迎审准备的整体分析：1) 资料完整性 2) 强制性条款覆盖 3) 主要风险 4) 下一步建议。项目：${project.name}`;
    return queryProject(project, q, { mode: "query" });
  }

  async function consultProject(project, question, context) {
    const prefix = `【项目】${project.name}\n【身份】${context?.roleLabel || "-"}\n\n`;
    return queryProject(project, prefix + question, { mode: "chat" });
  }

  async function evaluateViaRag(project, clauses, evidence) {
    const prompt = `你是 OAO 审计评估助手。仅依据本项目知识库文档，输出 Finding JSON 数组。
字段：clauseId, clauseNo, title, description, severity(仅 critical|major|minor|info), recommendation。
项目：${project.name}
条款数：${clauses.length}，迎审资料：${evidence.length} 份。
请对照强制性条款与迎审资料，输出发现事项 JSON 数组，不要输出其它文字。`;
    const result = await queryProject(project, prompt, { mode: "query" });
    return result;
  }

  async function ensureProjectKb(project) {
    const ws = await ensureProjectWorkspace(project);
    project.allmWorkspaceSlug = ws.slug;
    project.allmSessionId = projectSessionId(project.id);
    if (ws.created) project.kbCreatedAt = Date.now();
    await Store.put("projects", project);
    return ws;
  }

  global.OAOAuditKB = {
    checkHealth,
    resolveBaseUrl,
    projectWorkspaceSlug,
    projectSessionId,
    ensureProjectWorkspace,
    ensureProjectKb,
    buildDocumentMarkdown,
    queueDocument,
    processSyncQueue,
    scheduleSync,
    syncClauses,
    syncFindingSnapshot,
    syncRemediation,
    queryProject,
    analyzeProject,
    consultProject,
    evaluateViaRag,
    getPendingSync,
  };
})(typeof window !== "undefined" ? window : globalThis);
