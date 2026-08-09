(function (global) {
  'use strict';

  const TIMEOUTS = {
    anythingllm: 90000,
    ollama: 120000,
    glm: 60000,
  };

  const EMPTY_STRUCTURE = {
    summary: '',
    keyPoints: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
  };

  let ollamaChain = Promise.resolve();

  function isEn(lang) {
    return lang === 'en';
  }

  function shouldUseMeetingRag() {
    if (global.OAO_MEETING_RAG_ENABLED === false) return false;
    const host = global.location?.hostname || '';
    if (host === '127.0.0.1' || host === 'localhost' || host === '') return true;
    return false;
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error((label || 'request') + ' timeout after ' + ms + 'ms'));
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  function runOllamaQueued(task) {
    const run = ollamaChain.then(task, task);
    ollamaChain = run.catch(() => {});
    return run;
  }

  function logMinutesResolved(provider, detail) {
    console.info('[OAO Meeting Minutes] resolved via:', provider, detail || '');
  }

  function computeAiTimeout(prompt, baseMs) {
    const base = Number(baseMs) || TIMEOUTS.ollama;
    const len = String(prompt || '').length;
    return Math.max(base, 60000, Math.min(360000, 45000 + Math.floor(len / 10)));
  }

  function truncateText(text, maxLen) {
    const t = String(text || '').trim();
    if (!t || t.length <= maxLen) return t;
    return t.slice(0, Math.max(1, maxLen - 1)) + '…';
  }

  function lineSimilarity(a, b) {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.92;
    const minLen = Math.min(x.length, y.length);
    let same = 0;
    for (let i = 0; i < minLen; i++) {
      if (x[i] === y[i]) same += 1;
    }
    return same / Math.max(x.length, y.length);
  }

  function pickDistinctLines(items, max, threshold) {
    const out = [];
    items.forEach((item) => {
      const text = String(item || '').trim();
      if (!text) return;
      if (out.some((existing) => lineSimilarity(existing, text) >= (threshold || 0.58))) return;
      out.push(text);
    });
    return out.slice(0, max);
  }

  function tokenizeTranscriptLines(transcript) {
    return String(transcript || '')
      .split('\n')
      .flatMap((line) => {
        const body = line.replace(/^\[[^\]]+\]\s*/, '').trim();
        if (!body) return [];
        return body.split(/[。！？!?；;]+/).map((part) => part.trim()).filter((part) => part.length >= 4);
      });
  }

  function scoreMinuteSentence(sentence, index, total) {
    let score = Math.min(String(sentence).length, 96) * 0.06;
    if (/决定|同意|安排|负责|截止|下一步|结论|方案|讨论|建议|要求|部署|上线|预算|目标|计划|确认|通过|否决|延期|推进|汇报|总结/.test(sentence)) {
      score += 4;
    }
    if (/^(嗯|啊|那个|这个|然后|就是|好的|对对|OK|ok)[，,]?/u.test(sentence) && sentence.length < 14) {
      score -= 3;
    }
    if (index >= total * 0.45) score += 0.6;
    return score;
  }

  function isEmptyMinutesHint(summary, lang) {
    const text = String(summary || '').trim();
    if (!text) return true;
    if (isEn(lang)) return /not explicitly mentioned/i.test(text);
    return /未明确提及|暂无相关信息|无实质内容/.test(text);
  }

  function postProcessStructured(structured, lang) {
    structured = normalizeStructured(structured, lang);
    if (!isEmptyMinutesHint(structured.summary, lang)) {
      structured.summary = truncateText(structured.summary, isEn(lang) ? 420 : 220);
    }
    structured.keyPoints = pickDistinctLines(structured.keyPoints, 6).map((item) =>
      truncateText(item, isEn(lang) ? 120 : 60)
    );
    structured.decisions = pickDistinctLines(structured.decisions, 5).map((item) =>
      truncateText(item, isEn(lang) ? 120 : 60)
    );
    structured.openQuestions = pickDistinctLines(structured.openQuestions, 4).map((item) =>
      truncateText(item, isEn(lang) ? 120 : 60)
    );
    structured.actionItems = structured.actionItems.slice(0, 6).map((item) => ({
      task: truncateText(item.task, isEn(lang) ? 120 : 60),
      owner: truncateText(item.owner, isEn(lang) ? 40 : 20),
      deadline: truncateText(item.deadline, isEn(lang) ? 40 : 20),
    }));
    return structured;
  }

  function buildStructuredPrompt(options) {
    options = options || {};
    const lang = options.lang || 'zh';
    const prepare = options.prepareTranscript || ((t) => t);
    const scopedTranscript = prepare(options.transcript || '');
    const stopped = options.stoppedLabel || (isEn(lang) ? 'Stopped' : '已停止');
    const metaLine = isEn(lang)
      ? 'Duration: ' + (options.durationStr || '—') + '; Start: ' + ((options.sessionMeta && options.sessionMeta.startLabel) || stopped)
      : '会议时长：' + (options.durationStr || '—') + '；开始时间：' + ((options.sessionMeta && options.sessionMeta.startLabel) || stopped);

    const schemaHint = '{"summary":"...","keyPoints":["..."],"decisions":["..."],"actionItems":[{"task":"...","owner":"...","deadline":"..."}],"openQuestions":["..."]}';

    if (isEn(lang)) {
      return 'You are Xiao O Meeting Assistant. Produce **concise executive meeting minutes** strictly from the transcript below.\n\n'
        + 'Rules:\n'
        + '1. Extract only facts explicitly stated; never invent names, dates, or tasks.\n'
        + '2. **Summarize, do not copy.** Merge repetition; remove filler and chitchat.\n'
        + '3. summary: 2–4 sentences capturing the meeting purpose, main discussion, and outcome (≤420 chars).\n'
        + '4. keyPoints: 3–6 distilled bullets (≤120 chars each), not verbatim transcript lines.\n'
        + '5. decisions / actionItems / openQuestions: include only when clearly supported by the transcript.\n'
        + '6. Output **valid JSON only** (no markdown fences, no extra commentary) matching:\n'
        + schemaHint + '\n'
        + '7. Use empty arrays [] when a field has no evidence.\n'
        + '8. Use the empty-summary phrase only when the transcript is empty or contains no substantive discussion.\n\n'
        + metaLine + '\n\n---Transcript (sole source)---\n'
        + scopedTranscript;
    }

    return '你是小O会议助手。请**严格且仅依据**下方转录稿，生成**简洁扼要**的会议纪要。\n\n'
      + '要求：\n'
      + '1. 只写转录稿中明确出现的信息，不得编造人名、日期或待办。\n'
      + '2. **必须归纳总结，禁止照搬原句。** 合并重复话题，删除语气词、闲聊与无效往返。\n'
      + '3. summary：用 2–4 句话概括会议目的、主要讨论与结论（≤220 字，Executive Summary 风格）。\n'
      + '4. keyPoints：提炼 3–6 条核心要点（每条 ≤60 字），不是转录句子的复制粘贴。\n'
      + '5. decisions / actionItems / openQuestions：仅在有明确依据时填写；无则留空数组 []。\n'
      + '6. 只输出**合法 JSON**（不要 Markdown 代码块，不要额外说明），结构如下：\n'
      + schemaHint + '\n'
      + '7. 只有当转录稿为空或几乎全是寒暄/无效内容时，summary 才写「转录稿中未明确提及重点内容。」\n\n'
      + metaLine + '\n\n---转录稿（唯一依据）---\n'
      + scopedTranscript;
  }

  function extractJsonBlock(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return raw.slice(start, end + 1);
    return raw;
  }

  function asStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  function asActionItems(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === 'string') {
        return { task: item.trim(), owner: '', deadline: '' };
      }
      if (item && typeof item === 'object') {
        return {
          task: String(item.task || item.content || '').trim(),
          owner: String(item.owner || item.assignee || '').trim(),
          deadline: String(item.deadline || item.due || '').trim(),
        };
      }
      return null;
    }).filter((item) => item && item.task);
  }

  function normalizeStructured(input, lang) {
    const base = Object.assign({}, EMPTY_STRUCTURE, input || {});
    return {
      summary: String(base.summary || '').trim(),
      keyPoints: asStringArray(base.keyPoints),
      decisions: asStringArray(base.decisions),
      actionItems: asActionItems(base.actionItems),
      openQuestions: asStringArray(base.openQuestions),
    };
  }

  function parseStructuredMinutes(rawText, transcript, lang) {
    lang = lang || 'zh';
    const payload = extractJsonBlock(rawText);
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') {
          return postProcessStructured(normalizeStructured(parsed, lang), lang);
        }
      } catch (_) {}
    }
    const plain = String(rawText || '').trim();
    if (plain && !/^\s*[\[{]/.test(plain)) {
      return postProcessStructured(normalizeStructured({
        summary: plain.split('\n').filter(Boolean).slice(0, 2).join(' '),
        keyPoints: pickDistinctLines(
          plain.split('\n').map((l) => l.trim()).filter((l) => l.length > 4),
          6
        ),
      }, lang), lang);
    }
    return postProcessStructured(buildLocalStructuredFallback(transcript, lang), lang);
  }

  function buildLocalStructuredFallback(transcript, lang) {
    lang = lang || 'zh';
    const emptyHint = isEn(lang)
      ? 'Not explicitly mentioned in the transcript.'
      : '转录稿中未明确提及重点内容。';
    const sentences = tokenizeTranscriptLines(transcript);
    if (!sentences.length) {
      return normalizeStructured({ summary: emptyHint }, lang);
    }

    const scored = sentences.map((sentence, index) => ({
      sentence,
      score: scoreMinuteSentence(sentence, index, sentences.length),
    }));
    scored.sort((a, b) => b.score - a.score);

    const summaryParts = pickDistinctLines(scored.slice(0, 8).map((item) => item.sentence), 3);
    const keyPoints = pickDistinctLines(scored.map((item) => item.sentence), 6);

    if (!summaryParts.length && !keyPoints.length) {
      return normalizeStructured({ summary: emptyHint }, lang);
    }

    const summary = summaryParts.length
      ? truncateText(summaryParts.join(isEn(lang) ? '; ' : '；'), isEn(lang) ? 420 : 220)
      : truncateText(keyPoints[0], isEn(lang) ? 420 : 220);

    return normalizeStructured({
      summary,
      keyPoints,
      decisions: [],
      actionItems: [],
      openQuestions: [],
    }, lang);
  }

  function tryStructuredStreamPreview(rawText, transcript, lang) {
    lang = lang || 'zh';
    const payload = extractJsonBlock(rawText);
    if (!payload || payload.indexOf('{') < 0) return null;
    try {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object') return null;
      const structured = postProcessStructured(normalizeStructured(parsed, lang), lang);
      return {
        structured,
        plain: structuredToPlainText(structured, lang),
      };
    } catch (_) {
      const summaryMatch = payload.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (!summaryMatch) return null;
      const summary = summaryMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ')
        .trim();
      if (summary.length < 8) return null;
      const structured = postProcessStructured({ summary, keyPoints: [] }, lang);
      return {
        structured,
        plain: structuredToPlainText(structured, lang),
      };
    }
  }

  function structuredToPlainText(structured, lang) {
    structured = normalizeStructured(structured, lang);
    lang = lang || 'zh';
    if (isEn(lang)) {
      const parts = [];
      parts.push('Summary\n' + (structured.summary || '(empty)'));
      if (structured.keyPoints.length) {
        parts.push('Key Points\n' + structured.keyPoints.map((item, i) => (i + 1) + '. ' + item).join('\n'));
      }
      if (structured.decisions.length) {
        parts.push('Decisions\n' + structured.decisions.map((item, i) => (i + 1) + '. ' + item).join('\n'));
      }
      if (structured.actionItems.length) {
        parts.push('Action Items\n' + structured.actionItems.map((item, i) => {
          return (i + 1) + '. Task: ' + item.task
            + '; Owner: ' + (item.owner || 'Not specified')
            + '; Due: ' + (item.deadline || 'Not specified');
        }).join('\n'));
      }
      if (structured.openQuestions.length) {
        parts.push('Open Questions\n' + structured.openQuestions.map((item, i) => (i + 1) + '. ' + item).join('\n'));
      }
      return parts.join('\n\n');
    }
    const parts = [];
    parts.push('一、摘要\n' + (structured.summary || '（无）'));
    if (structured.keyPoints.length) {
      parts.push('二、核心要点\n' + structured.keyPoints.map((item, i) => (i + 1) + '. ' + item).join('\n'));
    }
    if (structured.decisions.length) {
      parts.push('三、会议决策\n' + structured.decisions.map((item, i) => (i + 1) + '. ' + item).join('\n'));
    }
    if (structured.actionItems.length) {
      parts.push('四、待办事项\n' + structured.actionItems.map((item, i) => {
        return (i + 1) + '. 任务：' + item.task
          + '；责任人：' + (item.owner || '未明确')
          + '；完成时间：' + (item.deadline || '未明确');
      }).join('\n'));
    }
    if (structured.openQuestions.length) {
      parts.push('五、待讨论问题\n' + structured.openQuestions.map((item, i) => (i + 1) + '. ' + item).join('\n'));
    }
    return parts.join('\n\n');
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function structuredToDisplayHtml(structured, lang) {
    structured = normalizeStructured(structured, lang);
    lang = lang || 'zh';
    const L = isEn(lang) ? {
      summary: 'Summary',
      keyPoints: 'Key Points',
      decisions: 'Decisions',
      actionItems: 'Action Items',
      openQuestions: 'Open Questions',
      empty: '(Not explicitly mentioned)',
    } : {
      summary: '摘要',
      keyPoints: '核心要点',
      decisions: '会议决策',
      actionItems: '待办事项',
      openQuestions: '待讨论问题',
      empty: '（转录稿未明确提及）',
    };

    function section(title, bodyHtml) {
      return '<div class="oao-minutes-section"><div class="oao-minutes-section-title">' + escapeHtml(title) + '</div>' + bodyHtml + '</div>';
    }

    const summaryHtml = '<div class="oao-minutes-line">' + escapeHtml(structured.summary || L.empty) + '</div>';
    const listHtml = (items) => {
      if (!items.length) return '<div class="oao-minutes-line" style="opacity:.65">' + escapeHtml(L.empty) + '</div>';
      return '<ul class="oao-minutes-list">' + items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>';
    };
    const actionHtml = () => {
      if (!structured.actionItems.length) {
        return '<div class="oao-minutes-line" style="opacity:.65">' + escapeHtml(L.empty) + '</div>';
      }
      return '<ul class="oao-minutes-list">' + structured.actionItems.map((item) => {
        const owner = item.owner || (isEn(lang) ? 'Not specified' : '未明确');
        const due = item.deadline || (isEn(lang) ? 'Not specified' : '未明确');
        return '<li><strong>' + escapeHtml(item.task) + '</strong>'
          + ' — ' + (isEn(lang) ? 'Owner' : '责任人') + ': ' + escapeHtml(owner)
          + ' · ' + (isEn(lang) ? 'Due' : '完成时间') + ': ' + escapeHtml(due)
          + '</li>';
      }).join('') + '</ul>';
    };

    return [
      section(L.summary, summaryHtml),
      structured.keyPoints.length ? section(L.keyPoints, listHtml(structured.keyPoints)) : '',
      structured.decisions.length ? section(L.decisions, listHtml(structured.decisions)) : '',
      structured.actionItems.length ? section(L.actionItems, actionHtml()) : '',
      structured.openQuestions.length ? section(L.openQuestions, listHtml(structured.openQuestions)) : '',
    ].filter(Boolean).join('');
  }

  global.OAOMeetingMinutesAI = {
    TIMEOUTS,
    computeAiTimeout,
    shouldUseMeetingRag,
    withTimeout,
    runOllamaQueued,
    logMinutesResolved,
    buildStructuredPrompt,
    parseStructuredMinutes,
    tryStructuredStreamPreview,
    buildLocalStructuredFallback,
    postProcessStructured,
    scoreMinuteSentence,
    structuredToPlainText,
    structuredToDisplayHtml,
    normalizeStructured,
  };
})(typeof window !== 'undefined' ? window : global);
