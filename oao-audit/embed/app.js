(function () {
  "use strict";

  const { ROLES, PROJECT_TEMPLATES, getRole, loadSavedRole, saveRole } = window.OAOAuditRoles;
  const Store = window.OAOAuditStore;
  const Parser = window.OAOAuditParser;
  const Evidence = window.OAOAuditEvidence;
  const Evaluator = window.OAOAuditEvaluator;
  const Reports = window.OAOAuditReports;
  const AI = window.OAOAuditAI;
  const Workflow = window.OAOAuditWorkflow;
  const Remediation = window.OAOAuditRemediation;
  const Org = window.OAOAuditOrg;
  const Bundle = window.OAOAuditBundle;
  const KB = window.OAOAuditKB;
  const Importer = window.OAOAuditImport;

  const params = new URLSearchParams(location.search);
  const walletUid = params.get("uid")?.trim() || params.get("user")?.trim() || "guest";
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;

  const ollamaBaseParam = params.get("ollama_base")?.trim();
  if (ollamaBaseParam) window.OAO_OLLAMA_BASE_URL = ollamaBaseParam;
  const ollamaModelParam = params.get("ollama_model")?.trim();
  if (ollamaModelParam) window.OAO_OLLAMA_MODEL = ollamaModelParam;
  const aiBaseParam = params.get("ai_base")?.trim();
  if (aiBaseParam) window.OAO_AI_BASE_URL = aiBaseParam;

  try {
    const parentWin = window.parent;
    if (parentWin && parentWin !== window && parentWin.OAO_AI_BASE_URL && !window.OAO_AI_BASE_URL) {
      window.OAO_AI_BASE_URL = parentWin.OAO_AI_BASE_URL;
    }
    if (parentWin && parentWin !== window && parentWin.OAO_ANYTHINGLLM_API_KEY && !window.OAO_ANYTHINGLLM_API_KEY) {
      window.OAO_ANYTHINGLLM_API_KEY = parentWin.OAO_ANYTHINGLLM_API_KEY;
    }
  } catch (_) {}

  const $ = (id) => document.getElementById(id);

  const FINDING_STATUS_LABEL = {
    open: "待处理",
    remediated: "已整改",
    verified: "已复核",
    closed: "已关闭",
  };

  let state = {
    roleId: loadSavedRole(walletUid) || "",
    org: null,
    project: null,
    pendingFiles: [],
    clauses: [],
    evidence: [],
    findings: [],
    remediations: [],
    consultMessages: [],
  };

  function workflowCtx() {
    return {
      project: state.project,
      clauses: state.clauses,
      evidence: state.evidence,
      findings: state.findings,
      remediations: state.remediations,
      evaluationRuns: state.evaluationRuns || [],
    };
  }

  async function queueUploadedDoc(project, payload) {
    if (!KB || !project) return;
    try {
      await KB.queueDocument(project, payload);
      void refreshKbStatus();
    } catch (err) {
      console.warn("[OAO Audit KB] queue:", err);
    }
  }

  async function refreshKbStatus() {
    const el = $("kbStatus");
    if (!el || !KB) return;
    const health = await KB.checkHealth();
    if (!state.project) {
      el.textContent = health.ok
        ? `AnythingLLM 就绪 @ ${health.base.replace(/^https?:\/\//, "")}${health.hasApiKey ? "" : "（未配置 API Key）"}`
        : `AnythingLLM 离线 — 请启动 :3001 并在 local-config.js 配置 API Key`;
      return;
    }
    const pending = await KB.getPendingSync(state.project.id);
    const maps = await Store.getKbDocMapsByProject(state.project.id);
    const ws = state.project.allmWorkspaceSlug || KB.projectWorkspaceSlug(state.project);
    el.textContent = health.ok
      ? `工作区：${ws} · 已索引 ${maps.length} 份 · 待同步 ${pending.length} 份${health.hasApiKey ? "" : " · 缺 API Key"}`
      : `AnythingLLM 离线（IndexedDB 仍可用，${pending.length} 份待同步）`;
  }

  async function manualSyncKb() {
    if (!state.project) {
      setStatus("请先选择项目");
      return;
    }
    $("btnSyncKb").disabled = true;
    setStatus("正在同步知识库…");
    try {
      await KB.ensureProjectKb(state.project);
      const result = await KB.processSyncQueue(state.project);
      state.project = await Store.get("projects", state.project.id);
      await refreshKbStatus();
      setStatus(`知识库同步完成：${result.synced} 成功，${result.failed} 失败`);
    } catch (err) {
      setStatus(`知识库同步失败：${err.message}`);
    } finally {
      $("btnSyncKb").disabled = false;
    }
  }

  async function analyzeProjectAll() {
    if (!state.project) return;
    $("btnAnalyzeProject").disabled = true;
    setStatus("全项目 RAG 分析中…");
    try {
      await KB.processSyncQueue(state.project);
      const result = await KB.analyzeProject(state.project);
      state.consultMessages.push({
        role: "assistant",
        content: `【全项目分析】\n\n${result.answer}`,
        at: Date.now(),
      });
      renderConsultMessages();
      switchPanel("consult");
      setStatus("全项目分析完成");
    } catch (err) {
      setStatus(`分析失败：${err.message}`);
    } finally {
      $("btnAnalyzeProject").disabled = false;
    }
  }

  function setStatus(msg) {
    const el = $("statusBar");
    if (el) el.textContent = msg;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadMany(files) {
    files.forEach((f, i) => {
      setTimeout(() => downloadText(f.name.replace(/\//g, "_"), f.content), i * 120);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  function severityClass(sev) {
    return `sev-${sev}`;
  }

  function updateNavAvailability() {
    const ctx = workflowCtx();
    const hasClauses = ctx.clauses.length > 0;
    const hasEvidence = ctx.evidence.length > 0;
    const hasFindings = ctx.findings.length > 0;
    const role = getRole(state.roleId);

    document.querySelector('.nav-btn[data-panel="clauses"]').disabled = !hasClauses;
    document.querySelector('.nav-btn[data-panel="evaluate"]').disabled = !(hasClauses && hasEvidence);
    document.querySelector('.nav-btn[data-panel="remediation"]').disabled = !hasFindings;
    document.querySelector('.nav-btn[data-panel="report"]').disabled = !hasFindings;

    const action = Workflow.getSuggestedAction(role, ctx);
    const nextBtn = $("btnGoNextStep");
    if (nextBtn) {
      nextBtn.disabled = !state.project;
      nextBtn.dataset.panel = action.panel;
      nextBtn.title = action.text;
    }

    renderWorkflow();
  }

  function renderWorkflow() {
    const bar = $("workflowBar");
    const hint = $("workflowHint");
    if (!bar) return;

    const role = getRole(state.roleId);
    const steps = Workflow.buildSteps(workflowCtx());
    bar.innerHTML = steps
      .map(
        (s) =>
          `<button type="button" class="wf-step ${s.state}" data-panel="${s.panel}" title="${s.label}">${s.label}</button>`
      )
      .join("");

    const action = Workflow.getSuggestedAction(role, workflowCtx());
    if (hint) hint.textContent = action.text;
  }

  function initWorkflowBar() {
    $("workflowBar")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".wf-step");
      if (!btn) return;
      const role = getRole(state.roleId);
      const panel = btn.dataset.panel;
      if (Workflow.panelAccessible(role, panel, workflowCtx())) switchPanel(panel);
    });
  }

  function applyRoleUi() {
    const role = getRole(state.roleId);
    $("roleSelect").value = state.roleId;
    const orgLabel = state.org?.name ? ` · 组织：${state.org.name}` : "";
    $("topMeta").dataset.orgSuffix = orgLabel;

    const canReq = role.canUploadRequirements || role.canParseRequirements;
    const reqPanel = $("panelRequirements");
    if (reqPanel) {
      const muted = reqPanel.querySelector("h2 + p.muted, .card > p.muted");
      if (muted) {
        muted.textContent = canReq
          ? "支持 PDF、Word、Excel、TXT/MD。解析后按科目生成《审计需求包》。"
          : "当前身份仅可查看已解析条款，请在迎审资料库上传资料。";
      }
    }

    $("reqDropzone")?.classList.toggle("hidden", !canReq);
    $("reqFileInput").disabled = !canReq;
    $("btnParseRequirements").disabled = !canReq || !state.pendingFiles.length;

    const canEv = role.canUploadEvidence;
    $("evDropzone")?.classList.toggle("hidden", !canEv);
    $("evFileInput").disabled = !canEv;
    $("evidenceType").disabled = !canEv;
    $("evidenceClause").disabled = !canEv;

    const evHint = $("evidenceHint");
    if (evHint) {
      evHint.textContent = canEv
        ? "上传迎审资料并关联条款。系统将按类型校验格式与基本结构。"
        : "当前身份仅可查看迎审资料（上传需被审计单位或审计组长）。";
    }

    $("btnRunEvaluation").disabled = !role.canRunEvaluation;

    const canRem = role.canManageRemediation || role.canSubmitRemediation;
    $("btnSubmitRemediation").disabled = !canRem;
    $("btnReAudit").disabled = !role.canManageRemediation;

    const remHint = $("remediationHint");
    if (remHint) {
      remHint.textContent = role.canManageRemediation
        ? "审阅整改说明并发起再审计复核，确认后可关闭重大/重要项。"
        : "针对重大/重要发现提交整改说明，并关联已上传的佐证资料。";
    }

    $("btnSaveOrg").disabled = !role.canManageOrg;
    $("orgName").disabled = !role.canManageOrg;
    $("orgMember").disabled = !role.canManageOrg;

    const reportHint = $("reportHint");
    if (reportHint) {
      reportHint.textContent =
        state.roleId === "auditee"
          ? "导出《自检自查报告》，或使用成册导出打包全部迎审档案。"
          : "导出《审计结果报告》，或使用成册导出（需求包 + 报告 + 整改台账 + 咨询话术）。";
    }

    document.querySelectorAll("#roleGrid .role-card").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.role === state.roleId);
    });
    $("btnConfirmRole").disabled = !state.roleId;
    updateNavAvailability();
    void refreshAiHealth();
  }

  function initRoleSelect() {
    const sel = $("roleSelect");
    sel.innerHTML = "";
    Object.values(ROLES).forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.label;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      state.roleId = sel.value;
      saveRole(walletUid, state.roleId);
      applyRoleUi();
    });
  }

  function initRoleOverlay() {
    document.querySelectorAll("#roleGrid .role-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.roleId = btn.dataset.role;
        applyRoleUi();
      });
    });
    $("btnConfirmRole").addEventListener("click", () => {
      if (!state.roleId) return;
      saveRole(walletUid, state.roleId);
      $("roleOverlay").classList.add("hidden");
      applyRoleUi();
    });
  }

  function initTemplateSelect() {
    const sel = $("projectTemplate");
    Object.values(PROJECT_TEMPLATES).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    });
    sel.value = "special";
  }

  function initEvidenceTypeSelect() {
    const sel = $("evidenceType");
    Object.values(Evidence.EVIDENCE_TYPES).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    });
  }

  function refreshClauseSelect() {
    const sel = $("evidenceClause");
    if (!sel) return;
    sel.innerHTML = '<option value="">（可选）不指定条款</option>';
    state.clauses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.clauseNo} · ${c.text.slice(0, 40)}…`;
      sel.appendChild(opt);
    });
  }

  function refreshRemediationSelects() {
    const fSel = $("remFindingSelect");
    const eSel = $("remEvidenceSelect");
    if (!fSel || !eSel) return;

    const major = state.findings.filter(Remediation.needsRemediation);
    fSel.innerHTML = major.length
      ? major.map((f) => `<option value="${f.id}">[${f.severityLabel}] ${f.clauseNo} · ${f.title.slice(0, 30)}</option>`).join("")
      : '<option value="">暂无重大/重要发现</option>';

    eSel.innerHTML =
      '<option value="">（可选）选择已上传资料</option>' +
      state.evidence.map((e) => `<option value="${e.id}">${e.fileName}</option>`).join("");
  }

  function switchPanel(name) {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.panel === name);
    });
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === name);
    });
  }

  function initNav() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        switchPanel(btn.dataset.panel);
      });
    });
  }

  async function refreshOrgUi() {
    state.org = await Org.getActiveOrganization(walletUid);
    const info = $("orgInfo");
    if (state.org) {
      $("orgName").value = state.org.name;
      info.textContent = `当前组织：${state.org.name} · 成员 ${state.org.members?.length || 1} 人`;
    } else {
      info.textContent = "尚未创建组织，可先保存组织名称（仅本地）。";
    }
  }

  async function saveOrg() {
    const role = getRole(state.roleId);
    if (!role.canManageOrg) {
      setStatus("当前身份不可管理组织");
      return;
    }
    const name = $("orgName").value.trim();
    if (!name) {
      setStatus("请填写组织名称");
      return;
    }
    let org = state.org;
    if (!org) {
      org = await Org.createOrganization(name, walletUid);
    } else {
      org.name = name;
      org.updatedAt = Date.now();
      await Store.put("organizations", org);
    }
    const member = $("orgMember").value.trim();
    if (member) org = await Org.addMember(org.id, member);
    state.org = org;
    if (state.project?.id) {
      state.project = await Org.assignProjectOrg(state.project.id, org.id);
    }
    $("orgMember").value = "";
    await refreshOrgUi();
    setStatus(`组织已保存：${org.name}`);
  }

  async function refreshProjectList() {
    const list = $("projectList");
    const projects = (await Store.getAll("projects")).sort((a, b) => b.updatedAt - a.updatedAt);
    list.innerHTML = "";
    if (!projects.length) {
      list.innerHTML = '<p class="muted">暂无项目，请先创建。</p>';
      return;
    }
    projects.forEach((p) => {
      const row = document.createElement("div");
      row.className = "file-item";
      row.innerHTML = `<span><strong>${p.name}</strong><br><span class="muted">${p.auditType || p.template || "专项审计"} · ${p.code || "未编号"} · ${p.period || "未设期间"}</span></span>`;
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn";
      openBtn.textContent = state.project?.id === p.id ? "当前" : "打开";
      openBtn.disabled = state.project?.id === p.id;
      openBtn.addEventListener("click", () => void loadProject(p.id));
      row.appendChild(openBtn);
      list.appendChild(row);
    });
  }

  async function loadConsultSession(projectId) {
    const session = await Store.getConsultSession(projectId);
    state.consultMessages = session?.messages || [];
    renderConsultMessages();
  }

  async function loadProject(projectId) {
    const project = await Store.get("projects", projectId);
    if (!project) return;
    state.project = project;
    $("projectName").value = project.name;
    $("projectTemplate").value = project.template;
    $("projectPeriod").value = project.period || "";
    $("projectCode").value = project.code || "";
    $("projectAuditType").value = project.auditType || "专项审计";
    $("projectClient").value = project.client || "";
    $("projectAuditorUnit").value = project.auditorUnit || "";
    $("projectAuditee").value = project.auditee || "";
    $("projectOwner").value = project.owner || "";
    $("projectStart").value = project.startDate || "";
    $("projectEnd").value = project.endDate || "";
    $("projectTarget").value = project.target || "";
    $("projectScope").value = project.scope || "";
    $("projectKeyAreas").value = project.keyAreas || "";
    $("projectBasis").value = project.basis || "";
    $("projectStatus").value = project.status || "planning";
    state.clauses = await Store.getClausesByProject(projectId);
    state.evidence = await Store.getEvidenceByProject(projectId);
    state.findings = await Store.getFindingsByProject(projectId);
    state.remediations = await Store.getRemediationsByProject(projectId);
    renderClauses();
    renderEvidence();
    renderFindings();
    renderRemediations();
    refreshClauseSelect();
    refreshRemediationSelects();
    await refreshReqFiles();
    await loadConsultSession(projectId);
    await refreshBundleMeta();
    await refreshKbStatus();
    setStatus(
      `已打开：${project.name} · ${state.clauses.length} 条 · ${state.evidence.length} 份资料 · ${state.findings.length} 项发现`
    );
    $("btnExportPackage").disabled = state.clauses.length === 0;
    updateNavAvailability();
  }

  async function refreshReqFiles() {
    const list = $("reqFileList");
    if (!state.project) {
      list.innerHTML = "";
      return;
    }
    const files = (await Store.getAll("requirementFiles")).filter((f) => f.projectId === state.project.id);
    list.innerHTML = files.length
      ? files
          .map(
            (f) =>
              `<div class="file-item"><span>${f.fileName}</span><span class="muted">${f.clauseCount || 0} 条 · ${f.engine || "-"}</span></div>`
          )
          .join("")
      : '<p class="muted">尚未上传要求文件</p>';
  }

  async function saveProject() {
    const name = $("projectName").value.trim();
    if (!name) {
      setStatus("请填写项目名称");
      return;
    }
    const now = Date.now();
    const project = state.project?.id
      ? {
          ...state.project,
          name,
          template: $("projectTemplate").value,
          period: $("projectPeriod").value.trim(),
          code: $("projectCode").value.trim(),
          auditType: $("projectAuditType").value,
          client: $("projectClient").value.trim(),
          auditorUnit: $("projectAuditorUnit").value.trim(),
          auditee: $("projectAuditee").value.trim(),
          owner: $("projectOwner").value.trim(),
          startDate: $("projectStart").value,
          endDate: $("projectEnd").value,
          target: $("projectTarget").value.trim(),
          scope: $("projectScope").value.trim(),
          keyAreas: $("projectKeyAreas").value.trim(),
          basis: $("projectBasis").value.trim(),
          status: $("projectStatus").value || "planning",
          orgId: state.org?.id || state.project.orgId || "",
          updatedAt: now,
        }
      : {
          id: Store.newId("proj"),
          name,
          template: $("projectTemplate").value,
          period: $("projectPeriod").value.trim(),
          code: $("projectCode").value.trim(),
          auditType: $("projectAuditType").value,
          client: $("projectClient").value.trim(),
          auditorUnit: $("projectAuditorUnit").value.trim(),
          auditee: $("projectAuditee").value.trim(),
          owner: $("projectOwner").value.trim(),
          startDate: $("projectStart").value,
          endDate: $("projectEnd").value,
          target: $("projectTarget").value.trim(),
          scope: $("projectScope").value.trim(),
          keyAreas: $("projectKeyAreas").value.trim(),
          basis: $("projectBasis").value.trim(),
          status: $("projectStatus").value || "planning",
          walletUid,
          orgId: state.org?.id || "",
          createdAt: now,
          updatedAt: now,
        };
    await Store.put("projects", project);
    state.project = project;
    try {
      await KB.ensureProjectKb(project);
      state.project = await Store.get("projects", project.id);
    } catch (err) {
      console.warn("[OAO Audit KB] workspace:", err);
    }
    await refreshProjectList();
    await refreshKbStatus();
    updateNavAvailability();
    setStatus(`项目已保存：${name}${state.project.allmWorkspaceSlug ? " · KB:" + state.project.allmWorkspaceSlug : ""}`);
  }

  function renderClauses() {
    const tbody = $("clauseTableBody");
    const stats = $("clauseStats");
    tbody.innerHTML = "";
    const l1Set = new Set();
    state.clauses.forEach((c) => {
      l1Set.add(c.subjectL1);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.clauseNo}</td>
        <td>${c.subjectL1}</td>
        <td>${c.subjectL2}</td>
        <td>${c.text.slice(0, 120)}${c.text.length > 120 ? "…" : ""}</td>
        <td>${c.mandatory ? '<span class="badge">强制</span>' : ""}</td>
        <td>${c.sourceFile || "-"}<br><span class="muted">${c.sourceLoc || ""}</span></td>`;
      tbody.appendChild(tr);
    });
    stats.innerHTML = `
      <div class="stat"><strong>${state.clauses.length}</strong>条款总数</div>
      <div class="stat"><strong>${l1Set.size}</strong>一级科目</div>
      <div class="stat"><strong>${state.clauses.filter((c) => c.mandatory).length}</strong>强制性条款</div>`;
    $("btnExportPackage").disabled = !state.clauses.length;
    refreshClauseSelect();
    updateNavAvailability();
  }

  function renderEvidence() {
    const list = $("evidenceList");
    if (!state.project) {
      list.innerHTML = "";
      return;
    }
    if (!state.evidence.length) {
      list.innerHTML = '<p class="muted">尚未上传迎审资料</p>';
      updateNavAvailability();
      return;
    }
    list.innerHTML = "";
    state.evidence.forEach((e) => {
      const row = document.createElement("div");
      row.className = "file-item";
      const status = e.validationOk ? '<span class="badge ok">校验通过</span>' : '<span class="badge warn">待复核</span>';
      row.innerHTML = `<span><strong>${e.fileName}</strong><br><span class="muted">${e.typeLabel}${e.clauseNo ? " → " + e.clauseNo : ""}</span></span><span>${status}</span>`;
      list.appendChild(row);
    });
    refreshRemediationSelects();
    updateNavAvailability();
  }

  function renderFindings() {
    const tbody = $("findingTableBody");
    const stats = $("findingStats");
    tbody.innerHTML = "";
    const counts = Evaluator.summarizeFindings(state.findings);
    stats.innerHTML = `
      <div class="stat sev-critical"><strong>${counts.critical}</strong>重大</div>
      <div class="stat sev-major"><strong>${counts.major}</strong>重要</div>
      <div class="stat sev-minor"><strong>${counts.minor}</strong>一般</div>
      <div class="stat sev-info"><strong>${counts.info}</strong>提示</div>`;

    state.findings.forEach((f) => {
      const tr = document.createElement("tr");
      const st = FINDING_STATUS_LABEL[f.status] || f.status || "待处理";
      const confirmBadge = f.confirmed ? '<span class="badge ok">已确认</span>' : "";
      tr.innerHTML = `
        <td><span class="badge ${severityClass(f.severity)}">${f.severityLabel}</span></td>
        <td>${f.title}</td>
        <td>${f.clauseNo}</td>
        <td><span class="badge">${st}</span>${confirmBadge}</td>
        <td>${f.description.slice(0, 100)}${f.description.length > 100 ? "…" : ""}</td>
        <td>${(f.recommendation || "-").slice(0, 80)}</td>
        <td><button type="button" class="btn finding-detail-btn" data-finding-id="${f.id}">证据链</button></td>`;
      tbody.appendChild(tr);
    });
    refreshRemediationSelects();
    updateNavAvailability();
  }

  function evidenceForFinding(f) {
    return state.evidence.filter((e) => (f.evidenceIds || []).includes(e.id) || e.clauseId === f.clauseId);
  }

  function renderFindingDetail(f) {
    $("findingDetailTitle").textContent = f.title || "审计发现问题";
    const ev = evidenceForFinding(f);
    const role = getRole(state.roleId);
    const confirmBtn = $("btnConfirmFinding");
    confirmBtn.hidden = !role.canConfirmFindings || f.confirmed === true;
    confirmBtn.dataset.findingId = f.id;

    const chain = ev
      .map((e) => `<div class="evidence-chain-item"><strong>${escapeHtml(e.fileName)}</strong><span class="muted">${escapeHtml(e.typeLabel)}${e.clauseNo ? " · " + e.clauseNo : ""}</span><button type="button" class="btn" data-open-evidence="${e.id}">查看</button></div>`)
      .join("") || '<p class="muted">暂无关联证据</p>';

    const list = (items) => (Array.isArray(items) && items.length ? items.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("") : "<li>—</li>");

    $("findingDetailBody").innerHTML = `
      <div class="finding-detail-grid">
        <div><strong>严重度</strong><span>${escapeHtml(f.severityLabel || "-")}</span></div>
        <div><strong>条款</strong><span>${escapeHtml(f.clauseNo || "-")}</span></div>
        <div><strong>状态</strong><span>${escapeHtml(FINDING_STATUS_LABEL[f.status] || f.status || "待处理")}${f.confirmed ? " · 已人工确认" : ""}</span></div>
        <div><strong>涉及金额</strong><span>${escapeHtml(f.amount || "未识别")}</span></div>
      </div>
      <section class="finding-detail-section">
        <h3>问题事实</h3>
        <p>${escapeHtml(f.facts || f.description || "—")}</p>
      </section>
      <section class="finding-detail-section">
        <h3>证据链</h3>
        ${chain}
      </section>
      <section class="finding-detail-section">
        <h3>制度 / 法律依据</h3>
        <p>${escapeHtml(f.basis?.clauseText || "暂未找到明确制度依据，需人工核实。")}</p>
      </section>
      <section class="finding-detail-section">
        <h3>风险与原因</h3>
        <ul>${list(f.riskFactors)}</ul>
        <p><strong>直接原因：</strong>${escapeHtml(f.directCause || "待补充")}</p>
        <p><strong>管理原因：</strong>${escapeHtml(f.managementCause || "待补充")}</p>
        <p><strong>制度/内控原因：</strong>${escapeHtml(f.systemCause || "待补充")}</p>
      </section>
      <section class="finding-detail-section">
        <h3>建议与整改</h3>
        <p>${escapeHtml(f.recommendation || "—")}</p>
        <p><strong>责任部门：</strong>${escapeHtml(f.remediationOwner || "待明确")}</p>
        <p><strong>整改期限：</strong>${escapeHtml(f.remediationDeadline || "待明确")}</p>
      </section>`;

    $("findingDetailModal").classList.remove("hidden");
  }

  function closeFindingDetail() {
    $("findingDetailModal").classList.add("hidden");
  }

  async function confirmFinding(findingId) {
    const finding = state.findings.find((f) => f.id === findingId);
    if (!finding) return;
    const role = getRole(state.roleId);
    if (!role.canConfirmFindings) {
      setStatus("当前身份不可确认审计问题");
      return;
    }
    finding.confirmed = true;
    finding.confirmedAt = Date.now();
    finding.updatedAt = Date.now();
    await Store.put("findings", finding);
    state.findings = state.findings.map((f) => (f.id === findingId ? finding : f));
    renderFindings();
    renderFindingDetail(finding);
    setStatus(`已确认问题：${finding.title}`);
    updateNavAvailability();
  }

  async function openEvidenceById(evidenceId) {
    const row = await Store.loadBlob(evidenceId);
    if (!row?.blob) {
      setStatus("未找到原始文件，可能仅在元数据中");
      return;
    }
    const url = URL.createObjectURL(row.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function renderRemediations() {
    const list = $("remediationList");
    if (!list) return;
    if (!state.remediations.length) {
      list.innerHTML = '<p class="muted">暂无整改记录</p>';
      return;
    }
    list.innerHTML = state.remediations
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => {
        const f = state.findings.find((x) => x.id === r.findingId);
        return `<div class="file-item"><span><strong>${f?.clauseNo || "-"}</strong><br><span class="muted">${r.note?.slice(0, 80) || "（无说明）"}</span></span><span class="muted">${Remediation.REMEDIATION_STATUS[r.status]?.label || r.status}</span></div>`;
      })
      .join("");
  }

  function renderConsultMessages() {
    const box = $("consultMessages");
    if (!state.consultMessages.length) {
      box.innerHTML = '<p class="muted">暂无对话，输入问题开始咨询。</p>';
      return;
    }
    box.innerHTML = state.consultMessages
      .map(
        (m) =>
          `<div class="consult-msg ${m.role}"><div class="consult-role">${m.role === "user" ? "您" : "OAO"}</div><div class="consult-body">${escapeHtml(m.content)}</div></div>`
      )
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function addPendingFiles(fileList) {
    Array.from(fileList).forEach((f) => {
      if (!state.pendingFiles.some((p) => p.name === f.name && p.size === f.size)) state.pendingFiles.push(f);
    });
    $("btnParseRequirements").disabled = !state.pendingFiles.length || !getRole(state.roleId).canParseRequirements;
    setStatus(`待解析文件：${state.pendingFiles.length} 个`);
  }

  async function uploadEvidenceFiles(fileList) {
    if (!state.project) {
      setStatus("请先保存/选择项目");
      switchPanel("project");
      return;
    }
    if (!getRole(state.roleId).canUploadEvidence) {
      setStatus("当前身份不可上传迎审资料");
      return;
    }

    const typeId = $("evidenceType").value || "other";
    const clauseId = $("evidenceClause").value || "";
    const clause = state.clauses.find((c) => c.id === clauseId);

    for (const file of Array.from(fileList)) {
      setStatus(`校验并入库：${file.name}…`);
      const inspection = await Evidence.inspectEvidenceContent(file, typeId, Parser.extractTextFromFile);
      if (!inspection.ok) {
        setStatus(`校验失败：${inspection.errors.join("；")}`);
        continue;
      }
      const blobId = Store.newId("blob");
      await Store.saveBlob(blobId, file, { name: file.name, type: file.type });
      const row = {
        id: Store.newId("evid"),
        projectId: state.project.id,
        fileName: file.name,
        blobId,
        typeId,
        typeLabel: inspection.typeLabel,
        clauseId: clauseId || "",
        clauseNo: clause?.clauseNo || "",
        preview: inspection.preview || "",
        validationOk: inspection.ok,
        validationWarnings: inspection.warnings || [],
        meta: inspection.meta || {},
        uploadedAt: Date.now(),
      };
      await Store.put("evidenceFiles", row);
      state.evidence.push(row);
      await queueUploadedDoc(state.project, {
        refId: row.id,
        docRole: "evidence",
        fileName: row.fileName,
        clauseNo: row.clauseNo,
        title: `${state.project.name}_迎审_${row.fileName}`,
        body: row.preview || `（文件：${row.fileName}，类型 ${row.typeLabel}）`,
        version: 1,
      });
    }
    renderEvidence();
    setStatus(`迎审资料已入库：共 ${state.evidence.length} 份（已排队同步知识库）`);
  }

  async function parseRequirements() {
    if (!state.project) {
      setStatus("请先保存/选择项目");
      switchPanel("project");
      return;
    }
    if (!state.pendingFiles.length) return;

    const useLlm = $("chkUseLlm").checked;
    $("btnParseRequirements").disabled = true;
    setStatus("正在解析要求文件…");
    const allClauses = [];

    try {
      for (const file of state.pendingFiles) {
        setStatus(`解析中：${file.name}…`);
        const blobId = Store.newId("blob");
        await Store.saveBlob(blobId, file, { name: file.name, type: file.type });
        const result = await Parser.parseRequirementFile(file, {
          templateId: state.project.template,
          useLlm,
        });
        result.clauses.forEach((c, idx) => {
          allClauses.push({
            id: Store.newId("clause"),
            projectId: state.project.id,
            subjectL1: c.subjectL1,
            subjectL2: c.subjectL2,
            subjectL3: c.subjectL3 || "一般要求",
            clauseNo: c.clauseNo || `C-${String(allClauses.length + idx + 1).padStart(3, "0")}`,
            text: c.text,
            mandatory: !!c.mandatory,
            sourceFile: file.name,
            sourceLoc: c.sourceLoc,
            sourceBlobId: blobId,
            createdAt: Date.now(),
          });
        });
        await Store.put("requirementFiles", {
          id: Store.newId("reqf"),
          projectId: state.project.id,
          fileName: file.name,
          blobId,
          clauseCount: result.clauses.length,
          engine: result.engine,
          extractedChars: result.extractedChars,
          uploadedAt: Date.now(),
        });

        const reqText = result.clauses.map((c) => c.text).join("\n");
        await queueUploadedDoc(state.project, {
          refId: `req_${file.name}_${file.size}`,
          docRole: "requirement",
          fileName: file.name,
          title: `${state.project.name}_制度_${file.name}`,
          body: reqText.slice(0, 120000),
          version: result.clauses.length,
        });
      }

      await Store.deleteClausesByProject(state.project.id);
      for (const clause of allClauses) await Store.put("clauses", clause);

      state.clauses = allClauses;
      state.pendingFiles = [];
      renderClauses();
      await refreshReqFiles();
      await KB.syncClauses(state.project, allClauses);
      await refreshKbStatus();
      switchPanel("clauses");
      setStatus(`解析完成：共 ${allClauses.length} 条条款（已更新知识库队列）`);
    } catch (err) {
      console.error(err);
      setStatus(`解析失败：${err.message}`);
    } finally {
      $("btnParseRequirements").disabled = !state.pendingFiles.length;
    }
  }

  async function runEvaluation() {
    if (!state.project) return;
    if (!getRole(state.roleId).canRunEvaluation) {
      setStatus("当前身份不可发起评估，请切换主管/三方/组长");
      return;
    }
    $("btnRunEvaluation").disabled = true;
    setStatus("正在运行智能评估…");
    try {
      const useLlm = $("chkEvalLlm").checked;
      const preferRag = $("chkEvalRag")?.checked !== false;
      const result = await Evaluator.runEvaluation(state.project, state.clauses, state.evidence, {
        useLlm,
        preferRag,
      });

      await Store.deleteFindingsByProject(state.project.id);
      for (const f of result.findings) await Store.put("findings", f);

      await Store.put("evaluationRuns", {
        id: Store.newId("eval"),
        projectId: state.project.id,
        engine: result.engine,
        findingCount: result.findings.length,
        evaluatedAt: result.evaluatedAt,
      });

      state.findings = result.findings;
      renderFindings();
      await KB.syncFindingSnapshot(state.project, result.findings);
      await refreshKbStatus();
      switchPanel("evaluate");
      setStatus(`评估完成：${result.findings.length} 项发现（${result.engine}）`);
    } catch (err) {
      console.error(err);
      setStatus(`评估失败：${err.message}`);
    } finally {
      $("btnRunEvaluation").disabled = !getRole(state.roleId).canRunEvaluation;
    }
  }

  async function submitRemediation() {
    const findingId = $("remFindingSelect").value;
    const note = $("remNote").value.trim();
    const evidenceId = $("remEvidenceSelect").value;
    if (!findingId) {
      setStatus("请选择要整改的发现项");
      return;
    }
    if (!note) {
      setStatus("请填写整改说明");
      return;
    }
    const record = Remediation.buildRemediationRecord(findingId, state.project.id, {
      note,
      evidenceIds: evidenceId ? [evidenceId] : [],
      submittedBy: walletUid,
      status: "submitted",
    });
    await Store.put("remediations", record);
    state.remediations.push(record);

    const finding = state.findings.find((f) => f.id === findingId);
    if (finding) {
      const updated = Remediation.applyRemediationToFinding(finding, record);
      await Store.put("findings", updated);
      state.findings = state.findings.map((f) => (f.id === findingId ? updated : f));
    }

    $("remNote").value = "";
    renderFindings();
    renderRemediations();
    await KB.syncRemediation(state.project, record, finding);
    await refreshKbStatus();
    setStatus("整改记录已提交（已同步知识库队列）");
  }

  async function runReAudit() {
    if (!getRole(state.roleId).canManageRemediation) {
      setStatus("当前身份不可发起再审计");
      return;
    }
    setStatus("再审计复核中…");
    const { updated, closed } = Remediation.reAuditOpenFindings(
      state.findings,
      state.evidence,
      state.remediations,
      Evaluator
    );
    const merged = state.findings.map((f) => {
      const u = updated.find((x) => x.id === f.id);
      const c = closed.find((x) => x.id === f.id);
      return c || u || f;
    });
    for (const f of merged) await Store.put("findings", f);
    state.findings = merged;
    renderFindings();
    setStatus(`再审计完成：复核 ${closed.length} 项，部分整改 ${updated.length} 项`);
    if (closed.length) switchPanel("report");
  }

  async function sendConsult() {
    const input = $("consultInput");
    const q = input.value.trim();
    if (!q || !state.project) return;

    state.consultMessages.push({ role: "user", content: q, at: Date.now() });
    renderConsultMessages();
    input.value = "";
    $("btnConsultSend").disabled = true;
    setStatus("AI 思考中…");

    try {
      let answer = "";
      const kbHealth = await KB.checkHealth();
      if (kbHealth.ok && kbHealth.hasApiKey) {
        try {
          await KB.processSyncQueue(state.project);
          const rag = await KB.consultProject(state.project, q, {
            roleLabel: getRole(state.roleId).label,
          });
          answer = rag.answer;
        } catch (kbErr) {
          console.warn("[OAO Audit] KB 咨询失败，降级 Ollama:", kbErr);
        }
      }
      if (!answer) {
        answer = await AI.consultAudit(q, {
          projectName: state.project.name,
          roleLabel: getRole(state.roleId).label,
          clausesSummary: state.clauses.slice(0, 15).map((c) => `${c.clauseNo}: ${c.text.slice(0, 60)}`).join("\n"),
          findingsSummary: state.findings.slice(0, 10).map((f) => `[${f.severityLabel}] ${f.title}`).join("\n"),
        });
      }
      state.consultMessages.push({ role: "assistant", content: answer, at: Date.now() });
      renderConsultMessages();
      const sessionId = (await Store.getConsultSession(state.project.id))?.id || Store.newId("consult");
      await Store.saveConsultSession({
        id: sessionId,
        projectId: state.project.id,
        messages: state.consultMessages,
        updatedAt: Date.now(),
      });
      setStatus("咨询已回复");
    } catch (err) {
      state.consultMessages.push({
        role: "assistant",
        content: `本地 Ollama 不可用：${err.message}。请确认 Ollama 已启动（127.0.0.1:11434）。`,
        at: Date.now(),
      });
      renderConsultMessages();
      setStatus("咨询失败");
    } finally {
      $("btnConsultSend").disabled = false;
    }
  }

  function bundleContext() {
    return {
      project: state.project,
      clauses: state.clauses,
      evidence: state.evidence,
      findings: state.findings,
      remediations: state.remediations,
      consultMessages: state.consultMessages,
      org: state.org,
      roleId: state.roleId,
      requirementFiles: state.requirementFiles || [],
      evaluationRuns: state.evaluationRuns || [],
    };
  }

  async function refreshBundleMeta() {
    if (!state.project?.id) {
      state.requirementFiles = [];
      state.evaluationRuns = [];
      return;
    }
    state.requirementFiles = (await Store.getAll("requirementFiles")).filter(
      (f) => f.projectId === state.project.id
    );
    state.evaluationRuns = await Store.getEvaluationRunsByProject(state.project.id);
  }

  function exportPackage() {
    if (!state.project || !state.clauses.length) return;
    const md = Parser.buildRequirementPackageMarkdown(state.project, state.clauses);
    const safeName = Bundle.safeName(state.project.name);
    downloadText(`${safeName}_审计需求包.md`, md);
    downloadText(`${safeName}_审计需求包.json`, JSON.stringify({ project: state.project, clauses: state.clauses, exportedAt: new Date().toISOString() }, null, 2));
    setStatus("已导出 Markdown + JSON 需求包");
  }

  function exportReport() {
    if (!state.project || !state.findings.length) return;
    const { filename, content } = Reports.buildReport(
      state.project,
      state.clauses,
      state.findings,
      state.evidence,
      state.roleId,
      state.remediations
    );
    downloadText(Bundle.safeName(filename), content);
    setStatus(`已导出：${filename}`);
  }

  function exportBundle() {
    if (!state.project) return;
    const files = Bundle.buildBundleFiles(bundleContext());
    downloadMany(files);
    setStatus(`成册导出：${files.length} 个文件（将依次下载）`);
  }

  async function exportBundleJson() {
    if (!state.project) return;
    await refreshBundleMeta();
    setStatus("正在打包 JSON 备份（含原文件）…");
    try {
      const ctx = bundleContext();
      const blobs = await Bundle.collectBlobPayloads(ctx, Store);
      const json = Bundle.buildBundleJson(ctx, blobs);
      downloadText(`${Bundle.safeName(state.project.name)}_审计档案备份.json`, json);
      setStatus(`已导出 JSON 备份（含 ${blobs.length} 个原文件）`);
    } catch (err) {
      setStatus(`导出失败：${err.message}`);
    }
  }

  async function importBundleJson(file) {
    if (!file || !Importer) return;
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || "new";
    setStatus("正在导入备份…");
    try {
      const text = await file.text();
      const result = await Importer.importBundle(text, {
        asNewProject: mode === "new",
        overwrite: mode === "overwrite",
      });
      await loadProject(result.projectId);
      if (KB && state.clauses.length) {
        try {
          await KB.ensureProjectKb(state.project);
          await KB.syncClauses(state.project, state.clauses);
          for (const row of state.evidence) {
            await KB.queueDocument(state.project, {
              refId: row.id,
              docRole: "evidence",
              fileName: row.fileName,
              clauseNo: row.clauseNo,
              title: `${state.project.name}_迎审_${row.fileName}`,
              body: row.preview || `（文件：${row.fileName}）`,
              version: 1,
            });
          }
          await refreshKbStatus();
        } catch (kbErr) {
          console.warn("[OAO Audit] post-import KB sync:", kbErr);
        }
      }
      setStatus(
        `导入完成：${result.projectName} · ${result.clauseCount} 条 · ${result.evidenceCount} 份 · ${result.blobCount} 个文件${
          result.hadBlobs ? "" : "（无原文件，需重新上传）"
        }`
      );
      switchPanel("project");
    } catch (err) {
      setStatus(`导入失败：${err.message}`);
    }
  }

  function exportConsult() {
    if (!state.consultMessages.length) {
      setStatus("暂无咨询记录");
      return;
    }
    const md = Reports.buildConsultExport(state.project, state.consultMessages);
    downloadText(`${Bundle.safeName(state.project?.name || "consult")}_审计咨询话术.md`, md);
    setStatus("已导出咨询话术");
  }

  function initUpload() {
    const drop = $("reqDropzone");
    const input = $("reqFileInput");
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => addPendingFiles(e.target.files || []));
    ["dragenter", "dragover"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("dragover");
        if (ev === "drop" && e.dataTransfer?.files?.length) addPendingFiles(e.dataTransfer.files);
      });
    });
    $("btnParseRequirements").addEventListener("click", () => void parseRequirements());
    $("btnExportPackage").addEventListener("click", exportPackage);
  }

  function initEvidenceUpload() {
    const drop = $("evDropzone");
    const input = $("evFileInput");
    if (!drop || !input) return;
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => void uploadEvidenceFiles(e.target.files || []));
    ["dragenter", "dragover"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("dragover");
        if (ev === "drop" && e.dataTransfer?.files?.length) void uploadEvidenceFiles(e.dataTransfer.files);
      });
    });
  }

  async function init() {
    if (window.__OAO_AUDIT_VENDOR_READY__) {
      try {
        await window.__OAO_AUDIT_VENDOR_READY__;
      } catch (err) {
        console.warn("[OAO Audit] vendor load:", err);
      }
    }
    initRoleSelect();
    initRoleOverlay();
    initTemplateSelect();
    initEvidenceTypeSelect();
    initNav();
    initWorkflowBar();
    initUpload();
    initEvidenceUpload();

    $("btnSaveProject").addEventListener("click", () => void saveProject());
    $("btnSwitchProject").addEventListener("click", () => switchPanel("project"));
    $("btnSaveOrg").addEventListener("click", () => void saveOrg());
    $("btnRunEvaluation").addEventListener("click", () => void runEvaluation());
    $("btnSubmitRemediation").addEventListener("click", () => void submitRemediation());
    $("btnReAudit").addEventListener("click", () => void runReAudit());
    $("btnConsultSend").addEventListener("click", () => void sendConsult());
    $("btnExportConsult").addEventListener("click", exportConsult);
    $("btnExportReport").addEventListener("click", exportReport);
    $("btnExportBundle").addEventListener("click", exportBundle);
    $("btnExportBundleJson").addEventListener("click", () => void exportBundleJson());
    $("btnImportBundleJson")?.addEventListener("click", () => $("importBundleInput")?.click());
    $("importBundleInput")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) void importBundleJson(file);
      e.target.value = "";
    });
    $("btnSyncKb").addEventListener("click", () => void manualSyncKb());
    $("btnAnalyzeProject").addEventListener("click", () => void analyzeProjectAll());
    $("btnGoNextStep").addEventListener("click", () => {
      const panel = $("btnGoNextStep").dataset.panel;
      if (panel) switchPanel(panel);
    });

    $("findingTableBody").addEventListener("click", (e) => {
      const detailBtn = e.target.closest(".finding-detail-btn");
      if (detailBtn) {
        const finding = state.findings.find((f) => f.id === detailBtn.dataset.findingId);
        if (finding) renderFindingDetail(finding);
      }
    });

    $("findingDetailModal").addEventListener("click", (e) => {
      const evidenceBtn = e.target.closest("[data-open-evidence]");
      if (evidenceBtn) void openEvidenceById(evidenceBtn.dataset.openEvidence);
    });

    $("btnCloseFindingDetail").addEventListener("click", closeFindingDetail);
    $("btnConfirmFinding").addEventListener("click", () => {
      const id = $("btnConfirmFinding").dataset.findingId;
      if (id) void confirmFinding(id);
    });

    $("consultInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendConsult();
      }
    });

    if (state.roleId) {
      $("roleOverlay").classList.add("hidden");
    } else {
      $("roleOverlay").classList.remove("hidden");
    }

    await refreshOrgUi();
    applyRoleUi();
    await refreshProjectList();
    void refreshAiHealth();
    void refreshKbStatus();
    setStatus("OAO 审计 — IndexedDB 档案 + AnythingLLM 项目知识库");
  }

  async function refreshAiHealth() {
    const health = await AI.checkHealth();
    const kbHealth = KB ? await KB.checkHealth() : { ok: false };
    const meta = $("topMeta");
    if (!meta) return;
    const role = getRole(state.roleId);
    const orgLabel = meta.dataset.orgSuffix || (state.org?.name ? ` · 组织：${state.org.name}` : "");
    const kbPart = kbHealth.ok ? " · KB:在线" : " · KB:离线";
    if (health.ok) {
      const modelHint = health.hasModel ? health.model : `${health.model}（未拉取）`;
      meta.textContent = `身份：${role.label} · Ollama:${modelHint}${kbPart}${orgLabel} · 本地存储`;
    } else {
      meta.textContent = `身份：${role.label} · Ollama 离线${kbPart}${orgLabel} · 本地存储`;
    }
  }

  init();
})();
