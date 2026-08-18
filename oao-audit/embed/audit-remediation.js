(function (global) {
  "use strict";

  const REMEDIATION_STATUS = {
    open: { id: "open", label: "待整改" },
    submitted: { id: "submitted", label: "已提交" },
    verified: { id: "verified", label: "已复核" },
    closed: { id: "closed", label: "已关闭" },
  };

  const FINDING_STATUS = {
    open: "open",
    remediated: "remediated",
    verified: "verified",
    closed: "closed",
  };

  function needsRemediation(finding) {
    return finding.severity === "critical" || finding.severity === "major";
  }

  function buildRemediationRecord(findingId, projectId, payload) {
    return {
      id: payload.id || `rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      findingId,
      projectId,
      note: String(payload.note || "").trim(),
      evidenceIds: payload.evidenceIds || [],
      status: payload.status || "submitted",
      submittedBy: payload.submittedBy || "guest",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function applyRemediationToFinding(finding, remediation) {
    return {
      ...finding,
      status: remediation.status === "verified" ? "verified" : "remediated",
      remediationNote: remediation.note,
      remediationAt: remediation.updatedAt,
      updatedAt: Date.now(),
    };
  }

  function reAuditOpenFindings(findings, evidenceRows, remediations, Evaluator) {
    const openMajor = findings.filter(
      (f) => needsRemediation(f) && f.status !== "verified" && f.status !== "closed"
    );
    if (!openMajor.length) return { updated: [], closed: [] };

    const updated = [];
    const closed = [];

    openMajor.forEach((finding) => {
      const rem = remediations
        .filter((r) => r.findingId === finding.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];

      const remEvidence = evidenceRows.filter(
        (e) => rem?.evidenceIds?.includes(e.id) || e.clauseId === finding.clauseId
      );
      const linkedText = remEvidence.map((e) => `${e.fileName}\n${e.preview || ""}`).join("\n");
      const hasNote = rem?.note && rem.note.length >= 8;
      const hasNewEvidence = remEvidence.length > 0;

      if (hasNote && hasNewEvidence) {
        closed.push({
          ...finding,
          status: "verified",
          description: `${finding.description}（再审计：已提交整改说明与佐证，建议人工确认后关闭。）`,
          updatedAt: Date.now(),
        });
      } else if (hasNote || hasNewEvidence) {
        updated.push({
          ...finding,
          status: "remediated",
          description: `${finding.description}（部分整改：${hasNote ? "已有说明" : ""}${hasNote && hasNewEvidence ? "、" : ""}${hasNewEvidence ? "已补充资料" : "缺佐证"}。）`,
          updatedAt: Date.now(),
        });
      } else {
        updated.push(finding);
      }
    });

    return { updated, closed };
  }

  function buildRemediationLedger(findings, remediations) {
    let md = `# 整改台账\n\n`;
    const major = findings.filter(needsRemediation);
    md += `- 待跟踪项：${major.length}\n\n`;
    major.forEach((f, i) => {
      const rem = remediations.filter((r) => r.findingId === f.id);
      md += `## ${i + 1}. [${f.severityLabel}] ${f.title}\n\n`;
      md += `- 条款：${f.clauseNo}\n`;
      md += `- 状态：${f.status || "open"}\n`;
      md += `- 建议：${f.recommendation || "-"}\n\n`;
      if (!rem.length) {
        md += `_暂无整改记录_\n\n`;
      } else {
        rem.forEach((r) => {
          md += `- ${new Date(r.createdAt).toLocaleString("zh-CN")} · ${REMEDIATION_STATUS[r.status]?.label || r.status}\n`;
          md += `  ${r.note || "（无说明）"}\n\n`;
        });
      }
    });
    return md;
  }

  global.OAOAuditRemediation = {
    REMEDIATION_STATUS,
    FINDING_STATUS,
    needsRemediation,
    buildRemediationRecord,
    applyRemediationToFinding,
    reAuditOpenFindings,
    buildRemediationLedger,
  };
})(typeof window !== "undefined" ? window : globalThis);
