# 小O会议 — 上传录音转写

## 功能

会议中心控制栏 **「上传录音转写」**：选择本地音频 → Ollama Whisper 转文字 → 自动写入转录区 → 自动生成结构化会议纪要。

## 前置条件（本地）

1. 双击 **`打开OAO.bat`**（`http://127.0.0.1:8777`）
2. **Ollama** 已启动（`:11434`）
3. 已拉取 Whisper 模型：
   ```bash
   ollama pull whisper
   ```
4. 可选：`local-config.js` 中设置
   ```javascript
   window.OAO_OLLAMA_WHISPER_MODEL = 'whisper';
   window.OAO_MEETING_UPLOAD_TIMEOUT_MS = 180000;
   ```

## 支持格式

webm、wav、mp3、m4a、ogg、mp4、aac、flac（单文件最大 100MB）

## 说明

- **不能使用**浏览器 Web Speech 转写文件，本功能走 **Ollama `/api/transcribe`**
- GitHub Pages 外网若无 Tunnel/Worker 代理 Ollama，会提示需本地打开
- 录音进行中上传会先确认并停止当前录音
- 转写完成后自动调用与手动「生成纪要」相同的 AI 链路

## 测试

1. 准备 30 秒 mp3/wav 测试文件  
2. 小O会议 → **上传录音转写** → 选文件  
3. 等待「正在转写…」→ 左侧转录有文字 → 右侧出现结构化纪要  
