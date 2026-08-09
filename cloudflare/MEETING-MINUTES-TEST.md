# 小O会议纪要优化 — 手动测试清单

## 前置

- 本地：`打开OAO.bat` + AnythingLLM (:3001) + Ollama (:11434, `qwen2.5:7b`)
- 控制台打开 F12，观察 `[OAO Meeting Minutes] resolved via:` 日志

## 1. AnythingLLM 正常路径

1. 确认 AnythingLLM 运行，工作区 `oaoeth` 可用  
2. 小O会议 → 录音 → 说 3–5 句实质性内容 → 停止  
3. 点击「生成纪要」  
4. **预期**：Console 显示 `anythingllm` 或 `anythingllm-rag`；页面展示结构化小节（摘要/要点/决策/待办/待讨论）

## 2. AnythingLLM 不可用 → 降级 Ollama

1. 关闭 AnythingLLM 或改错 `OAO_AI_BASE_URL`  
2. 保持 Ollama 运行  
3. 再次生成纪要  
4. **预期**：15s 内超时或失败后降级；Console 显示 `ollama-stream` 或 `ollama`；仍有结构化输出

## 3. 模拟生产环境 → GLM

1. 用 GitHub Pages URL 打开，或未配置 `local-config.js`  
2. 登录钱包，生成纪要  
3. **预期**：不请求本地 :3001/:11434；走 Worker 智谱 GLM；Console 显示 `glm` 或 `glm-fallback`

## 4. 全部 AI 失败 → 规则兜底

1. 断开 Ollama、AnythingLLM，并临时 block Worker GLM（或断网仅保留本地页）  
2. 生成纪要  
3. **预期**：Console 显示 `local`；输出 JSON 结构等价 plain text，含摘要 + 要点列表，不抛异常

## 5. RAG 开关

1. `local-config.js` 设置 `window.OAO_MEETING_RAG_ENABLED = false`  
2. 生成纪要  
3. **预期**：AnythingLLM 使用 `chat` 模式，日志为 `anythingllm` 而非 `anythingllm-rag`

## 6. Ollama 互斥（资源保护）

1. 同时开启 OAO翻译 AI 润色（:3011）与小O会议生成纪要  
2. **预期**：浏览器侧 Ollama 纪要请求经队列串行，不出现并发打满 GPU 导致双失败（允许略慢）

## 新增依赖

- **无新增 npm 依赖**  
- 新增前端脚本：`assets/js/oao-meeting-minutes-ai.js`（纯 JS，无打包）
