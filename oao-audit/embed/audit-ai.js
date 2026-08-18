(function (global) {
  "use strict";

  const DEFAULT_BASE = "http://127.0.0.1:11434";
  const DEFAULT_MODEL = "qwen2.5:7b";

  function resolveOllamaBase() {
    if (global.OAO_OLLAMA_BASE_URL) {
      return String(global.OAO_OLLAMA_BASE_URL).replace(/\/$/, "");
    }
    return DEFAULT_BASE;
  }

  function resolveModel() {
    return global.OAO_OLLAMA_MODEL || DEFAULT_MODEL;
  }

  async function checkHealth() {
    const base = resolveOllamaBase();
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { ok: false, base, model: resolveModel(), error: `HTTP ${res.status}` };
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name);
      const model = resolveModel();
      const hasModel = models.some((n) => n === model || n.startsWith(model + ':'));
      return { ok: true, base, model, models, hasModel };
    } catch (err) {
      return { ok: false, base, model: resolveModel(), error: err.message };
    }
  }

  async function chat(prompt, system, options = {}) {
    const base = resolveOllamaBase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 120000);
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: resolveModel(),
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return String(data?.message?.content || "").trim();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  function extractJsonArray(text) {
    const raw = String(text || "").trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : raw;
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    return JSON.parse(body);
  }

  async function parseRequirementsWithLlm(text, templateMeta) {
    const system = `你是 OAO 审计助手。将用户提供的制度/审计要求文本拆分为结构化条款 JSON 数组。
每项字段：subjectL1, subjectL2, subjectL3, clauseNo, text, mandatory(boolean), sourceLoc(页码或段落)。
科目参考模板：${JSON.stringify(templateMeta?.subjects || [])}
规则：仅输出 JSON 数组，不要编造未出现的条款；「必须」「不得」类 mandatory=true。`;
    const prompt = `请解析以下文本（最多取前12000字）：\n\n${text.slice(0, 12000)}`;
    const out = await chat(prompt, system, { timeout: 180000 });
    return extractJsonArray(out);
  }

  async function evaluateFindingsWithLlm(clauses, evidenceRows, project) {
    const clauseBrief = clauses.slice(0, 40).map((c) => ({
      id: c.id,
      clauseNo: c.clauseNo,
      mandatory: c.mandatory,
      text: c.text.slice(0, 200),
    }));
    const evidenceBrief = evidenceRows.slice(0, 30).map((e) => ({
      id: e.id,
      fileName: e.fileName,
      type: e.typeLabel,
      clauseId: e.clauseId,
      preview: (e.preview || "").slice(0, 500),
    }));

    const system = `你是 OAO 审计评估助手（马斯克式：关注成本、流程、采购异常）。
根据条款与迎审资料，输出 Finding JSON 数组。字段：
clauseId, clauseNo, title, description, severity(仅 critical|major|minor|info), recommendation, evidenceIds(数组)。
severity 映射：重大=critical，重要=major，一般=minor，提示=info。
仅输出 JSON 数组；强制性条款缺资料应为 major 或以上。`;
    const prompt = `项目：${project.name}\n条款：${JSON.stringify(clauseBrief)}\n迎审资料：${JSON.stringify(evidenceBrief)}`;
    const out = await chat(prompt, system, { timeout: 180000 });
    return extractJsonArray(out);
  }

  async function consultAudit(question, context) {
    const system = `你是 OAO 本地审计咨询助手。基于项目条款与评估发现回答，语气专业、简洁。
若信息不足请明确说明需补充的资料。不要编造不存在的法规条文。`;
    const prompt = `【项目】${context.projectName || "-"}\n【身份】${context.roleLabel || "-"}\n【条款摘要】\n${context.clausesSummary || "无"}\n【发现摘要】\n${context.findingsSummary || "无"}\n\n【问题】\n${question}`;
    return chat(prompt, system, { timeout: 120000 });
  }

  global.OAOAuditAI = {
    chat,
    parseRequirementsWithLlm,
    evaluateFindingsWithLlm,
    consultAudit,
    extractJsonArray,
    resolveOllamaBase,
    checkHealth,
  };
})(typeof window !== "undefined" ? window : globalThis);
