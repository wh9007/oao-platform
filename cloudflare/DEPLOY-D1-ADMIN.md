# OAO Platform — D1 用户数据 & 管理面板部署说明

## 一、架构概览

```
GitHub Pages (OAO.html / profile.html / admin/)
        │  HTTPS + Bearer JWT
        ▼
Cloudflare Worker (oao-ai)
   ├── /api/user/*     用户 sync / 会议摘要 / 翻译计数
   ├── /admin/*        管理员登录 & 面板 API
   ├── /glm/chat       智谱代理（附带用量统计 + 拉黑校验）
   └── D1 (oao-platform)
```

未登录用户：现有会议/翻译/AI **完全不受影响**（不写库、不强制 sync）。

---

## 二、创建 D1 数据库

```powershell
cd cloudflare
npm install
npx wrangler d1 create oao-platform
```

将输出的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "oao-platform"
database_id = "你的-database-id"
```

初始化表结构：

```powershell
npx wrangler d1 execute oao-platform --file=./schema.sql
npx wrangler d1 execute oao-platform --file=./schema-v2-admin.sql
```

本地验证（可选）：

```powershell
npx wrangler d1 execute oao-platform --local --file=./schema.sql
```

---

## 三、配置 Worker Secrets（必填）

**切勿写入 Git 或前端代码。**

```powershell
npx wrangler secret put ZHIPU_API_KEY
npx wrangler secret put OAO_ADMIN_PASSWORD
npx wrangler secret put OAO_ADMIN_JWT_SECRET
npx wrangler secret put OAO_USER_JWT_SECRET
npx wrangler secret put OAO_ADMIN_WALLETS
```

| Secret | 说明 |
|--------|------|
| `ZHIPU_API_KEY` | 智谱 API Key（已有） |
| `OAO_ADMIN_PASSWORD` | 管理面板登录密码（备用） |
| `OAO_ADMIN_WALLETS` | 管理员钱包白名单，逗号分隔，如 `0xabc...,0xdef...` |
| `OAO_ADMIN_JWT_SECRET` | 管理员 JWT 签名密钥（随机长字符串） |
| `OAO_USER_JWT_SECRET` | 用户 JWT 签名密钥（可与 admin 不同） |

### 可选：限流与告警阈值（Worker 变量 `[vars]` 或 Secrets）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OAO_RATE_WALLET_PER_MIN` | 10 | 每钱包每分钟 GLM 调用上限 |
| `OAO_RATE_WALLET_PER_HOUR` | 100 | 每钱包每小时上限 |
| `OAO_RATE_ANON_PER_MIN` | 3 | 未登录 IP 每分钟上限 |
| `OAO_RATE_ANON_PER_HOUR` | 20 | 未登录 IP 每小时上限 |
| `OAO_RATE_IP_PER_MIN` | 20 | 每 IP 每分钟上限（所有用户） |
| `OAO_RATE_IP_PER_HOUR` | 200 | 每 IP 每小时上限 |
| `OAO_GLM_DAILY_ALERT` | 500 | 24h 调用量超阈值写入告警表 |

---

## 四、部署 Worker

```powershell
cd cloudflare
npm install
npx wrangler deploy
```

验证：

```text
GET https://oao-ai.wh529007.workers.dev/
→ 应含 "platform": "d1_bound"

GET https://oao-ai.wh529007.workers.dev/glm/health
→ 应含 "platform": "d1_ready"
```

---

## 五、静态页面上传（GitHub Pages）

需包含以下新文件：

| 文件 | 用途 |
|------|------|
| `assets/js/oao-platform-api.js` | 前端 API 客户端 |
| `assets/js/oao-meeting-minutes-ai.js` | 结构化纪要 + 超时/队列 |
| `profile.html` | 用户个人中心 |
| `admin/index.html` | 管理面板（钱包/密码登录） |
| `OAO.html` | 已集成 sync / GLM meta |
| `oao-translate/embed/*` | 翻译用量上报 |

上传后访问：

- 个人中心：`https://wh9007.github.io/oao-platform/profile.html`
- 管理面板：`https://wh9007.github.io/oao-platform/admin/`

---

## 六、使用流程

### 普通用户

1. 在 OAO 主页钱包/微信登录
2. 自动后台 `POST /api/user/sync`（静默，失败不影响功能）
3. 使用小O会议生成纪要 → 摘要写入 D1
4. 使用 OAO 翻译 → 翻译次数/字数累计
5. 顶部用户菜单 → **个人中心** 查看历史

### 管理员

1. 打开 `/admin/`
2. **钱包登录**：连接白名单内钱包签名（推荐），或 **密码登录** 输入 `OAO_ADMIN_PASSWORD`
3. 查看 GLM 调用趋势、来源占比、Top 钱包、限流记录、告警横幅
4. 可对钱包地址 **拉黑** — 该用户调用 `/glm/chat` 时返回友好中文提示

---

## 七、API 路由清单

### 用户（需 Bearer 用户 JWT，sync 除外）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/sync` | 登录后同步用户，返回 token |
| GET | `/api/user/me` | 账户 + 翻译统计 |
| GET | `/api/user/meetings` | 会议摘要列表 |
| POST | `/api/user/meetings` | 保存会议摘要 |
| POST | `/api/user/translate` | 翻译用量 +1 |

### 管理（需 Bearer 管理员 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/login` | `{ "password": "..." }` |
| POST | `/admin/login/wallet` | `{ "address", "message", "signature" }` |
| GET | `/admin/api/stats?days=14` | 用量统计 + GLM 日志 + 限流 + 告警 |
| POST | `/admin/api/alerts/ack` | `{ "id" }` 确认告警 |
| GET | `/admin/api/users` | 用户列表 |
| POST | `/admin/api/users/block` | `{ "address", "reason?" }` |
| POST | `/admin/api/users/unblock` | `{ "address" }` |

---

## 八、安全说明

- 所有 D1 查询使用参数化 `bind()`，防 SQL 注入
- 管理员与普通用户 JWT **分离**（role: admin / user）
- 拉黑校验在 Worker 的 `/glm/chat` 入口执行
- 前端 **不包含** 管理员密码
- 本地测试管理员密码（`window.OAO_ADMIN_PASSWORD`）仅用于 OAO 主页测试登录，**与 Worker 管理面板密码无关**

---

## 九、故障排查

| 现象 | 处理 |
|------|------|
| `d1_missing` | 检查 wrangler.toml D1 binding 并 redeploy |
| 个人中心「请先登录」 | 先在 OAO 主页登录，再打开 profile |
| sync 401 invalid_signature | 重新钱包签名登录 |
| 管理面板 503 admin_not_configured | 设置 `OAO_ADMIN_PASSWORD` secret |
| 拉黑后仍能翻译 | 翻译走第三方 API，拉黑仅限制 **Worker 云端 GLM**；可扩展 translate API 校验 |

---

更新：2026-08-08
