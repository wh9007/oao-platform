(function (global) {
  "use strict";

  const SUBJECT_KEYWORDS = [
    { l1: "采购与合同", l2: "采购程序", keys: ["采购", "招标", "投标", "比价", "合同", "供应商"] },
    { l1: "成本与效率", l2: "流程冗余", keys: ["成本", "费用", "冗余", "浪费", "效率", "流程"] },
    { l1: "制度与合规", l2: "制度完备性", keys: ["制度", "规定", "办法", "细则", "合规", "内控"] },
    { l1: "财务与凭证", l2: "会计记录", keys: ["财务", "会计", "凭证", "报销", "预算", "资金"] },
  ];

  async function loadTemplate(templateId) {
    const url = `templates/${templateId || "special"}.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("模板加载失败");
    return res.json();
  }

  function guessSubject(text) {
    const t = String(text || "");
    let best = { l1: "制度与合规", l2: "制度完备性", l3: "一般要求", score: 0 };
    SUBJECT_KEYWORDS.forEach((row) => {
      let score = 0;
      row.keys.forEach((k) => {
        if (t.includes(k)) score += 2;
      });
      if (score > best.score) {
        best = { l1: row.l1, l2: row.l2, l3: row.l3 || "一般要求", score };
      }
    });
    return { l1: best.l1, l2: best.l2, l3: best.l3 };
  }

  function isMandatory(text) {
    return /必须|应当|不得|禁止|严禁|应/.test(String(text || ""));
  }

  function splitClausesHeuristic(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const clauses = [];
    let buf = [];
    let clauseIndex = 0;

    const flush = (sourceLoc) => {
      const joined = buf.join(" ").trim();
      buf = [];
      if (joined.length < 6) return;
      clauseIndex += 1;
      const sub = guessSubject(joined);
      clauses.push({
        subjectL1: sub.l1,
        subjectL2: sub.l2,
        subjectL3: sub.l3,
        clauseNo: `T-${String(clauseIndex).padStart(3, "0")}`,
        text: joined,
        mandatory: isMandatory(joined),
        sourceLoc: sourceLoc || `段${clauseIndex}`,
      });
    };

    lines.forEach((line, i) => {
      const isHead =
        /^第[一二三四五六七八九十百零\d]+[条章节]/.test(line) ||
        /^[(（][一二三四五六七八九十\d]+[)）]/.test(line) ||
        /^\d+[、\.．]\s*\S/.test(line) ||
        /^[\d]+[\s\.、]/.test(line);

      if (isHead && buf.length) flush(`行${i}`);
      if (isHead) {
        flush(`行${i}`);
        buf.push(line.replace(/^[\d、\.．\s]+/, "").trim() || line);
      } else {
        buf.push(line);
      }
    });
    flush("末尾");

    if (!clauses.length && text.trim()) {
      const chunks = text.match(/[\s\S]{1,800}(?:。|\n|$)/g) || [text.slice(0, 800)];
      chunks.forEach((chunk, idx) => {
        const sub = guessSubject(chunk);
        clauses.push({
          subjectL1: sub.l1,
          subjectL2: sub.l2,
          subjectL3: sub.l3,
          clauseNo: `T-${String(idx + 1).padStart(3, "0")}`,
          text: chunk.trim(),
          mandatory: isMandatory(chunk),
          sourceLoc: `块${idx + 1}`,
        });
      });
    }
    return clauses;
  }

  async function extractTextFromFile(file) {
    const name = file.name || "upload";
    const ext = name.split(".").pop().toLowerCase();

    if (ext === "txt" || ext === "md" || ext === "csv" || ext === "json") {
      return { text: await file.text(), sourceType: ext };
    }

    if (ext === "pdf") {
      if (!global.pdfjsLib) {
        throw new Error("PDF 引擎未加载，请刷新页面或改用 TXT/Word 粘贴");
      }
      const buf = await file.arrayBuffer();
      const pdf = await global.pdfjsLib.getDocument({ data: buf }).promise;
      const parts = [];
      for (let p = 1; p <= pdf.numPages; p += 1) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => it.str).join(" ");
        parts.push(`\n--- 第${p}页 ---\n${pageText}`);
      }
      return { text: parts.join("\n"), sourceType: "pdf", pages: pdf.numPages };
    }

    if (ext === "xlsx" || ext === "xls") {
      if (!global.XLSX) throw new Error("Excel 引擎未加载");
      const buf = await file.arrayBuffer();
      const wb = global.XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = global.XLSX.utils.sheet_to_csv(sheet);
      return { text: rows, sourceType: "excel" };
    }

    if (ext === "docx") {
      if (!global.mammoth) throw new Error("Word 引擎未加载");
      const buf = await file.arrayBuffer();
      const result = await global.mammoth.extractRawText({ arrayBuffer: buf });
      return { text: result.value || "", sourceType: "docx" };
    }

    throw new Error(`暂不支持 .${ext}，请转换为 PDF/TXT/DOCX/XLSX`);
  }

  async function parseRequirementFile(file, options = {}) {
    const extracted = await extractTextFromFile(file);
    const template = options.template || (await loadTemplate(options.templateId || "special"));
    let clauses = [];
    let engine = "rules";

    if (options.useLlm !== false) {
      try {
        const llmRows = await global.OAOAuditAI.parseRequirementsWithLlm(extracted.text, template);
        if (Array.isArray(llmRows) && llmRows.length) {
          engine = "ollama";
          clauses = llmRows.map((row, idx) => ({
            subjectL1: row.subjectL1 || row.l1 || "制度与合规",
            subjectL2: row.subjectL2 || row.l2 || "制度完备性",
            subjectL3: row.subjectL3 || row.l3 || "一般要求",
            clauseNo: row.clauseNo || `L-${String(idx + 1).padStart(3, "0")}`,
            text: String(row.text || "").trim(),
            mandatory: !!row.mandatory,
            sourceLoc: row.sourceLoc || extracted.sourceType,
          })).filter((c) => c.text);
        }
      } catch (err) {
        console.warn("[OAO Audit] LLM 解析失败，使用规则拆分:", err);
      }
    }

    if (!clauses.length) {
      clauses = splitClausesHeuristic(extracted.text);
    }

    return {
      fileName: file.name,
      extractedChars: extracted.text.length,
      clauses,
      engine,
    };
  }

  function buildRequirementPackageMarkdown(project, clauses) {
    const byL1 = {};
    clauses.forEach((c) => {
      byL1[c.subjectL1] = byL1[c.subjectL1] || {};
      const l2 = c.subjectL2 || "其他";
      byL1[c.subjectL1][l2] = byL1[c.subjectL1][l2] || [];
      byL1[c.subjectL1][l2].push(c);
    });

    let md = `# 审计需求包\n\n`;
    md += `- 项目：${project.name}\n`;
    md += `- 类型：${project.template}\n`;
    md += `- 条款数：${clauses.length}\n`;
    md += `- 生成时间：${new Date().toLocaleString("zh-CN")}\n\n`;

    Object.keys(byL1).forEach((l1) => {
      md += `## ${l1}\n\n`;
      Object.keys(byL1[l1]).forEach((l2) => {
        md += `### ${l2}\n\n`;
        byL1[l1][l2].forEach((c) => {
          md += `- **${c.clauseNo}** ${c.mandatory ? "〔强制〕" : ""} ${c.text}\n`;
          md += `  - 来源：${c.sourceFile || "-"} / ${c.sourceLoc || "-"}\n`;
        });
        md += `\n`;
      });
    });
    return md;
  }

  global.OAOAuditParser = {
    loadTemplate,
    parseRequirementFile,
    splitClausesHeuristic,
    buildRequirementPackageMarkdown,
    extractTextFromFile,
  };
})(typeof window !== "undefined" ? window : globalThis);
