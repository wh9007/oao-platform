(function (global) {
  'use strict';

  function escapeMd(text) {
    return String(text || '').replace(/\r/g, '').trim();
  }

  function slugifyTitle(title) {
    return String(title || 'meeting')
      .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'meeting';
  }

  function formatArchiveTimestamp(ms) {
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatTranscriptSection(entries, withTimestamps) {
    if (!Array.isArray(entries) || !entries.length) return '';
    return entries.map((entry) => {
      const ts = withTimestamps !== false ? `[${formatArchiveTimestamp(entry.startMs)}] ` : '';
      return `${ts}${entry.text || entry.body || ''}`.trim();
    }).filter(Boolean).join('\n');
  }

  function buildMeetingArchiveMarkdown(options) {
    options = options || {};
    const meta = options.meta || {};
    const structured = options.structured || {};
    const entries = options.entries || [];
    const sessionMeta = options.sessionMeta || {};
    const meetingId = options.meetingId || `session-${Date.now()}`;
    const wallet = options.wallet || '';
    const lang = options.lang === 'en' ? 'en' : 'zh';

    const title = meta.title || (lang === 'en' ? 'Meeting Minutes' : '会议记录');
    const summary = escapeMd(structured.summary || '');
    const keyPoints = (structured.keyPoints || []).map((item) => `- ${escapeMd(item)}`).join('\n');
    const decisions = (structured.decisions || []).map((item) => `- ${escapeMd(item)}`).join('\n');
    const actionItems = (structured.actionItems || []).map((item) => {
      const task = escapeMd(item.task || '');
      const owner = escapeMd(item.owner || (lang === 'en' ? 'Not specified' : '未明确'));
      const deadline = escapeMd(item.deadline || (lang === 'en' ? 'Not specified' : '未明确'));
      return `| ${task} | ${owner} | ${deadline} |`;
    }).join('\n');
    const openQuestions = (structured.openQuestions || []).map((item) => `- ${escapeMd(item)}`).join('\n');
    const transcriptBlock = formatTranscriptSection(entries, true);

    const actionHeader = lang === 'en'
      ? '| Task | Owner | Due |\n| --- | --- | --- |'
      : '| 任务 | 责任人 | 截止时间 |\n| --- | --- | --- |';

    return `---
docType: oao-meeting
meetingId: "${meetingId}"
title: "${title.replace(/"/g, '\\"')}"
host: "${escapeMd(meta.host).replace(/"/g, '\\"')}"
startTime: "${escapeMd(sessionMeta.startLabel || meta.time || '')}"
durationSec: ${Math.max(0, parseInt(options.durationSec, 10) || 0)}
attendees: "${escapeMd(meta.attendees).replace(/"/g, '\\"')}"
source: xiao-o-meeting
wallet: "${escapeMd(wallet).replace(/"/g, '\\"')}"
tags: [meeting, minutes, transcript, oao]
---

# ${title}

## ${lang === 'en' ? 'Summary' : '会议摘要'}
${summary || (lang === 'en' ? '(empty)' : '（无）')}

## ${lang === 'en' ? 'Key Points' : '核心要点'}
${keyPoints || '- ' + (lang === 'en' ? '(none)' : '（无）')}

## ${lang === 'en' ? 'Decisions' : '会议决策'}
${decisions || '- ' + (lang === 'en' ? '(none)' : '（无）')}

## ${lang === 'en' ? 'Action Items' : '待办事项'}
${actionItems ? `${actionHeader}\n${actionItems}` : (lang === 'en' ? '(none)' : '（无）')}

## ${lang === 'en' ? 'Open Questions' : '待讨论问题'}
${openQuestions || '- ' + (lang === 'en' ? '(none)' : '（无）')}

## ${lang === 'en' ? 'Full Transcript' : '完整转录（带时间戳）'}
${transcriptBlock || (lang === 'en' ? '(empty transcript)' : '（无转录）')}

## ${lang === 'en' ? 'Structured JSON' : '结构化 JSON'}
\`\`\`json
${JSON.stringify(structured, null, 2)}
\`\`\`
`;
  }

  function buildArchiveFilename(meta, meetingId) {
    const d = new Date();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
    ].join('');
    return `OAO-Meeting-${stamp}-${slugifyTitle(meta?.title)}-${String(meetingId).slice(-8)}.md`;
  }

  function buildPastMeetingsQueryPrompt(query, lang) {
    const q = String(query || '').trim();
    if (lang === 'en') {
      return `You are the OAO meeting archive assistant. Answer ONLY from retrieved historical meeting documents.\n`
        + `If documents do not contain the answer, say "Not found in historical meeting records."\n`
        + `Do not invent meetings, people, or decisions.\n\n`
        + `User question: ${q}\n\n`
        + `Requirements:\n`
        + `- Start with a concise conclusion\n`
        + `- Cite meeting title and time from document frontmatter when possible\n`
        + `- List action items separately if relevant\n`
        + `- Respond in English`;
    }
    return `你是 OAO 会议档案助手。仅根据检索到的历史会议文档回答，不得编造。\n`
      + `若文档未提及，明确回答「历史会议记录中未找到相关信息」。\n\n`
      + `用户问题：${q}\n\n`
      + `要求：\n`
      + `- 先给简洁结论\n`
      + `- 依据请注明会议标题与时间（来自文档 frontmatter）\n`
      + `- 如有待办单独列出\n`
      + `- 使用中文回答`;
  }

  function formatSearchResult(data, lang) {
    const answer = String(data?.answer || '').trim();
    const sources = Array.isArray(data?.sources) ? data.sources : [];
    if (!answer) {
      return {
        answer: lang === 'en' ? 'No response from knowledge base.' : '知识库未返回有效回答。',
        sources: [],
      };
    }
    return { answer, sources };
  }

  global.OAOMeetingKB = {
    buildMeetingArchiveMarkdown: buildMeetingArchiveMarkdown,
    buildArchiveFilename,
    buildPastMeetingsQueryPrompt,
    formatSearchResult,
    formatTranscriptSection,
  };
})(typeof window !== 'undefined' ? window : global);
