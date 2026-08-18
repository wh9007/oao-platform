# 小O会议 — AnythingLLM RAG 知识库配置

本地打开 OAO（`本地测试OAO.bat` → `http://127.0.0.1:8777`）时，小O会议生成纪要可自动使用 AnythingLLM 工作区 **oaoeth** 中的文档作为背景知识（RAG）。

## 特性开关

- **默认开启**（仅本地 `127.0.0.1` / `localhost`）
- 关闭 RAG：在 `local-config.js` 中加入  
  `window.OAO_MEETING_RAG_ENABLED = false;`
- GitHub Pages 生产环境 **不会** 启用 RAG，行为与优化前一致

## 推荐上传的文档类型

| 类型 | 示例 |
|------|------|
| 项目说明 | OAO 平台介绍、模块说明 |
| 历史纪要 | 以往会议 TXT/Word 导出 |
| 制度/流程 | 协会章程、审批流程 |
| 术语表 | 产品名、人名、缩写对照 |

## 方法一：AnythingLLM 界面上传（推荐）

1. 启动 **AnythingLLM Desktop**（默认 `http://127.0.0.1:3001`）
2. 打开工作区 **oaoeth**（与 `local-config.js` 中 `OAO_ANYTHINGLLM_WORKSPACE` 一致）
3. 进入 **Documents / 文档** → **Upload** 上传 PDF、TXT、MD、DOCX 等
4. 等待向量化完成（界面显示 embedded / ready）
5. 刷新 OAO 页面，在小O会议中生成纪要

纪要请求会使用 `mode: query`，AnythingLLM 会从已上传文档中检索相关片段。

## 方法二：放入 AnythingLLM 本地文档目录

AnythingLLM Desktop 会把工作区文档放在本机数据目录（因安装方式而异），常见路径：

- Windows：`%APPDATA%\anythingllm-desktop\storage\...`
- macOS：`~/Library/Application Support/anythingllm-desktop/storage/...`

在 AnythingLLM 设置中查看 **Storage / Data directory**，将文件复制到 **oaoeth** 工作区对应文件夹后，在界面中 **Scan / Import** 触发索引。

> 不建议直接把文件丢进 OAO 项目仓库 expecting 自动索引；**必须由 AnythingLLM 完成 embedding**。

## 验证 RAG 是否生效

1. 打开浏览器开发者工具 → Console
2. 生成纪要后查看日志：  
   `[OAO Meeting Minutes] resolved via: anythingllm-rag`
3. AnythingLLM 返回的 `sources` 数组非空（可在 Network 面板查看 `/api/v1/workspace/oaoeth/chat` 响应）

## 常见问题

**Q: 上传了文档但纪要没引用？**  
- 确认 `local-config.js` 中 API Key 与工作区 slug 正确  
- 转录内容与文档主题差异过大时，检索可能为空（仍会降级到 Ollama / GLM）

**Q: 生产环境 GitHub Pages 能用 RAG 吗？**  
- 不能也不应启用；生产走智谱 GLM，不访问本地 AnythingLLM

**Q: 需要改代码吗？**  
- 不需要；只需配置 AnythingLLM 工作区文档 + 本地 `local-config.js`
