(function (global) {
  "use strict";

  const PHASES = [
    { id: "identity", label: "身份选择", panel: "project" },
    { id: "project", label: "创建项目", panel: "project" },
    { id: "planning", label: "制定任务", panel: "requirements" },
    { id: "documents", label: "上传资料", panel: "evidence" },
    { id: "parse", label: "AI资料解析", panel: "requirements" },
    { id: "basis", label: "制度依据匹配", panel: "clauses" },
    { id: "analysis", label: "AI审计分析", panel: "evaluate" },
    { id: "findings", label: "发现问题与风险", panel: "evaluate" },
    { id: "confirm", label: "人工确认复核", panel: "evaluate" },
    { id: "papers", label: "形成审计底稿", panel: "report" },
    { id: "report", label: "生成审计报告", panel: "report" },
    { id: "remediation", label: "整改与跟踪", panel: "remediation" },
    { id: "archive", label: "项目归档", panel: "report" },
  ];

  function computePhase(ctx) {
    const { project, clauses = [], evidence = [], findings = [], remediations = [] } = ctx;
    if (!project) return "identity";
    if (!clauses.length) return "project";
    if (!evidence.length) return "documents";
    if (!findings.length) return "analysis";

    const confirmed = findings.filter((f) => f.confirmed === true);
    if (!confirmed.length) return "findings";

    const majorOpen = findings.some(
      (f) => (f.severity === "critical" || f.severity === "major") &&
        f.status !== "verified" &&
        f.status !== "closed"
    );
    if (majorOpen || remediations.length) return "remediation";
    return "report";
  }

  function buildSteps(ctx) {
    const current = computePhase(ctx);
    const idx = PHASES.findIndex((p) => p.id === current);
    return PHASES.map((p, i) => ({
      ...p,
      state: i < idx ? "done" : i === idx ? "current" : "pending",
    }));
  }

  function getSuggestedAction(role, ctx) {
    const phase = computePhase(ctx);
    const map = {
      identity: { panel: "project", text: "请先选择审计身份。" },
      project: { panel: "project", text: "创建并填写审计项目基本信息与审计目标、范围。" },
      planning: {
        panel: role.canParseRequirements ? "requirements" : "clauses",
        text: role.canParseRequirements
          ? "制定审计任务：上传制度/要求文件并解析生成条款。"
          : "查看审计条款与任务范围。",
      },
      documents: {
        panel: role.canUploadEvidence ? "evidence" : "clauses",
        text: role.canUploadEvidence
          ? "在审计资料中心上传迎审资料并关联条款。"
          : "等待被审计单位提交迎审资料。",
      },
      parse: {
        panel: role.canParseRequirements ? "requirements" : "clauses",
        text: role.canParseRequirements ? "AI 正在解析制度/要求文件并生成条款。" : "查看已解析条款。",
      },
      basis: {
        panel: "clauses",
        text: "核对制度/法律依据与条款清单，确认可追溯。",
      },
      analysis: {
        panel: "evaluate",
        text: role.canRunEvaluation !== false ? "运行 AI 审计分析，生成审计疑点与发现。" : "查看 AI 审计分析结果。",
      },
      findings: {
        panel: "evaluate",
        text: "检查 AI 审计发现、证据链与风险评级，逐项人工确认。",
      },
      confirm: {
        panel: "evaluate",
        text: "请审计组长/审计负责人完成人工确认与质量复核。",
      },
      papers: {
        panel: "report",
        text: "基于已确认问题形成审计工作底稿与报告草稿。",
      },
      remediation: {
        panel: "remediation",
        text: role.canManageRemediation
          ? "提交整改说明并发起再审计复核。"
          : "跟进整改项并补充佐证材料。",
      },
      report: { panel: "report", text: "生成并导出分身份审计报告或成册审计档案。" },
      archive: { panel: "report", text: "复核整改闭环并归档项目。" },
    };
    return map[phase] || map.init;
  }

  function panelAccessible(role, panel, ctx) {
    if (panel === "clauses" && !(ctx.clauses?.length > 0)) return false;
    if (panel === "requirements" && !role.canUploadRequirements && !role.canParseRequirements) {
      return ctx.clauses?.length > 0;
    }
    if (panel === "evaluate" && role.canViewFindings === false) return false;
    if (panel === "remediation" && !(ctx.findings?.length > 0)) return false;
    return true;
  }

  global.OAOAuditWorkflow = {
    PHASES,
    computePhase,
    buildSteps,
    getSuggestedAction,
    panelAccessible,
  };
})(typeof window !== "undefined" ? window : globalThis);
