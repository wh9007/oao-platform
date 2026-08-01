(function (global) {
  "use strict";

  const SpeechCtor = global.SpeechRecognition || global.webkitSpeechRecognition;
  const WATCHDOG_MS = 1500;
  const RESTART_DELAY_MS = 120;

  function detectBrowserBackend() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) {
      return {
        id: "microsoft",
        label: "Microsoft Azure Speech",
        labelEn: "Microsoft Azure Speech",
      };
    }
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
      return {
        id: "google",
        label: "Google Cloud Speech",
        labelEn: "Google Cloud Speech",
      };
    }
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
      return {
        id: "apple",
        label: "Apple Speech",
        labelEn: "Apple Speech",
      };
    }
    return {
      id: "browser",
      label: "Web Speech API",
      labelEn: "Web Speech API",
    };
  }

  const PROVIDERS = [
    {
      id: "auto",
      label: "自动（推荐）",
      labelEn: "Auto (Recommended)",
      hint: "故障时依次切换下列引擎",
      hintEn: "Rotates through engines on failure",
      isAuto: true,
    },
    {
      id: "native",
      label: "浏览器原生 · Web Speech",
      labelEn: "Native · Web Speech API",
      langMode: "user",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    },
    {
      id: "global-en",
      label: "全球通用 · English STT",
      labelEn: "Global · English STT",
      langMode: "en-US",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    },
    {
      id: "multilang",
      label: "全球通用 · Multilingual",
      labelEn: "Global · Multilingual",
      langMode: "multilang",
      continuous: true,
      interimResults: true,
      maxAlternatives: 3,
    },
  ];

  const AUTO_CHAIN = ["native", "global-en", "multilang"];

  function getProvider(id) {
    return PROVIDERS.find((p) => p.id === id) || PROVIDERS[1];
  }

  function getProviderChain(preference) {
    const pref = preference || "auto";
    if (pref === "auto") {
      return AUTO_CHAIN.map((id) => getProvider(id)).filter(Boolean);
    }
    const one = getProvider(pref);
    return one && !one.isAuto ? [one] : AUTO_CHAIN.map((id) => getProvider(id));
  }

  function resolveProviderLang(provider, userLang, chainIndex) {
    if (!provider || provider.langMode === "user") return userLang || "en-US";
    if (provider.langMode === "en-US") return "en-US";
    if (provider.langMode === "multilang") {
      return chainIndex > 0 ? "en-US" : (userLang || "en-US");
    }
    return userLang || "en-US";
  }

  function formatProviderLabel(provider, uiLang, chainIndex, userLang) {
    if (!provider) return uiLang === "zh" ? "未启动" : "Idle";
    const backend = detectBrowserBackend();
    const name = uiLang === "zh" ? provider.label : (provider.labelEn || provider.label);
    if (provider.id === "native" || provider.id === "auto") {
      const backendName = uiLang === "zh" ? backend.label : backend.labelEn;
      return `${name} · ${backendName}`;
    }
    const lang = resolveProviderLang(provider, userLang, chainIndex || 0);
    return `${name} (${lang})`;
  }

  function getSettingOptions(uiLang) {
    return PROVIDERS.map((p) => ({
      value: p.id,
      label: uiLang === "zh" ? p.label : (p.labelEn || p.label),
      hint: uiLang === "zh" ? p.hint : p.hintEn,
    }));
  }

  class BrowserSttSession {
    constructor(options) {
      this.options = options || {};
      this.rec = null;
      this.running = false;
      this.listening = false;
      this.providerId = this.options.providerId || "auto";
      this.chainIndex = 0;
      this.failCount = 0;
      this.activeProvider = null;
      this.uiLang = this.options.uiLang || "zh";
      this.lastResultAt = 0;
      this.lastActivityAt = 0;
      this.watchdogTimer = null;
      this.restartTimer = null;
    }

    getChain() {
      return getProviderChain(this.providerId);
    }

    getActiveLabel() {
      return formatProviderLabel(
        this.activeProvider,
        this.uiLang,
        this.chainIndex,
        this.resolveUserLang()
      );
    }

    resolveUserLang() {
      if (typeof this.options.resolveLang === "function") {
        return this.options.resolveLang();
      }
      return navigator.language || "en-US";
    }

    notifyProvider() {
      const label = this.getActiveLabel();
      this.options.onProviderChange?.(label, this.activeProvider);
      return label;
    }

    startWatchdog() {
      this.stopWatchdog();
      this.watchdogTimer = setInterval(() => {
        if (!this.running) return;
        if (!this.listening || !this.rec) {
          this.scheduleRestart(80);
          return;
        }
        const idleMs = Date.now() - this.lastActivityAt;
        if (idleMs > 12000 && Date.now() - this.lastResultAt > 12000) {
          this.scheduleRestart(60);
        }
      }, WATCHDOG_MS);
    }

    stopWatchdog() {
      if (this.watchdogTimer) {
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
      }
    }

    scheduleRestart(delay) {
      if (!this.running) return;
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (!this.running) return;
        this.restartCurrentProvider();
      }, delay == null ? RESTART_DELAY_MS : delay);
    }

    restartCurrentProvider() {
      if (!this.running) return;
      this.stopRecOnly();
      this.listening = false;
      const chain = this.getChain();
      const provider = chain[this.chainIndex];
      if (!provider) return;
      this.attachRecognition(provider);
    }

    start() {
      if (!SpeechCtor) {
        this.options.onError?.({ error: "unsupported", fatal: true });
        return false;
      }
      this.running = true;
      this.chainIndex = 0;
      this.failCount = 0;
      this.lastResultAt = Date.now();
      this.lastActivityAt = Date.now();
      this.startWatchdog();
      return this.startCurrentProvider();
    }

    startCurrentProvider() {
      const chain = this.getChain();
      const provider = chain[this.chainIndex];
      if (!provider || !this.running) return false;
      this.activeProvider = provider;
      this.notifyProvider();
      this.stopRecOnly();
      return this.attachRecognition(provider);
    }

    attachRecognition(provider) {
      const rec = new SpeechCtor();
      rec.continuous = provider.continuous !== false;
      rec.interimResults = provider.interimResults !== false;
      rec.lang = resolveProviderLang(provider, this.resolveUserLang(), this.chainIndex);
      rec.maxAlternatives = provider.maxAlternatives || 1;

      if (typeof this.options.applyGrammar === "function") {
        this.options.applyGrammar(rec);
      }
      if (typeof this.options.beforeStart === "function") {
        this.options.beforeStart(rec, provider);
      }

      rec.onstart = () => {
        this.listening = true;
        this.lastActivityAt = Date.now();
        this.options.onStart?.(rec, provider);
      };

      rec.onresult = (ev) => {
        this.failCount = 0;
        this.lastResultAt = Date.now();
        this.lastActivityAt = Date.now();
        this.options.onResult?.(ev, rec, provider);
      };

      rec.onerror = (ev) => {
        this.lastActivityAt = Date.now();
        if (ev.error === "aborted") return;
        if (ev.error === "no-speech") {
          this.listening = false;
          if (this.running) this.scheduleRestart(200);
          return;
        }
        if (ev.error === "not-allowed") {
          this.options.onError?.({ error: ev.error, fatal: true, event: ev });
          return;
        }
        this.listening = false;
        const networkLike = ev.error === "network" || ev.error === "service-not-allowed";
        this.failCount += 1;
        if (this.tryAdvanceProvider(networkLike || this.failCount >= 2)) return;
        this.options.onError?.({ error: ev.error, fatal: false, event: ev });
        if (this.running) this.scheduleRestart(280);
      };

      rec.onend = () => {
        this.listening = false;
        if (this.running) this.scheduleRestart(90);
      };

      try {
        rec.start();
        this.rec = rec;
        return true;
      } catch (_) {
        this.listening = false;
        if (this.tryAdvanceProvider(true)) return false;
        this.scheduleRestart(200);
        return false;
      }
    }

    tryAdvanceProvider(force) {
      const chain = this.getChain();
      if (this.providerId !== "auto") return false;
      if (this.chainIndex >= chain.length - 1) return false;
      if (!force && this.failCount < 2) return false;
      this.chainIndex += 1;
      this.failCount = 0;
      const label = this.notifyProvider();
      this.options.onFallback?.(label, this.activeProvider);
      this.scheduleRestart(320);
      return true;
    }

    stopRecOnly() {
      if (!this.rec) return;
      const rec = this.rec;
      this.rec = null;
      this.listening = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try { rec.abort(); } catch (_) {
        try { rec.stop(); } catch (e) {}
      }
    }

    stop() {
      this.running = false;
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.stopWatchdog();
      this.stopRecOnly();
      this.activeProvider = null;
      this.chainIndex = 0;
      this.failCount = 0;
    }

    getRecognition() {
      return this.rec;
    }
  }

  global.OAOBrowserSTT = {
    SpeechCtor,
    PROVIDERS,
    AUTO_CHAIN,
    detectBrowserBackend,
    getProvider,
    getProviderChain,
    resolveProviderLang,
    formatProviderLabel,
    getSettingOptions,
    createSession(options) {
      return new BrowserSttSession(options);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
