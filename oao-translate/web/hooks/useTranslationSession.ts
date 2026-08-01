"use client";



import { useCallback, useEffect, useRef, useState } from "react";

import {

  isBrowserSpeechSupported,

  resolveSpeechRecognitionLang,

  startBrowserSpeechRecognition,

} from "@/lib/browser-speech";

import { createAudioLevelMonitor, startPcmWavCapture, type PcmCaptureHandle } from "@/lib/audio-utils";

import { toLanguageCode, toLanguageCodes, toLanguageLabel } from "@/lib/language-map";

import { Settings, SessionStatus, TranscriptLine, TranslationResult } from "@/types/session";



const DEFAULT_PROVIDER =

  process.env.NEXT_PUBLIC_TRANSLATE_PROVIDER === "openai" ? "openai" : "ollama";

const FLUSH_INTERVAL_MS = 2800;



type SocketApi = {

  connected: boolean;

  emit: (event: string, data: unknown, ack?: (response: { ok: boolean; error?: string; data?: { id?: string } }) => void) => void;

};



type SessionOptions = {

  socket: SocketApi;

  sourceLanguage: string;

  targetLanguages: string[];

  settings: Settings;

  onLine: (line: TranscriptLine) => void;

  onAudioLevel?: (level: number) => void;

  onProcessing?: (processing: boolean) => void;

};



function formatTime(ts: number): string {

  return new Intl.DateTimeFormat("zh-CN", {

    hour: "2-digit",

    minute: "2-digit",

    second: "2-digit",

  }).format(new Date(ts));

}



function mergeTranslation(

  line: TranscriptLine,

  entry: { text: string; language?: string }

): TranscriptLine {

  const langCode = (entry.language ?? "en").toLowerCase();

  const langLabel = toLanguageLabel(langCode);

  const existing = line.translations ?? [];

  const index = existing.findIndex((item) => item.language === langCode);

  const nextItem: TranslationResult = { language: langCode, label: langLabel, text: entry.text };

  const translations =

    index >= 0 ? existing.map((item, i) => (i === index ? nextItem : item)) : [...existing, nextItem];

  return {

    ...line,

    translation: translations.map((item) => item.text).join("\n"),

    translations,

    language: translations.map((item) => item.label).join(" · "),

  };

}



export function useTranslationSession(options: SessionOptions) {

  const { socket, sourceLanguage, targetLanguages, settings, onLine, onAudioLevel, onProcessing } =

    options;

  const [status, setStatus] = useState<SessionStatus>("idle");

  const [lines, setLines] = useState<TranscriptLine[]>([]);

  const [sessionId, setSessionId] = useState<string | null>(null);

  const [processing, setProcessing] = useState(false);

  const [audioLevel, setAudioLevel] = useState(0);

  const [lastError, setLastError] = useState<string | null>(null);

  const [interimText, setInterimText] = useState("");



  const streamRef = useRef<MediaStream | null>(null);

  const sessionIdRef = useRef<string | null>(null);

  const statusRef = useRef<SessionStatus>("idle");

  const pcmCaptureRef = useRef<PcmCaptureHandle | null>(null);

  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLevelMonitorRef = useRef<(() => void) | null>(null);

  const stopBrowserSpeechRef = useRef<(() => void) | null>(null);

  const browserSpeechEnabledRef = useRef(false);

  const lastBrowserFinalRef = useRef("");

  const sourceLanguageRef = useRef(sourceLanguage);



  useEffect(() => {

    statusRef.current = status;

  }, [status]);



  useEffect(() => {

    sourceLanguageRef.current = sourceLanguage;

  }, [sourceLanguage]);



  useEffect(() => {

    onProcessing?.(processing);

  }, [onProcessing, processing]);



  useEffect(() => {

    onAudioLevel?.(audioLevel);

  }, [audioLevel, onAudioLevel]);



  const appendLine = useCallback(

    (partial: Omit<TranscriptLine, "id">) => {

      const line: TranscriptLine = { id: crypto.randomUUID(), ...partial };

      setLines((prev) => [...prev, line]);

      onLine(line);

    },

    [onLine]

  );



  const emitTranscriptText = useCallback(

    (text: string) => {

      const activeSessionId = sessionIdRef.current;

      const trimmed = text.trim();

      if (!activeSessionId || !trimmed || statusRef.current !== "recording") return;

      if (trimmed === lastBrowserFinalRef.current) return;

      lastBrowserFinalRef.current = trimmed;



      socket.emit("text:transcript", { sessionId: activeSessionId, text: trimmed }, (response) => {

        if (response?.ok === false && response.error) {

          setLastError(response.error);

        }

      });

    },

    [socket]

  );



  const flushAudio = useCallback(async () => {

    const activeSessionId = sessionIdRef.current;

    if (!activeSessionId || statusRef.current !== "recording") return;

    if (!pcmCaptureRef.current) return;



    setProcessing(true);

    try {

      const wav = await pcmCaptureRef.current.requestFlush();

      if (!wav || wav.size < 600) return;



      await new Promise<void>((resolve, reject) => {

        void wav.arrayBuffer().then((buffer) => {

          socket.emit("audio:chunk", { sessionId: activeSessionId, audio: buffer }, (response) => {

            if (response?.ok === false) {

              reject(new Error(response.error ?? "音频上传失败"));

              return;

            }

            resolve();

          });

        });

      });

    } catch (error) {

      const message = error instanceof Error ? error.message : "音频处理失败";

      setLastError(message);

      console.warn("[OAO翻译] 音频发送失败:", error);

    } finally {

      setProcessing(false);

    }

  }, [socket]);



  const stopBrowserSpeech = useCallback(() => {

    stopBrowserSpeechRef.current?.();

    stopBrowserSpeechRef.current = null;

    browserSpeechEnabledRef.current = false;

    setInterimText("");

  }, []);



  const startBrowserSpeech = useCallback(() => {

    stopBrowserSpeech();

    if (!isBrowserSpeechSupported()) return;



    const lang = resolveSpeechRecognitionLang(sourceLanguageRef.current);

    const handle = startBrowserSpeechRecognition({

      lang,

      onInterim: (text) => setInterimText(text),

      onFinal: (text) => {

        setInterimText("");

        emitTranscriptText(text);

      },

      onError: (message) => {

        if (message.includes("Whisper")) {

          browserSpeechEnabledRef.current = false;

        }

        setLastError(message);

      },

    });



    if (!handle) return;

    browserSpeechEnabledRef.current = true;

    stopBrowserSpeechRef.current = handle.stop;

  }, [emitTranscriptText, stopBrowserSpeech]);



  const cleanupCapture = useCallback(() => {

    if (flushTimerRef.current) {

      clearInterval(flushTimerRef.current);

      flushTimerRef.current = null;

    }

    stopBrowserSpeech();

    stopLevelMonitorRef.current?.();

    stopLevelMonitorRef.current = null;

    pcmCaptureRef.current?.stop();

    pcmCaptureRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());

    streamRef.current = null;

    setAudioLevel(0);

    setInterimText("");

    lastBrowserFinalRef.current = "";

  }, [stopBrowserSpeech]);



  const start = useCallback(async () => {

    if (!socket.connected) throw new Error("Socket not connected");

    if (typeof window !== "undefined" && !window.isSecureContext) {

      throw new Error("语音识别需要 HTTPS 或 localhost 环境，请通过 OAO 本地服务打开");

    }



    setLastError(null);

    const codes = toLanguageCodes(targetLanguages);



    await new Promise<void>((resolve, reject) => {

      socket.emit(

        "session:start",

        {

          provider: DEFAULT_PROVIDER,

          sourceLanguage: toLanguageCode(sourceLanguage),

          targetLanguage: codes[0] || "en",

          targetLanguages: codes,

          settings,

        },

        (response) => {

          if (!response?.ok || !response.data?.id) {

            reject(new Error(response?.error ?? "Failed to start session"));

            return;

          }

          sessionIdRef.current = response.data.id;

          setSessionId(response.data.id);

          resolve();

        }

      );

    });



    statusRef.current = "recording";

    setStatus("recording");



    const constraints: MediaTrackConstraints = {

      echoCancellation: settings.noiseReduction,

      noiseSuppression: settings.noiseReduction,

      autoGainControl: settings.noiseReduction,

    };

    streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: constraints });

    stopLevelMonitorRef.current = createAudioLevelMonitor(streamRef.current, setAudioLevel);

    pcmCaptureRef.current = startPcmWavCapture(streamRef.current, { minDurationSec: 0.8 });



    flushTimerRef.current = setInterval(() => {

      void flushAudio();

    }, FLUSH_INTERVAL_MS);



    startBrowserSpeech();

    setLines([]);

  }, [flushAudio, settings, socket, sourceLanguage, startBrowserSpeech, targetLanguages]);



  const pause = useCallback(() => {

    const activeSessionId = sessionIdRef.current;

    if (!activeSessionId) return;

    if (flushTimerRef.current) {

      clearInterval(flushTimerRef.current);

      flushTimerRef.current = null;

    }

    stopBrowserSpeech();

    socket.emit("session:pause", { sessionId: activeSessionId });

    statusRef.current = "paused";

    setStatus("paused");

    setAudioLevel(0);

  }, [socket, stopBrowserSpeech]);



  const resume = useCallback(() => {

    const activeSessionId = sessionIdRef.current;

    if (!activeSessionId) return;

    flushTimerRef.current = setInterval(() => {

      void flushAudio();

    }, FLUSH_INTERVAL_MS);

    startBrowserSpeech();

    socket.emit("session:resume", { sessionId: activeSessionId });

    statusRef.current = "recording";

    setStatus("recording");

  }, [flushAudio, socket, startBrowserSpeech]);



  const stop = useCallback(() => {

    const activeSessionId = sessionIdRef.current;

    void flushAudio();

    cleanupCapture();

    if (activeSessionId) socket.emit("session:stop", { sessionId: activeSessionId });

    sessionIdRef.current = null;

    setSessionId(null);

    statusRef.current = "idle";

    setStatus("idle");

    setProcessing(false);

  }, [cleanupCapture, flushAudio, socket]);



  const updateLanguages = useCallback(

    (nextSource: string, nextTargets: string[]) => {

      const activeSessionId = sessionIdRef.current;

      if (!activeSessionId) return;

      const codes = toLanguageCodes(nextTargets);

      socket.emit("settings:update", {

        sessionId: activeSessionId,

        sourceLanguage: toLanguageCode(nextSource),

        targetLanguage: codes[0],

        targetLanguages: codes,

      });

      if (statusRef.current === "recording") {

        startBrowserSpeech();

      }

    },

    [socket, startBrowserSpeech]

  );



  const handleTranscript = useCallback(

    (entry: { id: string; text: string; timestamp: number; isFinal?: boolean }) => {

      if (entry.isFinal === false) return;

      appendLine({

        source: entry.text,

        translation: "",

        translations: [],

        language: sourceLanguage,

        time: settings.timestamp ? formatTime(entry.timestamp) : "",

      });

    },

    [appendLine, settings.timestamp, sourceLanguage]

  );



  const handleTranslation = useCallback(

    (entry: { id: string; text: string; timestamp: number; language?: string }) => {

      setLines((prev) => {

        if (prev.length === 0) {

          const line = mergeTranslation(

            {

              id: entry.id,

              source: "",

              translation: "",

              translations: [],

              language: "",

              time: settings.timestamp ? formatTime(entry.timestamp) : "",

            },

            entry

          );

          onLine(line);

          return [line];

        }

        const next = [...prev];

        const updated = mergeTranslation(next[next.length - 1], entry);

        next[next.length - 1] = updated;

        onLine(updated);

        return next;

      });

    },

    [onLine, settings.timestamp]

  );



  useEffect(() => () => cleanupCapture(), [cleanupCapture]);



  return {

    status,

    lines,

    sessionId,

    processing,

    audioLevel,

    lastError,

    interimText,

    setLines,

    start,

    pause,

    resume,

    stop,

    updateLanguages,

    handleTranscript,

    handleTranslation,

  };

}


