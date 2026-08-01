(function () {
  "use strict";

  const { toLabel, toCode } = window.OAOTranslate;
  const SERVER_URL = "http://127.0.0.1:3011";
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session")?.trim() || "";
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;

  const sourceLabel = params.get("source")?.trim() || "";
  const targetLabel = params.get("target")?.trim() || "";
  const target2Label = params.get("target2")?.trim() || "";
  const targetLabels = [targetLabel, target2Label].filter(Boolean);

  const linesEl = document.getElementById("viewerLines");
  const hintEl = document.getElementById("viewerHint");
  const statusEl = document.getElementById("viewerStatus");
  const langEl = document.getElementById("viewerLang");
  const detailEl = document.getElementById("viewerDetail");
  const toastEl = document.getElementById("toast");
  const lines = [];
  const labelByCode = new Map();

  targetLabels.forEach((label) => {
    labelByCode.set(toCode(label), label);
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.add("hidden"), 3500);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function displayLangLabel(label) {
    if (!label || label === "Auto Detect") return "自动识别";
    return label;
  }

  function resolveTranslationLabel(code, fallback) {
    const key = (code || "").toLowerCase();
    return labelByCode.get(key) || toLabel(key) || fallback || key || "译文";
  }

  function renderLangBanner() {
    const source = displayLangLabel(sourceLabel || "自动识别");
    const targets = targetLabels.length
      ? targetLabels.join(" · ")
      : "译文";
    langEl.textContent = `${source} → ${targets}`;
  }

  function setDetail(text) {
    if (detailEl) detailEl.textContent = text;
  }

  function render() {
    if (!lines.length) {
      hintEl.style.display = "";
      return;
    }
    hintEl.style.display = "none";
    linesEl.innerHTML = lines.map((line) => {
      const trans = (line.translations || [])
        .map((t) => {
          const tag = escapeHtml(t.label || resolveTranslationLabel(t.language));
          return `<div class="line-trans"><span class="line-trans-label">${tag}</span>${escapeHtml(t.text)}</div>`;
        }).join("");
      return `<div class="line"><div class="line-source">${escapeHtml(line.source)}</div>${trans}</div>`;
    }).join("");
    linesEl.parentElement.scrollTop = linesEl.parentElement.scrollHeight;
  }

  function findLineForTranslation(payload) {
    const sourceText = payload?.sourceText?.trim();
    if (sourceText) {
      const matched = lines.find((l) => l.source === sourceText);
      if (matched) return matched;
    }
    return lines[lines.length - 1];
  }

  function upsertTranslation(payload) {
    const text = payload?.text?.trim();
    if (!text) return;
    const code = (payload.language || "").toLowerCase();
    const line = findLineForTranslation(payload);
    if (!line) return;
    const label = resolveTranslationLabel(code, payload.label);
    const existing = line.translations.find((t) => t.language === code);
    if (existing) {
      existing.text = text;
      existing.label = label;
    } else {
      line.translations.push({ language: code, label, text });
    }
    render();
  }

  function appendTranscript(payload) {
    const text = payload?.text?.trim();
    if (!text) return;
    lines.push({ source: text, translations: [] });
    render();
  }

  function applySessionMeta(data) {
    if (!data) return;
    if (data.sourceLanguage) {
      const label = toLabel(data.sourceLanguage);
      if (label && !sourceLabel) langEl.textContent = `${displayLangLabel(label)} → ${targetLabels.join(" · ") || "译文"}`;
    }
    (data.targetLanguages || []).forEach((code) => {
      const c = String(code || "").toLowerCase();
      if (!labelByCode.has(c)) labelByCode.set(c, toLabel(c));
    });
    renderLangBanner();
  }

  function loadHistory(history) {
    (history || []).forEach((entry) => {
      if (entry.kind === "transcript" && entry.text) {
        appendTranscript({ text: entry.text });
      }
      if (entry.kind === "translation" && entry.text) {
        upsertTranslation({
          text: entry.text,
          language: entry.language,
          sourceText: entry.sourceText,
        });
      }
    });
  }

  async function run() {
    renderLangBanner();
    if (!sessionId) {
      hintEl.textContent = "无效的分享链接（缺少 session）";
      setDetail("请从 OAO翻译 会话中复制完整分享链接");
      return;
    }
    if (typeof io !== "function") {
      hintEl.textContent = "无法加载 Socket 组件，请检查网络";
      setDetail("Socket.IO 脚本未加载");
      return;
    }

    try {
      const health = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!health.ok) throw new Error("server");
      const tokenRes = await fetch(`${SERVER_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: `viewer-${Date.now()}` }),
      });
      if (!tokenRes.ok) throw new Error("token");
      const { token } = await tokenRes.json();
      const socket = io(SERVER_URL, { auth: { token }, transports: ["websocket", "polling"] });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 8000);
        socket.once("connect", () => { clearTimeout(timer); resolve(); });
        socket.once("connect_error", () => { clearTimeout(timer); reject(new Error("connect")); });
      });

      setDetail(`会话 ${sessionId.slice(0, 8)}… · 已连接`);

      socket.emit("viewer:join", { sessionId }, (res) => {
        if (!res?.ok) {
          hintEl.textContent = res?.error || "会话不存在或已结束";
          setDetail("请确认分享方已开始会话且 OAO Services 正在运行");
          statusEl.innerHTML = "<strong>观看模式</strong> · 未连接";
          return;
        }
        applySessionMeta(res.data);
        loadHistory(res.data?.history || []);
        if (lines.length) hintEl.style.display = "none";
        else hintEl.textContent = "已连接，等待字幕…";
        toast("已加入实时会话");
      });

      socket.on("transcript", (payload) => {
        if (payload?.isFinal === false) return;
        appendTranscript(payload);
      });
      socket.on("translation", upsertTranslation);
      socket.on("disconnect", () => {
        toast("连接已断开");
        setDetail("连接已断开，请刷新页面重试");
      });
    } catch (_) {
      hintEl.textContent = "无法连接分享服务";
      setDetail("请确认分享方已开启 OAO Services（端口 3011）且会话进行中");
      statusEl.innerHTML = "<strong>观看模式</strong> · 连接失败";
    }
  }

  void run();
})();
