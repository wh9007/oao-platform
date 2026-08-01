(function () {
  "use strict";

  const { toCode, toLabel, resolveSourceCode, translateOnline, LANG_CODES } = window.OAOTranslate;
  const { STYLE_PRESETS, pickVoice, waitForVoices, prepareSpeechText, applyUtteranceStyle } = window.OAOVoice;
  const {
    createSession: createSttSession,
    getSettingOptions: getSttSettingOptions,
    formatProviderLabel,
  } = window.OAOBrowserSTT;

  const LANGUAGES = Object.keys(LANG_CODES);
  const TARGET_LANGUAGES = LANGUAGES.filter((l) => l !== "Auto Detect");
  const SERVER_URL = "http://127.0.0.1:3011";
  const STORAGE_KEY = "oao_translate_settings_v3";
  const HISTORY_KEY = "oao_translate_history_v2";

  const params = new URLSearchParams(location.search);
  const shareViewSession = params.get("session")?.trim();
  if (shareViewSession && !params.get("embed")) {
    const viewUrl = new URL("view.html", location.href);
    viewUrl.search = params.toString();
    location.replace(viewUrl.toString());
    return;
  }
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const userId = params.get("uid")?.trim() || params.get("user")?.trim() || `oao-${Date.now()}`;
  const userName = params.get("user")?.trim() || "";
  document.documentElement.dataset.theme = theme;

  const LANG_DISPLAY = {
    "Auto Detect": "自动识别",
  };

  const SETTINGS_GROUPS = [
    {
      title: "识别与翻译",
      items: [
        { key: "autoDetect", label: "自动识别语言", type: "checkbox" },
        { key: "autoTranslate", label: "自动翻译", type: "checkbox" },
        { key: "autoPlay", label: "自动朗读译文", type: "checkbox" },
        { key: "aiPolish", label: "AI 润色（仅本地 AI）", type: "checkbox" },
        { key: "sttProvider", label: "语音识别引擎", type: "select", options: getSttSettingOptions("zh") },
      ],
    },
    {
      title: "字幕显示",
      items: [
        { key: "subtitleSize", label: "字幕字号", type: "segment", options: [
          { value: "standard", label: "标准" },
          { value: "large", label: "大号" },
          { value: "extra", label: "特大" },
        ]},
        { key: "bilingual", label: "双语字幕", type: "checkbox" },
        { key: "multiLang", label: "多语言字幕", type: "checkbox" },
        { key: "timestamp", label: "显示时间戳", type: "checkbox" },
        { key: "autoScroll", label: "自动滚动", type: "checkbox" },
        { key: "highlightLatest", label: "高亮最新一条", type: "checkbox" },
      ],
    },
    {
      title: "音频与对话",
      items: [
        { key: "noiseReduction", label: "麦克风降噪", type: "checkbox" },
        { key: "dialogueMode", label: "对话模式（双语交流播报）", type: "checkbox", hint: "全程监听；智能过滤扬声器回声，不影响真人说话" },
      ],
    },
    {
      title: "界面与主题",
      items: [
        { key: "darkTheme", label: "深色主题", type: "checkbox" },
        { key: "compactMode", label: "紧凑字幕间距", type: "checkbox" },
      ],
    },
    {
      title: "会话与连接",
      items: [
        { key: "autoSave", label: "停止后自动保存历史", type: "checkbox" },
        { key: "autoReconnect", label: "自动重连本地 AI", type: "checkbox" },
      ],
    },
  ];

  const $ = (id) => document.getElementById(id);
  const appEl = $("app");
  const langMenuPortal = $("langMenuPortal");
  const settingMenuPortal = $("settingMenuPortal");

  const lang = {
    source: "Auto Detect",
    target: "English",
    target2: "",
  };

  const langPickers = {
    source: { root: $("sourceLangSelect"), options: LANGUAGES, optional: false },
    target: { root: $("targetLangSelect"), options: TARGET_LANGUAGES, optional: false },
    target2: { root: $("targetLang2Select"), options: ["", ...TARGET_LANGUAGES], optional: true },
  };

  let activeMenu = null;
  let activeMenuKind = null;

  const customSelects = {};

  const els = {
    statusMode: $("statusMode"),
    statusDetail: $("statusDetail"),
    statusRecBadge: $("statusRecBadge"),
    subtitles: $("subtitles"),
    emptyHint: $("emptyHint"),
    interim: $("interim"),
    wave: $("wave"),
    btnStart: $("btnStart"),
    btnPause: $("btnPause"),
    btnResume: $("btnResume"),
    btnStop: $("btnStop"),
    btnSpeak: $("btnSpeak"),
    btnExport: $("btnExport"),
    btnShare: $("btnShare"),
    btnSettings: $("btnSettings"),
    btnSwapLang: $("btnSwapLang"),
    sidebar: $("sidebar"),
    overlay: $("overlay"),
    settingsList: $("settingsList"),
    historyToolbar: $("historyToolbar"),
    historyList: $("historyList"),
    sharePopover: $("sharePopover"),
    shareLink: $("shareLink"),
    shareHint: $("shareHint"),
    qrBox: $("qrBox"),
    toast: $("toast"),
    voiceStyleSelect: $("voiceStyleSelect"),
    voiceRate: $("voiceRate"),
    voicePitch: $("voicePitch"),
    voiceVolume: $("voiceVolume"),
    rateVal: $("rateVal"),
    pitchVal: $("pitchVal"),
    volVal: $("volVal"),
  };

  const state = {
    engineMode: "browser",
    status: "idle",
    lines: [],
    sessionId: null,
    socket: null,
    socketBound: false,
    recognitionStop: null,
    sttSession: null,
    sttProviderLabel: "",
    mediaStream: null,
    audioCtx: null,
    analyser: null,
    animFrame: 0,
    dialogueTurn: 0,
    dialoguePartner: null,
    dialogueListenSide: "partner",
    dialogueSttRefreshTimer: 0,
    interimCommitTimer: 0,
    browserSttFails: 0,
    settings: loadSettings(),
    voice: { style: "natural" },
    historySelected: new Set(),
    recentTexts: [],
    history: loadHistory(),
    tts: { lineId: null, langCode: null, playing: false },
    ttsToken: 0,
    ttsEchoTexts: [],
    lastTtsSpeak: null,
    shareRelayReady: false,
  };

  function loadSettings() {
    const defaults = {
      autoDetect: true,
      autoTranslate: true,
      autoPlay: false,
      aiPolish: false,
      sttProvider: "auto",
      bilingual: true,
      multiLang: false,
      timestamp: true,
      autoScroll: true,
      subtitleSize: "large",
      highlightLatest: true,
      compactMode: false,
      darkTheme: theme === "dark",
      noiseReduction: true,
      dialogueMode: false,
      autoSave: true,
      autoReconnect: true,
      exportSource: true,
      exportTranslation: true,
      exportTimestamp: true,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.sttMode && !saved.sttProvider) {
        saved.sttProvider = saved.sttMode === "browser" ? "native" : "auto";
      }
      delete saved.sttMode;
      const merged = { ...defaults, ...saved };
      merged.autoPlay = saved.autoPlay === true;
      merged.dialogueMode = saved.dialogueMode === true;
      return merged;
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch (_) {}
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_) { return []; }
  }

  function saveHistoryEntry(entry) {
    if (!entry.id) entry.id = crypto.randomUUID();
    state.history = [entry, ...state.history].slice(0, 30);
    persistHistory();
    renderHistory();
  }

  function displayLangLabel(value) {
    if (!value) return "无";
    return LANG_DISPLAY[value] || value;
  }

  function getLangLabel(key) {
    if (key === "source") return displayLangLabel(lang.source);
    if (key === "target") return displayLangLabel(lang.target);
    return lang.target2 ? displayLangLabel(lang.target2) : "无";
  }

  function langValueForKey(key) {
    if (key === "source") return lang.source;
    if (key === "target") return lang.target;
    return lang.target2 || "";
  }

  function setLang(key, value) {
    if (key === "source") lang.source = value || "Auto Detect";
    else if (key === "target") lang.target = value || "English";
    else lang.target2 = value || "";
    if (state.settings.autoDetect && key === "source" && value !== "Auto Detect") {
      state.settings.autoDetect = false;
      saveSettings();
      renderSettingsPanel();
    }
    updateLangTriggers();
    applyAutoDetect();
    onLiveLangOrSettingsChange();
  }

  function applyAutoDetect() {
    if (state.settings.autoDetect) lang.source = "Auto Detect";
    updateLangTriggers();
  }

  function updateLangTriggers() {
    Object.entries(langPickers).forEach(([key, cfg]) => {
      const btn = cfg.root?.querySelector(".oao-select-trigger");
      if (!btn) return;
      btn.textContent = getLangLabel(key);
      btn.disabled = false;
    });
    Object.values(customSelects).forEach((cfg) => {
      const btn = cfg.root?.querySelector(".oao-select-trigger");
      if (!btn) return;
      const opt = cfg.options.find((o) => o.value === cfg.getValue());
      btn.textContent = opt?.label || cfg.getValue() || "—";
      if (typeof cfg.isDisabled === "function") btn.disabled = cfg.isDisabled();
    });
  }

  function closeMenus() {
    [langMenuPortal, settingMenuPortal].forEach((portal) => {
      if (!portal) return;
      portal.classList.add("hidden");
      portal.innerHTML = "";
    });
    activeMenu = null;
    activeMenuKind = null;
  }

  function closeLangMenu() {
    closeMenus();
  }

  function openMenuPortal(portal, kind, anchor, items, onPick) {
    closeMenus();
    if (!portal || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = Math.min(300, items.length * 42 + 16);
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = rect.bottom + 6;
    if (spaceBelow < menuHeight + 12 && rect.top > menuHeight + 12) {
      top = rect.top - menuHeight - 6;
    }
    portal.classList.remove("hidden");
    portal.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 220))}px`;
    portal.style.top = `${Math.max(8, top)}px`;
    portal.style.minWidth = `${Math.max(rect.width, 168)}px`;
    portal.innerHTML = items.map((item, idx) =>
      `<button type="button" class="${kind === "lang" ? "lang-menu-item" : "setting-menu-item"}${item.active ? " active" : ""}" data-idx="${idx}">${escapeHtml(item.label)}</button>`
    ).join("");
    portal.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const idx = Number(btn.dataset.idx);
        onPick(idx);
        closeMenus();
      });
    });
    activeMenu = portal;
    activeMenuKind = kind;
  }

  function openLangMenu(key, anchor) {
    const cfg = langPickers[key];
    if (!cfg) return;
    const current = langValueForKey(key);
    const items = cfg.options.map((opt) => {
      const val = opt || "";
      return {
        value: val,
        label: val === "" ? "无" : displayLangLabel(val),
        active: val === current,
      };
    });
    openMenuPortal(langMenuPortal, "lang", anchor, items, (idx) => {
      setLang(key, cfg.options[idx] || "");
    });
  }

  function mountCustomSelect(id, root, options, getValue, onChange, isDisabled) {
    if (!root) return;
    customSelects[id] = { root, options, getValue, onChange, isDisabled };
    root.innerHTML = `<button type="button" class="oao-select-trigger" aria-haspopup="listbox"></button>`;
    const btn = root.querySelector(".oao-select-trigger");
    btn.addEventListener("mousedown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof isDisabled === "function" && isDisabled()) return;
      if (activeMenu === settingMenuPortal) {
        closeMenus();
        return;
      }
      const current = getValue();
      const items = options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        active: opt.value === current,
      }));
      openMenuPortal(settingMenuPortal, "setting", btn, items, (idx) => {
        const next = options[idx];
        if (next) onChange(next.value);
        updateLangTriggers();
      });
    });
    updateLangTriggers();
  }

  function initLangPickers() {
    Object.entries(langPickers).forEach(([key, cfg]) => {
      if (!cfg.root) return;
      cfg.root.innerHTML = `<button type="button" class="oao-select-trigger" aria-haspopup="listbox"></button>`;
      const btn = cfg.root.querySelector(".oao-select-trigger");
      btn.addEventListener("mousedown", (ev) => ev.stopPropagation());
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (activeMenu === langMenuPortal) closeMenus();
        else openLangMenu(key, btn);
      });
    });
    if (state.settings.autoDetect) lang.source = "Auto Detect";
    updateLangTriggers();
    document.addEventListener("mousedown", (ev) => {
      if (langMenuPortal?.contains(ev.target)) return;
      if (settingMenuPortal?.contains(ev.target)) return;
      if (Object.values(langPickers).some((cfg) => cfg.root?.contains(ev.target))) return;
      if (Object.values(customSelects).some((cfg) => cfg.root?.contains(ev.target))) return;
      closeMenus();
    });
    window.addEventListener("resize", closeMenus);
  }

  function initVoicePickers() {
    mountCustomSelect(
      "voiceStyle",
      els.voiceStyleSelect,
      STYLE_PRESETS.map((s) => ({ value: s.id, label: s.label })),
      () => state.voice.style,
      (value) => { state.voice.style = value; },
      () => false
    );
  }

  function swapLanguages() {
    const prevSource = lang.source;
    const prevTarget = lang.target;
    if (prevSource === "Auto Detect" || !prevTarget) {
      return toast("请先选择固定的识别语言与目标语言", "error");
    }
    lang.source = prevTarget;
    lang.target = prevSource;
    state.settings.autoDetect = false;
    saveSettings();
    updateLangTriggers();
    renderSettingsPanel();
    onLiveLangOrSettingsChange();
    toast("已交换识别与翻译语言");
  }

  async function onLiveLangOrSettingsChange() {
    if (state.status === "idle") return;
    if (state.shareRelayReady && state.socket?.connected && state.sessionId) {
      state.socket.emit("share:open", {
        sessionId: state.sessionId,
        sourceLanguage: toCode(lang.source),
        targetLanguage: toCode(lang.target),
        targetLanguages: getTargetLabels().map(toCode),
      });
    }
    if (state.settings.dialogueMode) {
      state.dialoguePartner = null;
      state.dialogueListenSide = "partner";
    }
    if (state.status === "recording") {
      scheduleDialogueSttRefresh(160);
    }
  }

  function applyThemeSettings() {
    document.documentElement.dataset.theme = state.settings.darkTheme ? "dark" : "light";
  }

  function applyDisplaySettings() {
    if (!appEl) return;
    appEl.classList.remove("text-scale-standard", "text-scale-large", "text-scale-extra", "compact-mode");
    const size = state.settings.subtitleSize || "large";
    if (size === "large") appEl.classList.add("text-scale-large");
    else if (size === "extra") appEl.classList.add("text-scale-extra");
    else appEl.classList.add("text-scale-standard");
    if (state.settings.compactMode) appEl.classList.add("compact-mode");
    applyThemeSettings();
  }

  function toast(msg, type) {
    els.toast.textContent = msg;
    els.toast.className = "toast" + (type === "error" ? " error" : "");
    els.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add("hidden"), 3200);
  }

  function getTargetLabels() {
    return [...new Set([lang.target, lang.target2].filter(Boolean))];
  }

  function setStatus(mode, recording) {
    const browser = mode === "browser";
    const modeLabel = browser ? "浏览器模式" : "本地 AI";
    const sttLabel = state.sttProviderLabel
      || formatProviderLabel({ id: "native" }, "zh", 0, resolveRecogLang());
    const detail = browser
      ? `识别：${sttLabel} · 在线译+朗读`
      : `识别：${sttLabel} · 本地 AI 翻译`;
    if (els.statusMode) els.statusMode.innerHTML = `<strong>${modeLabel}</strong>`;
    if (els.statusRecBadge) els.statusRecBadge.classList.toggle("hidden", !recording);
    if (els.statusDetail) {
      els.statusDetail.textContent = detail + (userName ? ` · ${userName}` : "");
    }
  }

  function updateSttProviderLabel(label) {
    state.sttProviderLabel = label || "";
    setStatus(state.engineMode, state.status !== "idle");
  }

  function updateControls() {
    const s = state.status;
    els.btnStart.disabled = s !== "idle";
    els.btnPause.disabled = s !== "recording";
    els.btnResume.disabled = s !== "paused";
    els.btnStop.disabled = s === "idle";
    els.btnSpeak.disabled = !state.lines.length;
    els.btnExport.disabled = !state.lines.length;
    els.btnShare.disabled = s === "idle" || !state.sessionId;
    els.btnStart.classList.toggle("active", s === "recording");
    els.btnPause.classList.toggle("active", s === "recording");
    updateLangTriggers();
  }

  function renderSettingsPanel() {
    els.settingsList.innerHTML = SETTINGS_GROUPS.map((group) => {
      const items = group.items.map((item) => {
        if (item.type === "segment") {
          const buttons = item.options.map((o) =>
            `<button type="button" class="${state.settings[item.key] === o.value ? "active" : ""}" data-key="${item.key}" data-value="${o.value}">${o.label}</button>`
          ).join("");
          return `<div class="setting-item"><span>${item.label}</span><div class="setting-segment">${buttons}</div></div>`;
        }
        if (item.type === "select") {
          const opts = item.options.map((o) =>
            `<option value="${o.value}"${state.settings[item.key] === o.value ? " selected" : ""}>${o.label}</option>`
          ).join("");
          const hint = item.hint ? `<div class="setting-note">${item.hint}</div>` : "";
          return `<div class="setting-item setting-item-select"><span>${item.label}</span><select class="setting-select" data-key="${item.key}">${opts}</select></div>${hint}`;
        }
        const hint = item.hint ? `<div class="setting-note">${item.hint}</div>` : "";
        return `<label class="setting-item"><span>${item.label}</span><input type="checkbox" data-key="${item.key}" ${state.settings[item.key] ? "checked" : ""}></label>${hint}`;
      }).join("");
      return `<div class="setting-group"><div class="setting-group-title">${group.title}</div>${items}</div>`;
    }).join("") + `
      <div class="setting-group">
        <div class="setting-group-title">导出</div>
        <label class="setting-item"><span>包含原文</span><input type="checkbox" data-key="exportSource" ${state.settings.exportSource !== false ? "checked" : ""}></label>
        <label class="setting-item"><span>包含译文</span><input type="checkbox" data-key="exportTranslation" ${state.settings.exportTranslation !== false ? "checked" : ""}></label>
        <label class="setting-item"><span>包含时间戳</span><input type="checkbox" data-key="exportTimestamp" ${state.settings.exportTimestamp !== false ? "checked" : ""}></label>
        <div class="setting-actions">
          <button type="button" class="btn" id="btnExportCurrent">导出当前字幕</button>
        </div>
      </div>
      <div class="setting-group">
        <div class="setting-group-title">快捷操作</div>
        <div class="setting-actions">
          <button type="button" class="btn" id="btnClearLines">清空当前字幕</button>
          <button type="button" class="btn" id="btnResetSettings">恢复默认设置</button>
        </div>
      </div>`;

    els.settingsList.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        state.settings[input.dataset.key] = input.checked;
        if (input.dataset.key === "autoDetect" && input.checked) {
          lang.source = "Auto Detect";
          updateLangTriggers();
        }
        if (input.dataset.key === "dialogueMode" && input.checked) {
          state.settings.autoDetect = true;
          lang.source = "Auto Detect";
          updateLangTriggers();
        }
        saveSettings();
        applyDisplaySettings();
        renderLines();
        onLiveLangOrSettingsChange();
      });
    });
    els.settingsList.querySelectorAll(".setting-segment button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings[btn.dataset.key] = btn.dataset.value;
        saveSettings();
        applyDisplaySettings();
        renderSettingsPanel();
        renderLines();
      });
    });
    els.settingsList.querySelectorAll(".setting-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        state.settings[sel.dataset.key] = sel.value;
        saveSettings();
        if (sel.dataset.key === "sttProvider" && state.status === "recording") {
          startRecognition();
        }
        onLiveLangOrSettingsChange();
      });
    });
    $("btnClearLines")?.addEventListener("click", () => {
      if (!state.lines.length) return;
      if (!window.confirm("确定清空当前字幕？此操作不可恢复。")) return;
      state.lines = [];
      renderLines();
      toast("已清空字幕");
    });
    $("btnExportCurrent")?.addEventListener("click", () => exportLinesToTxt(state.lines));
    $("btnResetSettings")?.addEventListener("click", () => {
      state.settings = {
        autoDetect: true,
        autoTranslate: true,
        autoPlay: false,
        aiPolish: false,
      sttProvider: "auto",
        bilingual: true,
        multiLang: false,
        timestamp: true,
        autoScroll: true,
        subtitleSize: "large",
        highlightLatest: true,
        compactMode: false,
        darkTheme: theme === "dark",
        noiseReduction: true,
        dialogueMode: false,
        autoSave: true,
        autoReconnect: true,
        exportSource: true,
        exportTranslation: true,
        exportTimestamp: true,
      };
      lang.source = "Auto Detect";
      saveSettings();
      applyDisplaySettings();
      updateLangTriggers();
      renderSettingsPanel();
      renderLines();
      toast("已恢复默认设置");
    });

    updateLangTriggers();
  }

  function persistHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); } catch (_) {}
  }

  function updateHistoryToolbar() {
    if (!els.historyToolbar) return;
    const hasItems = state.history.length > 0;
    els.historyToolbar.classList.toggle("hidden", !hasItems);
    if (!hasItems) return;
    const selectedCount = state.historySelected.size;
    const deleteBtn = $("btnDeleteHistory");
    if (deleteBtn) deleteBtn.disabled = selectedCount === 0;
    const exportBtn = $("btnExportHistory");
    if (exportBtn) exportBtn.disabled = selectedCount === 0;
    const selectAll = $("historySelectAll");
    if (selectAll) {
      selectAll.checked = selectedCount > 0 && selectedCount === state.history.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.history.length;
    }
  }

  function deleteSelectedHistory() {
    if (!state.historySelected.size) return;
    if (!window.confirm(`确定删除选中的 ${state.historySelected.size} 条历史记录？`)) return;
    state.history = state.history.filter((item) => !state.historySelected.has(item.id));
    state.historySelected.clear();
    persistHistory();
    renderHistory();
    toast("已删除所选历史");
  }

  function clearAllHistory() {
    if (!state.history.length) return;
    if (!window.confirm("确定清空全部历史记录？此操作不可恢复。")) return;
    state.history = [];
    state.historySelected.clear();
    persistHistory();
    renderHistory();
    toast("已清空历史");
  }

  function exportSelectedHistory() {
    const items = state.history.filter((item) => state.historySelected.has(item.id));
    exportHistoryItems(items);
  }

  function renderHistoryToolbar() {
    if (!els.historyToolbar) return;
    els.historyToolbar.innerHTML = `
      <label class="history-select-all">
        <input type="checkbox" id="historySelectAll"> 全选
      </label>
      <button type="button" class="btn" id="btnExportHistory" disabled>导出所选</button>
      <button type="button" class="btn" id="btnDeleteHistory" disabled>删除所选</button>
      <button type="button" class="btn" id="btnClearHistory">清空全部</button>
    `;
    $("historySelectAll")?.addEventListener("change", (ev) => {
      if (ev.target.checked) {
        state.history.forEach((item) => state.historySelected.add(item.id));
      } else {
        state.historySelected.clear();
      }
      renderHistory();
    });
    $("btnExportHistory")?.addEventListener("click", exportSelectedHistory);
    $("btnDeleteHistory")?.addEventListener("click", deleteSelectedHistory);
    $("btnClearHistory")?.addEventListener("click", clearAllHistory);
    updateHistoryToolbar();
  }

  function renderHistory() {
    renderHistoryToolbar();
    if (!state.history.length) {
      els.historyList.innerHTML = '<p class="empty-hint">暂无历史会话</p>';
      updateHistoryToolbar();
      return;
    }
    state.history.forEach((item) => {
      if (!item.id) item.id = crypto.randomUUID();
    });
    els.historyList.innerHTML = state.history.map((item) => {
      const checked = state.historySelected.has(item.id) ? " checked" : "";
      return `<label class="history-item">
        <input type="checkbox" data-id="${item.id}"${checked} aria-label="选择">
        <span class="history-item-body">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.date)} · ${item.lines.length} 条</span>
        </span>
      </label>`;
    }).join("");

    els.historyList.querySelectorAll(".history-item input[type=checkbox]").forEach((input) => {
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("change", () => {
        const id = input.dataset.id;
        if (!id) return;
        if (input.checked) state.historySelected.add(id);
        else state.historySelected.delete(id);
        updateHistoryToolbar();
      });
    });

    els.historyList.querySelectorAll(".history-item").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.matches('input[type="checkbox"]')) return;
        const id = row.querySelector('input[type="checkbox"]')?.dataset.id;
        const item = state.history.find((h) => h.id === id);
        if (!item) return;
        if (state.status !== "idle") return toast("请先停止当前会话", "error");
        state.lines = JSON.parse(JSON.stringify(item.lines));
        renderLines();
        closePanels();
        toast("已加载历史会话");
      });
    });
    updateHistoryToolbar();
  }

  function getExportOptions() {
    return {
      timestamp: state.settings.exportTimestamp !== false,
      source: state.settings.exportSource !== false,
      translation: state.settings.exportTranslation !== false,
    };
  }

  function formatLinesExportText(lines, options = getExportOptions()) {
    const blocks = (lines || []).map((l) => {
      const chunks = [];
      if (options.timestamp && l.time) chunks.push(`[${l.time}]`);
      if (options.source) {
        const prefix = chunks.length ? `${chunks.join(" ")} ` : "";
        const speaker = l.speaker ? `${l.speaker} ` : "";
        chunks.length = 0;
        chunks.push(`${prefix}${speaker}${l.source}`.trim());
      }
      let text = chunks.filter(Boolean).join("\n") || "";
      if (options.translation && l.translations?.length) {
        const trans = l.translations.map((t) => `[${t.label || toLabel(t.language)}] ${t.text}`).join("\n");
        text = text ? `${text}\n→ ${trans}` : trans;
      }
      return text.trim();
    }).filter(Boolean);
    return blocks.join("\n\n");
  }

  function downloadTxtFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportLinesToTxt(lines, filenamePrefix = "OAO-translate") {
    const text = formatLinesExportText(lines);
    if (!text.trim()) return toast("没有可导出的内容", "error");
    downloadTxtFile(text, `${filenamePrefix}-${Date.now()}.txt`);
    toast("已导出 TXT");
  }

  function exportHistoryItems(items) {
    if (!items.length) return toast("请先勾选要导出的历史记录", "error");
    const body = items.map((item) => {
      const header = `=== ${item.title || "会话"} · ${item.date || ""} ===`.trim();
      const content = formatLinesExportText(item.lines || []);
      return content ? `${header}\n${content}` : header;
    }).join("\n\n------------------------------\n\n");
    if (!body.trim()) return toast("所选记录没有可导出的内容", "error");
    downloadTxtFile(body, `OAO-translate-history-${Date.now()}.txt`);
    toast(`已导出 ${items.length} 条历史记录`);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function getSpeakerSide(line) {
    if (!line?.speaker) return "";
    if (line.speaker.includes("A")) return "a";
    if (line.speaker.includes("B")) return "b";
    return "";
  }

  function getPrimaryTranslation(line) {
    if (!line?.translations?.length) return null;
    const targets = getTargetLabels();
    if (targets.length) {
      const primaryCode = toCode(targets[0]);
      return line.translations.find((t) => t.language === primaryCode) || line.translations[0];
    }
    return line.translations[0];
  }

  function updateSpeakUI() {
    const latest = state.lines[state.lines.length - 1];
    const footerActive = state.tts.playing && latest && state.tts.lineId === latest.id;
    els.btnSpeak?.classList.toggle("is-speaking", footerActive);
    els.subtitles.querySelectorAll(".btn-line-speak").forEach((btn) => {
      const active = state.tts.playing
        && btn.dataset.lineId === state.tts.lineId
        && btn.dataset.lang === state.tts.langCode;
      btn.classList.toggle("is-speaking", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    state.tts = { lineId: null, langCode: null, playing: false };
    state.ttsToken += 1;
    updateSpeakUI();
  }

  function renderLines() {
    if (!state.lines.length) {
      els.emptyHint.style.display = "";
      els.subtitles.querySelectorAll(".line").forEach((n) => n.remove());
      updateSpeakUI();
      return;
    }
    els.emptyHint.style.display = "none";
    els.subtitles.innerHTML = "";
    state.lines.forEach((line, idx) => {
      const div = document.createElement("div");
      const speakerSide = !state.settings.dialogueMode ? getSpeakerSide(line) : "";
      div.className = "line"
        + (state.settings.highlightLatest && idx === state.lines.length - 1 ? " is-latest" : "")
        + (speakerSide ? ` speaker-${speakerSide}` : "")
        + (state.settings.dialogueMode && line.speaker ? " dialogue-line" : "");
      div.dataset.lineId = line.id;
      const showTrans = state.settings.bilingual || state.settings.multiLang;
      const metaParts = [];
      if (state.settings.timestamp && line.time) metaParts.push(`<span class="line-time">${line.time}</span>`);
      if (state.settings.dialogueMode && line.speaker) {
        metaParts.push(`<span class="line-speaker-badge dialogue-route">${escapeHtml(line.speaker)}</span>`);
      } else if (line.speaker && !state.settings.dialogueMode) {
        const badge = line.speaker.replace(/^说话人\s*/, "");
        metaParts.push(`<span class="line-speaker-badge speaker-${speakerSide}">${escapeHtml(badge)}</span>`);
      }
      const metaHtml = metaParts.length ? `<div class="line-meta">${metaParts.join("")}</div>` : "";
      const transHtml = showTrans
        ? (line.translations || []).map((t) => {
            const langCode = escapeHtml(t.language || "");
            return `<div class="line-trans-row">
              <div class="line-trans"><span class="line-lang">${escapeHtml(t.label || toLabel(t.language))}</span>${escapeHtml(t.text)}</div>
              <button type="button" class="btn-line-speak" data-line-id="${line.id}" data-lang="${langCode}" title="再次聆听" aria-label="朗读此译文">🔊</button>
            </div>`;
          }).join("")
        : "";
      div.innerHTML =
        metaHtml +
        `<div class="line-source">${escapeHtml(line.source)}</div>` +
        transHtml;
      els.subtitles.appendChild(div);
    });
    if (state.settings.autoScroll) {
      els.subtitles.parentElement.scrollTop = els.subtitles.parentElement.scrollHeight;
    }
    updateControls();
    updateSpeakUI();
  }

  function normText(t) { return t.replace(/\s+/g, "").toLowerCase(); }
  function isDuplicate(text) {
    const n = normText(text);
    const now = Date.now();
    return state.recentTexts.some((x) => x.n === n && now - x.t < 3500);
  }
  function rememberText(text) {
    const n = normText(text);
    state.recentTexts = [{ n, t: Date.now() }, ...state.recentTexts.filter((x) => x.n !== n)].slice(0, 24);
  }

  function tokenizeForEcho(text) {
    return normText(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  }

  function textSimilarToEcho(input, echoRaw) {
    const a = normText(input);
    const b = normText(echoRaw);
    if (!a || !b) return false;
    if (a === b) return true;
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    if (minLen >= 2 && (a.includes(b) || b.includes(a)) && minLen / maxLen >= 0.4) return true;
    const wordsA = tokenizeForEcho(input);
    const wordsB = tokenizeForEcho(echoRaw);
    if (wordsA.length && wordsB.length) {
      const overlap = wordsA.filter((w) => wordsB.includes(w)).length;
      if (overlap >= 2 && overlap / Math.min(wordsA.length, wordsB.length) >= 0.55) return true;
      if (wordsA.length <= 3 && overlap === wordsA.length && overlap === wordsB.length) return true;
    }
    return false;
  }

  function rememberTtsEcho(spokenText, langCode, sourceText) {
    const now = Date.now();
    const raw = String(spokenText || "").trim();
    const lang = pairLangCode(langCode);
    state.lastTtsSpeak = {
      text: raw,
      lang,
      sourceText: String(sourceText || "").trim(),
      at: now,
    };
    const entries = [];
    [raw, sourceText, prepareSpeechText(raw, state.voice.style)].forEach((t) => {
      const s = String(t || "").trim();
      if (!s) return;
      entries.push({ raw: s, n: normText(s), lang, t: now });
      if (s.length > 14) {
        entries.push({ raw: s.slice(0, 30), n: normText(s.slice(0, 30)), lang, t: now });
      }
    });
    state.ttsEchoTexts = [...entries, ...state.ttsEchoTexts].slice(0, 28);
  }

  function isLikelyPlaybackEcho(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return false;
    const now = Date.now();
    const windowMs = state.settings.dialogueMode ? 20000 : 12000;

    const lastLine = state.lines[state.lines.length - 1];
    if (lastLine?.translations?.length) {
      for (const tr of lastLine.translations) {
        if (tr.text && textSimilarToEcho(trimmed, tr.text)) return true;
      }
    }

    const echoHit = state.ttsEchoTexts.some(
      (item) => now - item.t < windowMs && textSimilarToEcho(trimmed, item.raw)
    );
    if (!echoHit) return false;

    if (!state.settings.dialogueMode || !state.lastTtsSpeak || now - state.lastTtsSpeak.at > windowMs) {
      return true;
    }

    const detected = detectTextLangCode(trimmed);
    const similarToSpoken = textSimilarToEcho(trimmed, state.lastTtsSpeak.text)
      || (state.lastTtsSpeak.sourceText && textSimilarToEcho(trimmed, state.lastTtsSpeak.sourceText));

    if (!similarToSpoken) return false;

    if (!sameLangCode(detected, state.lastTtsSpeak.lang)) return true;

    const spokenLen = normText(state.lastTtsSpeak.text).length;
    const inputLen = normText(trimmed).length;
    if (inputLen <= spokenLen * 0.55) return true;
    return similarToSpoken;
  }

  function scheduleDialogueSttRefresh(delay) {
    if (!state.settings.dialogueMode || state.status !== "recording") return;
    clearTimeout(state.dialogueSttRefreshTimer);
    state.dialogueSttRefreshTimer = setTimeout(() => {
      state.dialogueSttRefreshTimer = 0;
      if (state.status === "recording") startRecognition();
    }, delay == null ? 280 : delay);
  }

  function pairLangCode(code) {
    const c = toCode(code);
    if (c === "auto") return "en";
    return String(c).slice(0, 2);
  }

  function sameLangCode(a, b) {
    return pairLangCode(a) === pairLangCode(b);
  }

  function detectTextLangCode(text) {
    return resolveSourceCode("Auto Detect", text);
  }

  function inferDialoguePartner(targetCode) {
    const nav = navigator.language || "zh-CN";
    let partner = nav.startsWith("zh") ? "zh" : nav.startsWith("ja") ? "ja" : nav.startsWith("ko") ? "ko" : "en";
    if (sameLangCode(partner, targetCode)) partner = partner === "zh" ? "en" : "zh";
    return partner;
  }

  function getDialogueLangCodes() {
    const target = pairLangCode(lang.target);
    let partner = toCode(lang.source);
    if (partner === "auto") {
      partner = state.dialoguePartner || inferDialoguePartner(target);
    } else {
      partner = pairLangCode(partner);
    }
    return { partner, target };
  }

  function resolveDialogueRoute(line) {
    const detected = detectTextLangCode(line.source);
    const { partner, target } = getDialogueLangCodes();
    if (toCode(lang.source) === "auto" && !sameLangCode(detected, target)) {
      state.dialoguePartner = pairLangCode(detected);
    }
    const partnerCode = state.dialoguePartner || partner;
    const partnerLabel = toLabel(partnerCode);
    if (sameLangCode(detected, target)) {
      return {
        sourceLabel: lang.target,
        targetCode: partnerCode,
        targetLabel: partnerLabel,
        speakCode: partnerCode,
        routeLabel: `${lang.target} → ${partnerLabel}`,
      };
    }
    const sourceLabel = toCode(lang.source) === "auto" ? toLabel(detected) : lang.source;
    return {
      sourceLabel,
      targetCode: target,
      targetLabel: lang.target,
      speakCode: target,
      routeLabel: `${sourceLabel} → ${lang.target}`,
    };
  }

  function nextSpeaker() {
    return "";
  }

  async function translateLineDialogue(line) {
    const route = resolveDialogueRoute(line);
    line.speaker = route.routeLabel;
    try {
      const text = await translateOnline(line.source, route.sourceLabel, route.targetCode);
      line.translations = [{
        language: route.targetCode,
        label: route.targetLabel,
        text,
      }];
      renderLines();
      maybeAutoSpeakLine(line);
      for (const item of line.translations) {
        pushShareEvent("translation", {
          text: item.text,
          language: item.language,
          sourceText: line.source,
        });
      }
      if (!state.tts.playing) scheduleDialogueSttRefresh(320);
    } catch (_) {
      toast("翻译暂不可用，请检查网络", "error");
    }
  }

  async function translateLine(line) {
    if (state.settings.dialogueMode) {
      await translateLineDialogue(line);
      return;
    }
    const targets = getTargetLabels();
    if (!targets.length) return;
    let changed = false;
    for (const label of targets) {
      const code = toCode(label);
      try {
        const text = await translateOnline(line.source, lang.source, code);
        const existing = line.translations.find((t) => t.language === code);
        const item = { language: code, label, text };
        if (existing) Object.assign(existing, item);
        else line.translations.push(item);
        changed = true;
      } catch (_) {
        toast("翻译暂不可用，请检查网络", "error");
      }
    }
    if (changed) {
      renderLines();
      maybeAutoSpeakLine(line);
      for (const item of line.translations) {
        pushShareEvent("translation", {
          text: item.text,
          language: item.language,
          sourceText: line.source,
        });
      }
    }
  }

  function maybeAutoSpeakLine(line) {
    if (!line || line.autoSpoken) return;
    if (!state.settings.autoPlay && !state.settings.dialogueMode) return;
    const trans = getPrimaryTranslation(line);
    const text = trans?.text?.trim();
    if (!text) return;
    void speakTranslation(line, trans, { manual: false });
  }

  function appendLine(sourceText) {
    const trimmed = sourceText.trim();
    if (!trimmed || isDuplicate(trimmed) || isLikelyPlaybackEcho(trimmed)) return null;
    rememberText(trimmed);
    const line = {
      id: crypto.randomUUID(),
      source: trimmed,
      translations: [],
      time: state.settings.timestamp ? formatTime() : "",
      speaker: "",
    };
    state.lines.push(line);
    renderLines();
    if ((state.settings.autoTranslate || state.settings.dialogueMode) && state.engineMode === "browser") {
      void translateLine(line);
    }
    if (state.settings.dialogueMode && state.status === "recording") {
      state.dialogueListenSide = state.dialogueListenSide === "target" ? "partner" : "target";
      clearTimeout(state.dialogueSttRefreshTimer);
    }
    if (state.engineMode === "server" && state.socket?.connected && state.sessionId) {
      state.socket.emit("text:transcript", {
        sessionId: state.sessionId,
        text: trimmed,
        speaker: line.speaker || undefined,
      });
    }
    pushShareEvent("transcript", { text: trimmed });
    return line;
  }

  function formatTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date());
  }

  function flushInterim() {
    const pending = (state.interimText || els.interim.textContent || "").trim();
    if (!pending || isLikelyPlaybackEcho(pending)) {
      state.interimText = "";
      els.interim.textContent = "";
      return;
    }
    state.interimText = "";
    els.interim.textContent = "";
    appendLine(pending);
  }

  function scheduleInterimCommit() {
    clearTimeout(state.interimCommitTimer);
    state.interimCommitTimer = setTimeout(() => {
      state.interimCommitTimer = 0;
      flushInterim();
    }, 2400);
  }

  function clearInterimCommitTimer() {
    clearTimeout(state.interimCommitTimer);
    state.interimCommitTimer = 0;
  }

  function resolveRecogLang() {
    const map = {
      zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR",
      fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT", pt: "pt-BR", ru: "ru-RU",
    };
    if (state.settings.dialogueMode) {
      const { partner, target } = getDialogueLangCodes();
      const side = state.dialogueListenSide || "partner";
      const code = side === "target" ? target : partner;
      return map[code] || code || "en-US";
    }
    const code = toCode(lang.source);
    const nav = navigator.language || "zh-CN";
    if (code === "auto") {
      if (nav.startsWith("zh")) return "zh-CN";
      if (nav.startsWith("ja")) return "ja-JP";
      if (nav.startsWith("ko")) return "ko-KR";
      return nav || "en-US";
    }
    return map[code] || code;
  }

  function startRecognition() {
    stopRecognition();
    state.browserSttFails = 0;
    const providerId = state.settings.sttProvider || "auto";
    if (!window.OAOBrowserSTT?.SpeechCtor) {
      toast("无法启动浏览器语音识别，请使用 Chrome 或 Edge", "error");
      updateSttProviderLabel("");
      setStatus(state.engineMode, state.status === "recording");
      return;
    }
    state.sttSession = createSttSession({
      providerId,
      uiLang: "zh",
      resolveLang: resolveRecogLang,
      onProviderChange: (label) => updateSttProviderLabel(label),
      onFallback: (label) => toast(`已切换备用引擎：${label}`, "error"),
      onResult: (ev) => {
        state.browserSttFails = 0;
        let interim = "";
        let gotFinal = false;
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const text = r[0]?.transcript || "";
          if (!text.trim()) continue;
          if (isLikelyPlaybackEcho(text)) continue;
          if (r.isFinal) {
            appendLine(text);
            gotFinal = true;
          } else {
            interim += text;
          }
        }
        state.interimText = interim;
        els.interim.textContent = interim;
        if (gotFinal) clearInterimCommitTimer();
        else if (interim.trim()) scheduleInterimCommit();
      },
      onError: ({ error, fatal }) => {
        if (error === "not-allowed") {
          toast("请允许麦克风权限", "error");
          return;
        }
        if (error === "unsupported") {
          toast("无法启动浏览器语音识别，请使用 Chrome 或 Edge", "error");
          return;
        }
        if (fatal) return;
        state.browserSttFails += 1;
        const blocked = error === "network" || error === "service-not-allowed";
        if (blocked && providerId !== "auto") {
          toast("当前引擎需联网，可改为「自动」以切换备用引擎", "error");
        } else if (state.browserSttFails >= 3 && providerId !== "auto") {
          toast(`语音识别异常（${error}），可改为「自动」尝试备用引擎`, "error");
        }
      },
    });
    if (!state.sttSession.start()) {
      toast("无法启动浏览器语音识别，请使用 Chrome 或 Edge", "error");
    } else if (!state.sttProviderLabel) {
      updateSttProviderLabel(formatProviderLabel({ id: "native" }, "zh", 0, resolveRecogLang()));
    }
    state.recognitionStop = () => state.sttSession?.stop();
    setStatus(state.engineMode, state.status === "recording");
  }

  function stopRecognition() {
    clearInterimCommitTimer();
    clearTimeout(state.dialogueSttRefreshTimer);
    state.sttSession?.stop();
    state.sttSession = null;
    state.recognitionStop?.();
    state.recognitionStop = null;
    state.interimText = "";
    els.interim.textContent = "";
    if (state.status === "idle") updateSttProviderLabel("");
  }

  async function startAudioLevel() {
    const strongEcho = state.settings.dialogueMode || state.settings.autoPlay;
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: strongEcho ? { ideal: true } : true,
        noiseSuppression: strongEcho || !!state.settings.noiseReduction,
        autoGainControl: strongEcho || !!state.settings.noiseReduction,
      },
    });
    state.audioCtx = new AudioContext();
    const src = state.audioCtx.createMediaStreamSource(state.mediaStream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    src.connect(state.analyser);
    const data = new Uint8Array(state.analyser.frequencyBinCount);
    const tick = () => {
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      els.wave.style.setProperty("--level", String(Math.min(1, sum / data.length / 128)));
      state.animFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopAudioLevel() {
    cancelAnimationFrame(state.animFrame);
    state.analyser = null;
    state.audioCtx?.close().catch(() => {});
    state.audioCtx = null;
    state.mediaStream?.getTracks().forEach((t) => t.stop());
    state.mediaStream = null;
    els.wave.style.setProperty("--level", "0");
  }

  async function prepareTts() {
    if (!window.speechSynthesis) return;
    await waitForVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0.01;
    u.rate = 10;
    u.onend = () => window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function speakRawText(text, langHint, styleId) {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.reject(new Error("no-tts"));
    const trimmed = prepareSpeechText(text, styleId || state.voice.style);
    if (!trimmed) return Promise.resolve();
    return waitForVoices().then((voices) => new Promise((resolve, reject) => {
      const style = styleId || state.voice.style;
      const u = new SpeechSynthesisUtterance(trimmed);
      u.voice = pickVoice(voices, langHint, "auto", style);
      applyUtteranceStyle(u, style, {
        rate: parseFloat(els.voiceRate.value),
        pitch: parseFloat(els.voicePitch.value),
        volume: parseFloat(els.voiceVolume.value),
      });
      u.onend = () => resolve();
      u.onerror = () => reject(new Error("tts-error"));
      synth.cancel();
      synth.speak(u);
    }));
  }

  async function speakTranslation(line, translation, options = {}) {
    if (!line) return;
    const manual = !!options.manual;
    const trans = translation || getPrimaryTranslation(line);
    const text = trans?.text?.trim();
    if (!text) return;
    if (!manual && line.autoSpoken) return;
    const langCode = trans?.language || resolveSourceCode(lang.source, line.source);
    const token = ++state.ttsToken;
    if (!manual) line.autoSpoken = true;
    rememberTtsEcho(text, langCode, line.source);
    state.tts = { lineId: line.id, langCode, playing: true };
    updateSpeakUI();
    try {
      await speakRawText(text, langCode, state.voice.style);
    } catch (_) {
      if (token === state.ttsToken) toast("朗读失败，请检查系统语音包", "error");
    } finally {
      if (token === state.ttsToken) {
        state.tts.playing = false;
        updateSpeakUI();
        if (state.settings.dialogueMode) scheduleDialogueSttRefresh(200);
      }
    }
  }

  function speakLatestLine() {
    const line = state.lines[state.lines.length - 1];
    if (!line) return;
    void speakTranslation(line, getPrimaryTranslation(line), { manual: true });
  }

  function bindSocketEvents() {
    if (!state.socket || state.socketBound) return;
    state.socketBound = true;
    state.socket.on("translation", (payload) => {
      if (!payload?.text) return;
      const code = (payload.language || "").toLowerCase();
      let line = payload.sourceText
        ? state.lines.find((l) => l.source === payload.sourceText)
        : state.lines[state.lines.length - 1];
      if (!line) return;
      const existing = line.translations.find((t) => t.language === code);
      const item = { language: code, label: toLabel(code), text: payload.text };
      if (existing) Object.assign(existing, item);
      else line.translations.push(item);
      renderLines();
      maybeAutoSpeakLine(line);
    });
    state.socket.on("transcript", (payload) => {
      if (!payload?.text || payload.isFinal === false) return;
      if (!isDuplicate(payload.text)) appendLine(payload.text);
    });
    state.socket.on("connect", () => {
      if (state.settings.aiPolish) {
        state.engineMode = "server";
        setStatus("server", state.status === "recording");
      }
    });
    state.socket.on("disconnect", () => {
      state.engineMode = "browser";
      setStatus("browser", state.status === "recording");
    });
  }

  async function ensureShareSocket() {
    if (typeof io !== "function") return false;
    if (state.socket?.connected) return true;
    try {
      const health = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2500) });
      if (!health.ok) return false;
      const tokenRes = await fetch(`${SERVER_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!tokenRes.ok) return false;
      const { token } = await tokenRes.json();
      if (!state.socket) {
        state.socket = io(SERVER_URL, { auth: { token }, transports: ["websocket", "polling"], reconnection: true });
        state.socketBound = false;
        bindSocketEvents();
      } else {
        state.socket.auth = { token };
        if (!state.socket.connected) state.socket.connect();
      }
      if (state.socket.connected) return true;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 5000);
        state.socket.once("connect", () => { clearTimeout(t); resolve(); });
        state.socket.once("connect_error", () => { clearTimeout(t); reject(new Error("connect")); });
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function registerShareSession() {
    if (!state.sessionId) return false;
    const connected = await ensureShareSocket();
    if (!connected) {
      state.shareRelayReady = false;
      return false;
    }
    try {
      const ok = await new Promise((resolve) => {
        state.socket.emit("share:open", {
          sessionId: state.sessionId,
          sourceLanguage: toCode(lang.source),
          targetLanguage: toCode(lang.target),
          targetLanguages: getTargetLabels().map(toCode),
        }, (res) => resolve(!!res?.ok));
      });
      state.shareRelayReady = ok;
      return ok;
    } catch (_) {
      state.shareRelayReady = false;
      return false;
    }
  }

  function pushShareEvent(kind, payload) {
    if (!state.shareRelayReady || !state.socket?.connected || !state.sessionId) return;
    if (state.status === "idle") return;
    if (state.engineMode === "server" && state.settings.aiPolish) return;
    state.socket.emit("share:push", {
      sessionId: state.sessionId,
      kind,
      text: payload.text,
      language: payload.language,
      sourceText: payload.sourceText,
    });
  }

  async function tryConnectServer() {
    if (!state.settings.autoReconnect || !state.settings.aiPolish) return;
    if (state.socket?.connected || typeof io !== "function") return;
    try {
      const health = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (!health.ok) return;
      const tokenRes = await fetch(`${SERVER_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!tokenRes.ok) return;
      const { token } = await tokenRes.json();
      if (state.socket) state.socket.disconnect();
      state.socket = io(SERVER_URL, { auth: { token }, transports: ["websocket", "polling"], reconnection: true });
      state.socketBound = false;
      bindSocketEvents();
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 5000);
        state.socket.once("connect", () => { clearTimeout(t); resolve(); });
        state.socket.once("connect_error", () => { clearTimeout(t); reject(new Error("connect")); });
      });
      state.engineMode = "server";
      setStatus("server", state.status === "recording");
    } catch (_) {
      state.engineMode = "browser";
      setStatus("browser", state.status === "recording");
    }
  }

  async function startSession() {
    if (!window.isSecureContext) return toast("请通过 http://127.0.0.1:8777 打开", "error");
    closeMenus();
    await prepareTts();
    state.recentTexts = [];
    state.dialogueTurn = 0;
    state.dialoguePartner = null;
    state.dialogueListenSide = "partner";
    state.sessionId = crypto.randomUUID();

    if (state.engineMode === "server" && state.socket?.connected && state.settings.aiPolish) {
      try {
        await new Promise((resolve, reject) => {
          state.socket.emit("session:start", {
            provider: "ollama",
            sourceLanguage: toCode(lang.source),
            targetLanguage: toCode(lang.target),
            targetLanguages: getTargetLabels().map(toCode),
            settings: state.settings,
          }, (res) => {
            if (res?.ok && res.data?.id) {
              state.sessionId = res.data.id;
              resolve();
            } else reject(new Error(res?.error || "session"));
          });
        });
      } catch (_) {
        state.engineMode = "browser";
        state.sessionId = crypto.randomUUID();
      }
    }

    try {
      await startAudioLevel();
    } catch (_) {
      toast("需要麦克风权限", "error");
      state.sessionId = null;
      return;
    }

    const shareReady = await registerShareSession();
    if (!shareReady) {
      toast("分享中继未连接，观看页可能无法同步；请确认 OAO Services 已启动", "error");
    }

    state.status = "recording";
    startRecognition();
    setStatus(state.engineMode, true);
    updateControls();
  }

  function pauseSession() {
    if (state.status !== "recording") return;
    flushInterim();
    stopSpeaking();
    stopRecognition();
    state.status = "paused";
    state.socket?.emit("session:pause", { sessionId: state.sessionId });
    setStatus(state.engineMode, false);
    updateControls();
  }

  function resumeSession() {
    if (state.status !== "paused") return;
    state.status = "recording";
    startRecognition();
    state.socket?.emit("session:resume", { sessionId: state.sessionId });
    setStatus(state.engineMode, true);
    updateControls();
  }

  function stopSession() {
    flushInterim();
    stopSpeaking();
    stopRecognition();
    stopAudioLevel();
    if (state.socket?.connected && state.sessionId) {
      state.socket.emit("session:stop", { sessionId: state.sessionId });
    }
    state.shareRelayReady = false;
    const snapshot = JSON.parse(JSON.stringify(state.lines));
    const title = `${lang.source} → ${getTargetLabels().join(" · ") || "仅识别"}`;
    if (state.settings.autoSave && snapshot.length) {
      saveHistoryEntry({
        id: crypto.randomUUID(),
        title,
        date: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
        lines: snapshot,
      });
    }
    state.status = "idle";
    state.sessionId = null;
    setStatus(state.engineMode, false);
    updateControls();
  }

  function exportTxt() {
    exportLinesToTxt(state.lines);
  }

  function buildShareLink() {
    const viewUrl = new URL("view.html", location.href);
    const sp = new URLSearchParams({
      session: state.sessionId || "",
      theme,
      source: lang.source,
    });
    const targets = getTargetLabels();
    if (targets[0]) sp.set("target", targets[0]);
    if (targets[1]) sp.set("target2", targets[1]);
    viewUrl.search = sp.toString();
    return viewUrl.toString();
  }

  function openShare() {
    if (!state.sessionId) return toast("请先开始会话", "error");
    els.shareLink.value = buildShareLink();
    els.qrBox.innerHTML = "";
    if (typeof QRCode === "function") {
      new QRCode(els.qrBox, { text: els.shareLink.value, width: 140, height: 140 });
    }
    els.shareHint.textContent = state.shareRelayReady
      ? "扫码或复制链接，他人可实时观看识别与译文（含目标语言标签）。"
      : "分享链接已生成，但中继未连接；请启动 OAO Services 后重新开始会话，观看页才能同步字幕。";
    els.sharePopover.classList.remove("hidden");
    els.overlay.classList.remove("hidden");
  }

  function closePanels() {
    closeMenus();
    els.sidebar.classList.add("hidden");
    els.sharePopover.classList.add("hidden");
    els.overlay.classList.add("hidden");
  }

  function openSettings() {
    closeMenus();
    els.sidebar.classList.remove("hidden");
    els.overlay.classList.remove("hidden");
    switchTab("settings");
    renderSettingsPanel();
  }

  function switchTab(tab) {
    document.querySelectorAll(".sidebar-tabs .tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    $("panelSettings").classList.toggle("hidden", tab !== "settings");
    $("panelHistory").classList.toggle("hidden", tab !== "history");
  }

  els.btnStart.addEventListener("click", () => void startSession());
  els.btnPause.addEventListener("click", pauseSession);
  els.btnResume.addEventListener("click", resumeSession);
  els.btnStop.addEventListener("click", stopSession);
  els.btnSpeak.addEventListener("click", () => speakLatestLine());
  els.subtitles.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".btn-line-speak");
    if (!btn) return;
    const line = state.lines.find((l) => l.id === btn.dataset.lineId);
    if (!line) return;
    const trans = line.translations.find((t) => t.language === btn.dataset.lang);
    if (trans) void speakTranslation(line, trans, { manual: true });
  });
  els.btnExport.addEventListener("click", exportTxt);
  els.btnShare.addEventListener("click", openShare);
  els.btnSettings.addEventListener("click", openSettings);
  els.btnSwapLang?.addEventListener("click", swapLanguages);
  $("btnCloseSidebar").addEventListener("click", closePanels);
  $("btnCloseShare").addEventListener("click", closePanels);
  els.overlay.addEventListener("click", closePanels);
  els.sidebar.addEventListener("mousedown", (ev) => ev.stopPropagation());
  els.sidebar.addEventListener("click", (ev) => ev.stopPropagation());
  els.sharePopover.addEventListener("mousedown", (ev) => ev.stopPropagation());
  els.sharePopover.addEventListener("click", (ev) => ev.stopPropagation());
  $("btnCopyShare").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.shareLink.value);
      toast("链接已复制");
    } catch (_) {
      els.shareLink.select();
      toast("请手动复制链接");
    }
  });
  document.querySelectorAll(".sidebar-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab || "settings"));
  });
  els.voiceRate.addEventListener("input", () => { els.rateVal.textContent = Number(els.voiceRate.value).toFixed(2); });
  els.voicePitch.addEventListener("input", () => { els.pitchVal.textContent = Number(els.voicePitch.value).toFixed(2); });
  els.voiceVolume.addEventListener("input", () => {
    els.volVal.textContent = `${Math.round(Number(els.voiceVolume.value) * 100)}%`;
  });
  $("btnVoiceTest").addEventListener("click", () => {
    void speakRawText("您好，这是 OAO 翻译朗读测试。", "zh-CN").catch(() => {
      toast("朗读失败，请检查系统语音包", "error");
    });
  });

  initLangPickers();
  initVoicePickers();
  renderSettingsPanel();
  renderHistory();
  applyDisplaySettings();
  setStatus("browser", false);
  updateControls();
  void tryConnectServer();
  setInterval(() => {
    if (state.settings.autoReconnect && state.settings.aiPolish && state.engineMode === "browser" && !state.socket?.connected) {
      void tryConnectServer();
    }
  }, 15000);

  window.addEventListener("message", (ev) => {
    if (ev.data?.type !== "oao-translate-query-close") return;
    const recording = state.status !== "idle";
    const hasContent = state.lines.length > 0;
    try {
      ev.source?.postMessage({
        type: "oao-translate-close-state",
        recording,
        hasContent,
        lineCount: state.lines.length,
      }, ev.origin || "*");
    } catch (_) {}
  });
})();
