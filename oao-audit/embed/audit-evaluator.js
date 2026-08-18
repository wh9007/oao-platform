(function (global) {
  "use strict";

  const { SEVERITY } = global.OAOAuditEvidence;

  function keywordOverlap(a, b) {
    const words = String(b || "")
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const text = String(a || "");
    let hits = 0;
    words.forEach((w) => {
      if (text.includes(w)) hits += 1;
    });
    return hits;
  }

  function mapSeverity(id) {
    const row = SEVERITY[id] || SEVERITY.info;
    return { id: row.id, label: row.label };
  }

  function buildFinding(projectId, clause, payload) {
    const sev = mapSeverity(payload.severity || "info");
    return {
      id: payload.id || `find_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      projectId,
      clauseId: clause.id,
      clauseNo: clause.clauseNo,
      subjectL1: clause.subjectL1,
      subjectL2: clause.subjectL2,
      title: payload.title || `条款 ${clause.clauseNo} 评估`,
      description: payload.description || "",
      severity: sev.id,
      severityLabel: sev.label,
      basis: {
        clauseNo: clause.clauseNo,
        clauseText: clause.text,
        sourceFile: clause.sourceFile,
        sourceLoc: clause.sourceLoc,
        mandatory: !!clause.mandatory,
      },
      evidenceIds: payload.evidenceIds || [],
      facts: payload.facts || payload.description || "",
      involvedParties: payload.involvedParties || payload.parties || "",
      amount: payload.amount || "",
      riskFactors: payload.riskFactors || [],
      directCause: payload.directCause || "",
      managementCause: payload.managementCause || "",
      systemCause: payload.systemCause || "",
      potentialImpact: payload.potentialImpact || payload.impact || "",
      confidence: payload.confidence || "low",
      missingEvidence: payload.missingEvidence || [],
      suggestedProcedures: payload.suggestedProcedures || [],
      remediationOwner: payload.remediationOwner || payload.owner || "",
      remediationDeadline: payload.remediationDeadline || payload.deadline || "",
      recommendation: payload.recommendation || "",
      status: payload.status || "open",
      confirmed: payload.confirmed === true,
      confirmedAt: payload.confirmedAt || null,
      engine: payload.engine || "rules",
      createdAt: Date.now(),
    };
  }

  function evaluateRules(clauses, evidenceRows) {
    const findings = [];
    const evidenceTextById = {};
    evidenceRows.forEach((e) => {
      evidenceTextById[e.id] = `${e.fileName}\n${e.preview || ""}`;
    });
    const allEvidenceText = evidenceRows.map((e) => evidenceTextById[e.id]).join("\n");

    clauses.forEach((clause) => {
      const linked = evidenceRows.filter((e) => e.clauseId === clause.id);
      const linkedIds = linked.map((e) => e.id);
      const corpus = linked.length
        ? linked.map((e) => evidenceTextById[e.id]).join("\n")
        : allEvidenceText;

      const overlap = keywordOverlap(corpus, clause.text);
      const hasLinked = linked.length > 0;
      const hasMatch = hasLinked || overlap >= 2;

      if (clause.mandatory && !hasMatch) {
        findings.push(
          buildFinding(clause.projectId, clause, {
            severity: "major",
            title: `强制性条款缺少迎审资料：${clause.clauseNo}`,
            description: `条款要求「${clause.text.slice(0, 80)}${clause.text.length > 80 ? "…" : ""}」未找到对应迎审资料或内容关联不足。`,
            facts: `当前未关联到与条款 ${clause.clauseNo} 直接对应的迎审资料。`,
            evidenceIds: linkedIds,
            missingEvidence: [`与 ${clause.clauseNo} 相关的制度、凭证或台账`],
            suggestedProcedures: ["请被审计单位补充原始资料", "核对是否存在线下已提供但未上传的情况"],
            recommendation: "请被审计单位补充与该条款直接相关的制度、凭证或台账。",
            engine: "rules",
          })
        );
        return;
      }

      if (hasMatch && overlap < 3 && clause.mandatory) {
        findings.push(
          buildFinding(clause.projectId, clause, {
            severity: "minor",
            title: `资料关联偏弱：${clause.clauseNo}`,
            description: `已提交资料与条款关键词匹配较少，需人工复核是否充分。`,
            facts: `已提交资料与条款 ${clause.clauseNo} 的关联性较弱。`,
            evidenceIds: linkedIds,
            missingEvidence: ["更直接对应条款的原始凭证或说明"],
            suggestedProcedures: ["人工复核已提交资料", "必要时补充关键原始凭证"],
            recommendation: "补充更直接对应条款要求的原始凭证或说明。",
            engine: "rules",
          })
        );
      }
    });

    if (!findings.length && clauses.length) {
      findings.push(
        buildFinding(clauses[0].projectId, clauses[0], {
          severity: "info",
          title: "初评未发现重大缺失",
          description: "规则引擎未检出强制性条款缺资料或明显弱关联项，建议结合 Ollama 深度评估或人工抽查。",
          evidenceIds: evidenceRows.map((e) => e.id),
          recommendation: "可发起再审计或在关键科目上人工复核。",
          engine: "rules",
        })
      );
    }

    return findings;
  }

  async function evaluateWithLlm(clauses, evidenceRows, project) {
    if (!global.OAOAuditAI?.evaluateFindingsWithLlm) {
      return evaluateRules(clauses, evidenceRows);
    }
    try {
      const llmFindings = await global.OAOAuditAI.evaluateFindingsWithLlm(clauses, evidenceRows, project);
      if (Array.isArray(llmFindings) && llmFindings.length) {
        return llmFindings
          .map((f) => {
            const clause =
              clauses.find((c) => c.id === f.clauseId || c.clauseNo === f.clauseNo) || null;
            if (!clause) return null;
            return buildFinding(project.id, clause, { ...f, engine: "ollama" });
          })
          .filter(Boolean);
      }
    } catch (err) {
      console.warn("[OAO Audit] LLM 评估失败，降级规则引擎:", err);
    }
    const ruleFindings = evaluateRules(clauses, evidenceRows);
    ruleFindings.forEach((f) => {
      f.description += "（LLM 不可用，已使用规则引擎）";
    });
    return ruleFindings;
  }

  async function runEvaluation(project, clauses, evidenceRows, options = {}) {
    if (!clauses.length) throw new Error("请先解析制度生成条款清单");
    if (!evidenceRows.length) throw new Error("请先上传迎审资料");

    const useRag = options.preferRag === true;
    if (useRag && global.OAOAuditKB) {
      try {
        await global.OAOAuditKB.processSyncQueue(project);
        const rag = await global.OAOAuditKB.evaluateViaRag(project, clauses, evidenceRows);
        const raw = rag.answer || "";
        const parsed = global.OAOAuditAI?.extractJsonArray
          ? global.OAOAuditAI.extractJsonArray(raw)
          : JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
        if (Array.isArray(parsed) && parsed.length) {
          const findings = parsed
            .map((f) => {
              const clause =
                clauses.find((c) => c.id === f.clauseId || c.clauseNo === f.clauseNo) || null;
              if (!clause) return null;
              return buildFinding(project.id, clause, { ...f, engine: "anythingllm" });
            })
            .filter(Boolean);
          if (findings.length) {
            return {
              findings,
              engine: "anythingllm+rag",
              evaluatedAt: Date.now(),
              clauseCount: clauses.length,
              evidenceCount: evidenceRows.length,
            };
          }
        }
      } catch (err) {
        console.warn("[OAO Audit] RAG 评估失败，降级 Ollama/规则:", err);
      }
    }

    const useLlm = options.useLlm !== false;
    const findings = useLlm
      ? await evaluateWithLlm(clauses, evidenceRows, project)
      : evaluateRules(clauses, evidenceRows);

    return {
      findings,
      engine: findings.some((f) => f.engine === "ollama") ? "ollama+rules" : "rules",
      evaluatedAt: Date.now(),
      clauseCount: clauses.length,
      evidenceCount: evidenceRows.length,
    };
  }

  function summarizeFindings(findings) {
    const counts = { critical: 0, major: 0, minor: 0, info: 0 };
    findings.forEach((f) => {
      if (counts[f.severity] !== undefined) counts[f.severity] += 1;
    });
    return counts;
  }

  global.OAOAuditEvaluator = {
    runEvaluation,
    evaluateRules,
    summarizeFindings,
    buildFinding,
  };
})(typeof window !== "undefined" ? window : globalThis);
