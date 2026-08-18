# 小O会议 · 知识库归档与跨会议检索

## 功能概述

1. **转录时间戳 + 音频定位**：停止录音后，转录行显示 `[MM:SS]`，点击行可定位播放；播放时自动高亮当前句。
2. **存入 OAO 知识库**：生成纪要后，将结构化纪要 + 带时间戳转录写入 AnythingLLM `oaoeth` 工作区（Markdown）。
3. **跨会议检索**：在会议中心底部面板提问，基于知识库检索历史会议并返回答案与引用来源。

## 本地使用前提

- 通过 `本地测试OAO.bat` 访问 `http://127.0.0.1:8777/OAO.html`
- 已启动 **Ollama**、**AnythingLLM**（工作区 `oaoeth`）
- `local-config.js` 中配置 `OAO_ANYTHINGLLM_API_KEY`

## 操作流程

1. 开始录音 → 停止 → 点击 **生成纪要**
2. 点击 **存入 OAO 知识库**（或设置 `window.OAO_MEETING_AUTO_ARCHIVE_KB = true` 静默归档）
3. 展开 **跨会议检索**，输入自然语言问题，例如：「上次预算会议定了什么待办？」

## 可选配置

```javascript
// 生成纪要后自动归档（无确认弹窗）
window.OAO_MEETING_AUTO_ARCHIVE_KB = true;
```

## Worker / D1（个人中心徽章）

若需在 `profile.html` 显示「已入知识库」徽章，需执行 D1 迁移并部署 Worker：

```bash
# 在项目 cloudflare 目录
wrangler d1 execute oao-db --file=schema-v3-meeting-kb.sql
wrangler deploy
```

## 归档文档格式

归档文件为 Markdown，含 YAML frontmatter（`docType: oao-meeting`、`meetingId`、`title` 等），便于 AnythingLLM 检索与跨会议问答。
