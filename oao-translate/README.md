# OAO 翻译

轻量实时翻译：默认同源静态页即可用，可选本地 AI 升级翻译润色与分享中继。

## 架构

```
OAO.html (:8777)
  ├── 小O会议 — 浏览器语音识别（与 embed 共用 stt-browser.js）
  └── iframe → oao-translate/embed/
                    ├── 浏览器 STT + 在线翻译（零安装）
                    └── server :3011  可选 · Qwen 润色 + 分享中继
```

## 语音识别（零安装）

OAO翻译与小O会议共用 `embed/lib/stt-browser.js`：

| 引擎 | 说明 |
|------|------|
| **自动（推荐）** | 故障时依次切换下列三个引擎 |
| **浏览器原生 · Web Speech** | Edge→Microsoft Azure Speech；Chrome→Google Cloud Speech |
| **全球通用 · English STT** | 使用 en-US，网络受限时优先尝试 |
| **全球通用 · Multilingual** | 多候选识别，提高兼容性 |

当前引擎名称显示在模态窗口顶部状态栏。推荐 Chrome 或 Edge，需麦克风权限并联网。

## 默认设置

- **对话模式**、**自动朗读译文**：默认关闭
- **自动识别语言**、**自动翻译**：默认开启

## 分享观看

1. 会话中点击「分享」→ 复制链接或扫码
2. 链接格式：`embed/view.html?session=...`
3. 需本机 `OAO Services`（:3011）运行以中继字幕

## 导出

- 底部「导出 TXT」
- 设置 → 导出：勾选原文/译文/时间戳
- 历史 → 勾选多条 →「导出所选」

## 快速开始

1. 双击 **`打开OAO.bat`**
2. 登录 → **OAO翻译** 或 **小O会议**
3. 选语言 → **开始**

可选本地 AI：`构建翻译AI.bat` + Ollama（翻译润色与分享中继，不含浏览器语音识别）。

## 目录

```
oao-translate/
  embed/                 同源静态前端
    app.js               主应用
    view.html / view.js  分享观看页
    lib/stt-browser.js   共享浏览器 STT
  server/                可选 Node 服务 (:3011)
    src/providers/       Ollama / 中继等
```

## 本地 AI 服务

```bash
cd oao-translate/server
npm install
npm run build    # 或双击 构建翻译AI.bat
npm run start    # 生产模式
```

环境变量见 `server/.env.example`（复制为 `.env`）。
