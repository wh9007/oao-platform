(function (global) {
  "use strict";

  const { SEVERITY } = global.OAOAuditEvidence;

  function severityOrder(a, b) {
    return (SEVERITY[a]?.order ?? 9) - (SEVERITY[b]?.order ?? 9);
  }

  function buildAuditResultReport(project, clauses, findings, evidenceRows, role, remediations) {
    const counts = { critical: 0, major: 0, minor: 0, info: 0 };
    findings.forEach((f) => {
      if (counts[f.severity] !== undefined) counts[f.severity] += 1;
    });

    let md = `# 审计结果报告\n\n`;
    md += `## 一、审计基本情况\n\n`;
    md += `- 项目：${project.name}\n`;
    md += `- 项目编号：${project.code || "-"}\n`;
    md += `- 审计类型：${project.auditType || project.template || "-"}\n`;
    md += `- 委托单位：${project.client || "-"}\n`;
    md += `- 审计单位：${project.auditorUnit || "-"}\n`;
    md += `- 被审计单位：${project.auditee || "-"}\n`;
    md += `- 审计负责人：${project.owner || "-"}\n`;
    md += `- 期间：${project.period || "未设"}\n`;
    md += `- 计划开始：${project.startDate || "-"}\n`;
    md += `- 计划结束：${project.endDate || "-"}\n`;
    md += `- 项目状态：${project.status || "-"}\n`;
    md += `- 审计目标：${project.target || "-"}\n`;
    md += `- 审计范围：${project.scope || "-"}\n`;
    md += `- 重点领域：${project.keyAreas || "-"}\n`;
    md += `- 审计依据：${project.basis || "-"}\n`;
    md += `- 导出身份：${role?.label || "审计方"}\n`;
    md += `- 生成时间：${new Date().toLocaleString("zh-CN")}\n\n`;

    md += `## 概要\n\n`;
    md += `| 指标 | 数量 |\n| --- | ---: |\n`;
    md += `| 条款总数 | ${clauses.length} |\n`;
    md += `| 迎审资料 | ${evidenceRows.length} |\n`;
    md += `| 重大 | ${counts.critical} |\n`;
    md += `| 重要 | ${counts.major} |\n`;
    md += `| 一般 | ${counts.minor} |\n`;
    md += `| 提示 | ${counts.info} |\n`;
    md += `| 整改记录 | ${remediations?.length || 0} |\n\n`;

    md += `## 发现事项（Finding）\n\n`;
    const sorted = [...findings].sort((a, b) => severityOrder(a.severity, b.severity));
    sorted.forEach((f, i) => {
      md += `### ${i + 1}. [${f.severityLabel}] ${f.title}\n\n`;
      md += `- 条款：${f.clauseNo}（${f.subjectL1} / ${f.subjectL2}）\n`;
      md += `- 状态：${f.status || "open"}\n`;
      md += `- 人工确认：${f.confirmed ? "已确认" : "待确认"}\n`;
      md += `- 问题事实：${f.facts || f.description || "-"}\n`;
      md += `- 涉及主体：${f.involvedParties || "-"}\n`;
      md += `- 涉及金额：${f.amount || "-"}\n`;
      md += `- 制度依据：${f.basis?.clauseText?.slice(0, 200) || "暂未找到明确制度依据"}${f.basis?.clauseText?.length > 200 ? "…" : ""}\n`;
      md += `- 直接原因：${f.directCause || "-"}\n`;
      md += `- 管理原因：${f.managementCause || "-"}\n`;
      md += `- 制度/内控原因：${f.systemCause || "-"}\n`;
      md += `- 潜在影响：${f.potentialImpact || "-"}\n`;
      md += `- 风险因素：${(f.riskFactors || []).join("、") || "-"}\n`;
      md += `- 建议：${f.recommendation || "-"}\n`;
      md += `- 整改责任部门：${f.remediationOwner || "-"}\n`;
      md += `- 建议整改期限：${f.remediationDeadline || "-"}\n\n`;
    });

    if (remediations?.length) {
      md += `## 整改跟进摘要\n\n`;
      remediations.slice(0, 20).forEach((r) => {
        md += `- ${r.note?.slice(0, 100) || "（无说明）"} · ${r.status}\n`;
      });
      md += `\n`;
    }

    md += `## 附录：条款覆盖\n\n`;
    clauses.slice(0, 50).forEach((c) => {
      md += `- ${c.clauseNo} ${c.mandatory ? "〔强制〕" : ""} ${c.text.slice(0, 60)}…\n`;
    });
    if (clauses.length > 50) md += `\n… 共 ${clauses.length} 条，完整清单见需求包导出。\n`;

    return md;
  }

  function buildSelfCheckReport(project, clauses, findings, evidenceRows) {
    const openMajor = findings.filter((f) => f.severity === "critical" || f.severity === "major");
    const openMinor = findings.filter((f) => f.severity === "minor" || f.severity === "info");

    let md = `# 自检自查报告\n\n`;
    md += `- 项目：${project.name}\n`;
    md += `- 项目编号：${project.code || "-"}\n`;
    md += `- 被审计单位：${project.auditee || "-"}\n`;
    md += `- 审计期间：${project.period || "-"}\n`;
    md += `- 自检范围：${project.scope || "-"}\n`;
    md += `- 重点领域：${project.keyAreas || "-"}\n`;
    md += `- 生成时间：${new Date().toLocaleString("zh-CN")}\n\n`;

    md += `## 迎审准备情况\n\n`;
    md += `- 已提交资料：${evidenceRows.length} 份\n`;
    md += `- 对照条款：${clauses.length} 条\n`;
    md += `- 待重点整改：${openMajor.length} 项\n`;
    md += `- 一般/提示项：${openMinor.length} 项\n\n`;

    md += `## 重点整改清单\n\n`;
    if (!openMajor.length) {
      md += `暂无重大/重要级别待整改项。\n\n`;
    } else {
      openMajor.forEach((f, i) => {
        md += `${i + 1}. **${f.severityLabel}** ${f.title}\n`;
        md += `   - 对应条款：${f.clauseNo}\n`;
        md += `   - 问题事实：${f.facts || f.description}\n`;
        md += `   - 整改建议：${f.recommendation || f.description}\n\n`;
      });
    }

    md += `## 资料清单\n\n`;
    evidenceRows.forEach((e) => {
      md += `- [${e.typeLabel}] ${e.fileName}${e.clauseNo ? ` → 条款 ${e.clauseNo}` : ""}\n`;
    });

    return md;
  }

  function buildReport(project, clauses, findings, evidenceRows, roleId, remediations) {
    const roleMap = {
      auditee: "被审计单位",
      supervisor: "主管单位",
      third_party: "三方审计单位",
      lead: "审计组长",
    };
    const role = { id: roleId, label: roleMap[roleId] || roleId };

    if (roleId === "auditee") {
      return {
        filename: `${project.name}_自检自查报告.md`,
        content: buildSelfCheckReport(project, clauses, findings, evidenceRows),
        type: "self_check",
      };
    }

    return {
      filename: `${project.name}_审计结果报告.md`,
      content: buildAuditResultReport(project, clauses, findings, evidenceRows, role, remediations),
      type: "audit_result",
    };
  }

  function buildConsultExport(project, messages) {
    let md = `# 审计咨询记录\n\n`;
    md += `- 项目：${project?.name || "-"}\n`;
    md += `- 导出时间：${new Date().toLocaleString("zh-CN")}\n\n`;
    messages.forEach((m) => {
      md += `**${m.role === "user" ? "问" : "答"}** (${new Date(m.at).toLocaleString("zh-CN")})\n\n`;
      md += `${m.content}\n\n---\n\n`;
    });
    return md;
  }

  global.OAOAuditReports = {
    buildReport,
    buildConsultExport,
    buildAuditResultReport,
    buildSelfCheckReport,
  };
})(typeof window !== "undefined" ? window : globalThis);
