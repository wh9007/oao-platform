# OAO Translate

OAO 实时多语言同声传译模块（集成于 OAO 主页工具栏）。

## 本地启动（推荐）

在项目根目录双击 **`打开OAO.bat`**，会自动：

- 启动 OAO 主页（`:8777`）
- 启动 OAO翻译 Web（`:3000`）与 Server（`:3011`）
- 仅保留 **一个** 后台窗口：`OAO Services`

## 技术栈

- **Web**: Next.js 14, React, TypeScript, TailwindCSS
- **Server**: Node.js, Express, Socket.io, JWT
- **AI（默认）**: 本地 Ollama — Whisper 转写 + Qwen 翻译（零 OpenAI Token）

## 端口说明

| 服务 | 端口 |
|------|------|
| OAO 主页 | 8777 |
| OAO翻译 Web | 3000 |
| OAO翻译 Server | 3011 |
| Ollama | 11434 |

> Server 使用 **3011**，避免与 AnythingLLM（3001）冲突。

## OAO 平台集成

登录后在左侧工具栏点击 **OAO翻译**，于模态窗口内打开（`/ ?embed=1`）。

```javascript
window.OAO_TRANSLATE_URL = 'http://127.0.0.1:3000';
```

## 手动开发（可选）

```bash
cd server && npm install && npm run dev   # :3011
cd web && npm install && npm run dev      # :3000
```

## 环境变量

见 `server/.env.example` 与 `web/.env.local.example`。

| 变量 | 说明 |
|------|------|
| `DEFAULT_PROVIDER` | 默认 `ollama` |
| `OLLAMA_BASE_URL` | 默认 `http://127.0.0.1:11434` |
| `OLLAMA_CHAT_MODEL` | 默认 `qwen2.5:7b` |
| `OLLAMA_WHISPER_MODEL` | 默认 `whisper` |
| `JWT_SECRET` | Web 与 Server 需一致 |

## Docker

```bash
cp .env.example .env
docker compose up --build
```
