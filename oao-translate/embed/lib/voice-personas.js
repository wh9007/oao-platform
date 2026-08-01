(function (global) {
  "use strict";

  const FEMALE_HINT = /huihui|xiaoxiao|xiaoyi|yaoyao|meijia|tingting|lili|susan|zira|samantha|victoria|linda|helen|anna|maria|yuki|sora|female|woman|girl|jenny|aria|晓晓|小艺|慧慧|女/i;
  const MALE_HINT = /yunjian|yunfeng|yunhao|yunyang|kangkang|david|mark|george|james|richard|daniel|guy|ryan|brian|male|男|云健|云枫|云扬|康康/i;
  const NEUTRAL_MALE_HINT = /yunxi|云希/i;

  const PERSONA_HINTS = {
    natural: { male: ["Kangkang", "康康", "Yunxi", "云希", "David", "Guy"], female: ["Xiaoxiao", "晓晓", "Huihui", "慧慧", "Zira"] },
    news: { male: ["Yunjian", "云健", "Kangkang", "David", "George"], female: ["Huihui", "慧慧", "Susan", "Jenny"] },
    gentle: { male: ["Yunxi", "云希", "Yunyang"], female: ["Xiaoyi", "小艺", "Yaoyao", "Aria"] },
    steady: { male: ["Yunfeng", "云枫", "David", "Richard", "George"], female: ["Huihui", "Xiaoxiao", "Helen"] },
    energetic: { male: ["Yunyang", "云扬", "Ryan", "Guy"], female: ["Xiaoxiao", "晓晓", "Aria", "Jenny"] },
    story: { male: ["Yunxi", "云希", "Daniel", "James"], female: ["Xiaoyi", "Meijia", "Samantha"] },
    formal: { male: ["Yunjian", "云健", "George", "Richard"], female: ["Huihui", "Susan", "Helen"] },
    slow: { male: ["Yunxi", "Kangkang", "David"], female: ["Huihui", "Xiaoyi", "Zira"] },
    cheerful: { male: ["Yunyang", "Ryan", "Guy"], female: ["Xiaoxiao", "Yaoyao", "Jenny", "Aria"] },
  };

  const STYLE_PRESETS = [
    { id: "natural", label: "自然对话", rate: 1, pitch: 1, volume: 1, gender: "auto", richText: false },
    { id: "news", label: "新闻播报", rate: 0.84, pitch: 0.72, volume: 1, gender: "male", richText: true },
    { id: "gentle", label: "温柔亲切", rate: 0.78, pitch: 1.22, volume: 0.9, gender: "female", richText: true },
    { id: "steady", label: "专业沉稳", rate: 0.86, pitch: 0.74, volume: 0.96, gender: "male", richText: true },
    { id: "energetic", label: "活力明快", rate: 1.18, pitch: 1.2, volume: 1, gender: "female", richText: false },
    { id: "story", label: "讲述叙事", rate: 0.82, pitch: 0.92, volume: 0.94, gender: "male", richText: true },
    { id: "formal", label: "严肃正式", rate: 0.8, pitch: 0.68, volume: 0.98, gender: "male", richText: true },
    { id: "slow", label: "慢速清晰", rate: 0.68, pitch: 0.94, volume: 1, gender: "auto", richText: true },
    { id: "cheerful", label: "热情欢快", rate: 1.22, pitch: 1.26, volume: 1, gender: "female", richText: false },
  ];

  function getStylePreset(styleId) {
    return STYLE_PRESETS.find((s) => s.id === styleId) || STYLE_PRESETS[0];
  }

  function voiceKey(v) {
    return `${v.name} ${v.voiceURI}`.toLowerCase();
  }

  function scoreGender(voice, gender) {
    if (gender === "auto") return 0;
    const name = voiceKey(voice);
    if (gender === "female") {
      if (FEMALE_HINT.test(name) && !MALE_HINT.test(name) && !NEUTRAL_MALE_HINT.test(name)) return 10;
      if (MALE_HINT.test(name) || NEUTRAL_MALE_HINT.test(name)) return -12;
      return -1;
    }
    if (MALE_HINT.test(name) && !FEMALE_HINT.test(name)) return 10;
    if (NEUTRAL_MALE_HINT.test(name) && !FEMALE_HINT.test(name)) return 8;
    if (FEMALE_HINT.test(name)) return -12;
    return -1;
  }

  function filterByGender(pool, gender) {
    if (gender === "auto") return pool;
    const matched = pool.filter((voice) => scoreGender(voice, gender) > 0);
    if (matched.length) return matched;
    const soft = pool.filter((voice) => scoreGender(voice, gender) >= 0);
    return soft.length ? soft : pool;
  }

  function pickVoice(voices, langHint, gender, styleId) {
    if (!voices.length) return null;
    const style = getStylePreset(styleId);
    const preferGender = gender === "auto" ? (style.gender || "auto") : gender;
    const lang = (langHint || "zh").toLowerCase().slice(0, 2);
    let pool = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
    if (!pool.length) pool = voices.filter((v) => /zh|cmn|yue|wuu/i.test(v.lang));
    if (!pool.length) pool = voices.slice();

    pool = filterByGender(pool, preferGender);

    const hints = PERSONA_HINTS[styleId] || PERSONA_HINTS.natural;
    const prefer = preferGender === "male"
      ? hints.male
      : preferGender === "female"
        ? hints.female
        : hints.male.concat(hints.female);

    let best = null;
    let bestScore = -999;
    for (const voice of pool) {
      let score = scoreGender(voice, preferGender);
      const name = voiceKey(voice);
      for (let i = 0; i < prefer.length; i++) {
        if (name.includes(prefer[i].toLowerCase())) score += 18 - i * 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = voice;
      }
    }
    return best || pool[0] || voices[0];
  }

  function prepareSpeechText(text, styleId) {
    const raw = String(text || "").trim();
    if (!raw) return raw;
    const style = getStylePreset(styleId);
    if (!style.richText) return raw;
    return raw
      .replace(/([，,])/g, "$1 ")
      .replace(/([。！？；：.!?;:])/g, "$1  ")
      .replace(/(\.{3}|…)/g, "$1  ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function applyUtteranceStyle(utterance, styleId, userControls) {
    const style = getStylePreset(styleId);
    const userRate = Number(userControls?.rate ?? 1);
    const userPitch = Number(userControls?.pitch ?? 1);
    const userVolume = Number(userControls?.volume ?? 1);
    utterance.rate = clamp(userRate * style.rate, 0.5, 2);
    utterance.pitch = clamp(userPitch * style.pitch, 0.5, 2);
    utterance.volume = clamp(userVolume * style.volume, 0.2, 1);
    return style;
  }

  function waitForVoices(timeoutMs) {
    timeoutMs = timeoutMs || 3500;
    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve([]);
    const existing = synth.getVoices();
    if (existing.length) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", finish);
        resolve(synth.getVoices());
      };
      synth.addEventListener("voiceschanged", finish);
      setTimeout(finish, timeoutMs);
    });
  }

  global.OAOVoice = {
    STYLE_PRESETS,
    getStylePreset,
    pickVoice,
    prepareSpeechText,
    applyUtteranceStyle,
    waitForVoices,
    scoreGender,
    filterByGender,
  };
})(typeof window !== "undefined" ? window : globalThis);
