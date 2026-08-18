(function (global) {
  "use strict";

  const EVIDENCE_TYPES = {
    policy: { id: "policy", label: "制度/规章", exts: ["pdf", "docx", "doc", "txt", "md"] },
    financial: { id: "financial", label: "财务 Excel", exts: ["xlsx", "xls", "csv"] },
    voucher: { id: "voucher", label: "凭证/扫描件", exts: ["pdf", "jpg", "jpeg", "png", "webp"] },
    contract: { id: "contract", label: "合同/协议", exts: ["pdf", "docx", "doc"] },
    other: { id: "other", label: "其他资料", exts: ["pdf", "docx", "xlsx", "txt", "md", "jpg", "jpeg", "png"] },
  };

  const SEVERITY = {
    critical: { id: "critical", label: "重大", order: 0 },
    major: { id: "major", label: "重要", order: 1 },
    minor: { id: "minor", label: "一般", order: 2 },
    info: { id: "info", label: "提示", order: 3 },
  };

  function extOf(name) {
    return String(name || "").split(".").pop().toLowerCase();
  }

  function detectEvidenceType(file) {
    const ext = extOf(file.name);
    for (const t of Object.values(EVIDENCE_TYPES)) {
      if (t.id !== "other" && t.exts.includes(ext)) return t.id;
    }
    return "other";
  }

  function validateEvidenceFile(file, typeId) {
    const type = EVIDENCE_TYPES[typeId] || EVIDENCE_TYPES.other;
    const ext = extOf(file.name);
    const errors = [];
    const warnings = [];

    if (!file.size) errors.push("文件为空");
    if (file.size > 50 * 1024 * 1024) errors.push("文件超过 50MB 上限");

    if (!type.exts.includes(ext)) {
      errors.push(`类型「${type.label}」不支持 .${ext}，允许：${type.exts.join(", ")}`);
    }

    if (typeId === "financial" && !["xlsx", "xls", "csv"].includes(ext)) {
      errors.push("财务资料需为 Excel/CSV");
    }

    if (file.name.length > 200) warnings.push("文件名过长，建议缩短");

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      typeId,
      typeLabel: type.label,
      ext,
    };
  }

  async function validateExcelStructure(text) {
    const lines = String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return { ok: false, message: "Excel 至少需要表头 + 一行数据" };
    }
    const header = lines[0].split(",");
    if (header.length < 2) {
      return { ok: false, message: "表头列数不足（建议 ≥2 列）" };
    }
    return { ok: true, columns: header.length, rows: lines.length - 1 };
  }

  async function inspectEvidenceContent(file, typeId, extractText) {
    const base = validateEvidenceFile(file, typeId);
    if (!base.ok) return { ...base, preview: "" };

    let preview = "";
    try {
      preview = (await extractText(file)).text.slice(0, 4000);
    } catch (err) {
      base.warnings.push(`内容预览失败：${err.message}`);
    }

    if (typeId === "financial" && preview) {
      const xl = await validateExcelStructure(preview);
      if (!xl.ok) base.warnings.push(xl.message);
      else base.meta = { columns: xl.columns, rows: xl.rows };
    }

    if (typeId === "voucher" && !preview && ["jpg", "jpeg", "png", "webp"].includes(base.ext)) {
      base.warnings.push("图片类凭证无法提取文字，评估时将标记为「已提交影像」");
      base.meta = { imageOnly: true };
    }

    return { ...base, preview };
  }

  global.OAOAuditEvidence = {
    EVIDENCE_TYPES,
    SEVERITY,
    detectEvidenceType,
    validateEvidenceFile,
    inspectEvidenceContent,
    validateExcelStructure,
  };
})(typeof window !== "undefined" ? window : globalThis);
