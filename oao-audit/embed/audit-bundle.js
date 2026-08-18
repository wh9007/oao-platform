(function (global) {
  "use strict";

  const Parser = global.OAOAuditParser;
  const Reports = global.OAOAuditReports;
  const Remediation = global.OAOAuditRemediation;

  function safeName(name) {
    return String(name || "audit").replace(/[\\/:*?"<>|]/g, "_");
  }

  function buildBundleFiles(ctx) {
    const { project, clauses, evidence, findings, remediations, consultMessages, roleId } = ctx;
    const files = [];
    const base = safeName(project.name);

    if (clauses.length) {
      files.push({
        name: `${base}/01_审计需求包.md`,
        content: Parser.buildRequirementPackageMarkdown(project, clauses),
      });
      files.push({
        name: `${base}/01_审计需求包.json`,
        content: JSON.stringify({ project, clauses, exportedAt: new Date().toISOString() }, null, 2),
      });
    }

    if (findings.length) {
      const report = Reports.buildReport(project, clauses, findings, evidence, roleId, remediations);
      files.push({ name: `${base}/02_${report.type === "self_check" ? "自检自查报告" : "审计结果报告"}.md`, content: report.content });
    }

    if (remediations.length || findings.some(Remediation.needsRemediation)) {
      files.push({
        name: `${base}/03_整改台账.md`,
        content: Remediation.buildRemediationLedger(findings, remediations),
      });
    }

    if (consultMessages?.length) {
      files.push({
        name: `${base}/04_审计咨询话术.md`,
        content: Reports.buildConsultExport(project, consultMessages),
      });
    }

    files.push({
      name: `${base}/00_成册说明.md`,
      content: buildCoverReadme(project, ctx),
    });

    return files;
  }

  function buildCoverReadme(project, ctx) {
    const { clauses, evidence, findings, remediations, org } = ctx;
    let md = `# OAO 审计成册档案\n\n`;
    md += `- 项目：${project.name}\n`;
    md += `- 期间：${project.period || "未设"}\n`;
    md += `- 组织：${org?.name || "个人本地项目"}\n`;
    md += `- 成册时间：${new Date().toLocaleString("zh-CN")}\n\n`;
    md += `## 目录\n\n`;
    md += `| 序号 | 文档 | 说明 |\n| ---: | --- | --- |\n`;
    md += `| 00 | 成册说明 | 本文件 |\n`;
    if (clauses.length) md += `| 01 | 审计需求包 | ${clauses.length} 条条款 |\n`;
    if (findings.length) md += `| 02 | 审计/自检报告 | ${findings.length} 项发现 |\n`;
    if (remediations.length) md += `| 03 | 整改台账 | ${remediations.length} 条整改记录 |\n`;
    if (ctx.consultMessages?.length) md += `| 04 | 咨询话术 | ${ctx.consultMessages.length} 条对话 |\n`;
    md += `\n## 迎审资料索引\n\n`;
    evidence.forEach((e) => {
      md += `- [${e.typeLabel}] ${e.fileName}${e.clauseNo ? ` → ${e.clauseNo}` : ""}\n`;
    });
    md += `\n> 本档案由 OAO 审计模块本地生成，数据不上云。\n`;
    return md;
  }

  function buildBundleJson(ctx, blobs) {
    return JSON.stringify(
      {
        version: 4,
        exportedAt: new Date().toISOString(),
        project: ctx.project,
        org: ctx.org || null,
        clauses: ctx.clauses,
        requirementFiles: ctx.requirementFiles || [],
        evidence: ctx.evidence.map(({ preview, ...rest }) => rest),
        findings: ctx.findings,
        remediations: ctx.remediations,
        evaluationRuns: ctx.evaluationRuns || [],
        consultMessages: ctx.consultMessages,
        blobs: blobs || [],
      },
      null,
      2
    );
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        resolve(dataUrl.split(",")[1] || "");
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function collectBlobPayloads(ctx, store) {
    const ids = new Set();
    (ctx.evidence || []).forEach((e) => e.blobId && ids.add(e.blobId));
    (ctx.clauses || []).forEach((c) => c.sourceBlobId && ids.add(c.sourceBlobId));
    (ctx.requirementFiles || []).forEach((f) => f.blobId && ids.add(f.blobId));
    const payloads = [];
    for (const id of ids) {
      const row = await store.loadBlob(id);
      if (!row?.blob) continue;
      try {
        const base64 = await blobToBase64(row.blob);
        payloads.push({
          id,
          fileName: row.meta?.name || "file",
          mimeType: row.blob.type || "application/octet-stream",
          base64,
        });
      } catch (err) {
        console.warn("[OAO Audit] blob export skip:", id, err);
      }
    }
    return payloads;
  }

  global.OAOAuditBundle = {
    buildBundleFiles,
    buildBundleJson,
    collectBlobPayloads,
    buildCoverReadme,
    safeName,
  };
})(typeof window !== "undefined" ? window : globalThis);
