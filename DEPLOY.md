# OAO 部署指南（GitHub Pages + Cloudflare Tunnel）

## 你将得到什么

| 组件 | 地址 | 作用 |
|------|------|------|
| 静态网站 | `https://wh529007.github.io/oao-platform/` | 外网访问 OAO 页面 |
| Cloudflare Worker | `https://oao-ai.wh529007.workers.dev` | 代理 AI / 会议信令 |
| Tunnel | `ollama.*` / `llm.*` | 外网安全访问你电脑上的模型 |

---

## 第一步：发布到 GitHub Pages

1. 双击 **`发布到GitHub.bat`**
2. 若提示登录，在终端执行：`gh auth login`
3. 等待 1~3 分钟，访问：  
   **https://wh529007.github.io/oao-platform/**

> 若 GitHub 用户名不是 `wh529007`，请编辑 `发布到GitHub.bat` 里的 `GITHUB_USER`。

---

## 第二步：创建 Cloudflare Tunnel

1. 打开 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels**
2. **Create a tunnel** → 命名如 `oao-home`
3. 在 **Public Hostname** 添加两条（域名需在 Cloudflare 托管）：

| 子域名 | 服务 |
|--------|------|
| `ollama.你的域名.com` | `http://localhost:11434` |
| `llm.你的域名.com` | `http://localhost:3001` |

4. 复制 **Install connector** 页面的 Token
5. 将 Token 粘贴到 `cloudflare/tunnel-token.txt`（一行）
6. 双击 **`启动Tunnel.bat`**，保持窗口运行

本机需同时运行：
- Ollama（11434）
- AnythingLLM（3001）

---

## 第三步：更新 Cloudflare Worker

1. Cloudflare Dashboard → **Workers & Pages** → `oao-ai`
2. 将 `cloudflare/oao-ai-worker.js` 与 `cloudflare/meeting-room.js` 部署到 Worker  
   （或用 Wrangler：复制 `wrangler.toml.example` 为 `wrangler.toml` 后执行 `npx wrangler deploy`）
3. **Settings → Variables** 添加：

| 变量名 | 示例值 |
|--------|--------|
| `LLM_ORIGIN` | `https://llm.你的域名.com` |
| `OLLAMA_ORIGIN` | `https://ollama.你的域名.com` |
| `ANYTHINGLLM_API_KEY` | 你的 AnythingLLM Key（可选） |

4. **Settings → Durable Objects** 确认绑定：
   - Name: `MEETING_ROOM`
   - Class: `MeetingRoom`

5. **Settings → Domains & Routes** 确认路由包含：  
   `oao-ai.wh529007.workers.dev/*`

---

## 第四步：验证

1. 打开 GitHub Pages 站点，登录（钱包或管理员测试）
2. F12 → Network，发一条 AI 消息，应看到请求发往 `oao-ai.wh529007.workers.dev`
3. 若返回 502，检查 Tunnel 是否在运行、Worker 变量是否正确

---

## 以后绑定 OAO.ETH

GitHub Pages 稳定后，在 ENS / DNS 添加 CNAME 指向 `wh529007.github.io`，并在 GitHub Pages 设置 Custom domain 为 `oao.eth` 或 `www.oao.eth`。

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.html` | GitHub Pages 入口，跳转至 OAO.html |
| `cloudflare/oao-ai-worker.js` | Worker 主程序 |
| `cloudflare/meeting-room.js` | 会议信令 Durable Object |
| `启动Tunnel.bat` | 本机运行 Tunnel |
| `发布到GitHub.bat` | 一键推送并启用 Pages |
