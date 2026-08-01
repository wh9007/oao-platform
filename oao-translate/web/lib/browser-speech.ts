import { toLanguageCode } from "@/lib/language-map";

export function resolveSpeechRecognitionLang(sourceLabel: string): string {
  const code = toLanguageCode(sourceLabel);
  if (code === "auto") {
    const nav = typeof navigator !== "undefined" ? navigator.language : "zh-CN";
    if (nav.startsWith("zh")) return "zh-CN";
    if (nav.startsWith("ja")) return "ja-JP";
    if (nav.startsWith("ko")) return "ko-KR";
    return nav || "en-US";
  }
  if (code.startsWith("zh")) return "zh-CN";
  if (code.startsWith("en")) return "en-US";
  if (code.startsWith("ja")) return "ja-JP";
  if (code.startsWith("ko")) return "ko-KR";
  if (code.startsWith("fr")) return "fr-FR";
  if (code.startsWith("de")) return "de-DE";
  if (code.startsWith("es")) return "es-ES";
  return code;
}

type BrowserSpeechOptions = {
  lang: string;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (listening: boolean) => void;
};

export type BrowserSpeechHandle = {
  stop: () => void;
};

export function isBrowserSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startBrowserSpeechRecognition(
  options: BrowserSpeechOptions
): BrowserSpeechHandle | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;

  let active = true;
  let recognition: SpeechRecognition | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearResumeTimer = () => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const create = () => {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = options.lang;

    rec.onstart = () => options.onStatus?.(true);

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = (result[0]?.transcript || "").trim();
        if (!text) continue;
        if (result.isFinal) {
          options.onFinal(text);
        } else {
          interim = text;
        }
      }
      if (interim) options.onInterim?.(interim);
    };

    rec.onerror = (event) => {
      if (!active) return;
      if (event.error === "aborted" || event.error === "no-speech") {
        scheduleStart(160);
        return;
      }
      const message =
        event.error === "not-allowed"
          ? "请允许浏览器使用麦克风"
          : event.error === "service-not-allowed"
            ? "当前环境不支持浏览器语音识别，将使用本地 Whisper"
            : `语音识别错误: ${event.error}`;
      options.onError?.(message);
      if (event.error !== "network") scheduleStart(320);
    };

    rec.onend = () => {
      options.onStatus?.(false);
      if (active) scheduleStart(80);
    };

    return rec;
  };

  const scheduleStart = (delay: number) => {
    clearResumeTimer();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!active) return;
      try {
        recognition?.start();
      } catch (err) {
        if ((err as Error)?.name === "InvalidStateError") return;
        recognition = create();
        try {
          recognition.start();
        } catch {
          /* retry on next onend */
        }
      }
    }, delay);
  };

  recognition = create();
  try {
    recognition.start();
  } catch {
    recognition = create();
    try {
      recognition.start();
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : "无法启动浏览器语音识别");
      return null;
    }
  }

  return {
    stop: () => {
      active = false;
      clearResumeTimer();
      const rec = recognition;
      recognition = null;
      if (!rec) return;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      options.onStatus?.(false);
    },
  };
}
