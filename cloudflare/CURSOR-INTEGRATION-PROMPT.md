# Cursor Agent 诊断提示词 — 登录后写入用户记录

将以下整段复制到 Cursor Agent，用于排查/扩展「登录后数据落地」集成点。

---

## 任务

在 OAO.eth 项目中，确认并完善 **登录用户 → Cloudflare D1** 的数据写入链路。要求：未登录不受影响；写入失败仅 `console.warn`，不阻塞 UI。

## 项目路径

`C:\Users\wh-90\Desktop\Html 代码\OAO.eth 20260612 更新测试`

## 核心文件

| 文件 | 作用 |
|------|------|
| `assets/js/oao-platform-api.js` | 前端 API：`syncUser`, `saveMeetingRecord`, `recordTranslate`, `buildGlmMeta` |
| `cloudflare/oao-ai-worker.js` | Worker 路由 |
| `cloudflare/user-api.js` | 用户 API |
| `cloudflare/admin-api.js` | 管理 API |
| `cloudflare/glm-handler.js` | GLM 代理 + 拉黑 + 用量 |
| `cloudflare/schema.sql` | D1 表结构 |
| `profile.html` | 个人中心 |
| `admin/index.html` | 管理面板 |

## 请逐项检查

### 1. 登录 sync 钩子（P0）

在 `OAO.html` 搜索以下函数，确认调用 `void window.OAOPlatform?.syncUser?.({ silent: true })`：

- `requireWalletSignature` — 钱包签名成功后
- `applyWeChatSession` — 微信登录成功后
- `tryRestoreWalletSession` — 会话恢复成功后
- `logoutAll` — 应调用 `OAOPlatform.clearSession()`

### 2. GLM 请求 meta（P1）

在 `OAO.html` 搜索 `resolveGlmChatUrl`，确认 POST body 含：

```javascript
_oaoMeta: window.OAOPlatform?.buildGlmMeta?.('glm_chat' | 'glm_minutes' | 'glm_prompt')
```

Worker 端 `glm-handler.js` 的 `extractOaoMeta` 会剥离该字段后再转发智谱。

### 3. 会议摘要保存（P1）

在 `generateMeetingMinutes()` 成功生成后，确认调用：

```javascript
OAOPlatform.saveMeetingRecord({ title, summary, durationSec, source })
```

**不要**保存完整转录稿，仅保存 AI 摘要（≤8000 字）。

### 4. 翻译用量（P1）

在 `oao-translate/embed/app.js` 的 `translateLine()` 成功分支，确认：

```javascript
OAOPlatform.recordTranslate(charCount)
```

embed 的 `index.html` 需引入 `../../assets/js/oao-platform-api.js`。

### 5. 拉黑友好提示（P2）

`throwIfGlmHttpError` 应识别 `error: 'user_blocked'` 并显示中文提示。

### 6. 个人中心入口（P2）

`OAO.html` 用户下拉菜单应有 `<a href="profile.html">个人中心</a>`。

## 验收脚本（浏览器控制台）

登录钱包后执行：

```javascript
await OAOPlatform.syncUser();
await OAOPlatform.fetchProfile();
await OAOPlatform.fetchMeetings();
```

应返回 200 JSON，无 uncaught error。

## 约束

- 不修改未登录用户的现有行为
- 不在前端或 Git 中写入管理员密码 / JWT secret
- D1 未绑定时 API 返回 503，前端静默失败

---

## 输出要求

请返回：

1. 每个集成点的 **文件:行号** 与当前状态（已集成 / 缺失 / 需修复）
2. 缺失项的最小 diff 建议
3. Worker 部署前检查清单（D1 binding、4 个 secrets）
