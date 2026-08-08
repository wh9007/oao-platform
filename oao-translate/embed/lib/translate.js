(function (global) {
  "use strict";

  const LANG_CODES = {
    "Auto Detect": "auto",
    中文: "zh",
    English: "en",
    日本語: "ja",
    한국어: "ko",
    Français: "fr",
    Deutsch: "de",
    Español: "es",
    Italiano: "it",
    Português: "pt",
    Русский: "ru",
    العربية: "ar",
    ไทย: "th",
    "Tiếng Việt": "vi",
    "Bahasa Indonesia": "id",
    Hindi: "hi",
  };

  const CODE_LABELS = Object.fromEntries(
    Object.entries(LANG_CODES)
      .filter(([k]) => k !== "Auto Detect")
      .map(([k, v]) => [v, k])
  );

  function toCode(label) {
    return LANG_CODES[label] || String(label || "").toLowerCase();
  }

  function toLabel(code) {
    return CODE_LABELS[(code || "").toLowerCase()] || code;
  }

  function pairCode(code) {
    const c = (code || "en").toLowerCase().slice(0, 2);
    return c === "auto" ? "en" : c;
  }

  function resolveSourceCode(sourceLabel, text) {
    const code = toCode(sourceLabel);
    if (code !== "auto") return code;
    if (/[\u4e00-\u9fff]/.test(text)) return "zh";
    if (/[a-zA-Z]/.test(text)) return "en";
    return "en";
  }

  function fetchTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function translateMyMemory(text, src, tgt) {
    const s = pairCode(src);
    const t = pairCode(tgt);
    if (s === t) return text;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${s}|${t}`;
    const res = await fetchTimeout(url, 9000);
    if (!res.ok) throw new Error("mymemory-http");
    const data = await res.json();
    const out = data?.responseData?.translatedText?.trim();
    if (!out || out.toUpperCase() === "AUTO") throw new Error("mymemory-empty");
    return out;
  }

  async function translateLibre(text, src, tgt) {
    const body = {
      q: text,
      source: pairCode(src) === "auto" ? "auto" : pairCode(src),
      target: pairCode(tgt),
      format: "text",
    };
    const post = await fetch("https://libretranslate.com/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (!post.ok) throw new Error("libre-http");
    const data = await post.json();
    const out = data?.translatedText?.trim();
    if (!out) throw new Error("libre-empty");
    return out;
  }

  async function translateOnline(text, sourceLabel, targetCode) {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const src = resolveSourceCode(sourceLabel, trimmed);
    const tgt = pairCode(targetCode);
    if (pairCode(src) === tgt) return trimmed;
    try {
      return await translateMyMemory(trimmed, src, tgt);
    } catch (_) {
      try {
        return await translateLibre(trimmed, src, tgt);
      } catch (e) {
        throw new Error("translate-unavailable");
      }
    }
  }

  global.OAOTranslate = { LANG_CODES, toCode, toLabel, resolveSourceCode, translateOnline };
})(typeof window !== "undefined" ? window : globalThis);
